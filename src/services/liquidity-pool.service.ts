/**
 * Resolve the crypto liquidity pool wallet. Used by onramp send, offramp receive checks, request/claim settlement.
 */

import { prisma } from "../lib/prisma.js";

export type LiquidityPoolWallet = {
  id: string;
  address: string;
  supportedChains: string[];
  supportedTokens: string[];
  isLiquidityPool: boolean;
  collectFees: boolean;
};

/**
 * Returns the wallet marked as the crypto liquidity pool.
 * Optionally filter by chain (wallet must have chain in supportedChains).
 * Returns null if no liquidity pool wallet is configured or if chain filter excludes it.
 */
export async function getLiquidityPoolWallet(chain?: string): Promise<LiquidityPoolWallet | null> {
  const wallet = await prisma.wallet.findFirst({
    where: {
      isLiquidityPool: true,
      ...(chain != null && chain !== "" && { supportedChains: { has: chain } }),
    },
    select: {
      id: true,
      address: true,
      supportedChains: true,
      supportedTokens: true,
      isLiquidityPool: true,
      collectFees: true,
    },
  });
  return wallet;
}
