/**
 * Email templates: payment request (payer notified to pay).
 * Used when someone creates a request; we send to the payer with link to frontend.
 */

export type PaymentRequestTemplateVars = {
  payerName?: string;
  requesterIdentifier: string;
  amount: string;
  currency: string;
  /** What the requester will receive (e.g. "50 USDC on Base" or "100 GHS mobile money") */
  receiveSummary: string;
  /** Full URL to frontend page (e.g. /pay/request/{linkId}) */
  claimLinkUrl: string;
  expiresAt?: string;
};

export function paymentRequestSubject(vars: PaymentRequestTemplateVars): string {
  return `Payment request: ${vars.amount} ${vars.currency} – ${vars.receiveSummary}`;
}

export function paymentRequestHtml(vars: PaymentRequestTemplateVars): string {
  const { requesterIdentifier, amount, currency, receiveSummary, claimLinkUrl, expiresAt } = vars;
  const expiry = expiresAt ? `<p>This request expires: ${expiresAt}</p>` : "";
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Payment request</title></head>
<body style="font-family: sans-serif; max-width: 560px;">
  <h2>You have a payment request</h2>
  <p>Someone is requesting a payment from you.</p>
  <ul>
    <li><strong>Amount:</strong> ${amount} ${currency}</li>
    <li><strong>They will receive:</strong> ${receiveSummary}</li>
    <li><strong>From:</strong> ${requesterIdentifier}</li>
  </ul>
  ${expiry}
  <p><a href="${claimLinkUrl}" style="display: inline-block; padding: 10px 20px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px;">Pay now</a></p>
  <p style="color: #666; font-size: 12px;">If you didn't expect this request, you can ignore this email.</p>
</body>
</html>
  `.trim();
}

export function paymentRequestText(vars: PaymentRequestTemplateVars): string {
  const { amount, currency, receiveSummary, claimLinkUrl } = vars;
  return `You have a payment request: ${amount} ${currency}. They will receive: ${receiveSummary}. Pay here: ${claimLinkUrl}`;
}
