import type { FastifyReply } from "fastify";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function parsePagination(query: { page?: string; limit?: string }) {
  const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(query.limit ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
  );
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

export function successEnvelope<T>(reply: FastifyReply, data: T, status = 200) {
  return reply.status(status).send({ success: true, data });
}

export function successEnvelopeWithMeta<T>(
  reply: FastifyReply,
  data: T,
  meta: { page: number; limit: number; total: number },
  status = 200
) {
  return reply.status(status).send({ success: true, data, meta });
}

export function errorEnvelope(reply: FastifyReply, error: string, status = 400) {
  return reply.status(status).send({ success: false, error });
}

/** Serialize transaction price fields for API (absolute USD prices only). */
export function serializeTransactionPrices(tx: {
  exchangeRate?: { toString(): string } | null;
  f_tokenPriceUsd?: { toString(): string } | null;
  t_tokenPriceUsd?: { toString(): string } | null;
  feeInUsd?: { toString(): string } | null;
}) {
  return {
    exchangeRate: tx.exchangeRate != null ? tx.exchangeRate.toString() : null,
    f_tokenPriceUsd: tx.f_tokenPriceUsd != null ? tx.f_tokenPriceUsd.toString() : null,
    t_tokenPriceUsd: tx.t_tokenPriceUsd != null ? tx.t_tokenPriceUsd.toString() : null,
    feeInUsd: tx.feeInUsd != null ? tx.feeInUsd.toString() : null,
  };
}
