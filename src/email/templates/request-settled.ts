/**
 * Email templates: payment request settled (payer and requester).
 * Payer: "We received your payment" — thumbs-up hero. Requester: "You've been paid" — dollar-sign hero.
 * Responsive, no header/footer.
 */

const THUMBS_UP_IMG = "https://d1oco4z2z1fhwp.cloudfront.net/templates/default/1346/Img62x.jpg";
const DOLLAR_IMG = "https://d1oco4z2z1fhwp.cloudfront.net/templates/default/1366/Img5_2x.jpg";
const TEAL = "#0d9488";

/** Build block explorer tx URL from chain name and tx hash. */
export function getExplorerTxUrl(chain: string, txHash: string): string {
  const c = (chain ?? "").toUpperCase().replace(/-/g, " ");
  const base =
    c === "BASE SEPOLIA"
      ? "https://sepolia.basescan.org"
      : c === "BASE"
        ? "https://basescan.org"
        : c === "ETHEREUM"
          ? "https://etherscan.io"
          : c === "POLYGON"
            ? "https://polygonscan.com"
            : c === "ARBITRUM"
              ? "https://arbiscan.io"
              : c === "BNB"
                ? "https://bscscan.com"
                : "https://etherscan.io";
  return `${base}/tx/${txHash.trim()}`;
}

export type RequestPaymentReceivedTemplateVars = {
  payerIdentifier: string;
  requesterIdentifier: string;
  amount: string;
  currency: string;
  txHash?: string;
  txExplorerUrl?: string;
};

export function requestPaymentReceivedSubject(_vars: RequestPaymentReceivedTemplateVars): string {
  return "We received your payment";
}

export function requestPaymentReceivedHtml(vars: RequestPaymentReceivedTemplateVars): string {
  const { requesterIdentifier, amount, currency, txHash, txExplorerUrl } = vars;
  const txLine =
    txHash && txExplorerUrl
      ? `<p style="margin:12px 0 0; font-size:14px;"><a href="${txExplorerUrl}" style="color:${TEAL}; word-break:break-all;">View transaction</a></p>`
      : txHash
        ? `<p style="margin:12px 0 0; font-size:12px; word-break:break-all; color:#64748b;">${txHash}</p>`
        : "";
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment received</title>
</head>
<body style="margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f1f5f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 6px rgba(0,0,0,0.05);">
    <tr>
      <td style="padding:32px 24px 24px; text-align:center;">
        <img src="${THUMBS_UP_IMG}" alt="" width="160" height="160" style="max-width:100%; height:auto; display:block; margin:0 auto 24px; border-radius:12px;" />
        <h1 style="margin:0 0 8px; font-size:22px; font-weight:600; color:#1e293b;">We received your payment</h1>
        <div style="height:3px; width:48px; background:${TEAL}; margin:0 auto 24px; border-radius:2px;"></div>
      </td>
    </tr>
    <tr>
      <td style="padding:0 24px 24px;">
        <div style="background:#f0fdfa; border-radius:10px; padding:20px; border-left:4px solid ${TEAL};">
          <p style="margin:0; font-size:15px; color:#334155;">Your payment of <strong>${amount} ${currency}</strong> has been received and sent to <strong>${requesterIdentifier}</strong>.</p>
          ${txLine}
        </div>
        <p style="margin:20px 0 0; color:#94a3b8; font-size:12px; text-align:center;">Thank you for using our service.</p>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

export function requestPaymentReceivedText(vars: RequestPaymentReceivedTemplateVars): string {
  const { requesterIdentifier, amount, currency, txHash, txExplorerUrl } = vars;
  const txLine = txHash ? (txExplorerUrl ? ` View transaction: ${txExplorerUrl}` : ` Transaction: ${txHash}`) : "";
  return `We received your payment of ${amount} ${currency} and sent it to ${requesterIdentifier}.${txLine}`;
}

export type RequestSettledToRequesterTemplateVars = {
  requesterIdentifier: string;
  amount: string;
  currency: string;
  txHash?: string;
  txExplorerUrl?: string;
};

export function requestSettledToRequesterSubject(vars: RequestSettledToRequesterTemplateVars): string {
  return `You've been paid ${vars.amount} ${vars.currency}`;
}

export function requestSettledToRequesterHtml(vars: RequestSettledToRequesterTemplateVars): string {
  const { amount, currency, txHash, txExplorerUrl } = vars;
  const txLine =
    txHash && txExplorerUrl
      ? `<p style="margin:12px 0 0; font-size:14px;"><a href="${txExplorerUrl}" style="color:${TEAL}; word-break:break-all;">View transaction</a></p>`
      : txHash
        ? `<p style="margin:12px 0 0; font-size:12px; word-break:break-all; color:#64748b;">${txHash}</p>`
        : "";
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You've been paid</title>
</head>
<body style="margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f1f5f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 6px rgba(0,0,0,0.05);">
    <tr>
      <td style="padding:32px 24px 24px; text-align:center;">
        <img src="${DOLLAR_IMG}" alt="" width="160" height="160" style="max-width:100%; height:auto; display:block; margin:0 auto 24px; border-radius:12px;" />
        <h1 style="margin:0 0 8px; font-size:22px; font-weight:600; color:#1e293b;">Thank you for the payment</h1>
        <div style="height:3px; width:48px; background:${TEAL}; margin:0 auto 24px; border-radius:2px;"></div>
      </td>
    </tr>
    <tr>
      <td style="padding:0 24px 24px;">
        <div style="background:#f0fdfa; border-radius:10px; padding:20px; border-left:4px solid ${TEAL};">
          <p style="margin:0; font-size:15px; color:#334155;">We have sent you <strong>${amount} ${currency}</strong> to your wallet.</p>
          ${txLine}
        </div>
        <p style="margin:20px 0 0; color:#94a3b8; font-size:12px; text-align:center;">Thank you for using our service.</p>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

export function requestSettledToRequesterText(vars: RequestSettledToRequesterTemplateVars): string {
  const { amount, currency, txHash, txExplorerUrl } = vars;
  const txLine = txHash ? (txExplorerUrl ? ` View transaction: ${txExplorerUrl}` : ` Transaction: ${txHash}`) : "";
  return `You've been paid ${amount} ${currency}. The funds have been sent to your wallet.${txLine}`;
}
