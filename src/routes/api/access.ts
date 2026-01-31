/**
 * Access context API: returns what the current API key can access (platform vs merchant, business, permissions).
 * Used by the frontend to show the correct dashboard and scope (e.g. "Acting as Business X" or "Platform Admin").
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";

export type AccessContext = {
  type: "platform" | "merchant";
  key: {
    id: string;
    name: string;
    permissions: string[];
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
   * Returns the access context for the authenticated API key:
   * - type: "platform" (key has no business) or "merchant" (key is scoped to a business)
   * - key: id, name, permissions
   * - business: when type is "merchant", the business id, name, slug (for display and switching)
   */
  app.get("/api/access", async (req: FastifyRequest, reply) => {
    try {
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
