/**
 * Supported chains and tokens: public GET and admin CRUD.
 * Used by other backends and admins to list/manage supported chains and tokens.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import { PERMISSION_PROVIDERS_READ, PERMISSION_PROVIDERS_WRITE } from "../../lib/permissions.js";

/** Shape of chain row from prisma.chain findMany select. chainId is BigInt in DB; we serialize as string in JSON. */
interface ChainRow {
  id: string;
  chainId: bigint;
  name: string;
  iconUri: string | null;
  rpcUrl?: string | null;
  rpcUrls?: unknown;
}

/** Shape of token row from prisma.supportedToken findMany select. chainId is BigInt in DB; we serialize as string in JSON. */
interface TokenRow {
  id: string;
  chainId: bigint;
  tokenAddress: string;
  symbol: string;
  decimals: number;
  name: string | null;
  logoUri: string | null;
  fonbnkCode: string | null;
  displaySymbol: string | null;
}

const ChainIdParamSchema = z.object({ id: z.string().uuid() });
const TokenIdParamSchema = z.object({ id: z.string().uuid() });

const CreateChainBodySchema = z.object({
  chain_id: z.union([z.coerce.number(), z.string()]).transform((v) => BigInt(v)).refine((b) => b > 0n),
  name: z.string().min(1),
  icon_uri: z.string().url().optional().nullable(),
});

const UpdateChainBodySchema = z.object({
  name: z.string().min(1).optional(),
  icon_uri: z.string().url().optional().nullable(),
});

const CreateTokenBodySchema = z.object({
  chain_id: z.union([z.coerce.number(), z.string()]).transform((v) => BigInt(v)).refine((b) => b > 0n),
  token_address: z.string().min(1),
  symbol: z.string().min(1),
  decimals: z.coerce.number().int().min(0).max(24).optional().default(18),
  name: z.string().optional().nullable(),
  logo_uri: z.string().url().optional().nullable(),
  fonbnk_code: z.string().min(1).optional().nullable(),
  display_symbol: z.string().min(1).optional().nullable(),
});

const UpdateTokenBodySchema = z.object({
  symbol: z.string().min(1).optional(),
  decimals: z.coerce.number().int().min(0).max(24).optional(),
  name: z.string().optional().nullable(),
  logo_uri: z.string().url().optional().nullable(),
  fonbnk_code: z.string().min(1).optional().nullable(),
  display_symbol: z.string().min(1).optional().nullable(),
});

export async function chainsTokensApiRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/chains
   * Return supported chains (chainId, name, iconUri). Public.
   */
  app.get("/api/chains", async (_, reply) => {
    const chains = await prisma.chain.findMany({
      orderBy: [{ chainId: "asc" }],
      select: { id: true, chainId: true, name: true, iconUri: true, rpcUrl: true, rpcUrls: true },
    }) as ChainRow[];
    const data = chains.map((c: ChainRow) => ({
      id: c.id,
      chainId: String(c.chainId),
      name: c.name,
      chainIconURI: c.iconUri ?? undefined,
      rpc: c.rpcUrl ?? undefined,
      rpcUrls: Array.isArray(c.rpcUrls) ? c.rpcUrls : undefined,
    }));
    return successEnvelope(reply, { chains: data });
  });

  /**
   * GET /api/tokens/list
   * List tokens for UI: displaySymbol (e.g. BASE USDC), logoUri, tokenAddress. Query: ?chainId=8453 to filter by chain. Safe (parameterized).
   */
  app.get<{ Querystring: unknown }>("/api/tokens/list", async (req: FastifyRequest<{ Querystring: unknown }>, reply) => {
    const query = z
      .object({ chainId: z.union([z.coerce.number(), z.string().min(1)]).optional() })
      .safeParse(req.query);
    const chainIdRaw = query.success ? query.data.chainId : undefined;
    const chainIdFilter =
      chainIdRaw !== undefined && chainIdRaw !== ""
        ? BigInt(typeof chainIdRaw === "string" && /^\d+$/.test(chainIdRaw) ? chainIdRaw : Number(chainIdRaw))
        : undefined;

    const tokens = await prisma.supportedToken.findMany({
      where: chainIdFilter != null ? { chainId: chainIdFilter } : undefined,
      orderBy: [{ chainId: "asc" }, { symbol: "asc" }],
      select: { chainId: true, tokenAddress: true, symbol: true, displaySymbol: true, logoUri: true },
    });

    const chainIds = [...new Set(tokens.map((t) => t.chainId))];
    const chains =
      chainIds.length > 0
        ? await prisma.chain.findMany({
            where: { chainId: { in: chainIds } },
            select: { chainId: true, name: true },
          })
        : [];
    const chainMap = new Map(chains.map((c) => [c.chainId, c.name]));

    const data = tokens.map((t) => ({
      chainId: String(t.chainId),
      displaySymbol:
        t.displaySymbol ?? (`${chainMap.get(t.chainId) ?? ""} ${t.symbol}`.trim() || t.symbol),
      logoUri: t.logoUri ?? undefined,
      tokenAddress: t.tokenAddress,
      symbol: t.symbol,
    }));
    return successEnvelope(reply, { tokens: data });
  });

  /**
   * GET /api/tokens
   * Return supported tokens with chain info. Query: ?chain_id=8453 to filter by chain. Public.
   */
  app.get<{ Querystring: unknown }>("/api/tokens", async (req: FastifyRequest<{ Querystring: unknown }>, reply) => {
    const query = z
      .object({ chain_id: z.union([z.coerce.number(), z.string()]).optional() })
      .safeParse(req.query);
    const chainIdRaw = query.success ? query.data.chain_id : undefined;
    const chainIdFilter =
      chainIdRaw !== undefined && chainIdRaw !== ""
        ? BigInt(chainIdRaw)
        : undefined;

    const tokens = await prisma.supportedToken.findMany({
      where: chainIdFilter != null ? { chainId: chainIdFilter } : undefined,
      orderBy: [{ chainId: "asc" }, { symbol: "asc" }],
      select: {
        id: true,
        chainId: true,
        tokenAddress: true,
        symbol: true,
        decimals: true,
        name: true,
        logoUri: true,
        fonbnkCode: true,
        displaySymbol: true,
      },
    }) as TokenRow[];

    const chainIds = [...new Set(tokens.map((t: TokenRow) => t.chainId))];
    const chains = await prisma.chain.findMany({
      where: { chainId: { in: chainIds } },
      select: { chainId: true, name: true, iconUri: true },
    }) as Pick<ChainRow, "chainId" | "name" | "iconUri">[];
    const chainMap = new Map(chains.map((c: Pick<ChainRow, "chainId" | "name" | "iconUri">) => [c.chainId, c]));

    const data = tokens.map((t: TokenRow) => {
      const chain = chainMap.get(t.chainId);
      return {
        id: t.id,
        chainId: String(t.chainId),
        networkName: chain?.name,
        chainIconURI: chain?.iconUri ?? undefined,
        address: t.tokenAddress,
        symbol: t.symbol,
        decimals: t.decimals,
        name: t.name ?? undefined,
        logoURI: t.logoUri ?? undefined,
        fonbnkCode: t.fonbnkCode ?? undefined,
        displaySymbol: t.displaySymbol ?? undefined,
      };
    });
    return successEnvelope(reply, { tokens: data });
  });

  // ---------- Admin: chains ----------
  app.get("/api/admin/chains", async (req: FastifyRequest, reply) => {
    if (!requirePermission(req, reply, PERMISSION_PROVIDERS_READ)) return;
    const chains = await prisma.chain.findMany({
      orderBy: [{ chainId: "asc" }],
      select: { id: true, chainId: true, name: true, iconUri: true, rpcUrl: true, rpcUrls: true, createdAt: true, updatedAt: true },
    });
    return successEnvelope(reply, {
      chains: chains.map((c) => ({ ...c, chainId: String(c.chainId) })),
    });
  });

  app.post<{ Body: unknown }>("/api/admin/chains", async (req: FastifyRequest<{ Body: unknown }>, reply) => {
    if (!requirePermission(req, reply, PERMISSION_PROVIDERS_WRITE)) return;
    const parse = CreateChainBodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({
        success: false,
        error: "Validation failed",
        details: parse.error.flatten(),
      });
    }
    const { chain_id, name, icon_uri } = parse.data;
    try {
      const chain = await prisma.chain.create({
        data: { chainId: chain_id, name, iconUri: icon_uri ?? undefined },
      });
      return successEnvelope(reply, { chain: { id: chain.id, chainId: String(chain.chainId), name: chain.name, iconUri: chain.iconUri } }, 201);
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002"
        ? "Chain with this chain_id already exists."
        : "Failed to create chain.";
      return errorEnvelope(reply, msg, 400);
    }
  });

  app.patch<{ Params: unknown; Body: unknown }>(
    "/api/admin/chains/:id",
    async (req: FastifyRequest<{ Params: unknown; Body: unknown }>, reply) => {
      if (!requirePermission(req, reply, PERMISSION_PROVIDERS_WRITE)) return;
      const paramParse = ChainIdParamSchema.safeParse(req.params);
      if (!paramParse.success) {
        return reply.status(400).send({ success: false, error: "Invalid chain id (UUID) in path." });
      }
      const parse = UpdateChainBodySchema.safeParse(req.body);
      if (!parse.success) {
        return reply.status(400).send({
          success: false,
          error: "Validation failed",
          details: parse.error.flatten(),
        });
      }
      const { id } = paramParse.data;
      const body = parse.data;
      try {
        const chain = await prisma.chain.update({
          where: { id },
          data: {
            ...(body.name != null && { name: body.name }),
            ...(body.icon_uri !== undefined && { iconUri: body.icon_uri }),
          },
        });
        return successEnvelope(reply, { chain: { id: chain.id, chainId: String(chain.chainId), name: chain.name, iconUri: chain.iconUri } });
      } catch (e: unknown) {
        if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2025") {
          return reply.status(404).send({ success: false, error: "Chain not found." });
        }
        return errorEnvelope(reply, "Failed to update chain.", 500);
      }
    }
  );

  app.delete<{ Params: unknown }>("/api/admin/chains/:id", async (req: FastifyRequest<{ Params: unknown }>, reply) => {
    if (!requirePermission(req, reply, PERMISSION_PROVIDERS_WRITE)) return;
    const parse = ChainIdParamSchema.safeParse(req.params);
    if (!parse.success) {
      return reply.status(400).send({ success: false, error: "Invalid chain id (UUID) in path." });
    }
    const { id } = parse.data;
    try {
      const chain = await prisma.chain.findUnique({ where: { id }, select: { chainId: true } });
      if (!chain) {
        return reply.status(404).send({ success: false, error: "Chain not found." });
      }
      await prisma.supportedToken.deleteMany({ where: { chainId: chain.chainId } });
      await prisma.chain.delete({ where: { id } });
      return successEnvelope(reply, { deleted: true });
    } catch (e: unknown) {
      if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2025") {
        return reply.status(404).send({ success: false, error: "Chain not found." });
      }
      return errorEnvelope(reply, "Failed to delete chain.", 500);
    }
  });

  // ---------- Admin: tokens ----------
  app.get("/api/admin/tokens", async (req: FastifyRequest, reply) => {
    if (!requirePermission(req, reply, PERMISSION_PROVIDERS_READ)) return;
    const tokens = await prisma.supportedToken.findMany({
      orderBy: [{ chainId: "asc" }, { symbol: "asc" }],
      select: { id: true, chainId: true, tokenAddress: true, symbol: true, decimals: true, name: true, logoUri: true, fonbnkCode: true, displaySymbol: true, createdAt: true, updatedAt: true },
    });
    return successEnvelope(reply, {
      tokens: tokens.map((t) => ({ ...t, chainId: String(t.chainId) })),
    });
  });

  app.post<{ Body: unknown }>("/api/admin/tokens", async (req: FastifyRequest<{ Body: unknown }>, reply) => {
    if (!requirePermission(req, reply, PERMISSION_PROVIDERS_WRITE)) return;
    const parse = CreateTokenBodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({
        success: false,
        error: "Validation failed",
        details: parse.error.flatten(),
      });
    }
    const { chain_id, token_address, symbol, decimals, name, logo_uri, fonbnk_code, display_symbol } = parse.data;
    try {
      const token = await prisma.supportedToken.create({
        data: {
          chainId: chain_id,
          tokenAddress: token_address.trim(),
          symbol: symbol.trim(),
          decimals,
          name: name ?? undefined,
          logoUri: logo_uri ?? undefined,
          fonbnkCode: fonbnk_code ?? undefined,
          displaySymbol: display_symbol ?? undefined,
        },
      });
      return successEnvelope(
        reply,
        {
          token: {
            id: token.id,
            chainId: String(token.chainId),
            tokenAddress: token.tokenAddress,
            symbol: token.symbol,
            decimals: token.decimals,
            name: token.name,
            logoUri: token.logoUri,
            fonbnkCode: token.fonbnkCode,
            displaySymbol: token.displaySymbol,
          },
        },
        201
      );
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002"
          ? "Token with this chain_id and token_address already exists."
          : "Failed to create token.";
      return errorEnvelope(reply, msg, 400);
    }
  });

  app.patch<{ Params: unknown; Body: unknown }>(
    "/api/admin/tokens/:id",
    async (req: FastifyRequest<{ Params: unknown; Body: unknown }>, reply) => {
      if (!requirePermission(req, reply, PERMISSION_PROVIDERS_WRITE)) return;
      const paramParse = TokenIdParamSchema.safeParse(req.params);
      if (!paramParse.success) {
        return reply.status(400).send({ success: false, error: "Invalid token id (UUID) in path." });
      }
      const parse = UpdateTokenBodySchema.safeParse(req.body);
      if (!parse.success) {
        return reply.status(400).send({
          success: false,
          error: "Validation failed",
          details: parse.error.flatten(),
        });
      }
      const { id } = paramParse.data;
      const body = parse.data;
      try {
        const token = await prisma.supportedToken.update({
          where: { id },
          data: {
            ...(body.symbol != null && { symbol: body.symbol }),
            ...(body.decimals != null && { decimals: body.decimals }),
            ...(body.name !== undefined && { name: body.name }),
            ...(body.logo_uri !== undefined && { logoUri: body.logo_uri }),
            ...(body.fonbnk_code !== undefined && { fonbnkCode: body.fonbnk_code }),
            ...(body.display_symbol !== undefined && { displaySymbol: body.display_symbol }),
          },
        });
        return successEnvelope(reply, {
          token: {
            id: token.id,
            chainId: String(token.chainId),
            tokenAddress: token.tokenAddress,
            symbol: token.symbol,
            decimals: token.decimals,
            name: token.name,
            logoUri: token.logoUri,
            fonbnkCode: token.fonbnkCode,
            displaySymbol: token.displaySymbol,
          },
        });
      } catch (e: unknown) {
        if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2025") {
          return reply.status(404).send({ success: false, error: "Token not found." });
        }
        return errorEnvelope(reply, "Failed to update token.", 500);
      }
    }
  );

  app.delete<{ Params: unknown }>("/api/admin/tokens/:id", async (req: FastifyRequest<{ Params: unknown }>, reply) => {
    if (!requirePermission(req, reply, PERMISSION_PROVIDERS_WRITE)) return;
    const parse = TokenIdParamSchema.safeParse(req.params);
    if (!parse.success) {
      return reply.status(400).send({ success: false, error: "Invalid token id (UUID) in path." });
    }
    const { id } = parse.data;
    try {
      await prisma.supportedToken.delete({ where: { id } });
      return successEnvelope(reply, { deleted: true });
    } catch (e: unknown) {
      if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2025") {
        return reply.status(404).send({ success: false, error: "Token not found." });
      }
      return errorEnvelope(reply, "Failed to delete token.", 500);
    }
  });
}
