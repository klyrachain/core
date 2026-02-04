import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { PaymentProvider, IdentityType, TransactionType } from "../../../prisma/generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { addPollJob } from "../../lib/queue.js";
import { getStoredQuote } from "../../lib/redis.js";
import { getFeeForOrder } from "../../services/fee.service.js";
import { deriveTransactionPrices, derivePricesFromAmounts } from "../../services/transaction-price.service.js";
import { sendToAdminDashboard } from "../../services/admin-dashboard.service.js";
import { validateOrder, storeFailedValidation, type OrderValidationInput } from "../../services/order-validation.service.js";

const OrderWebhookSchema = z.object({
  action: z.enum(["buy", "sell", "request", "claim"]),
  fromIdentifier: z.string().optional().nullable(),
  fromType: z.nativeEnum(IdentityType).optional().nullable(),
  fromUserId: z.string().uuid().optional().nullable(),
  toIdentifier: z.string().optional().nullable(),
  toType: z.nativeEnum(IdentityType).optional().nullable(),
  toUserId: z.string().uuid().optional().nullable(),
  f_amount: z.coerce.number().positive(),
  t_amount: z.coerce.number().positive(),
  f_price: z.coerce.number().nonnegative().optional(),
  t_price: z.coerce.number().nonnegative().optional(),
  f_chain: z.string().min(1).optional().default("ETHEREUM"),
  t_chain: z.string().min(1).optional().default("ETHEREUM"),
  f_token: z.string().min(1),
  t_token: z.string().min(1),
  f_provider: z.nativeEnum(PaymentProvider),
  t_provider: z.nativeEnum(PaymentProvider),
  providerSessionId: z.string().min(1).optional().nullable(),
  requestId: z.string().uuid().optional().nullable(),
  quoteId: z.string().uuid().optional().nullable(),
  providerPrice: z.coerce.number().nonnegative().optional().nullable(), // provider quote at order time (e.g. onramp basePrice) for P&L
});

type OrderWebhookBody = z.infer<typeof OrderWebhookSchema>;

const actionToType: Record<OrderWebhookBody["action"], TransactionType> = {
  buy: TransactionType.BUY,
  sell: TransactionType.SELL,
  request: TransactionType.REQUEST,
  claim: TransactionType.CLAIM,
};

/** Notify admin dashboard for every incoming order (accepted or rejected). Never throws. */
function notifyAdminOrder(
  payload: { event: string; data: Record<string, unknown> },
  log: FastifyRequest["log"]
): void {
  sendToAdminDashboard(payload).catch((err) =>
    log.warn({ err, event: payload.event }, "Admin webhook failed")
  );
}

export async function orderWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: unknown }>("/webhook/order", async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
    const parse = OrderWebhookSchema.safeParse(req.body);
    if (!parse.success) {
      notifyAdminOrder(
        {
          event: "order.rejected",
          data: {
            reason: "validation_failed",
            error: "Validation failed",
            details: parse.error.flatten(),
            body: req.body,
          },
        },
        req.log
      );
      return reply.status(400).send({
        success: false,
        error: "Validation failed",
        details: parse.error.flatten(),
      });
    }

    const body = parse.data;
    const type = actionToType[body.action];

    const resolvedPrices =
      body.f_price != null && body.t_price != null
        ? { f_price: body.f_price, t_price: body.t_price }
        : derivePricesFromAmounts(body.action, body.f_amount, body.t_amount);

    const validationInput: OrderValidationInput = {
      action: body.action,
      fromIdentifier: body.fromIdentifier,
      fromType: body.fromType,
      fromUserId: body.fromUserId,
      toIdentifier: body.toIdentifier,
      toType: body.toType,
      toUserId: body.toUserId,
      f_amount: body.f_amount,
      t_amount: body.t_amount,
      f_price: resolvedPrices.f_price,
      t_price: resolvedPrices.t_price,
      f_chain: body.f_chain,
      t_chain: body.t_chain,
      f_token: body.f_token,
      t_token: body.t_token,
      f_provider: body.f_provider,
      t_provider: body.t_provider,
      requestId: body.requestId,
      quoteId: body.quoteId,
    };

    const validation = await validateOrder(validationInput);
    if (!validation.valid) {
      await storeFailedValidation(validationInput, { error: validation.error, code: validation.code }).catch((err) =>
        req.log.warn({ err }, "Store failed validation")
      );
      notifyAdminOrder(
        {
          event: "order.rejected",
          data: {
            reason: "validation_failed",
            error: validation.error,
            code: validation.code,
            body: req.body,
          },
        },
        req.log
      );
      return reply.status(400).send({
        success: false,
        error: validation.error,
        code: validation.code,
      });
    }

    try {
      // Fee = platform gain = (platform price − provider price) × quantity. We need provider quote at order time.
      // Set from body.providerPrice or from stored quote (basePrice) when quoteId is sent. Clients should send quoteId
      // so providerPrice is stored and computeTransactionFee() at completion returns accurate fee.
      let providerPrice: number | null = body.providerPrice ?? null;
      if (providerPrice == null && body.quoteId) {
        const raw = await getStoredQuote(body.quoteId);
        if (raw) {
          try {
            const quote = JSON.parse(raw) as { basePrice?: string; debug?: { basePrice?: string } };
            const fromQuote = quote.basePrice ?? quote.debug?.basePrice;
            if (fromQuote != null) {
              const parsed = parseFloat(fromQuote);
              if (Number.isFinite(parsed)) providerPrice = parsed;
            }
          } catch {
            // ignore parse / missing basePrice
          }
        }
      }

      const prices = deriveTransactionPrices({
        f_token: body.f_token,
        t_token: body.t_token,
        f_price: resolvedPrices.f_price,
        t_price: resolvedPrices.t_price,
        f_amount: body.f_amount,
        t_amount: body.t_amount,
        action: body.action,
      });

      const transaction = await prisma.transaction.create({
        data: {
          type,
          status: "PENDING",
          fromIdentifier: body.fromIdentifier ?? null,
          fromType: body.fromType ?? null,
          fromUserId: body.fromUserId ?? null,
          toIdentifier: body.toIdentifier ?? null,
          toType: body.toType ?? null,
          toUserId: body.toUserId ?? null,
          f_amount: body.f_amount,
          t_amount: body.t_amount,
          exchangeRate: prices.exchangeRate,
          f_tokenPriceUsd: prices.f_tokenPriceUsd,
          t_tokenPriceUsd: prices.t_tokenPriceUsd,
          f_chain: body.f_chain,
          t_chain: body.t_chain,
          f_token: body.f_token,
          t_token: body.t_token,
          f_provider: body.f_provider,
          t_provider: body.t_provider,
          providerSessionId: body.providerSessionId ?? null,
          requestId: body.requestId ?? null,
          providerPrice,
        },
      });

      await addPollJob(transaction.id);

      const feeQuote = getFeeForOrder({
        action: body.action,
        f_amount: body.f_amount,
        t_amount: body.t_amount,
        f_price: resolvedPrices.f_price,
        t_price: resolvedPrices.t_price,
        f_token: body.f_token,
        t_token: body.t_token,
      });

      notifyAdminOrder(
        {
          event: "order.created",
          data: {
            transactionId: transaction.id,
            action: body.action,
            type: transaction.type,
            status: transaction.status,
            fromIdentifier: body.fromIdentifier ?? null,
            toIdentifier: body.toIdentifier ?? null,
            fromUserId: body.fromUserId ?? null,
            toUserId: body.toUserId ?? null,
            requestId: body.requestId ?? null,
            f_amount: body.f_amount,
            t_amount: body.t_amount,
            exchangeRate: prices.exchangeRate,
            f_tokenPriceUsd: prices.f_tokenPriceUsd,
            t_tokenPriceUsd: prices.t_tokenPriceUsd,
            f_chain: body.f_chain,
            t_chain: body.t_chain,
            f_token: body.f_token,
            t_token: body.t_token,
            feeAmount: feeQuote.feeAmount,
            feePercent: feeQuote.feePercent,
            totalCost: feeQuote.totalCost,
            profit: feeQuote.profit,
          },
        },
        req.log
      );

      return reply.status(201).send({
        success: true,
        data: {
          id: transaction.id,
          status: transaction.status,
          type: transaction.type,
        },
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Something went wrong.";
      notifyAdminOrder(
        {
          event: "order.rejected",
          data: {
            reason: "server_error",
            error: errorMessage,
            action: body.action,
            f_chain: body.f_chain,
            t_chain: body.t_chain,
            f_token: body.f_token,
            t_token: body.t_token,
            f_amount: body.f_amount,
            t_amount: body.t_amount,
          },
        },
        req.log
      );
      req.log.error({ err }, "Webhook order create failed");
      return reply.status(500).send({
        success: false,
        error: "Something went wrong.",
      });
    }
  });
}
