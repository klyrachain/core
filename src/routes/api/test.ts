/**
 * Test endpoints: testnet-only order creation for E2E and testing.
 * Use /api/test/offramp/order and /api/test/onramp/order for testnet flows.
 * Main flows use /webhook/order (mainnet validation).
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { PaymentProvider, IdentityType, TransactionType } from "../../../prisma/generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { addPollJob } from "../../lib/queue.js";
import { getStoredQuote } from "../../lib/redis.js";
import { getFeeForOrder } from "../../services/fee.service.js";
import { onRequestPaymentSettled } from "../../services/request-settlement.service.js";
import { deriveTransactionPrices, derivePricesFromAmounts } from "../../services/transaction-price.service.js";
import { sendToAdminDashboard } from "../../services/admin-dashboard.service.js";
import { validateOrderForTestnet } from "../../services/order-validation-test.service.js";
import type { OrderValidationInput } from "../../services/order-validation.service.js";

const OrderBodySchema = z.object({
  action: z.enum(["buy", "sell"]),
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
  f_chain: z.string().min(1),
  t_chain: z.string().min(1),
  f_token: z.string().min(1),
  t_token: z.string().min(1),
  f_provider: z.nativeEnum(PaymentProvider),
  t_provider: z.nativeEnum(PaymentProvider),
  providerSessionId: z.string().min(1).optional().nullable(),
  requestId: z.string().uuid().optional().nullable(),
  quoteId: z.string().uuid().optional().nullable(),
  providerPrice: z.coerce.number().nonnegative().optional().nullable(),
});

type OrderBody = z.infer<typeof OrderBodySchema>;

const actionToType = { buy: TransactionType.BUY, sell: TransactionType.SELL } as const;

function notifyAdminOrder(
  payload: { event: string; data: Record<string, unknown> },
  log: FastifyRequest["log"]
): void {
  sendToAdminDashboard(payload).catch((err) =>
    log.warn({ err, event: payload.event }, "Admin webhook failed")
  );
}

async function createTestOrder(
  req: FastifyRequest<{ Body: unknown }>,
  reply: FastifyReply,
  body: OrderBody,
  expectedAction: "buy" | "sell"
): Promise<void> {
  if (body.action !== expectedAction) {
    return reply.status(400).send({
      success: false,
      error: `This endpoint expects action "${expectedAction}". Got: ${body.action}`,
    });
  }

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

  const validation = await validateOrderForTestnet(validationInput);
  if (!validation.valid) {
    notifyAdminOrder(
      { event: "order.rejected", data: { reason: "test_validation_failed", error: validation.error, code: validation.code, body } },
      req.log
    );
    return reply.status(400).send({
      success: false,
      error: validation.error,
      code: validation.code,
    });
  }

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
        // ignore
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
        source: "test",
        transactionId: transaction.id,
        action: body.action,
        type: transaction.type,
        status: transaction.status,
        fromIdentifier: body.fromIdentifier ?? null,
        toIdentifier: body.toIdentifier ?? null,
        f_amount: body.f_amount,
        t_amount: body.t_amount,
        exchangeRate: prices.exchangeRate,
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
}

export async function testApiRoutes(app: FastifyInstance): Promise<void> {
  /** POST /api/test/offramp/order — create sell order (testnet f_chain only, e.g. BASE SEPOLIA). */
  app.post<{ Body: unknown }>("/api/test/offramp/order", async (req, reply) => {
    const parse = OrderBodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({
        success: false,
        error: "Validation failed",
        details: parse.error.flatten(),
      });
    }
    return createTestOrder(req, reply, parse.data, "sell");
  });

  /** POST /api/test/onramp/order — create buy order (testnet t_chain only, e.g. BASE SEPOLIA). */
  app.post<{ Body: unknown }>("/api/test/onramp/order", async (req, reply) => {
    const parse = OrderBodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({
        success: false,
        error: "Validation failed",
        details: parse.error.flatten(),
      });
    }
    return createTestOrder(req, reply, parse.data, "buy");
  });

  /** POST /api/test/request/simulate-payment — mark REQUEST transaction COMPLETED and run settlement (E2E only). No claim step; payer and requester get emails. */
  const SimulatePaymentBodySchema = z.object({
    transaction_id: z.string().uuid(),
  });
  app.post<{ Body: unknown }>("/api/test/request/simulate-payment", async (req, reply) => {
    const parse = SimulatePaymentBodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({
        success: false,
        error: "Validation failed",
        details: parse.error.flatten(),
      });
    }
    const { transaction_id } = parse.data;
    const tx = await prisma.transaction.findUnique({
      where: { id: transaction_id },
      select: { id: true, type: true, status: true, requestId: true },
    });
    if (!tx) {
      return reply.status(404).send({ success: false, error: "Transaction not found" });
    }
    if (tx.type !== "REQUEST") {
      return reply.status(400).send({ success: false, error: "Transaction is not a REQUEST" });
    }
    if (tx.status === "COMPLETED") {
      return reply.send({
        success: true,
        data: { already_completed: true, message: "Request already settled." },
      });
    }
    if (tx.status !== "PENDING") {
      return reply.status(400).send({ success: false, error: "Transaction is not PENDING" });
    }
    await prisma.transaction.update({
      where: { id: transaction_id },
      data: { status: "COMPLETED" },
    });
    const result = await onRequestPaymentSettled({ transactionId: transaction_id });
    if (!result.ok) {
      return reply.status(500).send({ success: false, error: result.error });
    }
    return reply.send({
      success: true,
      data: {
        settled: true,
        message: "Request settled. Payer and requester notified by email.",
      },
    });
  });
}
