import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { randomBytes } from "crypto";
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

  const CreateRequestSchema = z.object({
    payerEmail: z.string().email(),
    payerPhone: z.string().min(1).optional(),
    channels: z.union([z.array(z.enum(["EMAIL", "SMS", "WHATSAPP"])), z.enum(["EMAIL", "SMS", "WHATSAPP"])]).optional(),
    t_amount: z.coerce.number().positive(),
    t_chain: z.string().min(1),
    t_token: z.string().min(1),
    toIdentifier: z.string().min(1),
    receiveSummary: z.string().min(1),
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

      const transaction = await prisma.transaction.create({
        data: {
          type: "REQUEST",
          status: "PENDING",
          f_amount: 0,
          t_amount: body.t_amount,
          f_chain: "MOMO",
          t_chain: body.t_chain,
          f_token: "GHS",
          t_token: body.t_token,
          f_provider: "PAYSTACK",
          t_provider: "KLYRA",
          fromIdentifier: body.payerEmail,
          fromType: "EMAIL",
          toIdentifier: body.toIdentifier,
          toType: body.toIdentifier.includes("@") ? "EMAIL" : "NUMBER",
        },
      });

      const request = await prisma.request.create({
        data: {
          code: requestCode,
          linkId,
          transactionId: transaction.id,
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
      const results = await sendPaymentRequestNotification({
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
}
