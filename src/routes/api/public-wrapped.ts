import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";

const QuerySchema = z.object({
  wallet: z.string().min(3),
  period: z.enum(["month", "quarter", "year"]).optional().default("year"),
});

export async function publicWrappedApiRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/public/wrapped/wallet",
    async (
      req: FastifyRequest<{ Querystring: { wallet?: string; period?: "month" | "quarter" | "year" } }>,
      reply
    ) => {
      try {
        const parsed = QuerySchema.safeParse({
          wallet: req.query.wallet?.trim(),
          period: req.query.period,
        });
        if (!parsed.success) {
          return reply.status(400).send({
            success: false,
            error: "wallet is required.",
            details: parsed.error.flatten(),
          });
        }
        const wallet = parsed.data.wallet.toLowerCase();
        const days =
          parsed.data.period === "month"
            ? 30
            : parsed.data.period === "quarter"
              ? 90
              : 365;
        const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const txs = await prisma.transaction.findMany({
          where: {
            createdAt: { gte: from },
            OR: [
              { fromType: "ADDRESS", fromIdentifier: wallet },
              { toType: "ADDRESS", toIdentifier: wallet },
            ],
          },
          select: {
            id: true,
            status: true,
            type: true,
            f_amount: true,
            t_amount: true,
            f_token: true,
            t_token: true,
            f_chain: true,
            t_chain: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" },
        });
        const completed = txs.filter((tx) => tx.status === "COMPLETED");
        return successEnvelope(reply, {
          wallet,
          period: parsed.data.period,
          totals: {
            transactions: txs.length,
            completed: completed.length,
            successRate: txs.length > 0 ? Number((completed.length / txs.length).toFixed(4)) : 0,
          },
          timeline: txs.map((tx) => ({
            id: tx.id,
            at: tx.createdAt.toISOString(),
            status: tx.status,
            type: tx.type,
            fromAmount: tx.f_amount.toString(),
            toAmount: tx.t_amount.toString(),
            fromToken: tx.f_token,
            toToken: tx.t_token,
            fromChain: tx.f_chain,
            toChain: tx.t_chain,
          })),
        });
      } catch (err) {
        req.log.error({ err }, "GET /api/public/wrapped/wallet");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );
}
