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
