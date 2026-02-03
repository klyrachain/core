/**
 * Paystack banks API: list banks, resolve account number, validate account (South Africa).
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  listBanks,
  resolveBankAccount,
  validateBankAccount,
  isPaystackConfigured,
} from "../../services/paystack.service.js";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import { PERMISSION_CONNECT_TRANSACTIONS } from "../../lib/permissions.js";

const ListBanksQuerySchema = z.object({
  country: z.enum(["ghana", "kenya", "nigeria", "south_africa", "south africa"]).optional(),
  currency: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  perPage: z.coerce.number().min(1).max(100).optional(),
  use_cursor: z.coerce.boolean().optional(),
  next: z.string().optional(),
});

const ResolveAccountQuerySchema = z.object({
  account_number: z.string().min(1, "account_number is required"),
  bank_code: z.string().min(1, "bank_code is required"),
});

const ValidateAccountBodySchema = z.object({
  bank_code: z.string().min(1),
  country_code: z.string().length(2),
  account_number: z.string().min(1),
  account_name: z.string().min(1),
  account_type: z.enum(["personal", "business"]),
  document_type: z.enum(["identityNumber", "passportNumber", "businessRegistrationNumber"]),
  document_number: z.string().min(1),
});

export async function paystackBanksApiRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/paystack/banks",
    async (
      req: FastifyRequest<{
        Querystring: {
          country?: string;
          currency?: string;
          type?: string;
          perPage?: string;
          use_cursor?: string;
          next?: string;
        };
      }>,
      reply
    ) => {
      if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS)) return;
      if (!isPaystackConfigured()) {
        return reply.status(503).send({
          success: false,
          error: "Paystack is not configured. Set PAYSTACK_SECRET_KEY.",
        });
      }
      const parse = ListBanksQuerySchema.safeParse(req.query);
      if (!parse.success) {
        return reply.status(400).send({
          success: false,
          error: "Validation failed",
          details: parse.error.flatten(),
        });
      }
      try {
        const { country, currency, type, perPage, use_cursor, next } = parse.data;
        const paystackCountry = country === "south_africa" ? "south africa" : country;
        const result = await listBanks({
          country: paystackCountry ?? undefined,
          currency: currency ?? undefined,
          type: type ?? undefined,
          perPage: perPage ?? undefined,
          use_cursor: use_cursor ?? undefined,
          next: next ?? undefined,
        });
        return successEnvelope(reply, { banks: result.data, meta: result.meta });
      } catch (err) {
        req.log.error({ err }, "GET /api/paystack/banks");
        const msg = err instanceof Error ? err.message : "Something went wrong.";
        return errorEnvelope(reply, msg, 502);
      }
    }
  );

  app.get(
    "/api/paystack/banks/resolve",
    async (
      req: FastifyRequest<{
        Querystring: { account_number?: string; bank_code?: string };
      }>,
      reply
    ) => {
      if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS)) return;
      if (!isPaystackConfigured()) {
        return reply.status(503).send({
          success: false,
          error: "Paystack is not configured. Set PAYSTACK_SECRET_KEY.",
        });
      }
      const parse = ResolveAccountQuerySchema.safeParse(req.query);
      if (!parse.success) {
        return reply.status(400).send({
          success: false,
          error: "Validation failed",
          details: parse.error.flatten(),
        });
      }
      try {
        const result = await resolveBankAccount(parse.data.account_number, parse.data.bank_code);
        return successEnvelope(reply, result);
      } catch (err) {
        req.log.error({ err }, "GET /api/paystack/banks/resolve");
        const msg = err instanceof Error ? err.message : "Something went wrong.";
        return errorEnvelope(reply, msg, 502);
      }
    }
  );

  app.post<{ Body: unknown }>(
    "/api/paystack/banks/validate",
    async (req: FastifyRequest<{ Body: unknown }>, reply) => {
      if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS)) return;
      if (!isPaystackConfigured()) {
        return reply.status(503).send({
          success: false,
          error: "Paystack is not configured. Set PAYSTACK_SECRET_KEY.",
        });
      }
      const parse = ValidateAccountBodySchema.safeParse(req.body);
      if (!parse.success) {
        return reply.status(400).send({
          success: false,
          error: "Validation failed",
          details: parse.error.flatten(),
        });
      }
      try {
        const result = await validateBankAccount(parse.data);
        return successEnvelope(reply, result);
      } catch (err) {
        req.log.error({ err }, "POST /api/paystack/banks/validate");
        const msg = err instanceof Error ? err.message : "Something went wrong.";
        return errorEnvelope(reply, msg, 502);
      }
    }
  );
}
