import { describe, it, expect, beforeEach, vi } from "vitest";
import { Decimal } from "@prisma/client/runtime/client";

vi.mock("../../src/lib/prisma.js", () => ({
  prisma: {
    peerRampFill: { findUnique: vi.fn(), update: vi.fn() },
    peerRampOrder: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("../../src/services/transaction-verify.service.js", () => ({
  verifyTransactionByHash: vi.fn(),
  transferMatches: vi.fn(),
  buildEscrowVerificationSnapshot: vi.fn(() => ({
    chainId: 84532,
    txHash: "0xtx",
    blockNumber: "1",
    blockTimestamp: 0,
    receiptStatus: "success" as const,
    txFrom: "0xfrom",
    txContract: "0xto",
    expectedToken: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
    expectedEscrow: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    expectedMinWei: "10000000",
    sumMatchingWei: "10000000",
    matched: true,
    erc20TransferEventCount: 0,
    transferEvents: [],
  })),
}));

vi.mock("../../src/config/env.js", () => ({
  getEnv: vi.fn(() => ({
    PEER_RAMP_PLATFORM_ESCROW_ADDRESS: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  })),
}));

import { prisma } from "../../src/lib/prisma.js";
import * as txVerify from "../../src/services/transaction-verify.service.js";
import {
  acceptPeerRampFill,
  submitPeerRampOfframpEscrowTx,
} from "../../src/services/peer-ramp-order.service.js";

const mockFindUniqueFill = vi.mocked(prisma.peerRampFill.findUnique);
const mockUpdateFill = vi.mocked(prisma.peerRampFill.update);
const mockFindUniqueOrder = vi.mocked(prisma.peerRampOrder.findUnique);
const mockUpdateOrder = vi.mocked(prisma.peerRampOrder.update);
const mockVerify = vi.mocked(txVerify.verifyTransactionByHash);
const mockTransferMatches = vi.mocked(txVerify.transferMatches);

describe("peer-ramp-order accept + escrow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("acceptPeerRampFill sets onrampAcceptedAt", async () => {
    mockFindUniqueFill.mockResolvedValue({
      id: "f1",
      onrampAcceptedAt: null,
      offrampAcceptedAt: null,
      onrampOrder: { status: "AWAITING_SETTLEMENT" },
      offrampOrder: { status: "AWAITING_SETTLEMENT" },
    } as never);
    mockUpdateFill.mockResolvedValue({} as never);

    const r = await acceptPeerRampFill({ fillId: "f1", side: "ONRAMP" });
    expect(r.ok).toBe(true);
    expect(mockUpdateFill).toHaveBeenCalled();
  });

  it("submitPeerRampOfframpEscrowTx verifies transfer and updates order", async () => {
    const createdAt = new Date("2026-04-01T12:00:00.000Z");
    mockFindUniqueOrder.mockResolvedValue({
      id: "off-1",
      side: "OFFRAMP",
      status: "AWAITING_SETTLEMENT",
      chainId: 84532,
      tokenAddress: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
      decimals: 6,
      cryptoAmountTotal: new Decimal("10"),
      cryptoAmountRemaining: new Decimal("0"),
      escrowVerifiedAt: null,
      escrowTxHash: null,
      createdAt,
    } as never);
    mockVerify.mockResolvedValue({
      ok: true,
      chainId: 84532,
      hash: "0xtx",
      blockNumber: 1n,
      blockTimestamp: Math.floor(createdAt.getTime() / 1000) + 120,
      status: "success",
      from: "0xfrom",
      to: "0xto",
      transfers: [],
      receipt: { gasUsed: "1" },
    });
    mockTransferMatches.mockReturnValue(true);
    mockUpdateOrder.mockResolvedValue({} as never);

    const r = await submitPeerRampOfframpEscrowTx({
      orderId: "off-1",
      txHash: "0xabcdef",
    });
    expect(r.ok).toBe(true);
    expect(mockVerify).toHaveBeenCalledWith(84532, "0xabcdef");
    expect(mockTransferMatches).toHaveBeenCalled();
    expect(mockUpdateOrder).toHaveBeenCalled();
  });
});
