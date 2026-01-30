/**
 * Crypto / swap transaction API: record and search swap executions (0x, Squid, LiFi).
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  createCryptoTransaction,
  updateCryptoTransaction,
  getCryptoTransactionById,
  getCryptoTransactionByTxHash,
  listCryptoTransactions,
} from "../../services/crypto-transaction.service.js";
import { getSwapStatusFromProvider } from "../../services/swap-status.service.js";
import { parsePagination, successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";
import { hasPermission } from "../../lib/auth.guard.js";

const PROVIDERS = ["0x", "squid", "lifi"] as const;
const STATUSES = ["PENDING", "SUBMITTED", "CONFIRMED", "FAILED"] as const;

const CreateBodySchema = z.object({
  provider: z.enum(PROVIDERS),
  from_chain_id: z.coerce.number().int().positive(),
  to_chain_id: z.coerce.number().int().positive(),
  from_token: z.string().min(1),
  to_token: z.string().min(1),
  from_amount: z.string().min(1),
  to_amount: z.string().min(1),
  transaction_id: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const UpdateBodySchema = z.object({
  status: z.enum(STATUSES).optional(),
  tx_hash: z.string().min(1).optional(),
  tx_url: z.string().url().optional(),
  transaction_id: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export async function cryptoTransactionsApiRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Record a new crypto/swap transaction (e.g. when user picks a quote and proceeds).
   * Returns { id } for later update with tx hash / status.
   */
  app.post<{ Body: unknown }>(
    "/api/crypto-transactions",
    async (req: FastifyRequest<{ Body: unknown }>, reply) => {
      const parse = CreateBodySchema.safeParse(req.body);
      if (!parse.success) {
        return reply.status(400).send({
          success: false,
          error: "Validation failed",
          details: parse.error.flatten(),
        });
      }
      try {
        const { id } = await createCryptoTransaction({
          provider: parse.data.provider,
          fromChainId: parse.data.from_chain_id,
          toChainId: parse.data.to_chain_id,
          fromToken: parse.data.from_token,
          toToken: parse.data.to_token,
          fromAmount: parse.data.from_amount,
          toAmount: parse.data.to_amount,
          transactionId: parse.data.transaction_id,
          metadata: parse.data.metadata,
        });
        return successEnvelope(reply, { id }, 201);
      } catch (err) {
        req.log.error({ err }, "POST /api/crypto-transactions");
        return errorEnvelope(reply, "Failed to create crypto transaction.", 500);
      }
    }
  );

  /**
   * Update a crypto transaction (e.g. set tx hash and status when tx is submitted/confirmed).
   */
  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/api/crypto-transactions/:id",
    async (req: FastifyRequest<{ Params: { id: string }; Body: unknown }>, reply) => {
      const parse = UpdateBodySchema.safeParse(req.body);
      if (!parse.success) {
        return reply.status(400).send({
          success: false,
          error: "Validation failed",
          details: parse.error.flatten(),
        });
      }
      const updated = await updateCryptoTransaction(req.params.id, {
        status: parse.data.status,
        txHash: parse.data.tx_hash,
        txUrl: parse.data.tx_url,
        transactionId: parse.data.transaction_id,
        metadata: parse.data.metadata,
      });
      if (!updated) {
        return errorEnvelope(reply, "Crypto transaction not found.", 404);
      }
      return successEnvelope(reply, updated);
    }
  );

  /**
   * Admin-only: list crypto transactions (same as GET /api/crypto-transactions but requires ADMIN or * permission).
   */
  app.get(
    "/api/admin/crypto-transactions",
    async (
      req: FastifyRequest<{
        Querystring: { page?: string; limit?: string; provider?: string; status?: string };
      }>,
      reply
    ) => {
      if (!hasPermission(req, "ADMIN")) {
        return reply.status(403).send({
          success: false,
          error: "Admin permission required. API key must have ADMIN or * permission.",
        });
      }
      const { page, limit } = parsePagination(req.query);
      const provider = req.query.provider as (typeof PROVIDERS)[number] | undefined;
      const status = req.query.status as (typeof STATUSES)[number] | undefined;
      if (provider && !PROVIDERS.includes(provider)) {
        return reply.status(400).send({
          success: false,
          error: `provider must be one of: ${PROVIDERS.join(", ")}`,
        });
      }
      if (status && !STATUSES.includes(status)) {
        return reply.status(400).send({
          success: false,
          error: `status must be one of: ${STATUSES.join(", ")}`,
        });
      }
      try {
        const result = await listCryptoTransactions({
          page,
          limit,
          provider,
          status,
        });
        return reply.status(200).send({
          success: true,
          data: result.items,
          meta: { page: result.page, limit: result.limit, total: result.total },
        });
      } catch (err) {
        req.log.error({ err }, "GET /api/admin/crypto-transactions");
        return errorEnvelope(reply, "Failed to list crypto transactions.", 500);
      }
    }
  );

  /**
   * List crypto transactions with pagination and optional filters.
   */
  app.get(
    "/api/crypto-transactions",
    async (
      req: FastifyRequest<{
        Querystring: { page?: string; limit?: string; provider?: string; status?: string };
      }>,
      reply
    ) => {
      const { page, limit } = parsePagination(req.query);
      const provider = req.query.provider as (typeof PROVIDERS)[number] | undefined;
      const status = req.query.status as (typeof STATUSES)[number] | undefined;
      if (provider && !PROVIDERS.includes(provider)) {
        return reply.status(400).send({
          success: false,
          error: `provider must be one of: ${PROVIDERS.join(", ")}`,
        });
      }
      if (status && !STATUSES.includes(status)) {
        return reply.status(400).send({
          success: false,
          error: `status must be one of: ${STATUSES.join(", ")}`,
        });
      }
      try {
        const result = await listCryptoTransactions({
          page,
          limit,
          provider,
          status,
        });
        return reply.status(200).send({
          success: true,
          data: result.items,
          meta: { page: result.page, limit: result.limit, total: result.total },
        });
      } catch (err) {
        req.log.error({ err }, "GET /api/crypto-transactions");
        return errorEnvelope(reply, "Failed to list crypto transactions.", 500);
      }
    }
  );

  /**
   * Get status/verify from swap provider (0x, Squid, LiFi). Requires tx_hash to be set (PATCH first).
   * Query ?update=1 updates our record with normalized status and tx_url.
   */
  app.get(
    "/api/crypto-transactions/:id/status",
    async (
      req: FastifyRequest<{
        Params: { id: string };
        Querystring: { update?: string; raw?: string };
      }>,
      reply
    ) => {
      const item = await getCryptoTransactionById(req.params.id);
      if (!item) {
        return errorEnvelope(reply, "Crypto transaction not found.", 404);
      }
      const txHash = item.txHash ?? null;
      if (!txHash || typeof txHash !== "string") {
        return reply.status(400).send({
          success: false,
          error: "No tx_hash yet. Update the record with PATCH and tx_hash first.",
        });
      }
      const provider = item.provider as "0x" | "squid" | "lifi";
      if (!PROVIDERS.includes(provider)) {
        return reply.status(400).send({
          success: false,
          error: `Unknown provider: ${provider}`,
        });
      }
      const meta = item.metadata as Record<string, unknown> | null | undefined;
      const zeroXTradeHash =
        provider === "0x" &&
        meta &&
        typeof meta.zero_x_trade_hash === "string" &&
        meta.zero_x_trade_hash.trim()
          ? meta.zero_x_trade_hash.trim()
          : null;
      const statusHash = zeroXTradeHash ?? txHash;
      const result = await getSwapStatusFromProvider(
        provider,
        statusHash,
        item.fromChainId,
        item.toChainId
      );
      if (!result.ok) {
        const status = result.status ?? 502;
        return reply.status(status).send({
          success: false,
          error: result.error,
        });
      }
      const update = req.query.update === "1" || req.query.update === "true";
      if (update) {
        await updateCryptoTransaction(req.params.id, {
          status: result.normalized,
          ...(result.txUrl && { txUrl: result.txUrl }),
        });
      }
      const data = {
        id: item.id,
        provider: result.provider,
        normalized: result.normalized,
        provider_status: result.providerStatus,
        ...(result.providerMessage && { provider_message: result.providerMessage }),
        tx_hash: result.txHash ?? txHash,
        ...(result.txUrl && { tx_url: result.txUrl }),
        ...(req.query.raw === "1" && result.raw && { raw: result.raw }),
      };
      return successEnvelope(reply, data);
    }
  );

  /**
   * Get crypto transaction by blockchain tx hash (register before :id so "by-hash" is not parsed as id).
   */
  app.get(
    "/api/crypto-transactions/by-hash/:txHash",
    async (req: FastifyRequest<{ Params: { txHash: string } }>, reply) => {
      const item = await getCryptoTransactionByTxHash(req.params.txHash);
      if (!item) {
        return errorEnvelope(reply, "Crypto transaction not found.", 404);
      }
      return successEnvelope(reply, item);
    }
  );

  /**
   * Get crypto transaction by our id.
   */
  app.get(
    "/api/crypto-transactions/:id",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const item = await getCryptoTransactionById(req.params.id);
      if (!item) {
        return errorEnvelope(reply, "Crypto transaction not found.", 404);
      }
      return successEnvelope(reply, item);
    }
  );
}
