/**
 * Email template: claim notification (receiver notified to claim funds).
 * Design: "You have a new message" style, message-bubble hero, responsive, no header/footer.
 */

const MESSAGE_BUBBLE_IMG = "https://d1oco4z2z1fhwp.cloudfront.net/templates/default/1371/Img3_2x.jpg";
const TEAL = "#0d9488";

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
<body style="margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f1f5f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 6px rgba(0,0,0,0.05);">
    <tr>
      <td style="padding:32px 24px 24px; text-align:center;">
        <img src="${MESSAGE_BUBBLE_IMG}" alt="" width="160" height="160" style="max-width:100%; height:auto; display:block; margin:0 auto 24px; border-radius:12px;" />
        <h1 style="margin:0 0 8px; font-size:22px; font-weight:600; color:#1e293b;">You have a new message</h1>
        <div style="height:3px; width:48px; background:${TEAL}; margin:0 auto 24px; border-radius:2px;"></div>
      </td>
    </tr>
    <tr>
      <td style="padding:0 24px 24px;">
        <div style="background:#f0fdfa; border-radius:10px; padding:20px; border-left:4px solid ${TEAL};">
          <p style="margin:0 0 12px; font-size:15px; color:#334155;">Someone sent you <strong>${amount} ${currency}</strong>.</p>
          <p style="margin:0 0 8px; font-size:14px; color:#475569;"><strong style="color:#1e293b;">Claim code:</strong> <code style="background:#e2e8f0; padding:4px 10px; border-radius:6px; font-size:14px;">${claimCode}</code></p>
          <p style="margin:0 0 12px; font-size:14px; color:#475569;"><strong style="color:#1e293b;">Verification code (OTP):</strong> <code style="background:#e2e8f0; padding:4px 10px; border-radius:6px; font-size:14px;">${otp}</code></p>
          <p style="margin:0; font-size:14px; color:#475569;">Use the link below to verify and choose how to receive your funds (crypto or fiat).</p>
        </div>
        <p style="margin:24px 0 0; text-align:center;">
          <a href="${claimLinkUrl}" style="display:inline-block; padding:12px 28px; background:${TEAL}; color:#ffffff; text-decoration:none; font-weight:600; font-size:15px; border-radius:8px;">Claim now</a>
        </p>
        <p style="margin:20px 0 0; color:#94a3b8; font-size:12px; text-align:center;">Do not share your OTP. This code expires in 10 minutes.</p>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

export function claimNotificationText(vars: ClaimNotificationTemplateVars): string {
  const { amount, currency, claimCode, otp, claimLinkUrl } = vars;
  return `You have ${amount} ${currency} to claim. Code: ${claimCode}. OTP: ${otp}. Claim: ${claimLinkUrl}. OTP expires in 10 min.`;
}
