/**
 * Detect failures that are infrastructure/DB config, not bad credentials.
 * Prisma/pg often surface as long messages; login should not return 401 for these.
 */
export function isLikelyDatabaseUnavailableError(err: unknown): boolean {
  if (err == null) return false;
  const msg =
    err instanceof Error
      ? `${err.message} ${(err as Error & { cause?: unknown }).cause ?? ""}`
      : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes("denied access")) return true;
  if (lower.includes("can't reach database")) return true;
  if (lower.includes("database server")) return true;
  if (lower.includes("econnrefused")) return true;
  if (lower.includes("etimedout")) return true;
  if (lower.includes("enotfound")) return true;
  if (lower.includes("password authentication failed")) return true;
  if (lower.includes("connection terminated")) return true;
  if (lower.includes("ssl") && lower.includes("error")) return true;
  const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code: string }).code) : "";
  if (["P1000", "P1001", "P1017", "P1011"].includes(code)) return true;
  return false;
}
