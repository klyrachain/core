/**
 * Email template: claim notification (receiver notified to claim funds).
 * Design: "You have a new message" style, message-bubble hero, responsive, no header/footer.
 */

import {
  EMAIL_TEAL,
  MESSAGE_BUBBLE_IMG,
  emailLayoutShellEnd,
  emailLayoutShellStart,
} from "./message-style.js";

export type ClaimNotificationTemplateVars = {
  receiverIdentifier: string;
  amount: string;
  currency: string;
  claimCode: string;
  otp: string;
  claimLinkUrl: string;
};

export function claimNotificationSubject(vars: ClaimNotificationTemplateVars): string {
  return `You have ${vars.amount} ${vars.currency} to claim`;
}

export function claimNotificationHtml(vars: ClaimNotificationTemplateVars): string {
  const { amount, currency, claimCode, otp, claimLinkUrl } = vars;
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claim your funds</title>
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
          <p style="margin:0 0 12px; font-size:15px; color:#334155;">Someone sent you <strong>${amount} ${currency}</strong>.</p>
          <p style="margin:0 0 8px; font-size:14px; color:#475569;"><strong style="color:#1e293b;">Claim code:</strong> <code style="background:#e2e8f0; padding:4px 10px; border-radius:6px; font-size:14px;">${claimCode}</code></p>
          <p style="margin:0 0 12px; font-size:14px; color:#475569;"><strong style="color:#1e293b;">Verification code (OTP):</strong> <code style="background:#e2e8f0; padding:4px 10px; border-radius:6px; font-size:14px;">${otp}</code></p>
          <p style="margin:0; font-size:14px; color:#475569;">Use the link below to verify and choose how to receive your funds (crypto or fiat).</p>
        </div>
        <p style="margin:24px 0 0; text-align:center;">
          <a href="${claimLinkUrl}" style="display:inline-block; padding:12px 28px; background:${EMAIL_TEAL}; color:#ffffff; text-decoration:none; font-weight:600; font-size:15px; border-radius:8px;">Claim now</a>
        </p>
        <p style="margin:20px 0 0; color:#94a3b8; font-size:12px; text-align:center;">Do not share your OTP. This code expires in 10 minutes.</p>
      </td>
    </tr>
${emailLayoutShellEnd()}
</html>
  `.trim();
}

export function claimNotificationText(vars: ClaimNotificationTemplateVars): string {
  const { amount, currency, claimCode, otp, claimLinkUrl } = vars;
  return `You have ${amount} ${currency} to claim. Code: ${claimCode}. OTP: ${otp}. Claim: ${claimLinkUrl}. OTP expires in 10 min.`;
}
