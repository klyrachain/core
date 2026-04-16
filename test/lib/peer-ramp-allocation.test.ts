import { describe, it, expect } from "vitest";
import { Decimal } from "@prisma/client/runtime/client";
import { largestFirstGreedyPeerAlloc } from "../../src/lib/peer-ramp-allocation.js";

describe("largestFirstGreedyPeerAlloc", () => {
  it("matches initiator against largest counter first", () => {
    const out = largestFirstGreedyPeerAlloc({
      initiatorRemaining: new Decimal(30),
      candidates: [
        { id: "a", remaining: new Decimal(5) },
        { id: "b", remaining: new Decimal(12) },
        { id: "c", remaining: new Decimal(10) },
      ],
    });
    expect(out.map((x) => [x.peerId, x.amount.toString()])).toEqual([
      ["b", "12"],
      ["c", "10"],
      ["a", "5"],
    ]);
    const sum = out.reduce((s, x) => s.plus(x.amount), new Decimal(0));
    expect(sum.toString()).toBe("27");
  });

  it("stops when initiator filled", () => {
    const out = largestFirstGreedyPeerAlloc({
      initiatorRemaining: new Decimal(15),
      candidates: [
        { id: "x", remaining: new Decimal(20) },
        { id: "y", remaining: new Decimal(20) },
      ],
    });
    expect(out).toEqual([{ peerId: "x", amount: new Decimal(15) }]);
  });
});
