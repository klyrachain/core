import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { randomBytes } from "crypto";
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
import { normalizeNotificationChannels } from "../../lib/notification.types.js";
import { sendPaymentRequestNotification, buildPaymentRequestLink } from "../../services/notification.service.js";
import { generateClaimCode } from "../../utils/claim-code.js";
import { getLiquidityPoolWallet } from "../../services/liquidity-pool.service.js";
import { findPoolTokenFromDb } from "../../services/supported-token.service.js";
import { verifyTransactionByHash, transferMatches } from "../../services/transaction-verify.service.js";
import { addInventory } from "../../services/inventory.service.js";
import { onRequestPaymentSettled } from "../../services/request-settlement.service.js";

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
      const [items, total] = await Promise.all([
        prisma.request.findMany({
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          include: { transaction: true, claim: true },
        }),
        prisma.request.count(),
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
      const request = await prisma.request.findUnique({
        where: { id: req.params.id },
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

  const PayoutFiatSchema = z.object({
    type: z.enum(["nuban", "mobile_money"]),
    account_name: z.string().min(1, "account_name is required (verified via Paystack resolve/validate)"),
    account_number: z.string().min(1, "account_number is required"),
    bank_code: z.string().min(1).optional(), // required for nuban; for mobile_money = provider code (e.g. MTN)
    currency: z.string().min(1), // e.g. GHS
  });

  const CreateRequestSchema = z.object({
    payerEmail: z.string().email(),
    payerPhone: z.string().min(1).optional(),
    channels: z.union([z.array(z.enum(["EMAIL", "SMS", "WHATSAPP"])), z.enum(["EMAIL", "SMS", "WHATSAPP"])]).optional(),
    t_amount: z.coerce.number().positive(),
    t_chain: z.string().min(1),
    t_token: z.string().min(1),
    toIdentifier: z.string().min(1),
    receiveSummary: z.string().min(1),
    /** When set, we auto-settle to this (crypto: 0x...). Requester does not claim. */
    payoutTarget: z.string().min(1).optional(),
    /** Verified fiat payout (use after Paystack resolve/validate so account_name is known). Required when t_chain is MOMO/BANK. */
    payoutFiat: PayoutFiatSchema.optional(),
    /** Make a payment (crypto): what sender sends. When set, payer sends this to platform; receiver gets t_chain/t_token/t_amount. */
    f_chain: z.string().min(1).optional(),
    f_token: z.string().min(1).optional(),
    f_amount: z.coerce.number().positive().optional(),
    /** When true (e.g. Make a payment): do not send "payment request - pay now" to payer; they complete payment via returned URL / flow. Emails go after payment is confirmed. */
    skipPaymentRequestNotification: z.boolean().optional(),
  });

  /** POST /api/requests — create payment request and notify payer (email/SMS/WhatsApp) with link to pay. */
  app.post<{ Body: unknown }>("/api/requests", async (req: FastifyRequest<{ Body: unknown }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS)) return;
      const parse = CreateRequestSchema.safeParse(req.body);
      if (!parse.success) {
        return reply.status(400).send({ success: false, error: "Validation failed", details: parse.error.flatten() });
      }
      const body = parse.data;
      const channels = normalizeNotificationChannels(body.channels);
      const linkId = randomBytes(8).toString("hex");
      const requestCode = `REQ${randomBytes(4).toString("hex").toUpperCase()}`;
      const claimCode = generateClaimCode();

      const isSenderPaysCrypto =
        body.f_chain != null &&
        body.f_token != null &&
        body.f_amount != null &&
        body.f_chain.toUpperCase() !== "MOMO" &&
        body.f_chain.toUpperCase() !== "BANK";
      const f_chain = isSenderPaysCrypto ? body.f_chain! : "MOMO";
      const f_token = isSenderPaysCrypto ? body.f_token! : "GHS";
      const f_amount = isSenderPaysCrypto ? body.f_amount! : 0;

      const transaction = await prisma.transaction.create({
        data: {
          type: "REQUEST",
          status: "PENDING",
          f_amount,
          t_amount: body.t_amount,
          f_chain,
          t_chain: body.t_chain,
          f_token,
          t_token: body.t_token,
          f_provider: isSenderPaysCrypto ? "KLYRA" : "PAYSTACK",
          t_provider: "KLYRA",
          fromIdentifier: body.payerEmail,
          fromType: "EMAIL",
          toIdentifier: body.toIdentifier,
          toType: body.toIdentifier.includes("@") ? "EMAIL" : "NUMBER",
        },
      });

      const payoutFiatJson =
        body.payoutFiat != null
          ? (body.payoutFiat as Record<string, unknown>)
          : undefined;

      const request = await prisma.request.create({
        data: {
          code: requestCode,
          linkId,
          transactionId: transaction.id,
          payoutTarget: body.payoutTarget ?? undefined,
          payoutFiat: payoutFiatJson ?? undefined,
        },
      });

      await prisma.transaction.update({
        where: { id: transaction.id },
        data: { requestId: request.id },
      });

      const claim = await prisma.claim.create({
        data: {
          requestId: request.id,
          status: "ACTIVE",
          value: body.t_amount,
          price: 1,
          token: body.t_token,
          payerIdentifier: body.payerEmail,
          toIdentifier: body.toIdentifier,
          code: claimCode,
        },
      });

      const claimLinkUrl = buildPaymentRequestLink(linkId);
      const results = body.skipPaymentRequestNotification
        ? {}
        : await sendPaymentRequestNotification({
            channels,
            toEmail: body.payerEmail,
            toPhone: body.payerPhone,
            entityRefId: request.id,
            templateVars: {
              requesterIdentifier: body.toIdentifier,
              amount: String(body.t_amount),
              currency: body.t_token,
              receiveSummary: body.receiveSummary,
              claimLinkUrl,
            },
          });

      return reply.status(201).send({
        success: true,
        data: {
          id: request.id,
          code: request.code,
          linkId: request.linkId,
          transactionId: transaction.id,
          claimId: claim.id,
          claimCode: claim.code,
          payLink: claimLinkUrl,
          notification: results,
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
        select: { id: true, type: true, status: true, t_chain: true, t_token: true, t_amount: true, f_chain: true, f_token: true, f_amount: true },
      });
      if (!tx) return errorEnvelope(reply, "Transaction not found", 404);
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
