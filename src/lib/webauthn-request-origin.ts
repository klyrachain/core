import type { FastifyRequest } from "fastify";

/**
 * Browser origin for WebAuthn when Core is called via a server proxy (no `Origin` on the upstream request).
 * Next.js / other proxies should set `X-WebAuthn-Origin` from the incoming browser request.
 */
export function getWebAuthnRequestOrigin(req: FastifyRequest): string | undefined {
  const raw = req.headers["x-webauthn-origin"];
  const x = Array.isArray(raw) ? raw[0] : raw;
  if (typeof x === "string" && x.trim()) return x.trim();

  const o = req.headers.origin;
  if (typeof o === "string" && o.trim()) return o.trim();

  return undefined;
}
