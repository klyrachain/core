/**
 * Resolve merchant crypto settlement address from saved payout methods (commerce / onramp).
 */

import { prisma } from "../lib/prisma.js";

export type ResolvedCryptoPayout = {
  address: string;
  /** Normalized for Transaction.t_chain / executeOnrampSend (e.g. BASE, ETHEREUM). */
  t_chain: string;
  t_token: string;
};

function normalizeChain(chain: string | undefined): string {
  const c = (chain ?? "BASE").trim().toUpperCase();
  if (c === "BASE" || c === "BASE SEPOLIA") return c;
  return c.replace(/\s+/g, " ");
}

/**
 * Prefer primary active CRYPTO_WALLET; else first by createdAt.
 * Returns null if no valid 0x address is configured.
 */
export async function resolveBusinessCryptoSettlementAddress(
  businessId: string
): Promise<ResolvedCryptoPayout | null> {
  const methods = await prisma.payoutMethod.findMany({
    where: { businessId, type: "CRYPTO_WALLET", isActive: true },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
  for (const m of methods) {
    const d = m.details as { walletAddress?: string; chain?: string };
    const addr = d?.walletAddress?.trim() ?? "";
    if (!addr.startsWith("0x") || addr.length < 42) continue;
    const t_chain = normalizeChain(d?.chain);
    const t_token = (m.currency?.trim() || "USDC").toUpperCase();
    return { address: addr, t_chain, t_token };
  }
  return null;
}
