import type { PlatformPoolDestination } from "../../prisma/generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { getInfisicalSecretValue } from "./secrets/infisical-client.js";
import type { PaymentEcosystem } from "../lib/payment-chain-routing.js";

export type ResolvedPoolDestination = PlatformPoolDestination & {
  resolvedReceiveAddress: string;
};

async function hydrateReceiveAddress(row: PlatformPoolDestination): Promise<string | null> {
  const direct = row.receiveAddress?.trim();
  if (direct) return direct;
  const name = row.infisicalSecretName?.trim();
  if (!name) return null;
  const path = row.infisicalSecretPath?.trim() || "/";
  const fromVault = await getInfisicalSecretValue(name, path);
  return fromVault?.trim() || null;
}

/**
 * Prefer explicit `PlatformPoolDestination` rows (highest priority first). Returns null if none resolve.
 */
export async function resolvePlatformPoolDestination(
  ecosystem: PaymentEcosystem,
  networkKey: string,
  tokenSymbol: string
): Promise<ResolvedPoolDestination | null> {
  const nk = networkKey.trim().toUpperCase();
  const sym = tokenSymbol.trim().toUpperCase();

  const rows = await prisma.platformPoolDestination.findMany({
    where: {
      enabled: true,
      ecosystem,
      networkKey: nk,
      tokenSymbol: sym,
    },
    orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
  });

  for (const row of rows) {
    const resolvedReceiveAddress = await hydrateReceiveAddress(row);
    if (resolvedReceiveAddress) {
      return { ...row, resolvedReceiveAddress };
    }
  }

  return null;
}
