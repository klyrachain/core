import type { FastifyRequest } from "fastify";

export function getBearerToken(request: FastifyRequest): string | undefined {
  const raw = request.headers.authorization;
  if (typeof raw !== "string") return undefined;
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim();
}
