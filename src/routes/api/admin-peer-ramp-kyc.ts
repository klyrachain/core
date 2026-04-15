/**
 * Admin API: Peer Ramp app users — KYC listing, reset (redo verification), manual approve/decline (DB only).
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import {
  PERMISSION_PLATFORM_READ,
  PERMISSION_SETTINGS_WRITE,
} from "../../lib/permissions.js";
import {
  listPeerRampAppUsersForKycAdmin,
  resetPeerRampUserKyc,
  overridePeerRampUserKyc,
} from "../../services/peer-ramp-kyc-admin.service.js";

export async function adminPeerRampKycApiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/admin/peer-ramp-app/kyc/users", async (req: FastifyRequest, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_PLATFORM_READ)) return;
      const q = typeof req.query === "object" && req.query && "q" in req.query ? String((req.query as { q?: string }).q ?? "") : "";
      const limitRaw =
        typeof req.query === "object" && req.query && "limit" in req.query
          ? Number((req.query as { limit?: string }).limit)
          : 50;
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const users = await listPeerRampAppUsersForKycAdmin(q || undefined, limit);
      return successEnvelope(reply, { users });
    } catch (err) {
      req.log.error({ err }, "GET /api/admin/peer-ramp-app/kyc/users");
      return errorEnvelope(reply, "Could not list Peer Ramp KYC users.", 500);
    }
  });

  app.post("/api/admin/peer-ramp-app/kyc/reset", async (req: FastifyRequest<{ Body?: { email?: string } }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_SETTINGS_WRITE)) return;
      const email = typeof req.body === "object" && req.body ? String((req.body as { email?: string }).email ?? "") : "";
      const result = await resetPeerRampUserKyc(email);
      if (!result.ok) {
        return reply.status(400).send({ success: false, error: result.error, code: "BAD_REQUEST" });
      }
      return successEnvelope(reply, { ok: true });
    } catch (err) {
      req.log.error({ err }, "POST /api/admin/peer-ramp-app/kyc/reset");
      return errorEnvelope(reply, "Reset failed.", 500);
    }
  });

  app.post(
    "/api/admin/peer-ramp-app/kyc/override",
    async (req: FastifyRequest<{ Body?: { email?: string; status?: string } }>, reply) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_SETTINGS_WRITE)) return;
        const body = (req.body && typeof req.body === "object" ? req.body : {}) as {
          email?: string;
          status?: string;
        };
        const email = String(body.email ?? "");
        const status = String(body.status ?? "").toLowerCase();
        if (status !== "approved" && status !== "declined") {
          return reply.status(400).send({
            success: false,
            error: "status must be approved or declined",
            code: "VALIDATION",
          });
        }
        const result = await overridePeerRampUserKyc(email, status);
        if (!result.ok) {
          return reply.status(400).send({ success: false, error: result.error, code: "BAD_REQUEST" });
        }
        return successEnvelope(reply, { ok: true, status });
      } catch (err) {
        req.log.error({ err }, "POST /api/admin/peer-ramp-app/kyc/override");
        return errorEnvelope(reply, "Override failed.", 500);
      }
    }
  );
}
