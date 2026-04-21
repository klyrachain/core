/**
 * Notification dispatcher: sends payment-request and claim-notification via selected channels (EMAIL, SMS, WHATSAPP).
 * Email via Resend (templates in email/templates); SMS/WhatsApp via Sent.dm (templates in Sent dashboard).
 */

import type { NotificationChannel } from "../lib/notification.types.js";
import { sendEmail } from "./email.service.js";
import { sendMessageToPhone } from "./sent.service.js";
import { getEnv } from "../config/env.js";
import {
  paymentRequestSubject,
  paymentRequestHtml,
  paymentRequestText,
  type PaymentRequestTemplateVars,
} from "../email/templates/payment-request.js";
import {
  claimNotificationSubject,
  claimNotificationHtml,
  claimNotificationText,
  type ClaimNotificationTemplateVars,
} from "../email/templates/claim-notification.js";
import {
  requestPaymentReceivedSubject,
  requestPaymentReceivedHtml,
  requestPaymentReceivedText,
  requestSettledToRequesterSubject,
  requestSettledToRequesterHtml,
  requestSettledToRequesterText,
  type RequestPaymentReceivedTemplateVars,
  type RequestSettledToRequesterTemplateVars,
} from "../email/templates/request-settled.js";
import {
  paymentLinkPayerReceiptSubject,
  paymentLinkPayerReceiptHtml,
  paymentLinkPayerReceiptText,
  type PaymentLinkPayerReceiptVars,
} from "../email/templates/payment-link-payer-receipt.js";
import {
  paymentLinkMerchantReceiptSubject,
  paymentLinkMerchantReceiptHtml,
  paymentLinkMerchantReceiptText,
  type PaymentLinkMerchantReceiptVars,
} from "../email/templates/payment-link-merchant-receipt.js";

export type PaymentRequestNotificationPayload = {
  channels: NotificationChannel[];
  /** Payer email (for EMAIL channel) */
  toEmail: string;
  /** Payer phone E.164 (for SMS/WHATSAPP). Optional if only EMAIL. */
  toPhone?: string;
  entityRefId: string;
  templateVars: PaymentRequestTemplateVars;
};

export type ClaimNotificationPayload = {
  channels: NotificationChannel[];
  /** Receiver email (for EMAIL) */
  toEmail: string;
  /** Receiver phone (for SMS/WHATSAPP) */
  toPhone?: string;
  entityRefId: string;
  templateVars: ClaimNotificationTemplateVars;
};

function buildClaimLink(path: string): string {
  const env = getEnv();
  const base = env.FRONTEND_APP_URL.replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Send payment-request notification to payer (email and/or SMS/WhatsApp).
 */
export async function sendPaymentRequestNotification(
  payload: PaymentRequestNotificationPayload
): Promise<{ email?: SendResult; sms?: SendResult; whatsapp?: SendResult }> {
  const results: { email?: SendResult; sms?: SendResult; whatsapp?: SendResult } = {};
  const linkUrl = payload.templateVars.claimLinkUrl; // caller should set via buildClaimLink

  for (const ch of payload.channels) {
    if (ch === "EMAIL") {
      const r = await sendEmail({
        to: payload.toEmail,
        subject: paymentRequestSubject(payload.templateVars),
        html: paymentRequestHtml(payload.templateVars),
        text: paymentRequestText(payload.templateVars),
        entityRefId: payload.entityRefId,
      });
      results.email = r.ok ? { ok: true } : { ok: false, error: r.error };
    } else if ((ch === "SMS" || ch === "WHATSAPP") && payload.toPhone) {
      const templateId = getEnv().SENT_DM_TEMPLATE_PAYMENT_REQUEST;
      if (!templateId) {
        results[ch === "SMS" ? "sms" : "whatsapp"] = { ok: false, error: "Sent.dm payment-request template not configured" };
        continue;
      }
      const r = await sendMessageToPhone({
        phoneNumber: payload.toPhone,
        templateId,
        templateVariables: {
          link: linkUrl,
          amount: payload.templateVars.amount,
          currency: payload.templateVars.currency,
          receiveSummary: payload.templateVars.receiveSummary,
        },
      });
      results[ch === "SMS" ? "sms" : "whatsapp"] = r.ok ? { ok: true } : { ok: false, error: r.error };
    }
  }
  return results;
}

/**
 * Send claim notification to receiver (email and/or SMS/WhatsApp) with claim link and OTP.
 */
export async function sendClaimNotification(
  payload: ClaimNotificationPayload
): Promise<{ email?: SendResult; sms?: SendResult; whatsapp?: SendResult }> {
  const results: { email?: SendResult; sms?: SendResult; whatsapp?: SendResult } = {};
  const linkUrl = payload.templateVars.claimLinkUrl;

  for (const ch of payload.channels) {
    if (ch === "EMAIL") {
      const r = await sendEmail({
        to: payload.toEmail,
        subject: claimNotificationSubject(payload.templateVars),
        html: claimNotificationHtml(payload.templateVars),
        text: claimNotificationText(payload.templateVars),
        entityRefId: payload.entityRefId,
      });
      results.email = r.ok ? { ok: true } : { ok: false, error: r.error };
    } else if ((ch === "SMS" || ch === "WHATSAPP") && payload.toPhone) {
      const templateId = getEnv().SENT_DM_TEMPLATE_CLAIM_NOTIFICATION;
      if (!templateId) {
        results[ch === "SMS" ? "sms" : "whatsapp"] = { ok: false, error: "Sent.dm claim template not configured" };
        continue;
      }
      const r = await sendMessageToPhone({
        phoneNumber: payload.toPhone,
        templateId,
        templateVariables: {
          link: linkUrl,
          claimCode: payload.templateVars.claimCode,
          otp: payload.templateVars.otp,
          amount: payload.templateVars.amount,
          currency: payload.templateVars.currency,
        },
      });
      const key = ch === "SMS" ? "sms" : "whatsapp";
      if (r.ok) {
        results[key] = { ok: true };
        continue;
      }
      if (ch === "SMS") {
        const { isLikelyMoolreSmsDestination, isMoolreSmsConfigured, sendMoolrePlainSms } = await import(
          "./moolre-sms.service.js"
        );
        if (isMoolreSmsConfigured() && isLikelyMoolreSmsDestination(payload.toPhone)) {
          const plain = `Morapay claim: ${payload.templateVars.amount} ${payload.templateVars.currency}. OTP ${payload.templateVars.otp}. Code ${payload.templateVars.claimCode}. ${linkUrl}`.slice(0, 459);
          const m = await sendMoolrePlainSms(payload.toPhone, plain);
          results.sms = m.ok ? { ok: true } : { ok: false, error: `${r.error}; Moolre: ${m.error}` };
        } else {
          results.sms = { ok: false, error: r.error };
        }
      } else {
        results.whatsapp = { ok: false, error: r.error };
      }
    }
  }
  return results;
}

export type SendResult = { ok: true } | { ok: false; error: string };

/**
 * Send "We received your payment" to payer (after request is settled to requester).
 */
export async function sendRequestPaymentReceivedToPayer(
  toEmail: string,
  vars: RequestPaymentReceivedTemplateVars,
  entityRefId: string
): Promise<SendResult> {
  const r = await sendEmail({
    to: toEmail,
    subject: requestPaymentReceivedSubject(vars),
    html: requestPaymentReceivedHtml(vars),
    text: requestPaymentReceivedText(vars),
    entityRefId,
  });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/**
 * Send "You've been paid" to requester (after request is settled).
 */
export async function sendRequestSettledToRequester(
  toEmail: string,
  vars: RequestSettledToRequesterTemplateVars,
  entityRefId: string
): Promise<SendResult> {
  const r = await sendEmail({
    to: toEmail,
    subject: requestSettledToRequesterSubject(vars),
    html: requestSettledToRequesterHtml(vars),
    text: requestSettledToRequesterText(vars),
    entityRefId,
  });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/**
 * After Paystack charge.success for commerce BUY: payer + merchant receipts (best-effort; failures ignored).
 */
export async function sendPaymentLinkPaystackSuccessEmails(opts: {
  transactionId: string;
  paystackReference: string;
  /** Prefer metadata payer_email; avoid sending to platform inbox. */
  payerEmail: string | null;
  platformPaystackEmail: string | null;
  fiatAmount: number;
  fiatCurrency: string;
  merchantSupportEmail: string | null;
  businessName: string;
  linkTitle: string;
  linkPublicCode: string;
  /** When true, merchant receives gas prepaid copy instead of generic commerce receipt. */
  merchantGasPrepaidTopup?: boolean;
}): Promise<void> {
  const amountLabel = `${opts.fiatAmount} ${opts.fiatCurrency}`.trim();
  const platform = opts.platformPaystackEmail?.trim().toLowerCase() ?? "";

  const payerVars: PaymentLinkPayerReceiptVars = {
    amountLabel,
    orderReference: opts.paystackReference,
    transactionId: opts.transactionId,
  };

  let payerTo = opts.payerEmail?.trim().toLowerCase() ?? "";
  if (!payerTo.includes("@")) payerTo = "";
  if (platform && payerTo === platform) payerTo = "";

  if (payerTo) {
    await sendEmail({
      to: payerTo,
      subject: paymentLinkPayerReceiptSubject(payerVars),
      html: paymentLinkPayerReceiptHtml(payerVars),
      text: paymentLinkPayerReceiptText(payerVars),
      entityRefId: `${opts.transactionId}:payer-fiat-success`,
      idempotencyKey: `${opts.transactionId}:payer-fiat-success`,
    }).catch(() => {});
  }

  const merchantTo = opts.merchantSupportEmail?.trim() ?? "";
  if (merchantTo.includes("@")) {
    if (opts.merchantGasPrepaidTopup) {
      const subject = `Prepaid gas credited — ${amountLabel}`;
      const text = [
        `Hi ${opts.businessName},`,
        "",
        `Your prepaid gas balance was increased by ${amountLabel} after Paystack reference ${opts.paystackReference}.`,
        `Transaction id: ${opts.transactionId}.`,
        "",
        "If you did not initiate this top-up, contact support immediately.",
      ].join("\n");
      const html = `<p>Hi ${escapeHtml(opts.businessName)},</p><p>Your <strong>prepaid gas</strong> balance was increased by <strong>${escapeHtml(
        amountLabel
      )}</strong> after Paystack reference <code>${escapeHtml(opts.paystackReference)}</code>.</p><p>Transaction id: <code>${escapeHtml(
        opts.transactionId
      )}</code>.</p><p>If you did not initiate this top-up, contact support immediately.</p>`;
      await sendEmail({
        to: merchantTo,
        subject,
        html,
        text,
        entityRefId: `${opts.transactionId}:merchant-gas-prepaid-topup`,
        idempotencyKey: `${opts.transactionId}:merchant-gas-prepaid-topup`,
      }).catch(() => {});
    } else {
      const mVars: PaymentLinkMerchantReceiptVars = {
        businessName: opts.businessName,
        amountLabel,
        linkLabel: `${opts.linkTitle} (${opts.linkPublicCode})`,
        transactionId: opts.transactionId,
      };
      await sendEmail({
        to: merchantTo,
        subject: paymentLinkMerchantReceiptSubject(mVars),
        html: paymentLinkMerchantReceiptHtml(mVars),
        text: paymentLinkMerchantReceiptText(mVars),
        entityRefId: `${opts.transactionId}:merchant-fiat-success`,
        idempotencyKey: `${opts.transactionId}:merchant-fiat-success`,
      }).catch(() => {});
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Build frontend URL for payment request (payer pays here). */
export function buildPaymentRequestLink(linkId: string): string {
  return buildClaimLink(`/pay/request/${linkId}`);
}

/** Build frontend URL for claim (receiver claims here). Uses opaque `claimLinkId` only — never put the share `code` in the URL. */
export function buildClaimLinkByClaimLinkId(claimLinkId: string): string {
  return buildClaimLink(`/claim/${claimLinkId.trim()}`);
}
