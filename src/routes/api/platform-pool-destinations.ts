import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { errorEnvelope, parsePagination, successEnvelope, successEnvelopeWithMeta } from "../../lib/api-helpers.js";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import { PERMISSION_PLATFORM_READ, PERMISSION_SETTINGS_WRITE } from "../../lib/permissions.js";

const EcosystemSchema = z.enum([
  "EVM",
  "SOLANA",
  "STELLAR",
  "BITCOIN",
  "SUI",
  "TRON",
  "APTOS",
  "OTHER",
]);

const CreateBodySchema = z.object({
  ecosystem: EcosystemSchema,
  networkKey: z.string().min(1).max(120),
  tokenSymbol: z.string().min(1).max(64),
  receiveAddress: z.string().min(1).max(512).optional(),
  infisicalSecretName: z.string().min(1).max(256).optional(),
  infisicalSecretPath: z.string().max(512).optional().default("/"),
  tokenContractAddress: z.string().max(512).optional(),
  stellarAssetCode: z.string().max(16).optional(),
  stellarAssetIssuer: z.string().max(128).optional(),
  priority: z.coerce.number().int().optional().default(0),
  enabled: z.boolean().optional().default(true),
});

const PatchBodySchema = CreateBodySchema.partial();

export async function platformPoolDestinationsApiRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/platform-pool-destinations",
    async (req: FastifyRequest<{ Querystring: { page?: string; limit?: string } }>, reply) => {
      if (!requirePermission(req, reply, PERMISSION_PLATFORM_READ)) return;
      const { page, limit, skip } = parsePagination(req.query);
      const [items, total] = await Promise.all([
        prisma.platformPoolDestination.findMany({
          skip,
          take: limit,
          orderBy: [{ ecosystem: "asc" }, { networkKey: "asc" }, { priority: "desc" }],
        }),
        prisma.platformPoolDestination.count(),
      ]);
      return successEnvelopeWithMeta(reply, items, { page, limit, total });
    }
  );

  app.get("/api/platform-pool-destinations/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    if (!requirePermission(req, reply, PERMISSION_PLATFORM_READ)) return;
    const row = await prisma.platformPoolDestination.findUnique({ where: { id: req.params.id } });
    if (!row) return errorEnvelope(reply, "Not found", 404);
    return successEnvelope(reply, row);
  });

  app.post<{ Body: unknown }>("/api/platform-pool-destinations", async (req, reply) => {
    if (!requirePermission(req, reply, PERMISSION_SETTINGS_WRITE)) return;
    const parse = CreateBodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({
        success: false,
        error: "Validation failed",
        details: parse.error.flatten(),
      });
    }
    const b = parse.data;
    if (!b.receiveAddress?.trim() && !b.infisicalSecretName?.trim()) {
      return reply.status(400).send({
        success: false,
        error: "Provide receiveAddress and/or infisicalSecretName so the pool address can be resolved.",
      });
    }
    try {
      const row = await prisma.platformPoolDestination.create({
        data: {
          ecosystem: b.ecosystem,
          networkKey: b.networkKey.trim().toUpperCase(),
          tokenSymbol: b.tokenSymbol.trim().toUpperCase(),
          receiveAddress: b.receiveAddress?.trim() || null,
          infisicalSecretName: b.infisicalSecretName?.trim() || null,
          infisicalSecretPath: b.infisicalSecretPath?.trim() || "/",
          tokenContractAddress: b.tokenContractAddress?.trim() || null,
          stellarAssetCode: b.stellarAssetCode?.trim() || null,
          stellarAssetIssuer: b.stellarAssetIssuer?.trim() || null,
          priority: b.priority,
          enabled: b.enabled,
        },
      });
      return successEnvelope(reply, row, 201);
    } catch (err) {
      req.log.error({ err }, "POST /api/platform-pool-destinations");
      return errorEnvelope(reply, "Failed to create destination.", 500);
    }
  });

  app.patch(
    "/api/platform-pool-destinations/:id",
    async (req: FastifyRequest<{ Params: { id: string }; Body: unknown }>, reply) => {
      if (!requirePermission(req, reply, PERMISSION_SETTINGS_WRITE)) return;
      const parse = PatchBodySchema.safeParse(req.body);
      if (!parse.success) {
        return reply.status(400).send({
          success: false,
          error: "Validation failed",
          details: parse.error.flatten(),
        });
      }
      const b = parse.data;
      try {
        const row = await prisma.platformPoolDestination.update({
          where: { id: req.params.id },
          data: {
            ...(b.ecosystem != null ? { ecosystem: b.ecosystem } : {}),
            ...(b.networkKey != null ? { networkKey: b.networkKey.trim().toUpperCase() } : {}),
            ...(b.tokenSymbol != null ? { tokenSymbol: b.tokenSymbol.trim().toUpperCase() } : {}),
            ...(b.receiveAddress !== undefined
              ? { receiveAddress: b.receiveAddress?.trim() || null }
              : {}),
            ...(b.infisicalSecretName !== undefined
              ? { infisicalSecretName: b.infisicalSecretName?.trim() || null }
              : {}),
            ...(b.infisicalSecretPath != null
              ? { infisicalSecretPath: b.infisicalSecretPath.trim() || "/" }
              : {}),
            ...(b.tokenContractAddress !== undefined
              ? { tokenContractAddress: b.tokenContractAddress?.trim() || null }
              : {}),
            ...(b.stellarAssetCode !== undefined
              ? { stellarAssetCode: b.stellarAssetCode?.trim() || null }
              : {}),
            ...(b.stellarAssetIssuer !== undefined
              ? { stellarAssetIssuer: b.stellarAssetIssuer?.trim() || null }
              : {}),
            ...(b.priority != null ? { priority: b.priority } : {}),
            ...(b.enabled != null ? { enabled: b.enabled } : {}),
          },
        });
        return successEnvelope(reply, row);
      } catch {
        return errorEnvelope(reply, "Not found or update failed", 404);
      }
    }
  );

  app.delete("/api/platform-pool-destinations/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    if (!requirePermission(req, reply, PERMISSION_SETTINGS_WRITE)) return;
    try {
      await prisma.platformPoolDestination.delete({ where: { id: req.params.id } });
      return successEnvelope(reply, { deleted: true });
    } catch {
      return errorEnvelope(reply, "Not found", 404);
    }
  });
}
