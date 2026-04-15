/**
 * Peer ramp order lifecycle: create intents, commit onramp to Transaction + optional Paystack.
 */

import type { IdentityType, PaymentProvider, TransactionType } from "../../prisma/generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { addPollJob } from "../lib/queue.js";
import { getEnv } from "../config/env.js";
import { matchPeerRampOrderAfterCreate, normalizePeerRampTokenAddress } from "./peer-ramp-matcher.service.js";
import { deriveTransactionPrices, derivePricesFromAmounts } from "./transaction-price.service.js";
import { initializePayment, isPaystackConfigured } from "./paystack.service.js";
import { encodeFunctionData, erc20Abi, parseUnits } from "viem";
import {
  buildEscrowVerificationSnapshot,
  transferMatches,
  verifyTransactionByHash,
  type EscrowVerificationSnapshot,
} from "./transaction-verify.service.js";
import { notifyPeerRampOfframpEscrowVerified } from "./peer-ramp-notify.service.js";

export type PeerRampQuoteSnapshot = {
  fiatAmount: number;
  fiatCurrency: string;
  cryptoAmount: number;
  usdEquivalent?: number;
  displayCurrency?: string;
};

/** Map chain id to Transaction `*_chain` label used by testnet validation. */
export function chainIdToTxChainName(chainId: number): string {
  if (chainId === 84532) return "BASE SEPOLIA";
  if (chainId === 8453) return "BASE";
  return `CHAIN_${chainId}`;
}

export type CreatePeerRampOnrampInput = {
  chainId: number;
  tokenAddress: string;
  decimals: number;
  cryptoAmount: number;
  quoteSnapshot: PeerRampQuoteSnapshot;
  settlementCurrency: string;
  payerEmail: string;
  recipientAddress: string;
  cliSessionId?: string;
};

export type CreatePeerRampOfframpInput = {
  chainId: number;
  tokenAddress: string;
  decimals: number;
  cryptoAmount: number;
  quoteSnapshot: PeerRampQuoteSnapshot;
  settlementCurrency: string;
  payerEmail: string;
  payoutHint?: Record<string, unknown>;
  cliSessionId?: string;
};

export async function createPeerRampOnramp(input: CreatePeerRampOnrampInput) {
  const normalized = normalizePeerRampTokenAddress(input.tokenAddress);
  const order = await prisma.peerRampOrder.create({
    data: {
      side: "ONRAMP",
      chainId: input.chainId,
      tokenAddress: normalized,
      decimals: input.decimals,
      cryptoAmountTotal: input.cryptoAmount,
      cryptoAmountRemaining: input.cryptoAmount,
      status: "OPEN",
      quoteSnapshot: input.quoteSnapshot as object,
      settlementCurrency: input.settlementCurrency.trim().toUpperCase(),
      payerEmail: input.payerEmail.trim().toLowerCase(),
      recipientAddress: input.recipientAddress.trim(),
      cliSessionId: input.cliSessionId?.trim() || null,
    },
  });
  await matchPeerRampOrderAfterCreate(order.id);
  return prisma.peerRampOrder.findUniqueOrThrow({
    where: { id: order.id },
    include: {
      fillsAsOnramp: true,
      fillsAsOfframp: true,
    },
  });
}

export async function createPeerRampOfframp(input: CreatePeerRampOfframpInput) {
  const normalized = normalizePeerRampTokenAddress(input.tokenAddress);
  const order = await prisma.peerRampOrder.create({
    data: {
      side: "OFFRAMP",
      chainId: input.chainId,
      tokenAddress: normalized,
      decimals: input.decimals,
      cryptoAmountTotal: input.cryptoAmount,
      cryptoAmountRemaining: input.cryptoAmount,
      status: "OPEN",
      quoteSnapshot: input.quoteSnapshot as object,
      settlementCurrency: input.settlementCurrency.trim().toUpperCase(),
      payerEmail: input.payerEmail.trim().toLowerCase(),
      payoutHint: input.payoutHint ? (input.payoutHint as object) : undefined,
      cliSessionId: input.cliSessionId?.trim() || null,
    },
  });
  await matchPeerRampOrderAfterCreate(order.id);
  return prisma.peerRampOrder.findUniqueOrThrow({
    where: { id: order.id },
    include: {
      fillsAsOnramp: true,
      fillsAsOfframp: true,
    },
  });
}

export async function getPeerRampOrderById(id: string) {
  return prisma.peerRampOrder.findUnique({
    where: { id },
    include: {
      fillsAsOnramp: true,
      fillsAsOfframp: true,
      linkedTransaction: {
        select: {
          id: true,
          status: true,
          type: true,
          providerSessionId: true,
          cryptoSendTxHash: true,
        },
      },
    },
  });
}

export async function listPeerRampOrders(params: { cliSessionId?: string; limit?: number }) {
  const take = Math.min(params.limit ?? 50, 200);
  return prisma.peerRampOrder.findMany({
    where: params.cliSessionId ? { cliSessionId: params.cliSessionId } : undefined,
    orderBy: { createdAt: "desc" },
    take,
    include: {
      fillsAsOnramp: true,
      fillsAsOfframp: true,
    },
  });
}

const ACCEPTABLE_FOR_ACCEPT = new Set(["OPEN", "PARTIALLY_FILLED", "AWAITING_SETTLEMENT"]);

export type AcceptPeerRampFillResult =
  | { ok: true; fillId: string }
  | { ok: false; error: string; code?: string };

/**
 * Idempotent: sets acceptance timestamp for this side if not already set.
 * Both linked orders must still be in a non-terminal match/settlement state.
 */
export async function acceptPeerRampFill(input: {
  fillId: string;
  side: "ONRAMP" | "OFFRAMP";
}): Promise<AcceptPeerRampFillResult> {
  const fill = await prisma.peerRampFill.findUnique({
    where: { id: input.fillId },
    include: { onrampOrder: true, offrampOrder: true },
  });
  if (!fill) {
    return { ok: false, error: "Fill not found", code: "NOT_FOUND" };
  }
  for (const o of [fill.onrampOrder, fill.offrampOrder]) {
    if (!ACCEPTABLE_FOR_ACCEPT.has(o.status)) {
      return { ok: false, error: "Linked order is not open for acceptance", code: "INVALID_STATUS" };
    }
  }

  if (input.side === "ONRAMP") {
    if (fill.onrampAcceptedAt) {
      return { ok: true, fillId: fill.id };
    }
    await prisma.peerRampFill.update({
      where: { id: fill.id },
      data: { onrampAcceptedAt: new Date() },
    });
  } else {
    if (fill.offrampAcceptedAt) {
      return { ok: true, fillId: fill.id };
    }
    await prisma.peerRampFill.update({
      where: { id: fill.id },
      data: { offrampAcceptedAt: new Date() },
    });
  }

  return { ok: true, fillId: fill.id };
}

export type SubmitEscrowResult =
  | { ok: true; verifiedAt: string; escrowTxHash: string; verificationSnapshot?: EscrowVerificationSnapshot }
  | { ok: false; error: string; code?: string; verificationDetails?: EscrowVerificationSnapshot };

export type PeerRampEscrowTxPayload =
  | {
      ok: true;
      chainId: number;
      /** ERC-20 token contract to call */
      to: string;
      data: `0x${string}`;
      value: string;
      tokenAddress: string;
      decimals: number;
      escrowAddress: string;
    }
  | { ok: false; error: string; code?: string };

/**
 * Build an ERC-20 `transfer(escrow, amount)` tx for the wallet to submit (offramp escrow leg).
 */
export async function buildPeerRampOfframpEscrowTx(orderId: string): Promise<PeerRampEscrowTxPayload> {
  const order = await prisma.peerRampOrder.findUnique({
    where: { id: orderId },
  });
  if (!order || order.side !== "OFFRAMP") {
    return { ok: false, error: "Offramp order not found", code: "NOT_FOUND" };
  }
  if (order.escrowVerifiedAt && order.escrowTxHash) {
    return { ok: false, error: "Escrow already recorded for this order", code: "ALREADY_SUBMITTED" };
  }
  if (order.status !== "AWAITING_SETTLEMENT") {
    return { ok: false, error: "Order must be fully matched before escrow payment", code: "NOT_READY" };
  }
  const rem = Number(order.cryptoAmountRemaining.toString());
  if (rem > 1e-12) {
    return { ok: false, error: "Order still has unmatched remainder", code: "REMAINDER_OPEN" };
  }

  const escrow = peerRampEscrowAddressHint();
  if (!escrow) {
    return { ok: false, error: "PEER_RAMP_PLATFORM_ESCROW_ADDRESS not configured", code: "ESCROW_NOT_CONFIGURED" };
  }

  let amountWei: bigint;
  try {
    amountWei = parseUnits(order.cryptoAmountTotal.toString(), order.decimals);
  } catch {
    return { ok: false, error: "Invalid order amount/decimals", code: "INVALID_AMOUNT" };
  }

  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [escrow as `0x${string}`, amountWei],
  });

  return {
    ok: true,
    chainId: order.chainId,
    to: order.tokenAddress,
    data,
    value: "0",
    tokenAddress: order.tokenAddress,
    decimals: order.decimals,
    escrowAddress: escrow,
  };
}

/**
 * Offramp: verify ERC-20 transfer of full order crypto to platform escrow; record hash + verified time.
 */
export async function submitPeerRampOfframpEscrowTx(input: {
  orderId: string;
  txHash: string;
}): Promise<SubmitEscrowResult> {
  const order = await prisma.peerRampOrder.findUnique({
    where: { id: input.orderId },
  });
  if (!order || order.side !== "OFFRAMP") {
    return { ok: false, error: "Offramp order not found", code: "NOT_FOUND" };
  }
  if (order.escrowVerifiedAt && order.escrowTxHash) {
    return {
      ok: true,
      verifiedAt: order.escrowVerifiedAt.toISOString(),
      escrowTxHash: order.escrowTxHash,
    };
  }
  if (order.status !== "AWAITING_SETTLEMENT") {
    return { ok: false, error: "Order must be fully matched before escrow proof", code: "NOT_READY" };
  }
  const rem = Number(order.cryptoAmountRemaining.toString());
  if (rem > 1e-12) {
    return { ok: false, error: "Order still has unmatched remainder", code: "REMAINDER_OPEN" };
  }

  const escrow = peerRampEscrowAddressHint();
  if (!escrow) {
    return { ok: false, error: "PEER_RAMP_PLATFORM_ESCROW_ADDRESS not configured", code: "ESCROW_NOT_CONFIGURED" };
  }

  const hash = input.txHash.trim();
  const verify = await verifyTransactionByHash(order.chainId, hash);
  if (!verify.ok) {
    return { ok: false, error: verify.error, code: "VERIFY_FAILED" };
  }
  if (verify.status !== "success") {
    return { ok: false, error: "Transaction reverted on-chain", code: "TX_REVERTED" };
  }

  let expectedWei: bigint;
  try {
    expectedWei = parseUnits(order.cryptoAmountTotal.toString(), order.decimals);
  } catch {
    return { ok: false, error: "Invalid order amount/decimals for verification", code: "INVALID_AMOUNT" };
  }

  const snapshot = buildEscrowVerificationSnapshot(verify, order.tokenAddress, escrow, expectedWei);

  if (!transferMatches(verify.transfers, order.tokenAddress, escrow, expectedWei)) {
    await prisma.peerRampOrder.update({
      where: { id: order.id },
      data: { escrowVerifyLastAttempt: { ...snapshot, at: new Date().toISOString(), outcome: "TRANSFER_MISMATCH" } as object },
    });
    return {
      ok: false,
      error: `No ERC-20 transfer to escrow ${escrow} for token ${order.tokenAddress} with amount >= order total`,
      code: "TRANSFER_MISMATCH",
      verificationDetails: snapshot,
    };
  }

  const orderCreatedAtSec = Math.floor(order.createdAt.getTime() / 1000);
  const CLOCK_SKEW_SECONDS = 60;
  if (verify.blockTimestamp < orderCreatedAtSec - CLOCK_SKEW_SECONDS) {
    await prisma.peerRampOrder.update({
      where: { id: order.id },
      data: {
        escrowVerifyLastAttempt: {
          ...snapshot,
          at: new Date().toISOString(),
          outcome: "TX_TOO_OLD",
        } as object,
      },
    });
    return {
      ok: false,
      error: "Transaction mined before this order was created",
      code: "TX_TOO_OLD",
      verificationDetails: snapshot,
    };
  }

  const now = new Date();
  await prisma.peerRampOrder.update({
    where: { id: order.id },
    data: {
      escrowTxHash: hash,
      escrowVerifiedAt: now,
      escrowVerifyLastAttempt: {
        ...snapshot,
        at: now.toISOString(),
        outcome: "VERIFIED",
      } as object,
    },
  });

  void notifyPeerRampOfframpEscrowVerified(order.id, hash).catch((e) =>
    console.warn("[peer-ramp] offramp escrow email failed:", e)
  );

  return { ok: true, verifiedAt: now.toISOString(), escrowTxHash: hash, verificationSnapshot: snapshot };
}

export type CommitOnrampResult =
  | {
      ok: true;
      transactionId: string;
      paystack?: {
        authorization_url: string;
        access_code: string;
        reference: string;
      };
    }
  | { ok: false; error: string; code?: string };

/**
 * Onramp order must be fully matched (remainder 0, AWAITING_SETTLEMENT). Creates BUY Transaction and links it.
 * Optionally initializes Paystack (same semantics as /api/paystack/payments/initialize with transaction_id).
 */
export async function commitPeerRampOnramp(input: {
  orderId: string;
  initializePaystack?: boolean;
  paystackCustomerEmail?: string;
  callback_url?: string;
}): Promise<CommitOnrampResult> {
  const order = await prisma.peerRampOrder.findUnique({
    where: { id: input.orderId },
  });
  if (!order || order.side !== "ONRAMP") {
    return { ok: false, error: "Onramp order not found", code: "NOT_FOUND" };
  }
  if (order.linkedTransactionId) {
    return { ok: false, error: "Order already committed", code: "ALREADY_COMMITTED" };
  }
  if (order.status !== "AWAITING_SETTLEMENT") {
    return {
      ok: false,
      error: "Order must be fully matched (AWAITING_SETTLEMENT) before commit",
      code: "NOT_READY",
    };
  }
  const rem = Number(order.cryptoAmountRemaining.toString());
  if (rem > 1e-12) {
    return { ok: false, error: "Order still has unmatched crypto remainder", code: "REMAINDER_OPEN" };
  }

  const fills = await prisma.peerRampFill.findMany({
    where: { onrampOrderId: order.id },
  });
  if (fills.length === 0) {
    return { ok: false, error: "No fills for this onramp order", code: "NO_FILLS" };
  }
  for (const f of fills) {
    if (!f.onrampAcceptedAt || !f.offrampAcceptedAt) {
      return {
        ok: false,
        error: "All fills require dual acceptance (onramp + offramp) before commit",
        code: "FILL_ACCEPTANCE_REQUIRED",
      };
    }
  }

  const snap = order.quoteSnapshot as PeerRampQuoteSnapshot | null;
  if (!snap?.fiatAmount || !snap.fiatCurrency) {
    return { ok: false, error: "quoteSnapshot missing fiatAmount/fiatCurrency", code: "INVALID_QUOTE" };
  }

  const tChain = chainIdToTxChainName(order.chainId);
  const cryptoTotal = Number(order.cryptoAmountTotal.toString());
  const fiatTotal = snap.fiatAmount;
  const currency = snap.fiatCurrency.trim().toUpperCase();

  const legacy = derivePricesFromAmounts("buy", fiatTotal, cryptoTotal);
  const prices = deriveTransactionPrices({
    action: "buy",
    f_token: currency,
    t_token: "USDC",
    f_price: legacy.f_price,
    t_price: legacy.t_price,
    f_amount: fiatTotal,
    t_amount: cryptoTotal,
  });

  const payerEmail = (input.paystackCustomerEmail ?? order.payerEmail ?? "").trim().toLowerCase();
  const toAddr = (order.recipientAddress ?? "").trim();
  if (!toAddr.startsWith("0x")) {
    return { ok: false, error: "Invalid recipient wallet", code: "INVALID_ADDRESS" };
  }

  const platformEmail = getEnv().PAYSTACK_PLATFORM_EMAIL?.trim().toLowerCase() ?? "";
  const fromIdentifier =
    payerEmail && payerEmail.includes("@")
      ? payerEmail
      : platformEmail && platformEmail.includes("@")
        ? platformEmail
        : "peer-ramp@platform.local";
  const fromType: IdentityType = "EMAIL";

  const transaction = await prisma.transaction.create({
    data: {
      type: "BUY" as TransactionType,
      status: "PENDING",
      fromIdentifier,
      fromType,
      toIdentifier: toAddr,
      toType: "ADDRESS",
      f_amount: fiatTotal,
      t_amount: cryptoTotal,
      exchangeRate: prices.exchangeRate,
      f_tokenPriceUsd: prices.f_tokenPriceUsd,
      t_tokenPriceUsd: prices.t_tokenPriceUsd,
      f_chain: "BANK",
      t_chain: tChain,
      f_token: currency,
      t_token: "USDC",
      f_provider: "PAYSTACK" as PaymentProvider,
      t_provider: "KLYRA" as PaymentProvider,
      environment: tChain === "BASE SEPOLIA" ? "TEST" : "LIVE",
      settlementQuoteSnapshot: {
        peerRampOrderId: order.id,
        quoteSnapshot: snap,
      } as object,
    },
  });

  await prisma.peerRampOrder.update({
    where: { id: order.id },
    data: { linkedTransactionId: transaction.id },
  });

  await addPollJob(transaction.id);

  let paystack:
    | { authorization_url: string; access_code: string; reference: string }
    | undefined;

  if (input.initializePaystack) {
    if (!isPaystackConfigured()) {
      return { ok: false, error: "Paystack not configured", code: "PAYSTACK_UNAVAILABLE" };
    }
    if (!platformEmail || !platformEmail.includes("@")) {
      return { ok: false, error: "PAYSTACK_PLATFORM_EMAIL required", code: "PAYSTACK_PLATFORM_EMAIL_REQUIRED" };
    }
    const majorAmount = fiatTotal;
    const amountSubunits = Math.round(majorAmount * 100);
    if (amountSubunits < 100) {
      return { ok: false, error: "Fiat amount too small for Paystack (min 1 unit)", code: "AMOUNT_TOO_SMALL" };
    }
    const init = await initializePayment({
      email: platformEmail,
      amount: amountSubunits,
      currency,
      callback_url: input.callback_url,
      metadata: {
        transaction_id: transaction.id,
        peer_ramp_order_id: order.id,
        ...(payerEmail ? { payer_email: payerEmail } : {}),
      },
    });
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: { providerSessionId: init.reference },
    });
    paystack = {
      authorization_url: init.authorization_url,
      access_code: init.access_code,
      reference: init.reference,
    };
  }

  return { ok: true, transactionId: transaction.id, paystack };
}

export function peerRampEscrowAddressHint(): string | null {
  const a = getEnv().PEER_RAMP_PLATFORM_ESCROW_ADDRESS?.trim();
  if (a && a.startsWith("0x") && a.length === 42) return a;
  return null;
}
