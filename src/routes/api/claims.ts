import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { Prisma } from "../../../prisma/generated/prisma/client.js";
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
  getClaimOtp,
  deleteClaimOtp,
  getCustodialSendPayload,
  setCustodialClaimOtpGate,
  getCustodialClaimOtpGate,
  deleteCustodialClaimOtpGate,
  getCustodialTransactionIdByClaimLinkId,
  setClaimUnlockSession,
  getClaimUnlockSession,
  deleteClaimUnlockSession,
  deleteCustodialSendPayload,
  deleteCustodialClaimLinkIndex,
  tryAcquireClaimPayoutLock,
  releaseClaimPayoutLock,
} from "../../lib/redis.js";
import {
  claimRecipientsMatch,
  maskRecipientHint,
  timingSafeClaimCode,
  timingSafeOtp,
} from "../../lib/claim-recipient.js";
import {
  claimCryptoAllowed,
  claimFiatAllowed,
  cryptoPayoutAllowed,
  senderPaidFiatTx,
  settlementIsOnchainCrypto,
} from "../../lib/claim-payout-policy.js";
import { notifyClaimCompleted } from "../../services/claim-completion-notify.service.js";
import { executeRequestSettlementSend } from "../../services/onramp-execution.service.js";
import {
  executePaystackFiatTransfer,
  type PayoutFiat,
} from "../../services/request-settlement.service.js";

const CLAIM_LINK_ID_RE = /^[0-9a-f]{16}$/i;

type CustodialSendPayload = {
  claimCode: string;
  otp: string;
  beneficiary: string;
  payerEmail: string;
  amount: string;
  token: string;
  chain: string;
  claimLinkId?: string;
};

function parseCustodialPayload(raw: string | null): CustodialSendPayload | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (typeof o.claimCode !== "string" || typeof o.otp !== "string") return null;
    if (typeof o.beneficiary !== "string" || typeof o.payerEmail !== "string") return null;
    if (typeof o.amount !== "string" || typeof o.token !== "string" || typeof o.chain !== "string") return null;
    return {
      claimCode: o.claimCode,
      otp: o.otp,
      beneficiary: o.beneficiary,
      payerEmail: o.payerEmail,
      amount: o.amount,
      token: o.token,
      chain: o.chain,
      claimLinkId: typeof o.claimLinkId === "string" ? o.claimLinkId : undefined,
    };
  } catch {
    return null;
  }
}

type UnlockSession = {
  kind: "db" | "custodial";
  claimLinkId: string;
  recipient: string;
  claimId?: string;
  transactionId?: string;
};

function isValidClaimLinkId(s: string): boolean {
  return CLAIM_LINK_ID_RE.test(s.trim());
}

function claimPayoutGuard(
  tx: { f_chain: string; f_token: string; t_chain: string; t_token: string },
  payout_type: "crypto" | "fiat"
): { ok: true } | { ok: false; error: string; code: string } {
  if (payout_type === "fiat" && !claimFiatAllowed(tx)) {
    return {
      ok: false,
      error: "When the payer paid in fiat on this link, you can only receive crypto to your wallet.",
      code: "FIAT_CLAIM_NOT_ALLOWED",
    };
  }
  if (payout_type === "crypto" && !claimCryptoAllowed(tx)) {
    return {
      ok: false,
      error: "This claim is not set up for on-chain wallet payout.",
      code: "CRYPTO_CLAIM_NOT_ALLOWED",
    };
  }
  if (payout_type === "crypto" && !cryptoPayoutAllowed(tx)) {
    return {
      ok: false,
      error:
        "This link still settles the same crypto you sent. Pick a different receive asset (or Receive fiat) on the claim page, then complete the claim.",
      code: "CRYPTO_SAME_AS_SENT",
    };
  }
  return { ok: true };
}

async function resolveCustodialByLinkId(claimLinkId: string): Promise<{ transactionId: string; payload: CustodialSendPayload } | null> {
  const txId = await getCustodialTransactionIdByClaimLinkId(claimLinkId);
  if (!txId) return null;
  const payload = parseCustodialPayload(await getCustodialSendPayload(txId));
  if (!payload) return null;
  if (payload.claimLinkId && payload.claimLinkId.toLowerCase() !== claimLinkId.trim().toLowerCase()) return null;
  return { transactionId: txId, payload };
}

export async function claimsApiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/claims", async (req: FastifyRequest<{ Querystring: { page?: string; limit?: string; status?: string } }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS)) return;
      const { page, limit, skip } = parsePagination(req.query);
      const status = req.query.status as string | undefined;
      const where = status ? { status: status as "ACTIVE" | "CLAIMED" | "CANCELLED" | "FAIL" } : {};
      const [items, total] = await Promise.all([
        prisma.claim.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          include: { request: { include: { transaction: true } } },
        }),
        prisma.claim.count({ where }),
      ]);
      const data = items.map((claimRow) => ({
        ...claimRow,
        value: claimRow.value.toString(),
        price: claimRow.price.toString(),
        request: claimRow.request
          ? {
              ...claimRow.request,
              transaction: claimRow.request.transaction
                ? {
                    ...claimRow.request.transaction,
                    f_amount: claimRow.request.transaction.f_amount.toString(),
                    t_amount: claimRow.request.transaction.t_amount.toString(),
                    ...serializeTransactionPrices(claimRow.request.transaction),
                  }
                : null,
            }
          : null,
      }));
      return successEnvelopeWithMeta(reply, data, { page, limit, total });
    } catch (err) {
      req.log.error({ err }, "GET /api/claims");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.get("/api/claims/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS)) return;
      const claim = await prisma.claim.findUnique({
        where: { id: req.params.id },
        include: { request: { include: { transaction: true } } },
      });
      if (!claim) return errorEnvelope(reply, "Claim not found", 404);
      const data = {
        ...claim,
        value: claim.value.toString(),
        price: claim.price.toString(),
        request: claim.request
          ? {
              ...claim.request,
              transaction: claim.request.transaction
                ? {
                    ...claim.request.transaction,
                    f_amount: claim.request.transaction.f_amount.toString(),
                    t_amount: claim.request.transaction.t_amount.toString(),
                    ...serializeTransactionPrices(claim.request.transaction),
                  }
                : null,
            }
          : null,
      };
      return successEnvelope(reply, data);
    } catch (err) {
      req.log.error({ err }, "GET /api/claims/:id");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  /** Minimal metadata for public claim page (no amounts or payer until unlock). */
  app.get("/api/claims/by-link/:claimLinkId", async (req: FastifyRequest<{ Params: { claimLinkId: string } }>, reply) => {
    try {
      const claimLinkId = (req.params.claimLinkId ?? "").trim().toLowerCase();
      if (!isValidClaimLinkId(claimLinkId)) {
        return reply.status(400).send({ success: false, error: "Invalid claim link" });
      }
      const dbClaim = await prisma.claim.findFirst({
        where: { claimLinkId },
        select: { id: true, toIdentifier: true },
      });
      if (dbClaim) {
        return successEnvelope(reply, {
          claim_link_id: claimLinkId,
          source: "request",
          recipient_hint: maskRecipientHint(dbClaim.toIdentifier),
        });
      }
      const custodial = await resolveCustodialByLinkId(claimLinkId);
      if (custodial) {
        return successEnvelope(reply, {
          claim_link_id: claimLinkId,
          source: "custodial",
          recipient_hint: maskRecipientHint(custodial.payload.beneficiary),
        });
      }
      return errorEnvelope(reply, "Claim not found", 404);
    } catch (err) {
      req.log.error({ err }, "GET /api/claims/by-link/:claimLinkId");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  /** Get claim by 6-alphanumeric code (legacy; prefer by-link + unlock flow). */
  app.get("/api/claims/by-code/:code", async (req: FastifyRequest<{ Params: { code: string } }>, reply) => {
    try {
      const code = (req.params.code ?? "").trim().toUpperCase();
      if (!code) return reply.status(400).send({ success: false, error: "code is required" });
      const claim = await prisma.claim.findFirst({
        where: { code },
        include: { request: { include: { transaction: true } } },
      });
      if (!claim) return errorEnvelope(reply, "Claim not found", 404);
      const data = {
        ...claim,
        value: claim.value.toString(),
        price: claim.price.toString(),
        otpVerified: !!claim.otpVerifiedAt,
        request: claim.request
          ? {
              ...claim.request,
              transaction: claim.request.transaction
                ? {
                    ...claim.request.transaction,
                    f_amount: claim.request.transaction.f_amount.toString(),
                    t_amount: claim.request.transaction.t_amount.toString(),
                    ...serializeTransactionPrices(claim.request.transaction),
                  }
                : null,
            }
          : null,
      };
      return successEnvelope(reply, data);
    } catch (err) {
      req.log.error({ err }, "GET /api/claims/by-code/:code");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  const VerifyRecipientBodySchema = z.object({
    claim_link_id: z.string().min(16).max(16),
    recipient: z.string().min(3),
  });

  app.post<{ Body: unknown }>("/api/claims/verify-recipient", async (req: FastifyRequest<{ Body: unknown }>, reply) => {
    const parse = VerifyRecipientBodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ success: false, error: "Validation failed", details: parse.error.flatten() });
    }
    const claimLinkId = parse.data.claim_link_id.trim().toLowerCase();
    if (!isValidClaimLinkId(claimLinkId)) {
      return reply.status(400).send({ success: false, error: "Invalid claim link" });
    }
    const recipient = parse.data.recipient;

    const dbClaim = await prisma.claim.findFirst({
      where: { claimLinkId },
      select: { id: true, toIdentifier: true, payerIdentifier: true, status: true },
    });
    if (dbClaim) {
      if (dbClaim.status !== "ACTIVE") {
        return reply.status(400).send({ success: false, error: "Claim is not active" });
      }
      if (claimRecipientsMatch(dbClaim.payerIdentifier, dbClaim.toIdentifier)) {
        return reply.status(400).send({
          success: false,
          error: "This claim cannot be completed when payer and recipient are the same contact.",
          code: "SELF_CLAIM_NOT_ALLOWED",
        });
      }
      if (!claimRecipientsMatch(dbClaim.toIdentifier, recipient)) {
        return reply.status(400).send({ success: false, error: "Recipient does not match this claim" });
      }
      return successEnvelope(reply, { ok: true });
    }

    const custodial = await resolveCustodialByLinkId(claimLinkId);
    if (custodial) {
      if (claimRecipientsMatch(custodial.payload.payerEmail, custodial.payload.beneficiary)) {
        return reply.status(400).send({
          success: false,
          error: "This claim cannot be completed when payer and recipient are the same contact.",
          code: "SELF_CLAIM_NOT_ALLOWED",
        });
      }
      if (!claimRecipientsMatch(custodial.payload.beneficiary, recipient)) {
        return reply.status(400).send({ success: false, error: "Recipient does not match this claim" });
      }
      return successEnvelope(reply, { ok: true });
    }

    return errorEnvelope(reply, "Claim not found", 404);
  });

  const VerifyOtpBodySchema = z.object({
    claim_id: z.string().uuid().optional(),
    code: z.string().min(1).optional(),
    claim_link_id: z.string().min(16).max(16).optional(),
    recipient: z.string().min(3).optional(),
    otp: z.string().min(4).max(12),
  });

  app.post<{ Body: unknown }>("/api/claims/verify-otp", async (req: FastifyRequest<{ Body: unknown }>, reply) => {
    const parse = VerifyOtpBodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ success: false, error: "Validation failed", details: parse.error.flatten() });
    }
    const { claim_id, code, claim_link_id, recipient, otp } = parse.data;

    if (claim_link_id) {
      const claimLinkId = claim_link_id.trim().toLowerCase();
      if (!isValidClaimLinkId(claimLinkId)) {
        return reply.status(400).send({ success: false, error: "Invalid claim link" });
      }
      if (!recipient?.trim()) {
        return reply.status(400).send({ success: false, error: "recipient is required with claim_link_id" });
      }

      const dbClaim = await prisma.claim.findFirst({
        where: { claimLinkId },
        select: { id: true, otpVerifiedAt: true, status: true, toIdentifier: true },
      });
      if (dbClaim) {
        if (dbClaim.status !== "ACTIVE") return reply.status(400).send({ success: false, error: "Claim is not active" });
        if (!claimRecipientsMatch(dbClaim.toIdentifier, recipient)) {
          return reply.status(400).send({ success: false, error: "Recipient does not match this claim" });
        }
        if (dbClaim.otpVerifiedAt) {
          return successEnvelope(reply, { verified: true, message: "Already verified" });
        }
        const expected = await getClaimOtp(dbClaim.id);
        if (!expected || !timingSafeOtp(otp, expected)) {
          return reply.status(400).send({ success: false, error: "Invalid or expired OTP" });
        }
        await deleteClaimOtp(dbClaim.id);
        await prisma.claim.update({
          where: { id: dbClaim.id },
          data: { otpVerifiedAt: new Date() },
        });
        return successEnvelope(reply, { verified: true, message: "OTP verified" });
      }

      const custodial = await resolveCustodialByLinkId(claimLinkId);
      if (!custodial) return errorEnvelope(reply, "Claim not found", 404);
      if (!claimRecipientsMatch(custodial.payload.beneficiary, recipient)) {
        return reply.status(400).send({ success: false, error: "Recipient does not match this claim" });
      }
      if (!timingSafeOtp(otp, custodial.payload.otp)) {
        return reply.status(400).send({ success: false, error: "Invalid or expired OTP" });
      }
      await setCustodialClaimOtpGate(claimLinkId, custodial.transactionId);
      return successEnvelope(reply, { verified: true, message: "OTP verified" });
    }

    if (!claim_id && !code) {
      return reply.status(400).send({ success: false, error: "claim_id, code, or claim_link_id is required" });
    }
    const claim = await prisma.claim.findFirst({
      where: claim_id ? { id: claim_id } : { code: (code ?? "").trim().toUpperCase() },
      select: { id: true, otpVerifiedAt: true, status: true },
    });
    if (!claim) return errorEnvelope(reply, "Claim not found", 404);
    if (claim.status !== "ACTIVE") return reply.status(400).send({ success: false, error: "Claim is not active" });
    if (claim.otpVerifiedAt) return successEnvelope(reply, { verified: true, message: "Already verified" });

    const expected = await getClaimOtp(claim.id);
    if (!expected || !timingSafeOtp(otp, expected)) {
      return reply.status(400).send({ success: false, error: "Invalid or expired OTP" });
    }
    await deleteClaimOtp(claim.id);
    await prisma.claim.update({
      where: { id: claim.id },
      data: { otpVerifiedAt: new Date() },
    });
    return successEnvelope(reply, { verified: true, message: "OTP verified; you can now claim" });
  });

  const VerifyClaimCodeBodySchema = z.object({
    claim_link_id: z.string().min(16).max(16),
    recipient: z.string().min(3),
    code: z.string().min(6).max(6),
  });

  app.post<{ Body: unknown }>("/api/claims/verify-claim-code", async (req: FastifyRequest<{ Body: unknown }>, reply) => {
    const parse = VerifyClaimCodeBodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ success: false, error: "Validation failed", details: parse.error.flatten() });
    }
    const claimLinkId = parse.data.claim_link_id.trim().toLowerCase();
    if (!isValidClaimLinkId(claimLinkId)) {
      return reply.status(400).send({ success: false, error: "Invalid claim link" });
    }
    const { recipient, code } = parse.data;

    const dbClaim = await prisma.claim.findFirst({
      where: { claimLinkId },
      include: { request: { include: { transaction: true } } },
    });
    if (dbClaim) {
      if (dbClaim.status !== "ACTIVE") return reply.status(400).send({ success: false, error: "Claim is not active" });
      if (!claimRecipientsMatch(dbClaim.toIdentifier, recipient)) {
        return reply.status(400).send({ success: false, error: "Recipient does not match this claim" });
      }
      if (!dbClaim.otpVerifiedAt) {
        return reply.status(403).send({ success: false, error: "Verify OTP first", code: "OTP_NOT_VERIFIED" });
      }
      if (dbClaim.claimCodeVerifiedAt) {
        return reply.status(400).send({
          success: false,
          error: "Claim code was already verified. Use your unlock token to finish, or reopen the claim link.",
          code: "ALREADY_VERIFIED",
        });
      }
      if (!timingSafeClaimCode(code, dbClaim.code)) {
        return reply.status(400).send({ success: false, error: "Invalid claim code" });
      }
      await prisma.claim.update({
        where: { id: dbClaim.id },
        data: { claimCodeVerifiedAt: new Date() },
      });
      const token = randomBytes(24).toString("hex");
      const session: UnlockSession = {
        kind: "db",
        claimLinkId,
        recipient: recipient.trim(),
        claimId: dbClaim.id,
      };
      await setClaimUnlockSession(token, JSON.stringify(session));
      return successEnvelope(reply, { verified: true, unlock_token: token });
    }

    const custodial = await resolveCustodialByLinkId(claimLinkId);
    if (!custodial) return errorEnvelope(reply, "Claim not found", 404);
    if (!claimRecipientsMatch(custodial.payload.beneficiary, recipient)) {
      return reply.status(400).send({ success: false, error: "Recipient does not match this claim" });
    }
    const gateTx = await getCustodialClaimOtpGate(claimLinkId);
    if (!gateTx || gateTx !== custodial.transactionId) {
      return reply.status(403).send({ success: false, error: "Verify OTP first", code: "OTP_NOT_VERIFIED" });
    }
    if (!timingSafeClaimCode(code, custodial.payload.claimCode)) {
      return reply.status(400).send({ success: false, error: "Invalid claim code" });
    }
    await deleteCustodialClaimOtpGate(claimLinkId);
    const token = randomBytes(24).toString("hex");
    const session: UnlockSession = {
      kind: "custodial",
      claimLinkId,
      recipient: recipient.trim(),
      transactionId: custodial.transactionId,
    };
    await setClaimUnlockSession(token, JSON.stringify(session));
    return successEnvelope(reply, { verified: true, unlock_token: token });
  });

  const SettlementSelectionBodySchema = z.object({
    unlock_token: z.string().min(16),
    recipient: z.string().min(3),
    t_chain: z.string().min(1),
    t_token: z.string().min(1),
    t_amount: z.union([z.string().min(1), z.number()]),
  });

  app.post<{ Body: unknown }>("/api/claims/settlement-selection", async (req, reply) => {
    const parse = SettlementSelectionBodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ success: false, error: "Validation failed", details: parse.error.flatten() });
    }
    const token = parse.data.unlock_token.trim();
    const raw = await getClaimUnlockSession(token);
    if (!raw) {
      return reply.status(403).send({ success: false, error: "Invalid or expired session", code: "SESSION_INVALID" });
    }
    let session: UnlockSession;
    try {
      session = JSON.parse(raw) as UnlockSession;
    } catch {
      return reply.status(403).send({ success: false, error: "Invalid or expired session", code: "SESSION_INVALID" });
    }
    if (!claimRecipientsMatch(session.recipient, parse.data.recipient)) {
      return reply.status(400).send({ success: false, error: "Recipient does not match session" });
    }

    let tAmt: Prisma.Decimal;
    try {
      const rawAmt =
        typeof parse.data.t_amount === "number" ? String(parse.data.t_amount) : parse.data.t_amount.trim();
      tAmt = new Prisma.Decimal(rawAmt);
      if (tAmt.lte(0)) {
        return reply.status(400).send({ success: false, error: "t_amount must be positive" });
      }
    } catch {
      return reply.status(400).send({ success: false, error: "Invalid t_amount" });
    }

    const tChain = parse.data.t_chain.trim().toUpperCase();
    const tToken = parse.data.t_token.trim().toUpperCase();
    const proposedHead = { t_chain: tChain, t_token: tToken };

    if (!settlementIsOnchainCrypto(proposedHead)) {
      return reply.status(400).send({
        success: false,
        error: "Settlement must be an on-chain crypto asset.",
        code: "INVALID_SETTLEMENT_RAIL",
      });
    }
    if (!claimCryptoAllowed(proposedHead)) {
      return reply.status(400).send({
        success: false,
        error: "This claim is not set up for on-chain wallet payout.",
        code: "CRYPTO_CLAIM_NOT_ALLOWED",
      });
    }

    try {
      if (session.kind === "db" && session.claimId) {
        const claim = await prisma.claim.findUnique({
          where: { id: session.claimId },
          include: { request: { include: { transaction: true } } },
        });
        if (!claim) return errorEnvelope(reply, "Claim not found", 404);
        if (claim.status !== "ACTIVE") {
          return reply.status(400).send({ success: false, error: "Claim is not active" });
        }
        if (!claim.otpVerifiedAt || !claim.claimCodeVerifiedAt) {
          return reply.status(403).send({
            success: false,
            error: "Complete verification before choosing settlement",
            code: "VERIFY_REQUIRED",
          });
        }
        const tx = claim.request?.transaction;
        if (!tx || tx.type !== "REQUEST") {
          return errorEnvelope(reply, "Transaction not found", 404);
        }
        if (tx.cryptoSendTxHash) {
          return reply.status(400).send({
            success: false,
            error: "Settlement cannot be changed after the payer has sent crypto.",
            code: "SETTLEMENT_LOCKED",
          });
        }

        const merged = {
          f_chain: tx.f_chain,
          f_token: tx.f_token,
          t_chain: tChain,
          t_token: tToken,
        };
        if (!cryptoPayoutAllowed(merged)) {
          return reply.status(400).send({
            success: false,
            error:
              "Choose a different receive asset than what the payer sent on-chain, or use Receive fiat if available.",
            code: "CRYPTO_SAME_AS_SENT",
          });
        }

        await prisma.$transaction([
          prisma.transaction.update({
            where: { id: tx.id },
            data: { t_chain: tChain, t_token: tToken, t_amount: tAmt },
          }),
          prisma.claim.update({
            where: { id: claim.id },
            data: { token: tToken, value: tAmt },
          }),
        ]);

        const refreshed = await prisma.transaction.findUnique({
          where: { id: tx.id },
          select: {
            id: true,
            f_chain: true,
            f_token: true,
            f_amount: true,
            t_chain: true,
            t_token: true,
            t_amount: true,
            cryptoSendTxHash: true,
          },
        });
        if (!refreshed) return errorEnvelope(reply, "Transaction not found", 404);
        const cryptoPayoutOk = cryptoPayoutAllowed(refreshed);
        return successEnvelope(reply, {
          updated: true,
          transaction_id: refreshed.id,
          t_chain: refreshed.t_chain,
          t_token: refreshed.t_token,
          t_amount: refreshed.t_amount.toString(),
          crypto_payout_allowed: cryptoPayoutOk,
          claim_crypto_allowed: claimCryptoAllowed(refreshed),
        });
      }

      if (session.kind === "custodial" && session.transactionId) {
        const tx = await prisma.transaction.findUnique({
          where: { id: session.transactionId },
          select: {
            id: true,
            type: true,
            f_chain: true,
            f_token: true,
            f_amount: true,
            t_chain: true,
            t_token: true,
            t_amount: true,
            cryptoSendTxHash: true,
          },
        });
        if (!tx || tx.type !== "SELL") return errorEnvelope(reply, "Transaction not found", 404);
        if (tx.cryptoSendTxHash) {
          return reply.status(400).send({
            success: false,
            error: "Settlement cannot be changed after the payer has sent crypto.",
            code: "SETTLEMENT_LOCKED",
          });
        }

        const merged = {
          f_chain: tx.f_chain,
          f_token: tx.f_token,
          t_chain: tChain,
          t_token: tToken,
        };
        if (!cryptoPayoutAllowed(merged)) {
          return reply.status(400).send({
            success: false,
            error:
              "Choose a different receive asset than what the payer sent on-chain, or use Receive fiat if available.",
            code: "CRYPTO_SAME_AS_SENT",
          });
        }

        const refreshed = await prisma.transaction.update({
          where: { id: tx.id },
          data: { t_chain: tChain, t_token: tToken, t_amount: tAmt },
          select: {
            id: true,
            f_chain: true,
            f_token: true,
            t_amount: true,
            t_chain: true,
            t_token: true,
            cryptoSendTxHash: true,
          },
        });
        const cryptoPayoutOk = cryptoPayoutAllowed(refreshed);
        return successEnvelope(reply, {
          updated: true,
          transaction_id: refreshed.id,
          t_chain: refreshed.t_chain,
          t_token: refreshed.t_token,
          t_amount: refreshed.t_amount.toString(),
          crypto_payout_allowed: cryptoPayoutOk,
          claim_crypto_allowed: claimCryptoAllowed(refreshed),
        });
      }

      return reply.status(400).send({ success: false, error: "Invalid session" });
    } catch (err) {
      req.log.error({ err }, "POST /api/claims/settlement-selection");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.get("/api/claims/unlocked/:token", async (req: FastifyRequest<{ Params: { token: string } }>, reply) => {
    try {
      const token = (req.params.token ?? "").trim();
      if (token.length < 16) return reply.status(400).send({ success: false, error: "Invalid token" });
      const raw = await getClaimUnlockSession(token);
      if (!raw) return errorEnvelope(reply, "Session expired or invalid", 404);
      let session: UnlockSession;
      try {
        session = JSON.parse(raw) as UnlockSession;
      } catch {
        return errorEnvelope(reply, "Session expired or invalid", 404);
      }
      if (session.kind === "db" && session.claimId) {
        const claim = await prisma.claim.findUnique({
          where: { id: session.claimId },
          include: { request: { include: { transaction: true } } },
        });
        if (!claim || claim.status !== "ACTIVE" || !claim.claimCodeVerifiedAt) {
          return errorEnvelope(reply, "Claim not available", 404);
        }
        if (claim.claimLinkId.toLowerCase() !== session.claimLinkId.toLowerCase()) {
          return errorEnvelope(reply, "Claim not available", 404);
        }
        const tx = claim.request?.transaction;
        if (!tx) return errorEnvelope(reply, "Claim not available", 404);
        const senderFiat = senderPaidFiatTx(tx);
        const cryptoPayoutOk = cryptoPayoutAllowed(tx);
        const fiatClaimOk = claimFiatAllowed(tx);
        const cryptoClaimOk = claimCryptoAllowed(tx);
        const sent_summary = senderFiat
          ? `${tx.f_amount.toString()} ${tx.f_token} (fiat)`
          : `${tx.f_amount.toString()} ${tx.f_token} on ${tx.f_chain}`;
        return successEnvelope(reply, {
          claim_link_id: claim.claimLinkId,
          kind: "db",
          claim_id: claim.id,
          value: claim.value.toString(),
          token: claim.token,
          payer_identifier: claim.payerIdentifier,
          to_identifier: claim.toIdentifier,
          transaction_id: tx.id,
          payout_type_hint: tx.t_chain !== "MOMO" && tx.t_chain !== "BANK" ? "crypto" : "fiat",
          f_chain: tx.f_chain,
          f_token: tx.f_token,
          f_amount: tx.f_amount.toString(),
          t_chain: tx.t_chain,
          t_token: tx.t_token,
          t_amount: tx.t_amount.toString(),
          sent_summary,
          sender_paid_fiat: senderFiat,
          claim_fiat_allowed: fiatClaimOk,
          claim_crypto_allowed: cryptoClaimOk,
          crypto_payout_allowed: cryptoPayoutOk,
        });
      }
      if (session.kind === "custodial" && session.transactionId) {
        const payload = parseCustodialPayload(await getCustodialSendPayload(session.transactionId));
        if (!payload) return errorEnvelope(reply, "Claim not available", 404);
        const tx = await prisma.transaction.findUnique({
          where: { id: session.transactionId },
          select: {
            id: true,
            f_amount: true,
            f_token: true,
            f_chain: true,
            t_amount: true,
            t_token: true,
            t_chain: true,
            status: true,
            type: true,
            cryptoSendTxHash: true,
          },
        });
        if (!tx || tx.type !== "SELL") return errorEnvelope(reply, "Claim not available", 404);
        const senderFiat = senderPaidFiatTx(tx);
        const cryptoPayoutOk = cryptoPayoutAllowed(tx);
        const fiatClaimOk = claimFiatAllowed(tx);
        const cryptoClaimOk = claimCryptoAllowed(tx);
        const sent_summary = senderFiat
          ? `${tx.f_amount.toString()} ${tx.f_token} (fiat)`
          : `${tx.f_amount.toString()} ${tx.f_token} on ${tx.f_chain}`;
        return successEnvelope(reply, {
          claim_link_id: session.claimLinkId,
          kind: "custodial",
          transaction_id: tx.id,
          value: tx.t_amount.toString(),
          token: tx.t_token,
          payer_identifier: payload.payerEmail,
          to_identifier: payload.beneficiary,
          payout_type_hint: tx.t_chain !== "MOMO" && tx.t_chain !== "BANK" ? "crypto" : "fiat",
          f_chain: tx.f_chain,
          f_token: tx.f_token,
          f_amount: tx.f_amount.toString(),
          t_chain: tx.t_chain,
          t_token: tx.t_token,
          t_amount: tx.t_amount.toString(),
          sent_summary,
          sender_paid_fiat: senderFiat,
          claim_fiat_allowed: fiatClaimOk,
          claim_crypto_allowed: cryptoClaimOk,
          crypto_payout_allowed: cryptoPayoutOk,
        });
      }
      return errorEnvelope(reply, "Session expired or invalid", 404);
    } catch (err) {
      req.log.error({ err }, "GET /api/claims/unlocked/:token");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  const PayoutFiatClaimSchema = z.object({
    type: z.enum(["nuban", "mobile_money"]),
    account_name: z.string().min(1),
    account_number: z.string().min(1),
    bank_code: z.string().min(1),
    currency: z.string().min(1),
  });

  const ClaimBodySchema = z
    .object({
      code: z.string().length(6).optional(),
      unlock_token: z.string().min(16).optional(),
      recipient: z.string().min(3).optional(),
      claim_link_id: z.string().min(16).max(16).optional(),
      payout_type: z.enum(["crypto", "fiat"]),
      payout_target: z.string().optional(),
      payout_fiat: PayoutFiatClaimSchema.optional(),
    })
    .superRefine((data, ctx) => {
      const hasUnlock = Boolean(data.unlock_token?.trim());
      const hasLegacyCode = Boolean(data.code?.trim());
      if (!hasUnlock && !hasLegacyCode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "unlock_token or code is required",
          path: ["code"],
        });
      }
      if (hasUnlock && !data.recipient?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "recipient is required with unlock_token",
          path: ["recipient"],
        });
      }
      if (data.payout_type === "crypto") {
        const t = data.payout_target?.trim() ?? "";
        if (!t.startsWith("0x") || t.length !== 42) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "payout_target must be a valid 0x EVM address for crypto claims",
            path: ["payout_target"],
          });
        }
      } else if (!data.payout_fiat) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "payout_fiat is required for fiat claims",
          path: ["payout_fiat"],
        });
      }
    });

  app.post<{ Body: unknown }>("/api/claims/claim", async (req: FastifyRequest<{ Body: unknown }>, reply) => {
    const parse = ClaimBodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ success: false, error: "Validation failed", details: parse.error.flatten() });
    }
    const { payout_type } = parse.data;

    if (parse.data.unlock_token?.trim() && parse.data.recipient?.trim()) {
      const token = parse.data.unlock_token.trim();
      const raw = await getClaimUnlockSession(token);
      if (!raw) {
        return reply.status(403).send({ success: false, error: "Invalid or expired session", code: "SESSION_INVALID" });
      }
      let session: UnlockSession;
      try {
        session = JSON.parse(raw) as UnlockSession;
      } catch {
        return reply.status(403).send({ success: false, error: "Invalid or expired session", code: "SESSION_INVALID" });
      }
      if (!claimRecipientsMatch(session.recipient, parse.data.recipient!)) {
        return reply.status(400).send({ success: false, error: "Recipient does not match session" });
      }

      if (session.kind === "db" && session.claimId) {
        const claim = await prisma.claim.findUnique({
          where: { id: session.claimId },
          include: { request: { include: { transaction: true } } },
        });
        if (!claim) return errorEnvelope(reply, "Claim not found", 404);
        if (claim.status !== "ACTIVE") return reply.status(400).send({ success: false, error: "Claim is not active" });
        if (!claim.otpVerifiedAt || !claim.claimCodeVerifiedAt) {
          return reply.status(403).send({
            success: false,
            error: "Complete verification before claiming",
            code: "VERIFY_REQUIRED",
          });
        }
        let tx = claim.request?.transaction;
        if (!tx || !claim.request) return errorEnvelope(reply, "Transaction not found", 500);

        const guard = claimPayoutGuard(tx, payout_type);
        if (!guard.ok) {
          return reply.status(400).send({ success: false, error: guard.error, code: guard.code });
        }

        const payoutLockOk = await tryAcquireClaimPayoutLock(claim.id);
        if (!payoutLockOk) {
          return reply.status(429).send({
            success: false,
            error: "This claim is already being processed. Please wait a moment and try again.",
            code: "CLAIM_IN_PROGRESS",
          });
        }

        try {
          let sendResult: { ok: boolean; error?: string; reference?: string } = { ok: true };
          if (payout_type === "crypto") {
            const addr = parse.data.payout_target!.trim();
            const cr = await executeRequestSettlementSend(tx.id, addr);
            sendResult = cr.ok ? { ok: true } : { ok: false, error: cr.error };
          } else {
            const fiat = parse.data.payout_fiat as PayoutFiat;
            await prisma.request.update({
              where: { id: claim.request.id },
              data: { payoutFiat: JSON.parse(JSON.stringify(fiat)) as object },
            });
            sendResult = await executePaystackFiatTransfer({
              payoutFiat: fiat,
              amountHuman: tx.t_amount.toString(),
              referencePrefix: `claim_${claim.id.slice(0, 8)}`,
            });
          }

          if (!sendResult.ok) {
            req.log.warn({ err: sendResult.error, transactionId: tx.id, payout_type }, "Claim payout failed");
            return reply.status(502).send({
              success: false,
              error: sendResult.error ?? "Payout failed. Your claim is still active — try again or contact support.",
              code: "PAYOUT_FAILED",
            });
          }

          const markedClaim = await prisma.claim.updateMany({
            where: { id: claim.id, status: "ACTIVE" },
            data: { status: "CLAIMED" },
          });
          if (markedClaim.count === 0) {
            req.log.warn({ claimId: claim.id, transactionId: tx.id }, "claim.finalize_race_after_payout");
            return reply.status(409).send({
              success: false,
              error: "This link has already been claimed.",
              code: "ALREADY_CLAIMED",
            });
          }
          await prisma.transaction.update({
            where: { id: tx.id },
            data: { status: "COMPLETED" },
          });
          await deleteClaimUnlockSession(token);

          const recipientNorm = parse.data.recipient!.trim();
          const sentSummary = `${tx.f_amount.toString()} ${tx.f_token} on ${tx.f_chain}`;
          const addr = parse.data.payout_target?.trim() ?? "";
          const fiat = parse.data.payout_fiat;
          const claimedSummary =
            payout_type === "crypto"
              ? `${tx.t_amount.toString()} ${tx.t_token} on ${tx.t_chain} to ${addr.slice(0, 6)}…${addr.slice(-4)}`
              : `${tx.t_amount.toString()} ${fiat?.currency ?? ""} via ${fiat?.type ?? "fiat"} (transfer)`;
          void notifyClaimCompleted({
            payoutType: payout_type,
            payerEmail: claim.payerIdentifier,
            receiverContact: recipientNorm,
            sentSummary,
            claimedSummary,
            transactionId: tx.id,
            paystackReference: payout_type === "fiat" && sendResult.reference ? sendResult.reference : undefined,
          });

          return successEnvelope(reply, {
            claimed: true,
            claim_id: claim.id,
            transaction_id: tx.id,
            payout_type,
            sent: true,
            message:
              payout_type === "crypto"
                ? "Crypto sent to your wallet."
                : "Transfer to your account has been initiated.",
          });
        } finally {
          await releaseClaimPayoutLock(claim.id);
        }
      }

      if (session.kind === "custodial" && session.transactionId) {
        const payloadBefore = parseCustodialPayload(await getCustodialSendPayload(session.transactionId));
        let tx = await prisma.transaction.findUnique({
          where: { id: session.transactionId },
          select: {
            id: true,
            type: true,
            status: true,
            f_amount: true,
            f_token: true,
            f_chain: true,
            t_amount: true,
            t_token: true,
            t_chain: true,
            cryptoSendTxHash: true,
          },
        });
        if (!tx || tx.type !== "SELL") return errorEnvelope(reply, "Transaction not found", 404);
        if (tx.status === "COMPLETED") {
          return reply.status(400).send({ success: false, error: "This payment was already claimed.", code: "ALREADY_CLAIMED" });
        }

        const guard = claimPayoutGuard(tx, payout_type);
        if (!guard.ok) {
          return reply.status(400).send({ success: false, error: guard.error, code: guard.code });
        }

        const custodialLockKey = `custodial:${tx.id}`;
        const custodialLockOk = await tryAcquireClaimPayoutLock(custodialLockKey);
        if (!custodialLockOk) {
          return reply.status(429).send({
            success: false,
            error: "This claim is already being processed. Please wait a moment and try again.",
            code: "CLAIM_IN_PROGRESS",
          });
        }

        try {
          let sendResult: { ok: boolean; error?: string; reference?: string } = { ok: true };
          if (payout_type === "crypto") {
            const addr = parse.data.payout_target!.trim();
            const cr = await executeRequestSettlementSend(tx.id, addr);
            sendResult = cr.ok ? { ok: true } : { ok: false, error: cr.error };
          } else {
            const fiat = parse.data.payout_fiat as PayoutFiat;
            sendResult = await executePaystackFiatTransfer({
              payoutFiat: fiat,
              amountHuman: tx.t_amount.toString(),
              referencePrefix: `custodial_${tx.id.slice(0, 8)}`,
            });
          }

          if (!sendResult.ok) {
            req.log.warn({ err: sendResult.error, transactionId: tx.id, payout_type }, "Custodial claim payout failed");
            return reply.status(502).send({
              success: false,
              error: sendResult.error ?? "Payout failed. Try again or contact support.",
              code: "PAYOUT_FAILED",
            });
          }

          const linkId = payloadBefore?.claimLinkId ?? session.claimLinkId;
          await deleteCustodialSendPayload(tx.id);
          if (linkId) await deleteCustodialClaimLinkIndex(linkId);
          await deleteClaimUnlockSession(token);

          const recipientNorm = parse.data.recipient!.trim();
          const sentSummary = `${tx.f_amount.toString()} ${tx.f_token} on ${tx.f_chain}`;
          const addr = parse.data.payout_target?.trim() ?? "";
          const fiat = parse.data.payout_fiat;
          const claimedSummary =
            payout_type === "crypto"
              ? `${tx.t_amount.toString()} ${tx.t_token} on ${tx.t_chain} to ${addr.slice(0, 6)}…${addr.slice(-4)}`
              : `${tx.t_amount.toString()} ${fiat?.currency ?? ""} via ${fiat?.type ?? "fiat"} (transfer)`;
          void notifyClaimCompleted({
            payoutType: payout_type,
            payerEmail: payloadBefore?.payerEmail,
            receiverContact: recipientNorm,
            sentSummary,
            claimedSummary,
            transactionId: tx.id,
            paystackReference: payout_type === "fiat" && sendResult.reference ? sendResult.reference : undefined,
          });

          return successEnvelope(reply, {
            claimed: true,
            transaction_id: tx.id,
            payout_type,
            sent: true,
            message:
              payout_type === "crypto"
                ? "Crypto sent to your wallet."
                : "Transfer to your account has been initiated.",
          });
        } finally {
          await releaseClaimPayoutLock(custodialLockKey);
        }
      }

      return reply.status(400).send({ success: false, error: "Invalid session" });
    }

    const codeNorm = (parse.data.code ?? "").trim().toUpperCase();
    const claim = await prisma.claim.findFirst({
      where: { code: codeNorm },
      include: { request: { include: { transaction: true } } },
    });
    if (!claim) return errorEnvelope(reply, "Claim not found", 404);
    if (claim.status !== "ACTIVE") return reply.status(400).send({ success: false, error: "Claim is not active" });
    if (!claim.otpVerifiedAt) {
      return reply.status(403).send({
        success: false,
        error: "Verify your email/phone with OTP before claiming",
        code: "OTP_NOT_VERIFIED",
      });
    }
    let tx = claim.request?.transaction;
    if (!tx || !claim.request) return errorEnvelope(reply, "Transaction not found", 500);

    const guard = claimPayoutGuard(tx, payout_type);
    if (!guard.ok) {
      return reply.status(400).send({ success: false, error: guard.error, code: guard.code });
    }

    const legacyLockOk = await tryAcquireClaimPayoutLock(claim.id);
    if (!legacyLockOk) {
      return reply.status(429).send({
        success: false,
        error: "This claim is already being processed. Please wait a moment and try again.",
        code: "CLAIM_IN_PROGRESS",
      });
    }

    try {
      let sendResult: { ok: boolean; error?: string; reference?: string } = { ok: true };

      if (payout_type === "crypto") {
        const addr = parse.data.payout_target!.trim();
        const cr = await executeRequestSettlementSend(tx.id, addr);
        sendResult = cr.ok ? { ok: true } : { ok: false, error: cr.error };
      } else {
        const fiat = parse.data.payout_fiat as PayoutFiat;
        await prisma.request.update({
          where: { id: claim.request.id },
          data: { payoutFiat: JSON.parse(JSON.stringify(fiat)) as object },
        });
        sendResult = await executePaystackFiatTransfer({
          payoutFiat: fiat,
          amountHuman: tx.t_amount.toString(),
          referencePrefix: `claim_${claim.id.slice(0, 8)}`,
        });
      }

      if (!sendResult.ok) {
        req.log.warn({ err: sendResult.error, transactionId: tx.id, payout_type }, "Claim payout failed");
        return reply.status(502).send({
          success: false,
          error: sendResult.error ?? "Payout failed. Your claim is still active — try again or contact support.",
          code: "PAYOUT_FAILED",
        });
      }

      const markedLegacy = await prisma.claim.updateMany({
        where: { id: claim.id, status: "ACTIVE" },
        data: { status: "CLAIMED" },
      });
      if (markedLegacy.count === 0) {
        return reply.status(409).send({
          success: false,
          error: "This link has already been claimed.",
          code: "ALREADY_CLAIMED",
        });
      }
      await prisma.transaction.update({
        where: { id: tx.id },
        data: { status: "COMPLETED" },
      });

      const sentSummary = `${tx.f_amount.toString()} ${tx.f_token} on ${tx.f_chain}`;
      const addr = parse.data.payout_target?.trim() ?? "";
      const fiat = parse.data.payout_fiat;
      const claimedSummary =
        payout_type === "crypto"
          ? `${tx.t_amount.toString()} ${tx.t_token} on ${tx.t_chain} to ${addr.slice(0, 6)}…${addr.slice(-4)}`
          : `${tx.t_amount.toString()} ${fiat?.currency ?? ""} via ${fiat?.type ?? "fiat"} (transfer)`;
      void notifyClaimCompleted({
        payoutType: payout_type,
        payerEmail: claim.payerIdentifier,
        receiverContact: claim.toIdentifier,
        sentSummary,
        claimedSummary,
        transactionId: tx.id,
        paystackReference: payout_type === "fiat" && sendResult.reference ? sendResult.reference : undefined,
      });

      return successEnvelope(reply, {
        claimed: true,
        claim_id: claim.id,
        transaction_id: tx.id,
        payout_type,
        sent: true,
        message:
          payout_type === "crypto"
            ? "Crypto sent to your wallet."
            : "Transfer to your account has been initiated.",
      });
    } finally {
      await releaseClaimPayoutLock(claim.id);
    }
  });
}
