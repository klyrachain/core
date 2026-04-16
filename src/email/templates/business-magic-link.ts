import {
  EMAIL_PRODUCT_NAME,
  EMAIL_TEAL,
  MESSAGE_BUBBLE_IMG,
  emailLayoutShellEnd,
  emailLayoutShellStart,
} from "./message-style.js";

export type BusinessMagicLinkTemplateVars = {
  magicLinkUrl: string;
};

function hrefAttr(url: string): string {
  return url.replace(/"/g, "&quot;");
}

export function businessMagicLinkSubject(): string {
  return `Sign in to ${EMAIL_PRODUCT_NAME} for Business`;
}

export function businessMagicLinkHtml(vars: BusinessMagicLinkTemplateVars): string {
  const href = hrefAttr(vars.magicLinkUrl);
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign in | ${EMAIL_PRODUCT_NAME}</title>
</head>
${emailLayoutShellStart()}
    <tr>
      <td style="padding:32px 24px 24px; text-align:center;">
        <img src="${MESSAGE_BUBBLE_IMG}" alt="" width="160" height="160" style="max-width:100%; height:auto; display:block; margin:0 auto 24px; border-radius:12px;" />
        <h1 style="margin:0 0 8px; font-size:22px; font-weight:600; color:#1e293b;">Continue to ${EMAIL_PRODUCT_NAME}</h1>
        <div style="height:3px; width:48px; background:${EMAIL_TEAL}; margin:0 auto 24px; border-radius:2px;"></div>
      </td>
    </tr>
    <tr>
      <td style="padding:0 24px 24px;">
        <div style="background:#f0fdfa; border-radius:10px; padding:20px; border-left:4px solid ${EMAIL_TEAL};">
          <p style="margin:0 0 12px; font-size:15px; color:#334155;">Use the button below to sign in to ${EMAIL_PRODUCT_NAME} for Business. This magic link expires in 15 minutes.</p>
        </div>
        <p style="margin:24px 0 0; text-align:center;">
          <a href="${href}" style="display:inline-block; padding:12px 28px; background:${EMAIL_TEAL}; color:#ffffff; text-decoration:none; font-weight:600; font-size:15px; border-radius:8px;">Continue to ${EMAIL_PRODUCT_NAME}</a>
        </p>
        <p style="margin:20px 0 0; color:#94a3b8; font-size:12px; text-align:center;">If you did not request this, you can ignore this email.</p>
      </td>
    </tr>
${emailLayoutShellEnd()}
</html>
  `.trim();
}

export function businessMagicLinkText(vars: BusinessMagicLinkTemplateVars): string {
  return `Continue your business sign-in (link expires in 15 minutes): ${vars.magicLinkUrl}`;
}
