/**
 * Payer receipt after a successful card/bank/mobile checkout payment.
 */

import {
  EMAIL_TEAL,
  MESSAGE_BUBBLE_IMG,
  emailLayoutShellEnd,
  emailLayoutShellStart,
} from "./message-style.js";

export type PaymentLinkPayerReceiptVars = {
  amountLabel: string;
  /** Order / payment reference (full value for copy-paste). */
  orderReference: string;
  /** Internal transaction id (full UUID for copy-paste). */
  transactionId: string;
};

export function paymentLinkPayerReceiptSubject(_vars: PaymentLinkPayerReceiptVars): string {
  return "Payment successful";
}

export function paymentLinkPayerReceiptHtml(vars: PaymentLinkPayerReceiptVars): string {
  const { amountLabel, orderReference, transactionId } = vars;
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment successful</title>
</head>
${emailLayoutShellStart()}
    <tr>
      <td style="padding:32px 24px 24px; text-align:center;">
        <img src="${MESSAGE_BUBBLE_IMG}" alt="" width="160" height="160" style="max-width:100%; height:auto; display:block; margin:0 auto 24px; border-radius:12px;" />
        <h1 style="margin:0 0 8px; font-size:22px; font-weight:600; color:#1e293b;">Payment successful</h1>
        <div style="height:3px; width:48px; background:${EMAIL_TEAL}; margin:0 auto 24px; border-radius:2px;"></div>
      </td>
    </tr>
    <tr>
      <td style="padding:0 24px 24px;">
        <div style="background:#f0fdfa; border-radius:10px; padding:20px; border-left:4px solid ${EMAIL_TEAL};">
          <p style="margin:0 0 12px; font-size:15px; color:#334155;">Your payment went through.</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; font-size:14px; color:#475569;">
            <tr><td style="padding:4px 0;">Amount</td><td style="padding:4px 0; text-align:right; font-weight:600;">${amountLabel}</td></tr>
            <tr><td style="padding:12px 0 4px; vertical-align:top;">Order reference</td><td style="padding:12px 0 4px; text-align:right; font-family:monospace; font-size:12px; word-break:break-all;">${orderReference}</td></tr>
            <tr><td style="padding:4px 0; vertical-align:top;">Transaction ID</td><td style="padding:4px 0; text-align:right; font-family:monospace; font-size:12px; word-break:break-all;">${transactionId}</td></tr>
          </table>
        </div>
      </td>
    </tr>
${emailLayoutShellEnd()}
</html>`;
}

export function paymentLinkPayerReceiptText(vars: PaymentLinkPayerReceiptVars): string {
  return [
    "Payment successful",
    "",
    `Amount: ${vars.amountLabel}`,
    "",
    "Order reference (copy if needed):",
    vars.orderReference,
    "",
    "Transaction ID (copy if needed):",
    vars.transactionId,
    "",
    "Thank you.",
  ].join("\n");
}
