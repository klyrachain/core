/**
 * Peer ramp (CLOB-style) REST API. Requires platform API key or session (global preHandler).
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { successEnvelope } from "../../lib/api-helpers.js";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import { PERMISSION_CONNECT_TRANSACTIONS } from "../../lib/permissions.js";
import {
  acceptPeerRampFill,
  buildPeerRampOfframpEscrowTx,
  createPeerRampOfframp,
  createPeerRampOnramp,
  commitPeerRampOnramp,
  getPeerRampOrderById,
  listPeerRampOrders,
  peerRampEscrowAddressHint,
  submitPeerRampOfframpEscrowTx,
} from "../../services/peer-ramp-order.service.js";

const QuoteSnapshotSchema = z.object({
  fiatAmount: z.coerce.number().positive(),
  fiatCurrency: z.string().min(1),
  cryptoAmount: z.coerce.number().positive(),
  usdEquivalent: z.coerce.number().optional(),
  displayCurrency: z.string().optional(),
});

const EvmAddr = z
  .string()
  .trim()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Must be 0x + 40 hex");

const OnrampBodySchema = z.object({
  chainId: z.coerce.number().int().positive(),
  tokenAddress: z.string().min(1),
  decimals: z.coerce.number().int().min(0).max(36).default(6),
  cryptoAmount: z.coerce.number().positive(),
  quoteSnapshot: QuoteSnapshotSchema,
  settlementCurrency: z.string().min(1),
  payerEmail: z.string().email(),
  recipientAddress: EvmAddr,
  cliSessionId: z.string().max(128).optional(),
});

const OfframpBodySchema = z.object({
  chainId: z.coerce.number().int().positive(),
  tokenAddress: z.string().min(1),
  decimals: z.coerce.number().int().min(0).max(36).default(6),
  cryptoAmount: z.coerce.number().positive(),
  quoteSnapshot: QuoteSnapshotSchema,
  settlementCurrency: z.string().min(1),
  payerEmail: z.string().email(),
  payoutHint: z.record(z.unknown()).optional(),
  cliSessionId: z.string().max(128).optional(),
});

function serializeOrder(order: {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  side: string;
  chainId: number;
  tokenAddress: string;
  decimals: number;
  cryptoAmountTotal: { toString(): string };
  cryptoAmountRemaining: { toString(): string };
  status: string;
  quoteSnapshot: unknown;
  settlementCurrency: string | null;
  payerEmail: string | null;
  recipientAddress: string | null;
  payoutHint: unknown;
  cliSessionId: string | null;
  linkedTransactionId: string | null;
  escrowTxHash?: string | null;
  escrowVerifiedAt?: Date | null;
  escrowVerifyLastAttempt?: unknown;
  fillsAsOnramp?: Array<{
    id: string;
    offrampOrderId: string;
    cryptoAmount: { toString(): string };
    onrampAcceptedAt?: Date | null;
    offrampAcceptedAt?: Date | null;
  }>;
  fillsAsOfframp?: Array<{
    id: string;
    onrampOrderId: string;
    cryptoAmount: { toString(): string };
    onrampAcceptedAt?: Date | null;
    offrampAcceptedAt?: Date | null;
  }>;
  linkedTransaction?: unknown;
}) {
  return {
    id: order.id,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    side: order.side,
    chainId: order.chainId,
    tokenAddress: order.tokenAddress,
    decimals: order.decimals,
    cryptoAmountTotal: order.cryptoAmountTotal.toString(),
    cryptoAmountRemaining: order.cryptoAmountRemaining.toString(),
    status: order.status,
    quoteSnapshot: order.quoteSnapshot,
    settlementCurrency: order.settlementCurrency,
    payerEmail: order.payerEmail,
    recipientAddress: order.recipientAddress,
    payoutHint: order.payoutHint,
    cliSessionId: order.cliSessionId,
    linkedTransactionId: order.linkedTransactionId,
    escrowTxHash: order.escrowTxHash ?? undefined,
    escrowVerifiedAt: order.escrowVerifiedAt ?? undefined,
    escrowVerifyLastAttempt: order.escrowVerifyLastAttempt ?? undefined,
    fillsAsOnramp: order.fillsAsOnramp?.map((fill) => ({
      id: fill.id,
      offrampOrderId: fill.offrampOrderId,
      cryptoAmount: fill.cryptoAmount.toString(),
      onrampAcceptedAt: fill.onrampAcceptedAt ?? undefined,
      offrampAcceptedAt: fill.offrampAcceptedAt ?? undefined,
    })),
    fillsAsOfframp: order.fillsAsOfframp?.map((fill) => ({
      id: fill.id,
      onrampOrderId: fill.onrampOrderId,
      cryptoAmount: fill.cryptoAmount.toString(),
      onrampAcceptedAt: fill.onrampAcceptedAt ?? undefined,
      offrampAcceptedAt: fill.offrampAcceptedAt ?? undefined,
    })),
    linkedTransaction: order.linkedTransaction ?? undefined,
  };
}

export async function peerRampApiRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: unknown }>("/api/peer-ramp/orders/onramp", async (req: FastifyRequest<{ Body: unknown }>, reply) => {
    if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS)) return;
    const parse = OnrampBodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ success: false, error: "Validation failed", details: parse.error.flatten() });
    }
    const b = parse.data;
    const order = await createPeerRampOnramp({
      chainId: b.chainId,
      tokenAddress: b.tokenAddress,
      decimals: b.decimals,
      cryptoAmount: b.cryptoAmount,
      quoteSnapshot: b.quoteSnapshot,
      settlementCurrency: b.settlementCurrency,
      payerEmail: b.payerEmail,
      recipientAddress: b.recipientAddress,
      cliSessionId: b.cliSessionId,
    });
    return successEnvelope(reply, serializeOrder(order), 201);
  });

  app.post<{ Body: unknown }>("/api/peer-ramp/orders/offramp", async (req: FastifyRequest<{ Body: unknown }>, reply) => {
    if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS)) return;
    const parse = OfframpBodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ success: false, error: "Validation failed", details: parse.error.flatten() });
    }
    const b = parse.data;
    const order = await createPeerRampOfframp({
      chainId: b.chainId,
      tokenAddress: b.tokenAddress,
      decimals: b.decimals,
      cryptoAmount: b.cryptoAmount,
      quoteSnapshot: b.quoteSnapshot,
      settlementCurrency: b.settlementCurrency,
      payerEmail: b.payerEmail,
      payoutHint: b.payoutHint,
      cliSessionId: b.cliSessionId,
    });
    const escrow = peerRampEscrowAddressHint();
    return successEnvelope(
      reply,
      {
        order: serializeOrder(order),
        escrowAddress: escrow,
        instructions:
          escrow != null
            ? `After match and acceptance, pay ${b.cryptoAmount} USDC on chain ${b.chainId} from your connected wallet (the app builds the transaction).`
            : "Set PEER_RAMP_PLATFORM_ESCROW_ADDRESS for settlement instructions.",
      },
      201
    );
  });

  app.get<{ Params: { id: string } }>("/api/peer-ramp/orders/:id", async (req, reply) => {
    if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS)) return;
    const id = req.params.id?.trim();
    if (!id) return reply.status(400).send({ success: false, error: "Missing id" });
    const order = await getPeerRampOrderById(id);
    if (!order) return reply.status(404).send({ success: false, error: "Not found" });
    return successEnvelope(reply, serializeOrder(order));
  });

  app.get<{ Querystring: { cliSessionId?: string; limit?: string } }>(
    "/api/peer-ramp/orders",
    async (req, reply) => {
      if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS)) return;
      const cliSessionId = req.query.cliSessionId?.trim();
      const limit = req.query.limit != null ? Number(req.query.limit) : undefined;
      const rows = await listPeerRampOrders({
        cliSessionId: cliSessionId || undefined,
        limit: Number.isFinite(limit) ? limit : undefined,
      });
      return successEnvelope(reply, rows.map(serializeOrder));
    }
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/peer-ramp/orders/:id/commit-onramp",
    async (req: FastifyRequest<{ Params: { id: string }; Body: unknown }>, reply) => {
      if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS)) return;
      const id = req.params.id?.trim();
      if (!id) return reply.status(400).send({ success: false, error: "Missing id" });
      const BodySchema = z.object({
        initializePaystack: z.boolean().optional(),
        paystackCustomerEmail: z.string().email().optional(),
        callback_url: z.string().url().optional(),
      });
      const parse = BodySchema.safeParse(req.body && typeof req.body === "object" ? req.body : {});
      if (!parse.success) {
        return reply.status(400).send({ success: false, error: "Validation failed", details: parse.error.flatten() });
      }
      const result = await commitPeerRampOnramp({
        orderId: id,
        initializePaystack: parse.data.initializePaystack,
        paystackCustomerEmail: parse.data.paystackCustomerEmail,
        callback_url: parse.data.callback_url,
      });
      if (!result.ok) {
        const code = result.code ?? "COMMIT_FAILED";
        const conflict =
          code === "NOT_READY" ||
          code === "REMAINDER_OPEN" ||
          code === "FILL_ACCEPTANCE_REQUIRED" ||
          code === "NO_FILLS";
        const status = code === "NOT_FOUND" ? 404 : conflict ? 409 : 400;
        return reply.status(status).send({ success: false, error: result.error, code });
      }
      return successEnvelope(reply, {
        transactionId: result.transactionId,
        paystack: result.paystack,
      });
    }
  );

  app.post<{ Params: { fillId: string }; Body: unknown }>(
    "/api/peer-ramp/fills/:fillId/accept",
    async (req: FastifyRequest<{ Params: { fillId: string }; Body: unknown }>, reply) => {
      if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS)) return;
      const fillId = req.params.fillId?.trim();
      if (!fillId) return reply.status(400).send({ success: false, error: "Missing fill id" });
      const BodySchema = z.object({
        side: z.enum(["ONRAMP", "OFFRAMP"]),
      });
      const parse = BodySchema.safeParse(req.body && typeof req.body === "object" ? req.body : {});
      if (!parse.success) {
        return reply.status(400).send({ success: false, error: "Validation failed", details: parse.error.flatten() });
      }
      const result = await acceptPeerRampFill({ fillId, side: parse.data.side });
      if (!result.ok) {
        const code = result.code ?? "ACCEPT_FAILED";
        const status = code === "NOT_FOUND" ? 404 : code === "INVALID_STATUS" ? 409 : 400;
        return reply.status(status).send({ success: false, error: result.error, code });
      }
      return successEnvelope(reply, { fillId: result.fillId });
    }
  );

  app.get<{ Params: { id: string } }>("/api/peer-ramp/orders/:id/escrow-tx", async (req, reply) => {
    if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS)) return;
    const id = req.params.id?.trim();
    if (!id) return reply.status(400).send({ success: false, error: "Missing id" });
    const built = await buildPeerRampOfframpEscrowTx(id);
    if (!built.ok) {
      const code = built.code ?? "ESCROW_TX_FAILED";
      const status =
        code === "NOT_FOUND"
          ? 404
          : code === "NOT_READY" || code === "REMAINDER_OPEN" || code === "ALREADY_SUBMITTED"
            ? 409
            : code === "ESCROW_NOT_CONFIGURED"
              ? 503
              : 400;
      return reply.status(status).send({ success: false, error: built.error, code });
    }
    return successEnvelope(reply, {
      chainId: built.chainId,
      to: built.to,
      data: built.data,
      value: built.value,
      tokenAddress: built.tokenAddress,
      decimals: built.decimals,
      escrowAddress: built.escrowAddress,
    });
  });

  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/peer-ramp/orders/:id/submit-escrow-tx",
    async (req: FastifyRequest<{ Params: { id: string }; Body: unknown }>, reply) => {
      if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS)) return;
      const id = req.params.id?.trim();
      if (!id) return reply.status(400).send({ success: false, error: "Missing id" });
      const BodySchema = z.object({
        txHash: z.string().trim().min(10, "txHash required"),
      });
      const parse = BodySchema.safeParse(req.body && typeof req.body === "object" ? req.body : {});
      if (!parse.success) {
        return reply.status(400).send({ success: false, error: "Validation failed", details: parse.error.flatten() });
      }
      const result = await submitPeerRampOfframpEscrowTx({
        orderId: id,
        txHash: parse.data.txHash,
      });
      if (!result.ok) {
        const code = result.code ?? "ESCROW_FAILED";
        const status =
          code === "NOT_FOUND"
            ? 404
            : code === "NOT_READY" || code === "REMAINDER_OPEN"
              ? 409
              : code === "ESCROW_NOT_CONFIGURED"
                ? 503
                : 400;
        return reply.status(status).send({
          success: false,
          error: result.error,
          code,
          verificationDetails: result.verificationDetails,
        });
      }
      return successEnvelope(reply, {
        verifiedAt: result.verifiedAt,
        escrowTxHash: result.escrowTxHash,
        verificationSnapshot: result.verificationSnapshot,
      });
    }
  );
}
