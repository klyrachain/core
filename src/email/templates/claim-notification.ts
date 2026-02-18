/**
 * Email templates: claim notification (receiver notified to claim funds).
 * Used when payer has sent funds; we notify the receiver with claim link + OTP/code.
 */

export type ClaimNotificationTemplateVars = {
  receiverIdentifier: string;
  amount: string;
  currency: string;
  /** Short claim code (e.g. 6 chars) for claiming */
  claimCode: string;
  /** OTP to verify identity (e.g. 6 digits) */
  otp: string;
  /** Full URL to frontend claim page */
  claimLinkUrl: string;
};

export function claimNotificationSubject(vars: ClaimNotificationTemplateVars): string {
  return `You have ${vars.amount} ${vars.currency} to claim`;
}

export function claimNotificationHtml(vars: ClaimNotificationTemplateVars): string {
  const { amount, currency, claimCode, otp, claimLinkUrl } = vars;
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Claim your funds</title></head>
<body style="font-family: sans-serif; max-width: 560px;">
  <h2>You have funds to claim</h2>
  <p>Someone sent you <strong>${amount} ${currency}</strong>.</p>
  <p><strong>Claim code:</strong> <code style="background: #f3f4f6; padding: 4px 8px;">${claimCode}</code></p>
  <p><strong>Verification code (OTP):</strong> <code style="background: #f3f4f6; padding: 4px 8px;">${otp}</code></p>
  <p>Use the link below to verify and choose how to receive your funds (crypto or fiat).</p>
  <p><a href="${claimLinkUrl}" style="display: inline-block; padding: 10px 20px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px;">Claim now</a></p>
  <p style="color: #666; font-size: 12px;">Do not share your OTP. This code expires in 10 minutes.</p>
</body>
</html>
  `.trim();
}

export function claimNotificationText(vars: ClaimNotificationTemplateVars): string {
  const { amount, currency, claimCode, otp, claimLinkUrl } = vars;
  return `You have ${amount} ${currency} to claim. Code: ${claimCode}. OTP: ${otp}. Claim: ${claimLinkUrl}. OTP expires in 10 min.`;
}
