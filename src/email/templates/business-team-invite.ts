import {
  EMAIL_PRODUCT_NAME,
  EMAIL_TEAL,
  MESSAGE_BUBBLE_IMG,
  emailLayoutShellEnd,
  emailLayoutShellStart,
} from "./message-style.js";

export type BusinessTeamInviteTemplateVars = {
  businessName: string;
  inviteUrl: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hrefAttr(url: string): string {
  return url.replace(/"/g, "&quot;");
}

export function businessTeamInviteSubject(vars: BusinessTeamInviteTemplateVars): string {
  return `You're invited to ${vars.businessName} on ${EMAIL_PRODUCT_NAME}`;
}

export function businessTeamInviteHtml(vars: BusinessTeamInviteTemplateVars): string {
  const name = escapeHtml(vars.businessName);
  const href = hrefAttr(vars.inviteUrl);
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Team invitation | ${EMAIL_PRODUCT_NAME}</title>
</head>
${emailLayoutShellStart()}
    <tr>
      <td style="padding:32px 24px 24px; text-align:center;">
        <img src="${MESSAGE_BUBBLE_IMG}" alt="" width="160" height="160" style="max-width:100%; height:auto; display:block; margin:0 auto 24px; border-radius:12px;" />
        <h1 style="margin:0 0 8px; font-size:22px; font-weight:600; color:#1e293b;">You're invited</h1>
        <div style="height:3px; width:48px; background:${EMAIL_TEAL}; margin:0 auto 24px; border-radius:2px;"></div>
      </td>
    </tr>
    <tr>
      <td style="padding:0 24px 24px;">
        <div style="background:#f0fdfa; border-radius:10px; padding:20px; border-left:4px solid ${EMAIL_TEAL};">
          <p style="margin:0; font-size:15px; color:#334155;">You've been invited to join <strong>${name}</strong> on ${EMAIL_PRODUCT_NAME}.</p>
        </div>
        <p style="margin:24px 0 0; text-align:center;">
          <a href="${href}" style="display:inline-block; padding:12px 28px; background:${EMAIL_TEAL}; color:#ffffff; text-decoration:none; font-weight:600; font-size:15px; border-radius:8px;">Accept invitation</a>
        </p>
        <p style="margin:20px 0 0; color:#94a3b8; font-size:12px; text-align:center;">If the link does not work, open your dashboard and use the invite token from your administrator.</p>
      </td>
    </tr>
${emailLayoutShellEnd()}
</html>
  `.trim();
}

export function businessTeamInviteText(vars: BusinessTeamInviteTemplateVars): string {
  return `You've been invited to join ${vars.businessName} on ${EMAIL_PRODUCT_NAME}. Open: ${vars.inviteUrl}`;
}
