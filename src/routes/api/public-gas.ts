import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";
import { verifyGasReportToken } from "../../lib/gas-report-token.js";
import { buildGasPolicyPublic } from "../../services/gas-policy.service.js";
import { recordSponsorshipDebit } from "../../services/gas-ledger.service.js";
import type { GasSponsorSource } from "../../services/gas-ledger.service.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const GasUsageBodySchema = z.object({
  idempotencyKey: z.string().min(8).max(200),
  estimatedUsd: z.coerce.number().positive().max(1_000_000),
  chainId: z.string().min(1).max(64),
  sponsorSource: z.enum(["platform", "business"]),
  txHash: z.string().min(1).max(200).optional(),
  userOpHash: z.string().min(1).max(200).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export async function publicGasApiRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/public/gas-policy",
    async (req: FastifyRequest<{ Querystring: { paymentLinkId?: string } }>, reply) => {
      try {
        const raw = (req.query.paymentLinkId ?? "").trim();
        if (!raw || !UUID_RE.test(raw)) {
          return errorEnvelope(reply, "Invalid paymentLinkId.", 400);
        }
        const link = await prisma.paymentLink.findFirst({
          where: { id: raw, isActive: true },
          select: { businessId: true },
        });
        if (!link) {
          return errorEnvelope(reply, "Not found.", 404);
        }
        const gasPolicy = await buildGasPolicyPublic(link.businessId);
        return successEnvelope(reply, { gasPolicy });
      } catch (err) {
        req.log.error({ err }, "GET /api/public/gas-policy");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  app.post(
    "/api/public/gas-usage",
    async (
      req: FastifyRequest<{
        Headers: { "x-gas-report-token"?: string };
        Body: unknown;
      }>,
      reply
    ) => {
      try {
        const tokenHeader = req.headers["x-gas-report-token"];
        const token = typeof tokenHeader === "string" ? tokenHeader.trim() : "";
        if (!token) {
          return errorEnvelope(reply, "Missing X-Gas-Report-Token.", 401);
        }
        const payload = verifyGasReportToken(token);
        if (!payload) {
          return errorEnvelope(reply, "Invalid or expired gas report token.", 401);
        }

        const parsed = GasUsageBodySchema.safeParse(req.body);
        if (!parsed.success) {
          return errorEnvelope(reply, "Invalid body.", 400);
        }
        const body = parsed.data;

        const link = await prisma.paymentLink.findFirst({
          where: { id: payload.paymentLinkId, isActive: true },
          select: { id: true, businessId: true },
        });
        if (!link || link.businessId !== payload.businessId) {
          return errorEnvelope(reply, "Payment link mismatch.", 403);
        }

        const policy = await buildGasPolicyPublic(link.businessId);
        const platform = await prisma.platformGasSettings.findUnique({
          where: { id: "default" },
        });

        if (body.sponsorSource === "business") {
          if (!policy.businessSponsorshipEnabled) {
            return errorEnvelope(reply, "Business gas sponsorship is not available for this checkout.", 403);
          }
        } else {
          if (!policy.platformSponsorshipEnabled) {
            return errorEnvelope(reply, "Platform gas sponsorship is not enabled.", 403);
          }
          const max = platform?.maxUsdPerTx ?? null;
          if (max != null && body.estimatedUsd > Number(max.toString())) {
            return errorEnvelope(reply, "Estimated amount exceeds platform max per transaction.", 400);
          }
        }

        const idempotencyKey = `gas-usage:${body.idempotencyKey}`;
        const meta = {
          chainId: body.chainId,
          txHash: body.txHash ?? null,
          userOpHash: body.userOpHash ?? null,
          paymentLinkId: link.id,
          sponsorSource: body.sponsorSource,
          ...(body.metadata ?? {}),
        };

        const source: GasSponsorSource = body.sponsorSource;
        const businessIdForDebit = source === "business" ? link.businessId : null;

        const result = await recordSponsorshipDebit({
          businessId: businessIdForDebit,
          amountUsd: body.estimatedUsd,
          idempotencyKey,
          metadata: meta,
          source,
        });

        if (!result.ok) {
          return errorEnvelope(reply, result.error, 400);
        }

        return successEnvelope(reply, { recorded: true, entryId: result.entryId });
      } catch (err) {
        req.log.error({ err }, "POST /api/public/gas-usage");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );
}
