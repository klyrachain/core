import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { parseUnits } from "viem";
import { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "../../lib/prisma.js";
import {
  parsePagination,
  successEnvelope,
  successEnvelopeWithMeta,
  errorEnvelope,
  serializeTransactionPrices,
} from "../../lib/api-helpers.js";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import { PERMISSION_CONNECT_TRANSACTIONS } from "../../lib/permissions.js";
import {
  createPaymentRequest,
  CreatePaymentRequestBodySchema,
} from "../../services/payment-request-create.service.js";
import { getLiquidityPoolWallet } from "../../services/liquidity-pool.service.js";
import { findPoolTokenFromDb } from "../../services/supported-token.service.js";
import { verifyTransactionByHash, transferMatches } from "../../services/transaction-verify.service.js";
import { addInventory } from "../../services/inventory.service.js";
import { onRequestPaymentSettled } from "../../services/request-settlement.service.js";
import { getOptionalMerchantBusinessId } from "../../lib/business-portal-tenant.guard.js";
import { getMerchantEnvironmentOrThrow } from "../../lib/merchant-environment.js";

const CHAIN_NAME_TO_ID: Record<string, number> = {
  ETHEREUM: 1,
  BASE: 8453,
  "BASE SEPOLIA": 84532,
  BNB: 56,
  POLYGON: 137,
  ARBITRUM: 42161,
};

export async function requestsApiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/requests", async (req: FastifyRequest<{ Querystring: { page?: string; limit?: string } }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS)) return;
      const { page, limit, skip } = parsePagination(req.query);
      const merchantBid = getOptionalMerchantBusinessId(req);
      const merchantEnv = getMerchantEnvironmentOrThrow(req);
      const where = merchantBid
        ? { businessId: merchantBid, environment: merchantEnv }
        : {};
      const [items, total] = await Promise.all([
        prisma.request.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          include: { transaction: true, claim: true },
        }),
        prisma.request.count({ where }),
      ]);
      const data = items.map((r) => ({
        ...r,
        transaction: r.transaction
          ? {
            ...r.transaction,
            f_amount: r.transaction.f_amount.toString(),
            t_amount: r.transaction.t_amount.toString(),
            ...serializeTransactionPrices(r.transaction),
          }
          : null,
      }));
      return successEnvelopeWithMeta(reply, data, { page, limit, total });
    } catch (err) {
      req.log.error({ err }, "GET /api/requests");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  /** GET /api/requests/by-link/:linkId — get request by linkId (for pay page; no auth if public). */
  app.get("/api/requests/by-link/:linkId", async (req: FastifyRequest<{ Params: { linkId: string } }>, reply) => {
    try {
      const request = await prisma.request.findUnique({
        where: { linkId: req.params.linkId },
        include: { transaction: true, claim: true },
      });
      if (!request) return errorEnvelope(reply, "Request not found", 404);
      const data = {
        ...request,
        transaction: request.transaction
          ? {
              ...request.transaction,
              f_amount: request.transaction.f_amount.toString(),
              t_amount: request.transaction.t_amount.toString(),
              ...serializeTransactionPrices(request.transaction),
            }
          : null,
        claim: request.claim
          ? {
              ...request.claim,
              value: request.claim.value.toString(),
              price: request.claim.price.toString(),
            }
          : null,
      };
      return successEnvelope(reply, data);
    } catch (err) {
      req.log.error({ err }, "GET /api/requests/by-link/:linkId");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.get("/api/requests/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS)) return;
      const merchantBid = getOptionalMerchantBusinessId(req);
      const merchantEnv = getMerchantEnvironmentOrThrow(req);
      const request = await prisma.request.findFirst({
        where: merchantBid
          ? { id: req.params.id, businessId: merchantBid, environment: merchantEnv }
          : { id: req.params.id },
        include: { transaction: true, claim: true },
      });
      if (!request) return errorEnvelope(reply, "Request not found", 404);
      const data = {
        ...request,
        transaction: request.transaction
          ? {
            ...request.transaction,
            f_amount: request.transaction.f_amount.toString(),
            t_amount: request.transaction.t_amount.toString(),
            ...serializeTransactionPrices(request.transaction),
          }
          : null,
        claim: request.claim
          ? {
            ...request.claim,
            value: request.claim.value.toString(),
            price: request.claim.price.toString(),
          }
          : null,
      };
      return successEnvelope(reply, data);
    } catch (err) {
      req.log.error({ err }, "GET /api/requests/:id");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  /** POST /api/requests — create payment request and notify payer (email/SMS/WhatsApp) with link to pay. */
  app.post<{ Body: unknown }>("/api/requests", async (req: FastifyRequest<{ Body: unknown }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS, { allowMerchant: true })) return;
      const parse = CreatePaymentRequestBodySchema.safeParse(req.body);
      if (!parse.success) {
        return reply.status(400).send({ success: false, error: "Validation failed", details: parse.error.flatten() });
      }
      const merchantBid = getOptionalMerchantBusinessId(req) ?? null;
      const data = await createPaymentRequest(parse.data, { businessId: merchantBid });
      return reply.status(201).send({
        success: true,
        data: {
          id: data.id,
          code: data.code,
          linkId: data.linkId,
          transactionId: data.transactionId,
          claimId: data.claimId,
          claimCode: data.claimCode,
          payLink: data.payLink,
          notification: data.notification,
        },
      });
    } catch (err) {
      req.log.error({ err }, "POST /api/requests");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  /** GET /api/requests/calldata?transaction_id= — for paying a request with crypto. Returns pool address and amount so payer sends to platform. */
  app.get(
    "/api/requests/calldata",
    async (req: FastifyRequest<{ Querystring: { transaction_id?: string } }>, reply) => {
      if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS, { allowMerchant: true })) return;
      const transaction_id = req.query.transaction_id;
      if (!transaction_id) {
        return reply.status(400).send({ success: false, error: "transaction_id is required" });
      }
      const tx = await prisma.transaction.findUnique({
        where: { id: transaction_id },
        select: {
          id: true,
          type: true,
          status: true,
          businessId: true,
          environment: true,
          t_chain: true,
          t_token: true,
          t_amount: true,
          f_chain: true,
          f_token: true,
          f_amount: true,
        },
      });
      if (!tx) return errorEnvelope(reply, "Transaction not found", 404);
      const merchantBid = getOptionalMerchantBusinessId(req);
      const merchantEnv = getMerchantEnvironmentOrThrow(req);
      if (merchantBid && (tx.businessId !== merchantBid || tx.environment !== merchantEnv)) {
        return reply.status(403).send({ success: false, error: "Forbidden", code: "TENANT_MISMATCH" });
      }
      if (tx.type !== "REQUEST") return reply.status(400).send({ success: false, error: "Transaction must be REQUEST" });
      if (tx.status === "COMPLETED") return reply.status(400).send({ success: false, error: "Request already paid" });

      const fChainUpper = (tx.f_chain ?? "").toUpperCase();
      const useFromSide = fChainUpper !== "MOMO" && fChainUpper !== "BANK" && tx.f_token != null && tx.f_amount != null;
      const chainForPool = useFromSide ? tx.f_chain! : tx.t_chain;
      const tokenForPool = useFromSide ? tx.f_token! : tx.t_token;
      const amountForPool = useFromSide ? tx.f_amount! : tx.t_amount;

      const pool = await getLiquidityPoolWallet(chainForPool);
      if (!pool) {
        return reply.status(503).send({
          success: false,
          error: `No liquidity pool for "${chainForPool}". Add a Wallet with isLiquidityPool=true.`,
        });
      }
      const chainKey = chainForPool?.toUpperCase().replace(/-/g, " ") ?? "";
      const chainId = CHAIN_NAME_TO_ID[chainKey] ?? CHAIN_NAME_TO_ID[chainForPool?.toUpperCase() ?? ""] ?? 8453;
      const poolToken = await findPoolTokenFromDb(chainId, tokenForPool);
      if (!poolToken) return errorEnvelope(reply, `Unsupported token ${tokenForPool}`, 400);

      return successEnvelope(reply, {
        toAddress: pool.address,
        chainId,
        chain: chainForPool,
        token: tokenForPool,
        tokenAddress: poolToken.address,
        amount: amountForPool.toString(),
        decimals: poolToken.decimals ?? 18,
        message: "Send this amount of token to toAddress; then POST /api/requests/confirm-crypto with tx_hash",
      });
    }
  );

  /** POST /api/requests/confirm-crypto — confirm crypto payment for a request (payer sent to pool). Verifies tx, adds inventory, marks COMPLETED, settles to requester. */
  const ConfirmCryptoSchema = z.object({ transaction_id: z.string().uuid(), tx_hash: z.string().min(1) });
  app.post<{ Body: unknown }>("/api/requests/confirm-crypto", async (req: FastifyRequest<{ Body: unknown }>, reply) => {
    if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS, { allowMerchant: true })) return;
    const parse = ConfirmCryptoSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ success: false, error: "Validation failed", details: parse.error.flatten() });
    }
    const { transaction_id, tx_hash } = parse.data;

    const tx = await prisma.transaction.findUnique({
      where: { id: transaction_id },
      select: {
        id: true,
        type: true,
        status: true,
        businessId: true,
          environment: true,
        createdAt: true,
        t_chain: true,
        t_token: true,
        t_amount: true,
        t_tokenPriceUsd: true,
        f_chain: true,
        f_token: true,
        f_amount: true,
      },
    });
    if (!tx) return errorEnvelope(reply, "Transaction not found", 404);
    const merchantBidConfirm = getOptionalMerchantBusinessId(req);
    const merchantEnvConfirm = getMerchantEnvironmentOrThrow(req);
    if (
      merchantBidConfirm &&
      (tx.businessId !== merchantBidConfirm || tx.environment !== merchantEnvConfirm)
    ) {
      return reply.status(403).send({ success: false, error: "Forbidden", code: "TENANT_MISMATCH" });
    }
    if (tx.type !== "REQUEST") return reply.status(400).send({ success: false, error: "Transaction must be REQUEST" });
    if (tx.status === "COMPLETED") {
      return successEnvelope(reply, { confirmed: true, transaction_id, message: "Already completed" });
    }

    const fChainUpper = (tx.f_chain ?? "").toUpperCase();
    const useFromSide = fChainUpper !== "MOMO" && fChainUpper !== "BANK" && tx.f_token != null && tx.f_amount != null;
    const chainForPool = useFromSide ? tx.f_chain! : tx.t_chain;
    const tokenForPool = useFromSide ? tx.f_token! : tx.t_token;
    const amountForPool = useFromSide ? tx.f_amount! : tx.t_amount;

    const pool = await getLiquidityPoolWallet(chainForPool);
    if (!pool) return reply.status(503).send({ success: false, error: `No liquidity pool for ${chainForPool}` });
    const chainKey = chainForPool?.toUpperCase().replace(/-/g, " ") ?? "";
    const chainId = CHAIN_NAME_TO_ID[chainKey] ?? CHAIN_NAME_TO_ID[chainForPool?.toUpperCase() ?? ""] ?? 8453;
    const poolToken = await findPoolTokenFromDb(chainId, tokenForPool);
    if (!poolToken) return errorEnvelope(reply, `Unsupported token ${tokenForPool}`, 400);

    const verify = await verifyTransactionByHash(chainId, tx_hash);
    if (!verify.ok) return reply.status(400).send({ success: false, error: `Verification failed: ${verify.error}` });
    if (verify.status !== "success") return reply.status(400).send({ success: false, error: "Transaction reverted" });
    const decimals = poolToken.decimals ?? 18;
    const expectedAmountWei = parseUnits(amountForPool.toString(), decimals);
    if (!transferMatches(verify.transfers, poolToken.address, pool.address, expectedAmountWei)) {
      return reply.status(400).send({
        success: false,
        error: `No transfer to pool ${pool.address} for amount >= ${amountForPool} ${tokenForPool}. Check tx_hash and toAddress from calldata.`,
      });
    }
    const orderCreatedAtSeconds = Math.floor(tx.createdAt.getTime() / 1000);
    const CLOCK_SKEW_SECONDS = 60;
    if (verify.blockTimestamp < orderCreatedAtSeconds - CLOCK_SKEW_SECONDS) {
      return reply.status(400).send({ success: false, error: "Transaction mined before request; replay not allowed." });
    }

    const amount = new Decimal(amountForPool);
    const costPerTokenUsd = 1;
    try {
      await addInventory({
        chain: chainForPool,
        chainId,
        tokenAddress: poolToken.address,
        symbol: tokenForPool,
        amount,
        address: pool.address.toLowerCase(),
        type: "PURCHASE",
        costPerTokenUsd,
        sourceTransactionId: transaction_id,
      });
    } catch (err) {
      req.log.error({ err, transaction_id }, "Request confirm-crypto addInventory failed");
      return errorEnvelope(reply, "Failed to credit inventory", 500);
    }

    await prisma.transaction.update({
      where: { id: transaction_id },
      data: { status: "COMPLETED" },
    });

    const settled = await onRequestPaymentSettled({ transactionId: transaction_id });
    if (!settled.ok) {
      req.log.warn({ error: settled.error, transaction_id }, "Request settlement after confirm-crypto failed");
    }

    return successEnvelope(reply, {
      confirmed: true,
      transaction_id,
      tx_hash,
      message: "Payment confirmed. Request settled to requester; both parties notified.",
    });
  });
}
