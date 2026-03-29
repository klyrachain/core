/**
 * Email template: payment request (payer notified to pay).
 * Design: "You have a new message" style, message-bubble hero, responsive, no header/footer.
 */

import {
  EMAIL_TEAL,
  MESSAGE_BUBBLE_IMG,
  emailLayoutShellEnd,
  emailLayoutShellStart,
} from "./message-style.js";

export type PaymentRequestTemplateVars = {
  payerName?: string;
  requesterIdentifier: string;
  amount: string;
  currency: string;
  receiveSummary: string;
  claimLinkUrl: string;
  expiresAt?: string;
};

export function paymentRequestSubject(vars: PaymentRequestTemplateVars): string {
  return `Payment request: ${vars.amount} ${vars.currency} – ${vars.receiveSummary}`;
}

export function paymentRequestHtml(vars: PaymentRequestTemplateVars): string {
  const { requesterIdentifier, amount, currency, receiveSummary, claimLinkUrl, expiresAt } = vars;
  const expiry = expiresAt ? `<p style="margin:0 0 16px; color:#64748b; font-size:14px;">This request expires: ${expiresAt}</p>` : "";
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment request</title>
</head>
${emailLayoutShellStart()}
    <tr>
      <td style="padding:32px 24px 24px; text-align:center;">
        <img src="${MESSAGE_BUBBLE_IMG}" alt="" width="160" height="160" style="max-width:100%; height:auto; display:block; margin:0 auto 24px; border-radius:12px;" />
        <h1 style="margin:0 0 8px; font-size:22px; font-weight:600; color:#1e293b;">You have a new message</h1>
        <div style="height:3px; width:48px; background:${EMAIL_TEAL}; margin:0 auto 24px; border-radius:2px;"></div>
      </td>
    </tr>
    <tr>
      <td style="padding:0 24px 24px;">
        <div style="background:#f0fdfa; border-radius:10px; padding:20px; border-left:4px solid ${EMAIL_TEAL};">
          <p style="margin:0 0 12px; font-size:15px; color:#334155;">Someone is requesting a payment from you.</p>
          <ul style="margin:0; padding-left:20px; color:#475569; font-size:14px; line-height:1.6;">
            <li><strong style="color:#1e293b;">Amount:</strong> ${amount} ${currency}</li>
            <li><strong style="color:#1e293b;">They will receive:</strong> ${receiveSummary}</li>
            <li><strong style="color:#1e293b;">From:</strong> ${requesterIdentifier}</li>
          </ul>
          ${expiry}
        </div>
        <p style="margin:24px 0 0; text-align:center;">
          <a href="${claimLinkUrl}" style="display:inline-block; padding:12px 28px; background:${EMAIL_TEAL}; color:#ffffff; text-decoration:none; font-weight:600; font-size:15px; border-radius:8px;">Pay now</a>
        </p>
        <p style="margin:20px 0 0; color:#94a3b8; font-size:12px; text-align:center;">If you didn't expect this request, you can ignore this email.</p>
      </td>
    </tr>
${emailLayoutShellEnd()}
</html>
  `.trim();
}

export function paymentRequestText(vars: PaymentRequestTemplateVars): string {
  const { amount, currency, receiveSummary, claimLinkUrl } = vars;
  return `You have a payment request: ${amount} ${currency}. They will receive: ${receiveSummary}. Pay here: ${claimLinkUrl}`;
}
