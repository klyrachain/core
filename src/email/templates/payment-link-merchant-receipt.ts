/**
 * Merchant notification: customer payment succeeded (amounts only).
 */

import {
  EMAIL_TEAL,
  MESSAGE_BUBBLE_IMG,
  emailLayoutShellEnd,
  emailLayoutShellStart,
} from "./message-style.js";

export type PaymentLinkMerchantReceiptVars = {
  businessName: string;
  amountLabel: string;
  linkLabel: string;
  /** Full transaction id for records / support. */
  transactionId: string;
};

export function paymentLinkMerchantReceiptSubject(vars: PaymentLinkMerchantReceiptVars): string {
  return `Payment received — ${vars.amountLabel}`;
}

export function paymentLinkMerchantReceiptHtml(vars: PaymentLinkMerchantReceiptVars): string {
  const { businessName, amountLabel, linkLabel, transactionId } = vars;
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment received</title>
</head>
${emailLayoutShellStart()}
    <tr>
      <td style="padding:32px 24px 24px; text-align:center;">
        <img src="${MESSAGE_BUBBLE_IMG}" alt="" width="160" height="160" style="max-width:100%; height:auto; display:block; margin:0 auto 24px; border-radius:12px;" />
        <h1 style="margin:0 0 8px; font-size:22px; font-weight:600; color:#1e293b;">Payment received</h1>
        <div style="height:3px; width:48px; background:${EMAIL_TEAL}; margin:0 auto 24px; border-radius:2px;"></div>
      </td>
    </tr>
    <tr>
      <td style="padding:0 24px 24px;">
        <div style="background:#f8fafc; border-radius:10px; padding:20px; border-left:4px solid ${EMAIL_TEAL};">
          <p style="margin:0 0 8px; font-size:15px; color:#334155;">${businessName}</p>
          <p style="margin:0 0 12px; font-size:14px; color:#64748b;">A customer payment was successful.</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; font-size:14px; color:#475569;">
            <tr><td style="padding:4px 0;">Amount</td><td style="padding:4px 0; text-align:right; font-weight:600;">${amountLabel}</td></tr>
            <tr><td style="padding:4px 0;">Link</td><td style="padding:4px 0; text-align:right; font-size:12px;">${linkLabel}</td></tr>
            <tr><td style="padding:4px 0; vertical-align:top;">Transaction ID</td><td style="padding:4px 0; text-align:right; font-family:monospace; font-size:12px; word-break:break-all;">${transactionId}</td></tr>
          </table>
        </div>
      </td>
    </tr>
${emailLayoutShellEnd()}
</html>`;
}

export function paymentLinkMerchantReceiptText(vars: PaymentLinkMerchantReceiptVars): string {
  return [
    `Payment received — ${vars.amountLabel}`,
    "",
    vars.businessName,
    "A customer payment was successful.",
    "",
    `Amount: ${vars.amountLabel}`,
    `Link: ${vars.linkLabel}`,
    "",
    "Transaction ID:",
    vars.transactionId,
  ].join("\n");
}
