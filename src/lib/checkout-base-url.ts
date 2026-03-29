/**
 * Normalized payer checkout origin for share links (no trailing path).
 */
export function normalizeCheckoutBaseUrl(raw: string | undefined): string | null {
  const t = raw?.trim();
  if (!t) return null;
  try {
    return new URL(t).origin;
  } catch {
    return null;
  }
}
