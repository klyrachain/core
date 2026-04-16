/**
 * Shared payment request creation (platform Connect + merchant payment links).
 * Sets transaction.businessId when the caller is a merchant.
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { MerchantEnvironment } from "../../prisma/generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { normalizeNotificationChannels } from "../lib/notification.types.js";
import { sendPaymentRequestNotification, buildPaymentRequestLink } from "./notification.service.js";
import { generateClaimCode } from "../utils/claim-code.js";

const PayoutFiatSchema = z.object({
  type: z.enum(["nuban", "mobile_money"]),
  account_name: z.string().min(1, "account_name is required (verified via Paystack resolve/validate)"),
  account_number: z.string().min(1, "account_number is required"),
  bank_code: z.string().min(1).optional(),
  currency: z.string().min(1),
});

export const CreatePaymentRequestBodySchema = z.object({
  payerEmail: z.string().email(),
  payerPhone: z.string().min(1).optional(),
  channels: z
    .union([z.array(z.enum(["EMAIL", "SMS", "WHATSAPP"])), z.enum(["EMAIL", "SMS", "WHATSAPP"])])
    .optional(),
  t_amount: z.coerce.number().positive(),
  t_chain: z.string().min(1),
  t_token: z.string().min(1),
  toIdentifier: z.string().min(1),
  receiveSummary: z.string().min(1),
  payoutTarget: z.string().min(1).optional(),
  payoutFiat: PayoutFiatSchema.optional(),
  f_chain: z.string().min(1).optional(),
  f_token: z.string().min(1).optional(),
  f_amount: z.coerce.number().positive().optional(),
  skipPaymentRequestNotification: z.boolean().optional(),
});

export type CreatePaymentRequestBody = z.infer<typeof CreatePaymentRequestBodySchema>;

export type CreatePaymentRequestResult = {
  id: string;
  code: string;
  linkId: string;
  transactionId: string;
  claimId: string;
  claimCode: string;
  payLink: string;
  notification: Record<string, unknown>;
};

export async function createPaymentRequest(
  body: CreatePaymentRequestBody,
  options: { businessId?: string | null; environment?: MerchantEnvironment }
): Promise<CreatePaymentRequestResult> {
  const channels = normalizeNotificationChannels(body.channels);
  const linkId = randomBytes(8).toString("hex");
  const requestCode = `REQ${randomBytes(4).toString("hex").toUpperCase()}`;
  const claimCode = generateClaimCode();

  const isSenderPaysCrypto =
    body.f_chain != null &&
    body.f_token != null &&
    body.f_amount != null &&
    body.f_chain.toUpperCase() !== "MOMO" &&
    body.f_chain.toUpperCase() !== "BANK";
  const f_chain = isSenderPaysCrypto ? body.f_chain! : "MOMO";
  const f_token = isSenderPaysCrypto ? body.f_token! : "GHS";
  const f_amount = isSenderPaysCrypto ? body.f_amount! : 0;

  const businessId = options.businessId ?? undefined;
  const environment: MerchantEnvironment = options.environment ?? "LIVE";

  const transaction = await prisma.transaction.create({
    data: {
      type: "REQUEST",
      status: "PENDING",
      f_amount,
      t_amount: body.t_amount,
      f_chain,
      t_chain: body.t_chain,
      f_token,
      t_token: body.t_token,
      f_provider: isSenderPaysCrypto ? "KLYRA" : "PAYSTACK",
      t_provider: "KLYRA",
      fromIdentifier: body.payerEmail,
      fromType: "EMAIL",
      toIdentifier: body.toIdentifier,
      toType: body.toIdentifier.includes("@") ? "EMAIL" : "NUMBER",
      businessId: businessId ?? null,
      environment,
    },
  });

  const payoutFiatJson =
    body.payoutFiat != null ? (JSON.parse(JSON.stringify(body.payoutFiat)) as object) : undefined;

  const request = await prisma.request.create({
    data: {
      code: requestCode,
      linkId,
      transactionId: transaction.id,
      payoutTarget: body.payoutTarget ?? undefined,
      payoutFiat: payoutFiatJson ?? undefined,
      businessId: businessId ?? undefined,
      environment,
    },
  });

  await prisma.transaction.update({
    where: { id: transaction.id },
    data: { requestId: request.id },
  });

  const claim = await prisma.claim.create({
    data: {
      requestId: request.id,
      status: "ACTIVE",
      value: body.t_amount,
      price: 1,
      token: body.t_token,
      payerIdentifier: body.payerEmail,
      toIdentifier: body.toIdentifier,
      code: claimCode,
    },
  });

  const claimLinkUrl = buildPaymentRequestLink(linkId);
  const results = body.skipPaymentRequestNotification
    ? {}
    : await sendPaymentRequestNotification({
        channels,
        toEmail: body.payerEmail,
        toPhone: body.payerPhone,
        entityRefId: request.id,
        templateVars: {
          requesterIdentifier: body.toIdentifier,
          amount: String(body.t_amount),
          currency: body.t_token,
          receiveSummary: body.receiveSummary,
          claimLinkUrl,
        },
      });

  return {
    id: request.id,
    code: request.code,
    linkId: request.linkId,
    transactionId: transaction.id,
    claimId: claim.id,
    claimCode: claim.code,
    payLink: claimLinkUrl,
    notification: results,
  };
}
