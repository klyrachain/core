/**
 * Peer-ramp app: OTP email (message-style layout).
 */

import {
  EMAIL_TEAL,
  MESSAGE_BUBBLE_IMG,
  emailLayoutShellEnd,
  emailLayoutShellStart,
} from "./message-style.js";

export function peerRampAppOtpSubject(): string {
  return "Your Morapay verification code";
}

export function peerRampAppOtpEmailHtml(vars: { code: string }): string {
  const code = vars.code.trim();
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verification code</title>
</head>
${emailLayoutShellStart()}
    <tr>
      <td style="padding:32px 24px 24px; text-align:center;">
        <img src="${MESSAGE_BUBBLE_IMG}" alt="" width="160" height="160" style="max-width:100%; height:auto; display:block; margin:0 auto 24px; border-radius:12px;" />
        <h1 style="margin:0 0 8px; font-size:22px; font-weight:600; color:#1e293b;">Verify your email</h1>
        <div style="height:3px; width:48px; background:${EMAIL_TEAL}; margin:0 auto 24px; border-radius:2px;"></div>
      </td>
    </tr>
    <tr>
      <td style="padding:0 24px 24px;">
        <div style="background:#f0fdfa; border-radius:10px; padding:24px; border-left:4px solid ${EMAIL_TEAL}; text-align:center;">
          <p style="margin:0 0 12px; font-size:15px; color:#334155;">Use this code in Morapay:</p>
          <p style="margin:0; font-size:28px; font-weight:700; letter-spacing:0.2em; color:#0f766e; font-family:ui-monospace,monospace;">${code}</p>
          <p style="margin:16px 0 0; font-size:13px; color:#64748b;">Expires in 10 minutes. If you didn’t request this, you can ignore this email.</p>
        </div>
      </td>
    </tr>
${emailLayoutShellEnd()}
</html>
  `.trim();
}
