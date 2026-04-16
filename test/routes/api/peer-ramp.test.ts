import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import { peerRampApiRoutes } from "../../../src/routes/api/peer-ramp.js";
import * as orderSvc from "../../../src/services/peer-ramp-order.service.js";

vi.mock("../../../src/services/peer-ramp-order.service.js", () => ({
  createPeerRampOnramp: vi.fn(),
  createPeerRampOfframp: vi.fn(),
  commitPeerRampOnramp: vi.fn(),
  getPeerRampOrderById: vi.fn(),
  listPeerRampOrders: vi.fn(),
  peerRampEscrowAddressHint: vi.fn(),
  acceptPeerRampFill: vi.fn(),
  submitPeerRampOfframpEscrowTx: vi.fn(),
  buildPeerRampOfframpEscrowTx: vi.fn(),
}));

const mockOnramp = vi.mocked(orderSvc.createPeerRampOnramp);
const mockOfframp = vi.mocked(orderSvc.createPeerRampOfframp);
const mockGet = vi.mocked(orderSvc.getPeerRampOrderById);
const mockList = vi.mocked(orderSvc.listPeerRampOrders);
const mockCommit = vi.mocked(orderSvc.commitPeerRampOnramp);
const mockEscrow = vi.mocked(orderSvc.peerRampEscrowAddressHint);
const mockAcceptFill = vi.mocked(orderSvc.acceptPeerRampFill);
const mockSubmitEscrow = vi.mocked(orderSvc.submitPeerRampOfframpEscrowTx);
const mockBuildEscrowTx = vi.mocked(orderSvc.buildPeerRampOfframpEscrowTx);

function baseOrder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "ord-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    side: "ONRAMP",
    chainId: 84532,
    tokenAddress: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
    decimals: 6,
    cryptoAmountTotal: { toString: () => "30" },
    cryptoAmountRemaining: { toString: () => "0" },
    status: "AWAITING_SETTLEMENT",
    quoteSnapshot: {},
    settlementCurrency: "NGN",
    payerEmail: "a@test.dev",
    recipientAddress: "0x1111111111111111111111111111111111111111",
    payoutHint: null,
    cliSessionId: null,
    linkedTransactionId: null,
    fillsAsOnramp: [],
    fillsAsOfframp: [],
    ...overrides,
  };
}

describe("peer-ramp API", () => {
  let app: Awaited<ReturnType<typeof Fastify>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    app.addContentTypeParser("application/json", { parseAs: "string" }, (_, body, done) => {
      try {
        done(null, body ? JSON.parse(body as string) : {});
      } catch (e) {
        done(e as Error, undefined);
      }
    });
    app.addHook("preHandler", (req, _reply, done) => {
      (req as { apiKey?: { permissions: string[]; businessId: string | null } }).apiKey = {
        permissions: ["*"],
        businessId: null,
      };
      done();
    });
    await app.register(peerRampApiRoutes, { prefix: "" });
  });

  it("POST /api/peer-ramp/orders/onramp returns 201", async () => {
    mockOnramp.mockResolvedValue(baseOrder() as never);
    const res = await app.inject({
      method: "POST",
      url: "/api/peer-ramp/orders/onramp",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        chainId: 84532,
        tokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        cryptoAmount: 30,
        quoteSnapshot: { fiatAmount: 45000, fiatCurrency: "NGN", cryptoAmount: 30 },
        settlementCurrency: "NGN",
        payerEmail: "a@test.dev",
        recipientAddress: "0x1111111111111111111111111111111111111111",
      }),
    });
    expect(res.statusCode).toBe(201);
    expect(mockOnramp).toHaveBeenCalledOnce();
  });

  it("POST /api/peer-ramp/orders/offramp includes escrow hint", async () => {
    mockOfframp.mockResolvedValue({ ...baseOrder({ side: "OFFRAMP" }), recipientAddress: null } as never);
    mockEscrow.mockReturnValue("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
    const res = await app.inject({
      method: "POST",
      url: "/api/peer-ramp/orders/offramp",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        chainId: 84532,
        tokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        cryptoAmount: 10,
        quoteSnapshot: { fiatAmount: 15000, fiatCurrency: "NGN", cryptoAmount: 10 },
        settlementCurrency: "NGN",
        payerEmail: "s@test.dev",
      }),
    });
    expect(res.statusCode).toBe(201);
    const j = res.json() as { data: { escrowAddress: string } };
    expect(j.data.escrowAddress).toMatch(/^0x/);
  });

  it("GET /api/peer-ramp/orders/:id", async () => {
    mockGet.mockResolvedValue(baseOrder() as never);
    const res = await app.inject({ method: "GET", url: "/api/peer-ramp/orders/ord-1" });
    expect(res.statusCode).toBe(200);
  });

  it("POST commit-onramp returns transaction id", async () => {
    mockCommit.mockResolvedValue({
      ok: true,
      transactionId: "tx-uuid",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/peer-ramp/orders/ord-1/commit-onramp",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(200);
    const j = res.json() as { data: { transactionId: string } };
    expect(j.data.transactionId).toBe("tx-uuid");
  });

  it("POST /api/peer-ramp/fills/:fillId/accept returns 200", async () => {
    mockAcceptFill.mockResolvedValue({ ok: true, fillId: "fill-1" });
    const res = await app.inject({
      method: "POST",
      url: "/api/peer-ramp/fills/fill-1/accept",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ side: "ONRAMP" }),
    });
    expect(res.statusCode).toBe(200);
    expect(mockAcceptFill).toHaveBeenCalledWith({ fillId: "fill-1", side: "ONRAMP" });
  });

  it("POST commit-onramp returns 409 when fill acceptance required", async () => {
    mockCommit.mockResolvedValue({
      ok: false,
      error: "All fills require dual acceptance",
      code: "FILL_ACCEPTANCE_REQUIRED",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/peer-ramp/orders/ord-1/commit-onramp",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(409);
  });

  it("GET escrow-tx returns encoded transfer", async () => {
    mockBuildEscrowTx.mockResolvedValue({
      ok: true,
      chainId: 84532,
      to: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
      data: "0xa9059cbb000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
      value: "0",
      tokenAddress: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
      decimals: 6,
      escrowAddress: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    });
    const res = await app.inject({ method: "GET", url: "/api/peer-ramp/orders/off-1/escrow-tx" });
    expect(res.statusCode).toBe(200);
    const j = res.json() as { data: { data: string; chainId: number } };
    expect(j.data.chainId).toBe(84532);
    expect(j.data.data.startsWith("0x")).toBe(true);
  });

  it("POST submit-escrow-tx returns verified payload", async () => {
    mockSubmitEscrow.mockResolvedValue({
      ok: true,
      verifiedAt: "2026-01-01T00:00:00.000Z",
      escrowTxHash: "0xabc",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/peer-ramp/orders/off-1/submit-escrow-tx",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ txHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" }),
    });
    expect(res.statusCode).toBe(200);
    const j = res.json() as { data: { escrowTxHash: string } };
    expect(j.data.escrowTxHash).toBe("0xabc");
  });
});
