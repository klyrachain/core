/**
 * After a successful claim: payer is told funds were claimed (no payout method);
 * receiver is told what they received (fiat/crypto + reference when applicable).
 */

import {
  EMAIL_TEAL,
  MESSAGE_BUBBLE_IMG,
  emailLayoutShellEnd,
  emailLayoutShellStart,
} from "./message-style.js";

export type ClaimSettledPayerVars = {
  payerIdentifier: string;
  /** What they originally sent (e.g. "0.05 USDC on BASE"). */
  sentSummary: string;
};

export type ClaimSettledReceiverVars = {
  receiverIdentifier: string;
  /** Original payment summary (e.g. "0.05 USDC on BASE"). */
  sentSummary: string;
  payoutKind: "crypto" | "fiat";
  /** What they claimed (e.g. "0.05 USDC to wallet" or "100 GHS via bank transfer"). */
  claimedSummary: string;
  transactionId: string;
  paystackReference?: string;
};

export function claimSettledPayerSubject(_vars: ClaimSettledPayerVars): string {
  return "Your payment was claimed";
}

export function claimSettledPayerHtml(vars: ClaimSettledPayerVars): string {
  const { sentSummary } = vars;
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Payment claimed</title></head>
${emailLayoutShellStart()}
    <tr><td style="padding:32px 24px 24px; text-align:center;">
      <img src="${MESSAGE_BUBBLE_IMG}" alt="" width="120" height="120" style="max-width:100%; height:auto; display:block; margin:0 auto 16px; border-radius:12px;" />
      <h1 style="margin:0 0 8px; font-size:20px; font-weight:600; color:#1e293b;">Payment claimed</h1>
      <div style="height:3px; width:40px; background:${EMAIL_TEAL}; margin:0 auto 20px; border-radius:2px;"></div>
    </td></tr>
    <tr><td style="padding:0 24px 28px;">
      <div style="background:#f8fafc; border-radius:10px; padding:18px; border-left:4px solid ${EMAIL_TEAL};">
        <p style="margin:0 0 10px; font-size:15px; color:#334155;">The recipient has successfully claimed the funds you sent.</p>
        <p style="margin:0; font-size:14px; color:#475569;">Your payment: <strong>${sentSummary}</strong></p>
        <p style="margin:14px 0 0; font-size:13px; color:#64748b;">For privacy we do not include how they chose to receive (crypto vs fiat) in this message.</p>
      </div>
    </td></tr>
${emailLayoutShellEnd()}
</html>`.trim();
}

export function claimSettledPayerText(vars: ClaimSettledPayerVars): string {
  return `Your payment was claimed. You sent: ${vars.sentSummary}. We do not include payout details to the recipient in this email.`;
}

export function claimSettledReceiverSubject(_vars: ClaimSettledReceiverVars): string {
  return "You claimed your payment";
}

export function claimSettledReceiverHtml(vars: ClaimSettledReceiverVars): string {
  const refBlock =
    vars.payoutKind === "fiat" && vars.paystackReference
      ? `<p style="margin:10px 0 0; font-size:13px; color:#475569;">Transfer reference: <code style="background:#e2e8f0; padding:2px 8px; border-radius:4px;">${vars.paystackReference}</code></p>`
      : "";
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Claim complete</title></head>
${emailLayoutShellStart()}
    <tr><td style="padding:32px 24px 24px; text-align:center;">
      <img src="${MESSAGE_BUBBLE_IMG}" alt="" width="120" height="120" style="max-width:100%; height:auto; display:block; margin:0 auto 16px; border-radius:12px;" />
      <h1 style="margin:0 0 8px; font-size:20px; font-weight:600; color:#1e293b;">Claim complete</h1>
      <div style="height:3px; width:40px; background:${EMAIL_TEAL}; margin:0 auto 20px; border-radius:2px;"></div>
    </td></tr>
    <tr><td style="padding:0 24px 28px;">
      <div style="background:#f0fdfa; border-radius:10px; padding:18px; border-left:4px solid ${EMAIL_TEAL};">
        <p style="margin:0 0 8px; font-size:15px; color:#334155;">You received a payment and claimed it as <strong>${vars.payoutKind}</strong>.</p>
        <p style="margin:0 0 6px; font-size:14px; color:#475569;">Payment sent to you: <strong>${vars.sentSummary}</strong></p>
        <p style="margin:0; font-size:14px; color:#475569;">You claimed: <strong>${vars.claimedSummary}</strong></p>
        ${refBlock}
        <p style="margin:12px 0 0; font-size:12px; color:#94a3b8;">Order / transaction id: ${vars.transactionId}</p>
      </div>
    </td></tr>
${emailLayoutShellEnd()}
</html>`.trim();
}

export function claimSettledReceiverText(vars: ClaimSettledReceiverVars): string {
  const ref = vars.paystackReference ? ` Reference: ${vars.paystackReference}.` : "";
  return `You claimed your payment. Sent to you: ${vars.sentSummary}. You claimed (${vars.payoutKind}): ${vars.claimedSummary}.${ref} Tx: ${vars.transactionId}.`;
}
