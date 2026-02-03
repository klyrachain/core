/**
 * Access context API: returns what the current auth can access (API key or session: platform vs merchant, business, permissions, admin).
 * Used by the frontend to show the correct dashboard and scope (e.g. "Acting as Business X" or "Platform Admin").
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import { PERMISSION_ACCESS_READ } from "../../lib/permissions.js";

export type AccessContext = {
  type: "platform" | "merchant";
  key?: {
    id: string;
    name: string;
    permissions: string[];
  };
  admin?: {
    adminId: string;
    email: string;
    name: string | null;
    role: string;
  };
  business?: {
    id: string;
    name: string;
    slug: string;
  };
};

export async function accessApiRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/access
   * Returns the access context:
   * - When session: type "platform", admin (id, email, name, role).
   * - When API key: type "platform" (no business) or "merchant" (key scoped to business), key (id, name, permissions), business when merchant.
   */
  app.get("/api/access", async (req: FastifyRequest, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_ACCESS_READ, { allowMerchant: true })) return;
      if (req.adminSession) {
        return successEnvelope(reply, {
          type: "platform",
          admin: {
            adminId: req.adminSession.adminId,
            email: req.adminSession.email,
            name: req.adminSession.name,
            role: req.adminSession.role,
          },
        } satisfies AccessContext);
      }

      const apiKey = req.apiKey;
      if (!apiKey) {
        return errorEnvelope(reply, "Not authenticated.", 401);
      }

      const keyPayload = {
        id: apiKey.id,
        name: apiKey.name,
        permissions: apiKey.permissions,
      };

      if (!apiKey.businessId) {
        return successEnvelope(reply, {
          type: "platform",
          key: keyPayload,
        } satisfies AccessContext);
      }

      const business = await prisma.business.findUnique({
        where: { id: apiKey.businessId },
        select: { id: true, name: true, slug: true },
      });

      if (!business) {
        return successEnvelope(reply, {
          type: "merchant",
          key: keyPayload,
          business: undefined,
        } satisfies AccessContext);
      }

      return successEnvelope(reply, {
        type: "merchant",
        key: keyPayload,
        business: {
          id: business.id,
          name: business.name,
          slug: business.slug,
        },
      } satisfies AccessContext);
    } catch (err) {
      req.log.error({ err }, "GET /api/access");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });
}
