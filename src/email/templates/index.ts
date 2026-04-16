/**
 * Email templates index. Grouped by feature for easy access.
 */

export {
  paymentRequestSubject,
  paymentRequestHtml,
  paymentRequestText,
  type PaymentRequestTemplateVars,
} from "./payment-request.js";

export {
  claimNotificationSubject,
  claimNotificationHtml,
  claimNotificationText,
  type ClaimNotificationTemplateVars,
} from "./claim-notification.js";

export {
  businessMagicLinkSubject,
  businessMagicLinkHtml,
  businessMagicLinkText,
  type BusinessMagicLinkTemplateVars,
} from "./business-magic-link.js";

export {
  businessTeamInviteSubject,
  businessTeamInviteHtml,
  businessTeamInviteText,
  type BusinessTeamInviteTemplateVars,
} from "./business-team-invite.js";

export {
  MESSAGE_BUBBLE_IMG,
  EMAIL_TEAL,
  EMAIL_PRODUCT_NAME,
  EMAIL_HTML_BODY_STYLE,
  EMAIL_CARD_TABLE_STYLE,
  emailLayoutShellStart,
  emailLayoutShellEnd,
} from "./message-style.js";
