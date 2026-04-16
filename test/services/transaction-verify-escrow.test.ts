import { describe, it, expect } from "vitest";
import {
  sumMatchingTransfersToRecipient,
  transferMatches,
  type TransferItem,
} from "../../src/services/transaction-verify.service.js";

describe("transaction-verify escrow matching", () => {
  const token = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
  const escrowLower = "0x9f08efb0767bf180b8b8094faaef9dab5a0755e1";
  /** Same address, EIP-55 checksummed — viem often returns this form in decoded logs. */
  const escrowChecksummed = "0x9f08eFb0767Bf180B8b8094FaaEF9DAB5a0755e1";
  const thirtyUsdc = 30_000_000n;

  it("matches when Transfer `to` is checksummed and escrow param is lowercase", () => {
    const transfers: TransferItem[] = [
      {
        token,
        from: "0x1111111111111111111111111111111111111111",
        to: escrowChecksummed,
        valueRaw: thirtyUsdc.toString(),
      },
    ];
    expect(transferMatches(transfers, token, escrowLower, thirtyUsdc)).toBe(true);
    expect(sumMatchingTransfersToRecipient(transfers, token, escrowLower)).toBe(thirtyUsdc);
  });

  it("sums multiple Transfer logs to the same escrow", () => {
    const transfers: TransferItem[] = [
      {
        token,
        from: "0x2222222222222222222222222222222222222222",
        to: escrowLower,
        valueRaw: "15000000",
      },
      {
        token,
        from: "0x2222222222222222222222222222222222222222",
        to: escrowChecksummed.toLowerCase(),
        valueRaw: "15000000",
      },
    ];
    expect(sumMatchingTransfersToRecipient(transfers, token, escrowLower)).toBe(thirtyUsdc);
    expect(transferMatches(transfers, token, escrowLower, thirtyUsdc)).toBe(true);
  });
});
