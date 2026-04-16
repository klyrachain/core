/**
 * Shared hero image, accent, and HTML shell for “new message” style transactional emails.
 */

export const MESSAGE_BUBBLE_IMG =
  "https://d1oco4z2z1fhwp.cloudfront.net/templates/default/1371/Img3_2x.jpg";

export const EMAIL_TEAL = "#0d9488";

export const EMAIL_PRODUCT_NAME = "Morapay";

/** No gray canvas: matches typical clients; vertical padding + horizontal gutter on narrow viewports. */
export const EMAIL_HTML_BODY_STYLE =
  "margin:0;padding:16px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#ffffff;-webkit-text-size-adjust:100%;";

/** Centered card: fluid up to 560px, light border so it reads on white clients. */
export const EMAIL_CARD_TABLE_STYLE =
  "max-width:560px;width:100%;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 1px 2px rgba(0,0,0,0.04);";

export function emailLayoutShellStart(): string {
  return `<body style="${EMAIL_HTML_BODY_STYLE}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
    <tr>
      <td align="center" style="padding:0 16px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${EMAIL_CARD_TABLE_STYLE}">`;
}

export function emailLayoutShellEnd(): string {
  return `
        </table>
      </td>
    </tr>
  </table>
</body>`;
}
