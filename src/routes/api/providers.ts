/**
 * Provider % Routing API: list providers, update status/operational/enabled/priority/fee, rotate API key.
 * All endpoints require platform admin key (no businessId). Used by dashboard provider routing UI.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";
import { hashApiKey, getKeyPrefix } from "../../services/api-key.service.js";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import { PERMISSION_PROVIDERS_READ, PERMISSION_PROVIDERS_WRITE } from "../../lib/permissions.js";

const KEY_DISPLAY_LENGTH = 7;

function maskApiKey(keyPrefix: string | null): string | null {
  if (!keyPrefix) return null;
  return keyPrefix.length >= KEY_DISPLAY_LENGTH
    ? `${keyPrefix.slice(0, KEY_DISPLAY_LENGTH)}...`
    : "...";
}

function serializeProvider(p: {
  id: string;
  code: string;
  name: string | null;
  status: string;
  operational: boolean;
  enabled: boolean;
  keyPrefix: string | null;
  priority: number;
  fee: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    status: p.status,
    operational: p.operational,
    enabled: p.enabled,
    apiKeyMasked: maskApiKey(p.keyPrefix),
    priority: p.priority,
    fee: p.fee == null ? null : Number(p.fee),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function providersApiRoutes(app: FastifyInstance): Promise<void> {
  // --- GET /api/providers ---
  app.get("/api/providers", async (req: FastifyRequest, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_PROVIDERS_READ)) return;
      const list = await prisma.providerRouting.findMany({
        orderBy: [{ priority: "desc" }, { code: "asc" }],
      });
      const data = list.map((p) => serializeProvider({ ...p, keyPrefix: p.keyPrefix }));
      return successEnvelope(reply, data);
    } catch (err) {
      req.log.error({ err }, "GET /api/providers");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  // --- GET /api/providers/:id ---
  app.get("/api/providers/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_PROVIDERS_READ)) return;
      const provider = await prisma.providerRouting.findUnique({
        where: { id: req.params.id },
      });
      if (!provider) return errorEnvelope(reply, "Provider not found", 404);
      const data = serializeProvider({ ...provider, keyPrefix: provider.keyPrefix });
      return successEnvelope(reply, data);
    } catch (err) {
      req.log.error({ err }, "GET /api/providers/:id");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  // --- PATCH /api/providers/:id ---
  app.patch(
    "/api/providers/:id",
    async (
      req: FastifyRequest<{
        Params: { id: string };
        Body: {
          status?: "ACTIVE" | "INACTIVE" | "MAINTENANCE";
          operational?: boolean;
          enabled?: boolean;
          priority?: number;
          fee?: number | null;
          name?: string | null;
        };
      }>,
      reply
    ) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_PROVIDERS_WRITE)) return;
        const existing = await prisma.providerRouting.findUnique({
          where: { id: req.params.id },
        });
        if (!existing) return errorEnvelope(reply, "Provider not found", 404);

        const body = req.body ?? {};
        const updates: {
          status?: "ACTIVE" | "INACTIVE" | "MAINTENANCE";
          operational?: boolean;
          enabled?: boolean;
          priority?: number;
          fee?: number | null;
          name?: string | null;
        } = {};
        if (body.status !== undefined) updates.status = body.status;
        if (body.operational !== undefined) updates.operational = body.operational;
        if (body.enabled !== undefined) updates.enabled = body.enabled;
        if (body.priority !== undefined) {
          const n = Number(body.priority);
          if (!Number.isInteger(n)) return errorEnvelope(reply, "priority must be an integer", 400);
          updates.priority = n;
        }
        if (body.fee !== undefined) updates.fee = body.fee == null ? null : body.fee;
        if (body.name !== undefined) updates.name = body.name === "" ? null : body.name;

        const provider = await prisma.providerRouting.update({
          where: { id: req.params.id },
          data: updates,
        });
        const data = serializeProvider({ ...provider, keyPrefix: provider.keyPrefix });
        return successEnvelope(reply, data);
      } catch (err) {
        req.log.error({ err }, "PATCH /api/providers/:id");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  // --- POST /api/providers/:id/rotate-key (Update key) ---
  app.post(
    "/api/providers/:id/rotate-key",
    async (
      req: FastifyRequest<{
        Params: { id: string };
        Body: { apiKey?: string };
      }>,
      reply
    ) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_PROVIDERS_WRITE)) return;
        const rawKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
        if (!rawKey) return errorEnvelope(reply, "apiKey is required in body", 400);

        const existing = await prisma.providerRouting.findUnique({
          where: { id: req.params.id },
        });
        if (!existing) return errorEnvelope(reply, "Provider not found", 404);

        const keyHash = hashApiKey(rawKey);
        const keyPrefix = getKeyPrefix(rawKey);

        const provider = await prisma.providerRouting.update({
          where: { id: req.params.id },
          data: { keyHash, keyPrefix },
        });
        const data = serializeProvider({ ...provider, keyPrefix: provider.keyPrefix });
        return successEnvelope(reply, data);
      } catch (err) {
        req.log.error({ err }, "POST /api/providers/:id/rotate-key");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );
}
