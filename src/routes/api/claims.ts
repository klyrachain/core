import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
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
import { getClaimOtp, deleteClaimOtp } from "../../lib/redis.js";
import { executeRequestSettlementSend } from "../../services/onramp-execution.service.js";
import {
  executePaystackFiatTransfer,
  type PayoutFiat,
} from "../../services/request-settlement.service.js";

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

  /** Get claim by 6-alphanumeric code (for recipient; no auth required if using code). */
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

  const VerifyOtpBodySchema = z.object({
    claim_id: z.string().uuid().optional(),
    code: z.string().min(1).optional(),
    otp: z.string().min(4).max(10),
  });

  /** Verify OTP for claim (recipient). Sets otpVerifiedAt so claim can proceed. Requires claim_id or code. */
  app.post<{ Body: unknown }>("/api/claims/verify-otp", async (req: FastifyRequest<{ Body: unknown }>, reply) => {
    const parse = VerifyOtpBodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ success: false, error: "Validation failed", details: parse.error.flatten() });
    }
    const { claim_id, code, otp } = parse.data;
    if (!claim_id && !code) {
      return reply.status(400).send({ success: false, error: "claim_id or code is required" });
    }
    const claim = await prisma.claim.findFirst({
      where: claim_id ? { id: claim_id } : { code: (code ?? "").trim().toUpperCase() },
      select: { id: true, otpVerifiedAt: true, status: true },
    });
    if (!claim) return errorEnvelope(reply, "Claim not found", 404);
    if (claim.status !== "ACTIVE") return reply.status(400).send({ success: false, error: "Claim is not active" });
    if (claim.otpVerifiedAt) return successEnvelope(reply, { verified: true, message: "Already verified" });

    const expected = await getClaimOtp(claim.id);
    if (!expected || expected !== otp.trim()) {
      return reply.status(400).send({ success: false, error: "Invalid or expired OTP" });
    }
    await deleteClaimOtp(claim.id);
    await prisma.claim.update({
      where: { id: claim.id },
      data: { otpVerifiedAt: new Date() },
    });
    return successEnvelope(reply, { verified: true, message: "OTP verified; you can now claim" });
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
      code: z.string().length(6),
      payout_type: z.enum(["crypto", "fiat"]),
      payout_target: z.string().optional(),
      payout_fiat: PayoutFiatClaimSchema.optional(),
    })
    .superRefine((data, ctx) => {
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

  /** Complete claim: recipient provides 6-char code and payout choice. Blocked if OTP not verified. */
  app.post<{ Body: unknown }>("/api/claims/claim", async (req: FastifyRequest<{ Body: unknown }>, reply) => {
    const parse = ClaimBodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ success: false, error: "Validation failed", details: parse.error.flatten() });
    }
    const { code, payout_type } = parse.data;
    const codeNorm = code.trim().toUpperCase();
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
    const tx = claim.request?.transaction;
    if (!tx || !claim.request) return errorEnvelope(reply, "Transaction not found", 500);

    let sendResult: { ok: boolean; error?: string } = { ok: true };

    if (payout_type === "crypto") {
      const addr = parse.data.payout_target!.trim();
      sendResult = await executeRequestSettlementSend(tx.id, addr);
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
      req.log.warn(
        { err: sendResult.error, transactionId: tx.id, payout_type },
        "Claim payout failed"
      );
      return reply.status(502).send({
        success: false,
        error: sendResult.error ?? "Payout failed. Your claim is still active — try again or contact support.",
        code: "PAYOUT_FAILED",
      });
    }

    await prisma.claim.update({
      where: { id: claim.id },
      data: { status: "CLAIMED" },
    });
    await prisma.transaction.update({
      where: { id: tx.id },
      data: { status: "COMPLETED" },
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
          : "Fiat transfer initiated to your account.",
    });
  });
}
