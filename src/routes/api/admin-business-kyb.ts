/**
 * Admin API: business KYB — list, reset (clear session id), manual approve/decline (DB only).
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import {
  PERMISSION_PLATFORM_READ,
  PERMISSION_SETTINGS_WRITE,
} from "../../lib/permissions.js";
import {
  listAdminKybBusinesses,
  resetBusinessKyb,
  overrideBusinessKyb,
} from "../../services/admin-business-kyb.service.js";

export async function adminBusinessKybApiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/admin/businesses/kyb", async (req: FastifyRequest, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_PLATFORM_READ)) return;
      const q = typeof req.query === "object" && req.query && "q" in req.query ? String((req.query as { q?: string }).q ?? "") : "";
      const limitRaw =
        typeof req.query === "object" && req.query && "limit" in req.query
          ? Number((req.query as { limit?: string }).limit)
          : 50;
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const businesses = await listAdminKybBusinesses(q || undefined, limit);
      return successEnvelope(reply, { businesses });
    } catch (err) {
      req.log.error({ err }, "GET /api/admin/businesses/kyb");
      return errorEnvelope(reply, "Could not list businesses.", 500);
    }
  });

  app.post(
    "/api/admin/businesses/kyb/reset",
    async (req: FastifyRequest<{ Body?: { businessId?: string } }>, reply) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_SETTINGS_WRITE)) return;
        const businessId =
          typeof req.body === "object" && req.body ? String((req.body as { businessId?: string }).businessId ?? "") : "";
        const result = await resetBusinessKyb(businessId);
        if (!result.ok) {
          return reply.status(400).send({ success: false, error: result.error, code: "BAD_REQUEST" });
        }
        return successEnvelope(reply, { ok: true });
      } catch (err) {
        req.log.error({ err }, "POST /api/admin/businesses/kyb/reset");
        return errorEnvelope(reply, "Reset failed.", 500);
      }
    }
  );

  app.post(
    "/api/admin/businesses/kyb/override",
    async (req: FastifyRequest<{ Body?: { businessId?: string; status?: string } }>, reply) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_SETTINGS_WRITE)) return;
        const body = (req.body && typeof req.body === "object" ? req.body : {}) as {
          businessId?: string;
          status?: string;
        };
        const businessId = String(body.businessId ?? "");
        const status = String(body.status ?? "").toLowerCase();
        if (status !== "approved" && status !== "declined") {
          return reply.status(400).send({
            success: false,
            error: "status must be approved or declined",
            code: "VALIDATION",
          });
        }
        const result = await overrideBusinessKyb(businessId, status);
        if (!result.ok) {
          return reply.status(400).send({ success: false, error: result.error, code: "BAD_REQUEST" });
        }
        return successEnvelope(reply, { ok: true, status });
      } catch (err) {
        req.log.error({ err }, "POST /api/admin/businesses/kyb/override");
        return errorEnvelope(reply, "Override failed.", 500);
      }
    }
  );
}
