import {
  EMAIL_PRODUCT_NAME,
  EMAIL_TEAL,
  MESSAGE_BUBBLE_IMG,
  emailLayoutShellEnd,
  emailLayoutShellStart,
} from "./message-style.js";

export type PublicContactTemplateVars = {
  name: string;
  email: string;
  company?: string;
  topic: string;
  message: string;
  submittedAtIso: string;
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function publicContactTeamSubject(vars: Pick<PublicContactTemplateVars, "topic">): string {
  return `[${EMAIL_PRODUCT_NAME} contact] ${vars.topic}`;
}

export function publicContactTeamHtml(vars: PublicContactTemplateVars): string {
  const companyLine =
    vars.company && vars.company.trim().length > 0
      ? `<p style="margin:0 0 8px;"><strong>Company:</strong> ${esc(vars.company.trim())}</p>`
      : "";
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
${emailLayoutShellStart()}
    <tr>
      <td style="padding:32px 24px 16px; text-align:center;">
        <img src="${MESSAGE_BUBBLE_IMG}" alt="" width="120" height="120" style="max-width:100%; height:auto; display:block; margin:0 auto 16px; border-radius:12px;" />
        <h1 style="margin:0 0 8px; font-size:20px; font-weight:600; color:#1e293b;">New contact form message</h1>
        <div style="height:3px; width:48px; background:${EMAIL_TEAL}; margin:0 auto 16px; border-radius:2px;"></div>
      </td>
    </tr>
    <tr>
      <td style="padding:0 24px 28px;">
        <div style="background:#f8fafc; border-radius:10px; padding:18px; border:1px solid #e2e8f0;">
          <p style="margin:0 0 8px;"><strong>From:</strong> ${esc(vars.name)} &lt;${esc(vars.email)}&gt;</p>
          ${companyLine}
          <p style="margin:0 0 8px;"><strong>Topic:</strong> ${esc(vars.topic)}</p>
          <p style="margin:0 0 8px; color:#64748b; font-size:12px;">Received: ${esc(vars.submittedAtIso)}</p>
          <hr style="border:none; border-top:1px solid #e2e8f0; margin:16px 0;" />
          <p style="margin:0; white-space:pre-wrap; font-size:14px; color:#334155; line-height:1.5;">${esc(vars.message)}</p>
        </div>
        <p style="margin:16px 0 0; color:#94a3b8; font-size:12px;">Reply directly to this email to respond to the sender (Reply-To is set).</p>
      </td>
    </tr>
${emailLayoutShellEnd()}
</html>
  `.trim();
}

export function publicContactTeamText(vars: PublicContactTemplateVars): string {
  const lines = [
    `From: ${vars.name} <${vars.email}>`,
    vars.company?.trim() ? `Company: ${vars.company.trim()}` : "",
    `Topic: ${vars.topic}`,
    `Time: ${vars.submittedAtIso}`,
    "",
    vars.message,
  ].filter(Boolean);
  return lines.join("\n");
}

export function publicContactAckSubject(): string {
  return `We received your message — ${EMAIL_PRODUCT_NAME}`;
}

export function publicContactAckHtml(vars: { name: string }): string {
  const name = esc(vars.name.trim() || "there");
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
${emailLayoutShellStart()}
    <tr>
      <td style="padding:32px 24px 16px; text-align:center;">
        <img src="${MESSAGE_BUBBLE_IMG}" alt="" width="120" height="120" style="max-width:100%; height:auto; display:block; margin:0 auto 16px; border-radius:12px;" />
        <h1 style="margin:0 0 8px; font-size:20px; font-weight:600; color:#1e293b;">Thanks, ${name}</h1>
        <div style="height:3px; width:48px; background:${EMAIL_TEAL}; margin:0 auto 16px; border-radius:2px;"></div>
      </td>
    </tr>
    <tr>
      <td style="padding:0 24px 28px;">
        <div style="background:#f0fdfa; border-radius:10px; padding:20px; border-left:4px solid ${EMAIL_TEAL};">
          <p style="margin:0; font-size:15px; color:#334155; line-height:1.55;">
            We have received your message and will respond as soon as we can. If your request is urgent, include any relevant transaction or account details in a follow-up reply.
          </p>
        </div>
        <p style="margin:20px 0 0; color:#94a3b8; font-size:12px; text-align:center;">This is an automated confirmation — please do not reply to this email if your client blocks unknown senders; use the address you contacted us from instead.</p>
      </td>
    </tr>
${emailLayoutShellEnd()}
</html>
  `.trim();
}

export function publicContactAckText(): string {
  return `Thanks — we received your message and will get back to you as soon as we can.\n\n— ${EMAIL_PRODUCT_NAME}`;
}
