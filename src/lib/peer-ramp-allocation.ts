/**
 * Pure greedy allocation: largest counterparty remainder first.
 * Amounts are semantic decimals as strings (human token units, e.g. USDC).
 */

import { Decimal } from "@prisma/client/runtime/client";

export type AllocationInput = {
  initiatorRemaining: Decimal;
  candidates: Array<{ id: string; remaining: Decimal }>;
};

export type AllocationRow = { peerId: string; amount: Decimal };

export function largestFirstGreedyPeerAlloc(params: AllocationInput): AllocationRow[] {
  const sorted = [...params.candidates].sort((a, b) => b.remaining.comparedTo(a.remaining));
  let left = new Decimal(params.initiatorRemaining);
  const out: AllocationRow[] = [];

  for (const c of sorted) {
    if (left.lte(0)) break;
    if (c.remaining.lte(0)) continue;
    const take = left.lessThanOrEqualTo(c.remaining) ? left : c.remaining;
    if (take.lte(0)) continue;
    out.push({ peerId: c.id, amount: take });
    left = left.minus(take);
  }

  return out;
}
