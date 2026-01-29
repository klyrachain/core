import type { FastifyRequest, FastifyReply } from "fastify";
import { captureFromRequest, updateRequestLog } from "./request-log-store.js";

declare module "fastify" {
  interface FastifyRequest {
    requestLogId?: string;
    requestLogStart?: number;
  }
}

export async function onRequestLog(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  request.requestLogStart = Date.now();
  const id = captureFromRequest({
    method: request.method,
    url: request.url,
    headers: request.headers as Record<string, string | undefined>,
    body: request.body,
    query: request.query as Record<string, string | string[] | undefined>,
  });
  request.requestLogId = id;
}

export async function onResponseLog(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const id = request.requestLogId;
  const start = request.requestLogStart;
  if (id) {
    const responseTimeMs = start !== undefined ? Date.now() - start : undefined;
    updateRequestLog(id, { statusCode: reply.statusCode, responseTimeMs });
  }
}
