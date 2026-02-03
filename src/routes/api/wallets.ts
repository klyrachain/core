import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { parsePagination, successEnvelope, successEnvelopeWithMeta, errorEnvelope } from "../../lib/api-helpers.js";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import { PERMISSION_PLATFORM_READ, PERMISSION_SETTINGS_WRITE } from "../../lib/permissions.js";
import { WalletManager } from "../../utils/wallet-manager.js";

const MASK = "***";

const walletSelect = {
  id: true,
  address: true,
  encryptedKey: true,
  supportedChains: true,
  supportedTokens: true,
  isLiquidityPool: true,
  collectFees: true,
  createdAt: true,
  updatedAt: true,
} as const;

const CreateBodySchema = z.object({
  address: z.string().min(1).regex(/^0x[a-fA-F0-9]{40}$/, "address must be 0x + 40 hex"),
  privateKey: z.string().min(1),
  supportedChains: z.array(z.string().min(1)).min(1),
  supportedTokens: z.array(z.string().min(1)).min(1),
  isLiquidityPool: z.boolean().optional().default(false),
  collectFees: z.boolean().optional().default(false),
});

const PatchBodySchema = z.object({
  supportedChains: z.array(z.string().min(1)).optional(),
  supportedTokens: z.array(z.string().min(1)).optional(),
  isLiquidityPool: z.boolean().optional(),
  collectFees: z.boolean().optional(),
});

export async function walletsApiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/wallets", async (req: FastifyRequest<{ Querystring: { page?: string; limit?: string } }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_PLATFORM_READ)) return;
      const { page, limit, skip } = parsePagination(req.query);
      const [items, total] = await Promise.all([
        prisma.wallet.findMany({
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          select: walletSelect,
        }),
        prisma.wallet.count(),
      ]);
      const data = items.map((w) => ({
        ...w,
        encryptedKey: w.encryptedKey ? MASK : null,
      }));
      return successEnvelopeWithMeta(reply, data, { page, limit, total });
    } catch (err) {
      req.log.error({ err }, "GET /api/wallets");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.get("/api/wallets/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_PLATFORM_READ)) return;
      const wallet = await prisma.wallet.findUnique({
        where: { id: req.params.id },
        select: walletSelect,
      });
      if (!wallet) return errorEnvelope(reply, "Wallet not found", 404);
      const data = { ...wallet, encryptedKey: wallet.encryptedKey ? MASK : null };
      return successEnvelope(reply, data);
    } catch (err) {
      req.log.error({ err }, "GET /api/wallets/:id");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.post<{ Body: unknown }>("/api/wallets", async (req: FastifyRequest<{ Body: unknown }>, reply) => {
    if (!requirePermission(req, reply, PERMISSION_SETTINGS_WRITE)) return;
    const parse = CreateBodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({
        success: false,
        error: "Validation failed",
        details: parse.error.flatten(),
      });
    }
    const { address, privateKey, supportedChains, supportedTokens, isLiquidityPool, collectFees } = parse.data;
    try {
      const existing = await prisma.wallet.findUnique({ where: { address: address.toLowerCase() } });
      if (existing) {
        return reply.status(400).send({
          success: false,
          error: "A wallet with this address already exists.",
        });
      }
      if (isLiquidityPool) {
        const other = await prisma.wallet.findFirst({
          where: { isLiquidityPool: true },
          select: { id: true },
        });
        if (other) {
          return reply.status(400).send({
            success: false,
            error: "Another wallet is already set as the crypto liquidity pool. Unset it first or use PATCH to switch.",
          });
        }
      }
      const encryptedKey = WalletManager.encrypt(privateKey);
      const wallet = await prisma.wallet.create({
        data: {
          address: address.toLowerCase(),
          encryptedKey,
          supportedChains,
          supportedTokens,
          isLiquidityPool,
          collectFees,
        },
        select: walletSelect,
      });
      const data = { ...wallet, encryptedKey: MASK };
      return successEnvelope(reply, data, 201);
    } catch (err) {
      req.log.error({ err }, "POST /api/wallets");
      return errorEnvelope(reply, "Failed to create wallet.", 500);
    }
  });

  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/api/wallets/:id",
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
      const wallet = await prisma.wallet.findUnique({
        where: { id: req.params.id },
        select: { id: true, isLiquidityPool: true },
      });
      if (!wallet) return errorEnvelope(reply, "Wallet not found", 404);

      const update = parse.data;
      if (update.isLiquidityPool === true) {
        const other = await prisma.wallet.findFirst({
          where: { isLiquidityPool: true, id: { not: req.params.id } },
          select: { id: true },
        });
        if (other) {
          return reply.status(400).send({
            success: false,
            error: "Another wallet is already set as the crypto liquidity pool. Unset it first.",
          });
        }
      }

      const updated = await prisma.wallet.update({
        where: { id: req.params.id },
        data: {
          ...(update.supportedChains != null && { supportedChains: update.supportedChains }),
          ...(update.supportedTokens != null && { supportedTokens: update.supportedTokens }),
          ...(update.isLiquidityPool != null && { isLiquidityPool: update.isLiquidityPool }),
          ...(update.collectFees != null && { collectFees: update.collectFees }),
        },
        select: walletSelect,
      });
      const data = { ...updated, encryptedKey: MASK };
      return successEnvelope(reply, data);
    }
  );
}
