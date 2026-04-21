/**
 * Email: receiver notified when a payment request is created — no pay link; claim instructions go out after the payer pays.
 */

import {
  EMAIL_TEAL,
  MESSAGE_BUBBLE_IMG,
  emailLayoutShellEnd,
  emailLayoutShellStart,
} from "./message-style.js";

export type PaymentRequestReceiverPendingVars = {
  payerContact: string;
  amount: string;
  currency: string;
};

export function paymentRequestReceiverPendingSubject(vars: PaymentRequestReceiverPendingVars): string {
  return `Request sent: ${vars.amount} ${vars.currency}`;
}

export function paymentRequestReceiverPendingHtml(vars: PaymentRequestReceiverPendingVars): string {
  const { payerContact, amount, currency } = vars;
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Request sent</title>
</head>
${emailLayoutShellStart()}
    <tr>
      <td style="padding:32px 24px 24px; text-align:center;">
        <img src="${MESSAGE_BUBBLE_IMG}" alt="" width="160" height="160" style="max-width:100%; height:auto; display:block; margin:0 auto 24px; border-radius:12px;" />
        <h1 style="margin:0 0 8px; font-size:22px; font-weight:600; color:#1e293b;">Request sent</h1>
        <div style="height:3px; width:48px; background:${EMAIL_TEAL}; margin:0 auto 24px; border-radius:2px;"></div>
      </td>
    </tr>
    <tr>
      <td style="padding:0 24px 24px;">
        <div style="background:#f0fdfa; border-radius:10px; padding:20px; border-left:4px solid ${EMAIL_TEAL};">
          <ul style="margin:0; padding-left:20px; color:#475569; font-size:14px; line-height:1.6;">
            <li><strong style="color:#1e293b;">Amount:</strong> ${amount} ${currency}</li>
            <li><strong style="color:#1e293b;">Payer:</strong> ${payerContact}</li>
          </ul>
          <p style="margin:16px 0 0; color:#64748b; font-size:14px; line-height:1.5;">
            They were notified. You will receive claim instructions by email or SMS after they pay.
          </p>
        </div>
      </td>
    </tr>
${emailLayoutShellEnd()}
</html>
  `.trim();
}

export function paymentRequestReceiverPendingText(vars: PaymentRequestReceiverPendingVars): string {
  return [
    `Request sent: ${vars.amount} ${vars.currency}.`,
    `Payer: ${vars.payerContact}.`,
    "They were notified. Claim instructions arrive after they pay.",
  ].join("\n");
}
