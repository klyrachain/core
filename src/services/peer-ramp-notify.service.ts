/**
 * Peer ramp: transactional emails after fiat confirmation, escrow verification, and crypto delivery.
 * Does not expose counterparty PII — only order IDs and on-chain hashes the platform verified or executed.
 */

import { prisma } from "../lib/prisma.js";
import { sendEmail } from "./email.service.js";
import {
  peerRampFiatReceivedHtml,
  peerRampFiatReceivedSubject,
  peerRampOfframpCompleteHtml,
  peerRampOfframpCompleteSubject,
  peerRampOnrampCompleteHtml,
  peerRampOnrampCompleteSubject,
} from "../email/templates/peer-ramp-transactional.js";

function peerRampTxExplorerUrl(chainId: number, txHash: string): string {
  const h = txHash.trim();
  if (chainId === 8453) return `https://basescan.org/tx/${h}`;
  if (chainId === 84532) return `https://sepolia.basescan.org/tx/${h}`;
  return `https://basescan.org/tx/${h}`;
}

/** After Paystack confirms fiat for a peer-ramp-linked BUY (before crypto send). */
export async function notifyPeerRampFiatPaymentReceived(
  transactionId: string,
  _paystackReference?: string | null
): Promise<void> {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: {
      id: true,
      settlementQuoteSnapshot: true,
      f_amount: true,
      f_token: true,
      fromIdentifier: true,
    },
  });
  if (!tx) return;
  const snap = tx.settlementQuoteSnapshot as { peerRampOrderId?: string } | null;
  const orderId = snap?.peerRampOrderId?.trim();
  if (!orderId) return;
  const order = await prisma.peerRampOrder.findUnique({
    where: { id: orderId },
    select: { id: true, side: true, payerEmail: true, quoteSnapshot: true },
  });
  if (!order || order.side !== "ONRAMP") return;
  const toEmail = (order.payerEmail ?? tx.fromIdentifier)?.trim();
  if (!toEmail?.includes("@")) return;

  const fiatCurrency = (tx.f_token ?? "").toString().toUpperCase();
  const fiatAmount = tx.f_amount.toString();
  const qs = order.quoteSnapshot as { cryptoAmount?: number } | null;
  const cryptoAmount = qs?.cryptoAmount != null ? String(qs.cryptoAmount) : undefined;

  await sendEmail({
    to: toEmail,
    subject: peerRampFiatReceivedSubject(fiatCurrency || "FIAT"),
    html: peerRampFiatReceivedHtml({
      orderId: order.id,
      transactionId: tx.id,
      fiatAmount,
      fiatCurrency: fiatCurrency || "FIAT",
      cryptoAmount,
      cryptoSymbol: cryptoAmount ? "USDC" : undefined,
    }),
    entityRefId: `peer-ramp-fiat-${order.id}`,
    idempotencyKey: `peer-ramp-fiat-received-${transactionId}`,
  });
}

/**
 * After BUY completes: USDC was sent to the recipient wallet (`cryptoSendTxHash`).
 * Email the onramper with delivery hash; optionally note verified counterparty escrow tx from linked fills.
 */
export async function notifyPeerRampAfterOnrampCryptoSent(transactionId: string): Promise<void> {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: {
      id: true,
      cryptoSendTxHash: true,
      settlementQuoteSnapshot: true,
      t_token: true,
      t_amount: true,
      t_chain: true,
    },
  });
  if (!tx?.cryptoSendTxHash) return;

  const snap = tx.settlementQuoteSnapshot as { peerRampOrderId?: string } | null;
  const orderId = snap?.peerRampOrderId?.trim();
  if (!orderId) return;

  const order = await prisma.peerRampOrder.findUnique({
    where: { id: orderId },
  });
  if (!order || order.side !== "ONRAMP") return;
  const toEmail = order.payerEmail?.trim();
  if (!toEmail?.includes("@")) return;

  const token = (tx.t_token ?? "").toString();
  const html = peerRampOnrampCompleteHtml({
    orderId: order.id,
    transactionId: tx.id,
    amount: tx.t_amount.toString(),
    token,
    chain: (tx.t_chain ?? "").toString(),
    deliveryTxHash: tx.cryptoSendTxHash,
    deliveryTxExplorerUrl: peerRampTxExplorerUrl(order.chainId, tx.cryptoSendTxHash),
  });

  await sendEmail({
    to: toEmail,
    subject: peerRampOnrampCompleteSubject(token || "USDC"),
    html,
    entityRefId: `peer-ramp-onramp-${order.id}`,
    idempotencyKey: `peer-ramp-onramp-email-${transactionId}`,
  });
}

/** Single offramp user email: on-chain payment verified + quote amounts (fiat payout may follow separately). */
export async function notifyPeerRampOfframpEscrowVerified(
  offrampOrderId: string,
  escrowTxHash: string
): Promise<void> {
  const order = await prisma.peerRampOrder.findUnique({ where: { id: offrampOrderId } });
  if (!order || order.side !== "OFFRAMP") return;
  const toEmail = order.payerEmail?.trim();
  if (!toEmail?.includes("@")) return;

  const snap = order.quoteSnapshot as { fiatAmount?: number; fiatCurrency?: string } | null;
  const explorer = peerRampTxExplorerUrl(order.chainId, escrowTxHash.trim());

  await sendEmail({
    to: toEmail,
    subject: peerRampOfframpCompleteSubject(),
    html: peerRampOfframpCompleteHtml({
      orderId: order.id,
      txHash: escrowTxHash.trim(),
      txExplorerUrl: explorer,
      cryptoAmount: order.cryptoAmountTotal.toString(),
      tokenSymbol: "USDC",
      fiatAmount: snap?.fiatAmount != null ? String(snap.fiatAmount) : undefined,
      fiatCurrency: snap?.fiatCurrency?.toUpperCase(),
    }),
    entityRefId: `peer-ramp-off-${order.id}`,
    idempotencyKey: `peer-ramp-offramp-escrow-${offrampOrderId}`,
  });
}
