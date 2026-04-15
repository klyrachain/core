/**
 * E2E-style integration: matcher + DB (requires migrated schema + PEER_RAMP_INTEGRATION_TESTS=1 + DATABASE_URL in .env).
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import type { PrismaClient } from "../../prisma/generated/prisma/client.js";

const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const CHAIN = 84532;

const quote = (crypto: number, fiat: number, currency = "NGN") => ({
  fiatAmount: fiat,
  fiatCurrency: currency,
  cryptoAmount: crypto,
});

describe.skipIf(process.env.PEER_RAMP_INTEGRATION_TESTS !== "1")("peer-ramp e2e (DB)", () => {
  let prisma: PrismaClient;
  let createPeerRampOfframp: (typeof import("../../src/services/peer-ramp-order.service.js"))["createPeerRampOfframp"];
  let createPeerRampOnramp: (typeof import("../../src/services/peer-ramp-order.service.js"))["createPeerRampOnramp"];
  let commitPeerRampOnramp: (typeof import("../../src/services/peer-ramp-order.service.js"))["commitPeerRampOnramp"];
  let acceptPeerRampFill: (typeof import("../../src/services/peer-ramp-order.service.js"))["acceptPeerRampFill"];

  beforeAll(async () => {
    await import("dotenv/config");
    const { loadEnv } = await import("../../src/config/env.js");
    loadEnv();
    const prismaMod = await import("../../src/lib/prisma.js");
    prisma = prismaMod.prisma;
    const orderMod = await import("../../src/services/peer-ramp-order.service.js");
    createPeerRampOfframp = orderMod.createPeerRampOfframp;
    createPeerRampOnramp = orderMod.createPeerRampOnramp;
    commitPeerRampOnramp = orderMod.commitPeerRampOnramp;
    acceptPeerRampFill = orderMod.acceptPeerRampFill;
  });

  beforeEach(async () => {
    await prisma.peerRampFill.deleteMany();
    await prisma.peerRampOrder.deleteMany();
  });

  it("1:1 full match", async () => {
    await createPeerRampOfframp({
      chainId: CHAIN,
      tokenAddress: USDC_BASE_SEPOLIA,
      decimals: 6,
      cryptoAmount: 20,
      quoteSnapshot: quote(20, 30000),
      settlementCurrency: "NGN",
      payerEmail: "seller@test.dev",
    });

    const on = await createPeerRampOnramp({
      chainId: CHAIN,
      tokenAddress: USDC_BASE_SEPOLIA,
      decimals: 6,
      cryptoAmount: 20,
      quoteSnapshot: quote(20, 31000),
      settlementCurrency: "NGN",
      payerEmail: "buyer@test.dev",
      recipientAddress: "0x1111111111111111111111111111111111111111",
    });

    expect(on.cryptoAmountRemaining.toString()).toBe("0");
    expect(on.status).toBe("AWAITING_SETTLEMENT");
    const fills = await prisma.peerRampFill.findMany({});
    expect(fills.length).toBe(1);
    expect(fills[0].cryptoAmount.toString()).toBe("20");
  }, 60_000);

  it("aggregates multiple offramps for one onramp", async () => {
    for (let i = 0; i < 3; i++) {
      await createPeerRampOfframp({
        chainId: CHAIN,
        tokenAddress: USDC_BASE_SEPOLIA,
        decimals: 6,
        cryptoAmount: 10,
        quoteSnapshot: quote(10, 15000 + i),
        settlementCurrency: "NGN",
        payerEmail: `seller${i}@test.dev`,
      });
    }

    const on = await createPeerRampOnramp({
      chainId: CHAIN,
      tokenAddress: USDC_BASE_SEPOLIA,
      decimals: 6,
      cryptoAmount: 30,
      quoteSnapshot: quote(30, 47000),
      settlementCurrency: "NGN",
      payerEmail: "buyer@test.dev",
      recipientAddress: "0x2222222222222222222222222222222222222222",
    });

    expect(on.cryptoAmountRemaining.toString()).toBe("0");
    const fills = await prisma.peerRampFill.findMany({});
    expect(fills.length).toBe(3);
    const sum = fills.reduce((a, f) => a + Number(f.cryptoAmount.toString()), 0);
    expect(sum).toBe(30);
  }, 60_000);

  it("aggregates multiple onramps for one large offramp", async () => {
    await createPeerRampOfframp({
      chainId: CHAIN,
      tokenAddress: USDC_BASE_SEPOLIA,
      decimals: 6,
      cryptoAmount: 25,
      quoteSnapshot: quote(25, 38000),
      settlementCurrency: "NGN",
      payerEmail: "whale@test.dev",
    });

    const a = await createPeerRampOnramp({
      chainId: CHAIN,
      tokenAddress: USDC_BASE_SEPOLIA,
      decimals: 6,
      cryptoAmount: 10,
      quoteSnapshot: quote(10, 15500),
      settlementCurrency: "NGN",
      payerEmail: "a@test.dev",
      recipientAddress: "0x3333333333333333333333333333333333333333",
    });
    expect(a.cryptoAmountRemaining.toString()).toBe("0");

    const b = await createPeerRampOnramp({
      chainId: CHAIN,
      tokenAddress: USDC_BASE_SEPOLIA,
      decimals: 6,
      cryptoAmount: 15,
      quoteSnapshot: quote(15, 23200),
      settlementCurrency: "NGN",
      payerEmail: "b@test.dev",
      recipientAddress: "0x4444444444444444444444444444444444444444",
    });
    expect(b.cryptoAmountRemaining.toString()).toBe("0");

    const off = await prisma.peerRampOrder.findFirst({
      where: { side: "OFFRAMP" },
    });
    expect(off?.cryptoAmountRemaining.toString()).toBe("0");

    const fills = await prisma.peerRampFill.findMany({});
    expect(fills.length).toBe(2);
  }, 60_000);

  it("commit-onramp requires dual accept on each fill", async () => {
    await createPeerRampOfframp({
      chainId: CHAIN,
      tokenAddress: USDC_BASE_SEPOLIA,
      decimals: 6,
      cryptoAmount: 5,
      quoteSnapshot: quote(5, 7500),
      settlementCurrency: "NGN",
      payerEmail: "seller@test.dev",
    });

    const on = await createPeerRampOnramp({
      chainId: CHAIN,
      tokenAddress: USDC_BASE_SEPOLIA,
      decimals: 6,
      cryptoAmount: 5,
      quoteSnapshot: quote(5, 7600),
      settlementCurrency: "NGN",
      payerEmail: "buyer@test.dev",
      recipientAddress: "0x5555555555555555555555555555555555555555",
    });

    expect(on.status).toBe("AWAITING_SETTLEMENT");
    const fills = await prisma.peerRampFill.findMany({ where: { onrampOrderId: on.id } });
    expect(fills.length).toBe(1);

    const blocked = await commitPeerRampOnramp({ orderId: on.id, initializePaystack: false });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe("FILL_ACCEPTANCE_REQUIRED");

    await acceptPeerRampFill({ fillId: fills[0].id, side: "ONRAMP" });
    const blocked2 = await commitPeerRampOnramp({ orderId: on.id, initializePaystack: false });
    expect(blocked2.ok).toBe(false);
    if (!blocked2.ok) expect(blocked2.code).toBe("FILL_ACCEPTANCE_REQUIRED");

    await acceptPeerRampFill({ fillId: fills[0].id, side: "OFFRAMP" });
    const ok = await commitPeerRampOnramp({ orderId: on.id, initializePaystack: false });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      const tx = await prisma.transaction.findUnique({ where: { id: ok.transactionId } });
      expect(tx?.type).toBe("BUY");
    }
  }, 60_000);
});
