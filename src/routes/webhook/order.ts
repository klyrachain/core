import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { PaymentProvider, IdentityType, TransactionType } from "../../../prisma/generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { addPollJob } from "../../lib/queue.js";
import { getFeeForOrder } from "../../services/fee.service.js";
import { sendToAdminDashboard } from "../../services/admin-dashboard.service.js";
import { validateProviderPayload } from "../../services/provider.server.js";

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
  f_price: z.coerce.number().nonnegative(),
  t_price: z.coerce.number().nonnegative(),
  f_chain: z.string().min(1).optional().default("ETHEREUM"),
  t_chain: z.string().min(1).optional().default("ETHEREUM"),
  f_token: z.string().min(1),
  t_token: z.string().min(1),
  f_provider: z.nativeEnum(PaymentProvider).optional().default(PaymentProvider.NONE),
  t_provider: z.nativeEnum(PaymentProvider).optional().default(PaymentProvider.NONE),
  providerSessionId: z.string().min(1).optional().nullable(),
  requestId: z.string().uuid().optional().nullable(),
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

    const providerValidation = validateProviderPayload({
      action: body.action,
      fromIdentifier: body.fromIdentifier,
      fromType: body.fromType,
      toIdentifier: body.toIdentifier,
      toType: body.toType,
      f_provider: body.f_provider,
      t_provider: body.t_provider,
      f_chain: body.f_chain,
      t_chain: body.t_chain,
      f_token: body.f_token,
      t_token: body.t_token,
    });
    if (!providerValidation.valid) {
      notifyAdminOrder(
        {
          event: "order.rejected",
          data: {
            reason: "provider_validation_failed",
            error: providerValidation.error,
            code: providerValidation.code,
            body: req.body,
          },
        },
        req.log
      );
      return reply.status(400).send({
        success: false,
        error: providerValidation.error,
        code: providerValidation.code,
      });
    }

    try {
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
          f_price: body.f_price,
          t_price: body.t_price,
          f_chain: body.f_chain,
          t_chain: body.t_chain,
          f_token: body.f_token,
          t_token: body.t_token,
          f_provider: body.f_provider,
          t_provider: body.t_provider,
          providerSessionId: body.providerSessionId ?? null,
          requestId: body.requestId ?? null,
        },
      });

      await addPollJob(transaction.id);

      const feeQuote = getFeeForOrder({
        action: body.action,
        f_amount: body.f_amount,
        t_amount: body.t_amount,
        f_price: body.f_price,
        t_price: body.t_price,
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
            f_price: body.f_price,
            t_price: body.t_price,
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
