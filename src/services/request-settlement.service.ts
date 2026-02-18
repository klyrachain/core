/**
 * Payment request settlement: when we receive payment for a REQUEST, we auto-settle to the requester
 * (no claim step). Send crypto to payoutTarget or fiat via Paystack transfer using verified payoutFiat.
 */

import { prisma } from "../lib/prisma.js";
import { executeRequestSettlementSend } from "./onramp-execution.service.js";
import {
  createTransferRecipient,
  initiateTransfer,
  isPaystackConfigured,
} from "./paystack.service.js";
import { onRequestPaymentConfirmed } from "./request-claim-notify.service.js";
import { getExplorerTxUrl } from "../email/templates/request-settled.js";
import {
  sendRequestPaymentReceivedToPayer,
  sendRequestSettledToRequester,
} from "./notification.service.js";

type PayoutFiat = {
  type: "nuban" | "mobile_money";
  account_name: string;
  account_number: string;
  bank_code?: string;
  currency: string;
};

function parsePayoutFiat(json: unknown): PayoutFiat | null {
  if (json == null || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (o.type !== "nuban" && o.type !== "mobile_money") return null;
  if (typeof o.account_name !== "string" || !o.account_name.trim()) return null;
  if (typeof o.account_number !== "string" || !o.account_number.trim()) return null;
  if (typeof o.currency !== "string" || !o.currency.trim()) return null;
  if (o.type === "nuban" && (typeof o.bank_code !== "string" || !o.bank_code.trim())) return null;
  if (o.type === "mobile_money" && (typeof o.bank_code !== "string" || !o.bank_code.trim())) return null; // provider code required
  return {
    type: o.type,
    account_name: String(o.account_name).trim(),
    account_number: String(o.account_number).trim(),
    bank_code: typeof o.bank_code === "string" && o.bank_code.trim() ? o.bank_code.trim() : undefined,
    currency: String(o.currency).trim(),
  };
}

/** GHS mobile: Paystack expects local format 0XXXXXXXXX; strip 233 if present. */
function normalizeAccountForPaystack(account: string, currency: string, type: "nuban" | "mobile_money"): string {
  let out = account.trim();
  if (currency === "GHS" && type === "mobile_money" && out.startsWith("233")) {
    const local = out.slice(3).replace(/^0+/, "") || "0";
    out = local.length === 9 ? `0${local}` : local.startsWith("0") ? local : `0${local}`;
  }
  return out;
}

export type OnRequestPaymentSettledResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Called when payment for a REQUEST is confirmed (Paystack or crypto received).
 * Crypto: send to payoutTarget. Fiat: if payoutFiat set, Paystack transfer to verified account (name confirmed via resolve/validate).
 */
export async function onRequestPaymentSettled(opts: {
  transactionId: string;
}): Promise<OnRequestPaymentSettledResult> {
  const tx = await prisma.transaction.findUnique({
    where: { id: opts.transactionId },
    select: { id: true, type: true, status: true, requestId: true, t_chain: true, t_amount: true, t_token: true },
  });
  if (!tx || tx.type !== "REQUEST") return { ok: false, error: "Transaction not found or not a REQUEST" };
  if (tx.status !== "COMPLETED") return { ok: false, error: "Transaction not yet completed" };
  if (!tx.requestId) return { ok: false, error: "No request linked" };

  const request = await prisma.request.findUnique({
    where: { id: tx.requestId },
    include: { claim: true, transaction: true },
  });
  if (!request) return { ok: false, error: "Request not found" };

  const claim = request.claim;
  const payerEmail = (request.transaction?.fromIdentifier ?? "").trim();
  const requesterIdentifier = (request.transaction?.toIdentifier ?? "").trim();
  const amount = tx.t_amount.toString();
  const currency = tx.t_token ?? "";
  const tChainUpper = tx.t_chain?.toUpperCase() ?? "";

  const isCrypto = tChainUpper !== "MOMO" && tChainUpper !== "BANK";
  const payoutTarget = request.payoutTarget?.trim();
  const payoutFiat = parsePayoutFiat(request.payoutFiat);
  let cryptoSendTxHash: string | undefined;

  if (isCrypto && payoutTarget && payoutTarget.startsWith("0x")) {
    const sendResult = await executeRequestSettlementSend(opts.transactionId, payoutTarget);
    if (!sendResult.ok) {
      return { ok: false, error: sendResult.error };
    }
    cryptoSendTxHash = sendResult.txHash;
  }

  const didSettlement = (isCrypto && payoutTarget && payoutTarget.startsWith("0x")) ||
    (!isCrypto && payoutFiat && isPaystackConfigured());
  if (!didSettlement && claim && claim.status === "ACTIVE") {
    const notify = await onRequestPaymentConfirmed({ transactionId: opts.transactionId });
    if (!notify.ok) return { ok: false, error: notify.error };
    return { ok: true };
  }

  if (!isCrypto && payoutFiat && isPaystackConfigured()) {
    const amountSubunits = Math.round(Number(tx.t_amount) * 100); // GHS: pesewas
    const accountForPaystack = normalizeAccountForPaystack(
      payoutFiat.account_number,
      payoutFiat.currency,
      payoutFiat.type
    );
    const recipientType = payoutFiat.type === "nuban" ? "nuban" : "mobile_money";
    const bankCode = payoutFiat.bank_code?.trim();
    if (!bankCode) {
      return {
        ok: false,
        error: recipientType === "nuban"
          ? "payoutFiat.bank_code is required for bank payout"
          : "payoutFiat.bank_code (provider code, e.g. MTN) is required for mobile money",
      };
    }
    try {
      const { recipient_code } = await createTransferRecipient({
        type: recipientType,
        name: payoutFiat.account_name,
        account_number: accountForPaystack,
        bank_code: bankCode,
        currency: payoutFiat.currency,
      });
      const reference = `req_${request.id.slice(0, 8)}_${Date.now()}`.replace(/-/g, "_").slice(0, 50);
      await initiateTransfer({
        source: "balance",
        amount: amountSubunits,
        recipient: recipient_code,
        reference,
        reason: "Request settlement",
        currency: payoutFiat.currency,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Paystack transfer failed";
      return { ok: false, error: msg };
    }
  }

  if (claim && claim.status === "ACTIVE") {
    await prisma.claim.update({
      where: { id: claim.id },
      data: { status: "CLAIMED" },
    });
  }

  const txExplorerUrl =
    cryptoSendTxHash && tx.t_chain ? getExplorerTxUrl(tx.t_chain, cryptoSendTxHash) : undefined;
  const cryptoVars = cryptoSendTxHash
    ? { txHash: cryptoSendTxHash, ...(txExplorerUrl ? { txExplorerUrl } : {}) }
    : {};

  if (payerEmail && payerEmail.includes("@")) {
    await sendRequestPaymentReceivedToPayer(
      payerEmail,
      { payerIdentifier: payerEmail, requesterIdentifier, amount, currency, ...cryptoVars },
      request.id
    );
  }
  if (requesterIdentifier && requesterIdentifier.includes("@")) {
    await sendRequestSettledToRequester(
      requesterIdentifier,
      { requesterIdentifier, amount, currency, ...cryptoVars },
      request.id
    );
  }

  return { ok: true };
}
