/**
 * Peer-ramp transactional emails — same visual system as payment-request (message-style).
 */

import {
  EMAIL_TEAL,
  MESSAGE_BUBBLE_IMG,
  emailLayoutShellEnd,
  emailLayoutShellStart,
} from "./message-style.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function peerRampOnrampCompleteSubject(tokenSymbol: string): string {
  return `Peer ramp complete — ${tokenSymbol} delivered`;
}

export function peerRampOnrampCompleteHtml(vars: {
  orderId: string;
  transactionId: string;
  amount: string;
  token: string;
  chain: string;
  deliveryTxHash: string;
  deliveryTxExplorerUrl: string;
}): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Onramp complete</title></head>
${emailLayoutShellStart()}
  <tr>
    <td style="padding:32px 24px 24px; text-align:center;">
      <img src="${MESSAGE_BUBBLE_IMG}" alt="" width="160" height="160" style="max-width:100%; height:auto; display:block; margin:0 auto 24px; border-radius:12px;" />
      <h1 style="margin:0 0 8px; font-size:22px; font-weight:600; color:#1e293b;">Crypto delivered</h1>
      <div style="height:3px; width:48px; background:${EMAIL_TEAL}; margin:0 auto 24px; border-radius:2px;"></div>
    </td>
  </tr>
  <tr>
    <td style="padding:0 24px 24px;">
      <div style="background:#f0fdfa; border-radius:10px; padding:20px; border-left:4px solid ${EMAIL_TEAL};">
        <p style="margin:0 0 12px; font-size:15px; color:#334155;">Your peer ramp onramp is complete. Details below (IDs and on-chain data only).</p>
        <ul style="margin:0; padding-left:20px; color:#475569; font-size:14px; line-height:1.7;">
          <li><strong style="color:#1e293b;">Order:</strong> <code style="font-size:12px;">${escapeHtml(vars.orderId)}</code></li>
          <li><strong style="color:#1e293b;">Transaction:</strong> <code style="font-size:12px;">${escapeHtml(vars.transactionId)}</code></li>
          <li><strong style="color:#1e293b;">Delivered:</strong> ${escapeHtml(vars.amount)} ${escapeHtml(vars.token)} on ${escapeHtml(vars.chain)}</li>
          <li><strong style="color:#1e293b;">Delivery tx:</strong> <a href="${escapeHtml(vars.deliveryTxExplorerUrl)}" style="color:#0d9488; font-size:12px; word-break:break-all;">${escapeHtml(vars.deliveryTxHash)}</a></li>
        </ul>
        <p style="margin:16px 0 0; font-size:12px; color:#94a3b8;">No counterparty contact details are included.</p>
      </div>
    </td>
  </tr>
${emailLayoutShellEnd()}
</html>`.trim();
}

export function peerRampOfframpCompleteSubject(): string {
  return "Your transaction is confirmed";
}

export function peerRampOfframpCompleteHtml(vars: {
  orderId: string;
  txHash: string;
  txExplorerUrl: string;
  cryptoAmount: string;
  tokenSymbol: string;
  fiatAmount?: string;
  fiatCurrency?: string;
}): string {
  const fiatLine =
    vars.fiatAmount && vars.fiatCurrency
      ? `<li><strong style="color:#1e293b;">Fiat equivalent (quote):</strong> ${escapeHtml(vars.fiatAmount)} ${escapeHtml(vars.fiatCurrency)}</li>`
      : "";
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Transaction confirmed</title></head>
${emailLayoutShellStart()}
  <tr>
    <td style="padding:32px 24px 24px; text-align:center;">
      <img src="${MESSAGE_BUBBLE_IMG}" alt="" width="160" height="160" style="max-width:100%; height:auto; display:block; margin:0 auto 24px; border-radius:12px;" />
      <h1 style="margin:0 0 8px; font-size:22px; font-weight:600; color:#1e293b;">Transaction confirmed</h1>
      <div style="height:3px; width:48px; background:${EMAIL_TEAL}; margin:0 auto 24px; border-radius:2px;"></div>
    </td>
  </tr>
  <tr>
    <td style="padding:0 24px 24px;">
      <div style="background:#f0fdfa; border-radius:10px; padding:20px; border-left:4px solid ${EMAIL_TEAL};">
        <p style="margin:0 0 12px; font-size:15px; color:#334155;">We verified your on-chain payment. Amounts below match your order.</p>
        <ul style="margin:0; padding-left:20px; color:#475569; font-size:14px; line-height:1.7;">
          <li><strong style="color:#1e293b;">Order:</strong> <code style="font-size:12px;">${escapeHtml(vars.orderId)}</code></li>
          <li><strong style="color:#1e293b;">Crypto sent:</strong> ${escapeHtml(vars.cryptoAmount)} ${escapeHtml(vars.tokenSymbol)}</li>
          ${fiatLine}
          <li><strong style="color:#1e293b;">On-chain:</strong> <a href="${escapeHtml(vars.txExplorerUrl)}" style="color:#0d9488; font-size:12px; word-break:break-all;">${escapeHtml(vars.txHash)}</a></li>
        </ul>
        <p style="margin:16px 0 0; font-size:12px; color:#94a3b8;">Bank payout may follow separately depending on region and provider status (including test environments).</p>
      </div>
    </td>
  </tr>
${emailLayoutShellEnd()}
</html>`.trim();
}

export function peerRampFiatReceivedSubject(fiatCurrency: string): string {
  return `We received your ${fiatCurrency} payment — settlement in progress`;
}

export function peerRampFiatReceivedHtml(vars: {
  orderId: string;
  transactionId: string;
  fiatAmount: string;
  fiatCurrency: string;
  cryptoAmount?: string;
  cryptoSymbol?: string;
}): string {
  const cryptoLine =
    vars.cryptoAmount && vars.cryptoSymbol
      ? `<li><strong style="color:#1e293b;">Crypto (quote):</strong> ${escapeHtml(vars.cryptoAmount)} ${escapeHtml(vars.cryptoSymbol)}</li>`
      : "";
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Payment received</title></head>
${emailLayoutShellStart()}
  <tr>
    <td style="padding:32px 24px 24px; text-align:center;">
      <img src="${MESSAGE_BUBBLE_IMG}" alt="" width="160" height="160" style="max-width:100%; height:auto; display:block; margin:0 auto 24px; border-radius:12px;" />
      <h1 style="margin:0 0 8px; font-size:22px; font-weight:600; color:#1e293b;">Fiat payment received</h1>
      <div style="height:3px; width:48px; background:${EMAIL_TEAL}; margin:0 auto 24px; border-radius:2px;"></div>
    </td>
  </tr>
  <tr>
    <td style="padding:0 24px 24px;">
      <div style="background:#f0fdfa; border-radius:10px; padding:20px; border-left:4px solid ${EMAIL_TEAL};">
        <p style="margin:0 0 12px; font-size:15px; color:#334155;">We’ve received your fiat payment. We’re moving crypto to your wallet — you’ll get another message when on-chain delivery completes.</p>
        <ul style="margin:0; padding-left:20px; color:#475569; font-size:14px; line-height:1.7;">
          <li><strong style="color:#1e293b;">Order:</strong> <code style="font-size:12px;">${escapeHtml(vars.orderId)}</code></li>
          <li><strong style="color:#1e293b;">Reference:</strong> <code style="font-size:12px;">${escapeHtml(vars.transactionId)}</code></li>
          <li><strong style="color:#1e293b;">Fiat paid:</strong> ${escapeHtml(vars.fiatAmount)} ${escapeHtml(vars.fiatCurrency)}</li>
          ${cryptoLine}
        </ul>
      </div>
    </td>
  </tr>
${emailLayoutShellEnd()}
</html>`.trim();
}
