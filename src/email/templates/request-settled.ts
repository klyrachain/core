/**
 * Email templates: payment request settled (payer and requester).
 * Used when we have received payment for a request and settled to the requester; no claim step.
 */

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
  /** Crypto send tx hash */
  txHash?: string;
  /** Block explorer URL for the tx (so recipient can view on-chain) */
  txExplorerUrl?: string;
};

export function requestPaymentReceivedSubject(_vars: RequestPaymentReceivedTemplateVars): string {
  return "We received your payment";
}

export function requestPaymentReceivedHtml(vars: RequestPaymentReceivedTemplateVars): string {
  const { requesterIdentifier, amount, currency, txHash, txExplorerUrl } = vars;
  const txLine =
    txHash && txExplorerUrl
      ? `<p>Transaction: <a href="${txExplorerUrl}" style="color: #2563eb; word-break: break-all;">${txHash}</a></p>`
      : txHash
        ? `<p>Transaction: <code style="font-size: 11px; word-break: break-all;">${txHash}</code></p>`
        : "";
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Payment received</title></head>
<body style="font-family: sans-serif; max-width: 560px;">
  <h2>We received your payment</h2>
  <p>Your payment of <strong>${amount} ${currency}</strong> has been received and sent to <strong>${requesterIdentifier}</strong>.</p>
  ${txLine}
  <p style="color: #666; font-size: 12px;">Thank you for using our service.</p>
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
      ? `<p>Transaction: <a href="${txExplorerUrl}" style="color: #2563eb; word-break: break-all;">${txHash}</a></p>`
      : txHash
        ? `<p>Transaction: <code style="font-size: 11px; word-break: break-all;">${txHash}</code></p>`
        : "";
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Payment sent</title></head>
<body style="font-family: sans-serif; max-width: 560px;">
  <h2>You've been paid</h2>
  <p>We have sent you <strong>${amount} ${currency}</strong> to your wallet.</p>
  ${txLine}
  <p style="color: #666; font-size: 12px;">Thank you for using our service.</p>
</body>
</html>
  `.trim();
}

export function requestSettledToRequesterText(vars: RequestSettledToRequesterTemplateVars): string {
  const { amount, currency, txHash, txExplorerUrl } = vars;
  const txLine = txHash ? (txExplorerUrl ? ` View transaction: ${txExplorerUrl}` : ` Transaction: ${txHash}`) : "";
  return `You've been paid ${amount} ${currency}. The funds have been sent to your wallet.${txLine}`;
}
