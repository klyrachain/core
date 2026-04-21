import { sendEmail } from "./email.service.js";
import {
  claimSettledPayerHtml,
  claimSettledPayerSubject,
  claimSettledPayerText,
  claimSettledReceiverHtml,
  claimSettledReceiverSubject,
  claimSettledReceiverText,
} from "../email/templates/claim-settled.js";

function isEmail(s: string): boolean {
  return s.trim().includes("@");
}

/**
 * Best-effort emails after a successful claim: payer gets generic "claimed";
 * receiver gets payout summary (fiat reference when present).
 */
export async function notifyClaimCompleted(opts: {
  payoutType: "crypto" | "fiat";
  payerEmail?: string | null;
  receiverContact: string;
  sentSummary: string;
  claimedSummary: string;
  transactionId: string;
  paystackReference?: string;
}): Promise<void> {
  const payer = (opts.payerEmail ?? "").trim();
  if (payer && isEmail(payer)) {
    await sendEmail({
      to: payer,
      subject: claimSettledPayerSubject({ payerIdentifier: payer, sentSummary: opts.sentSummary }),
      html: claimSettledPayerHtml({ payerIdentifier: payer, sentSummary: opts.sentSummary }),
      text: claimSettledPayerText({ payerIdentifier: payer, sentSummary: opts.sentSummary }),
      entityRefId: `${opts.transactionId}:claim-settled-payer`,
      idempotencyKey: `${opts.transactionId}:claim-settled-payer`,
    }).catch(() => {});
  }

  const recv = opts.receiverContact.trim();
  if (recv && isEmail(recv)) {
    await sendEmail({
      to: recv,
      subject: claimSettledReceiverSubject({
        receiverIdentifier: recv,
        sentSummary: opts.sentSummary,
        payoutKind: opts.payoutType,
        claimedSummary: opts.claimedSummary,
        transactionId: opts.transactionId,
        paystackReference: opts.paystackReference,
      }),
      html: claimSettledReceiverHtml({
        receiverIdentifier: recv,
        sentSummary: opts.sentSummary,
        payoutKind: opts.payoutType,
        claimedSummary: opts.claimedSummary,
        transactionId: opts.transactionId,
        paystackReference: opts.paystackReference,
      }),
      text: claimSettledReceiverText({
        receiverIdentifier: recv,
        sentSummary: opts.sentSummary,
        payoutKind: opts.payoutType,
        claimedSummary: opts.claimedSummary,
        transactionId: opts.transactionId,
        paystackReference: opts.paystackReference,
      }),
      entityRefId: `${opts.transactionId}:claim-settled-receiver`,
      idempotencyKey: `${opts.transactionId}:claim-settled-receiver`,
    }).catch(() => {});
  }
}
