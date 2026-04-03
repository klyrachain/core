/**
 * Paystack payment initialization. Returns authorization URL for frontend redirect.
 * Uses PAYSTACK_PLATFORM_EMAIL for Paystack's `email` field so payers are not emailed by Paystack;
 * payer email is stored on Transaction and in metadata only.
 * Commerce (payment_link_id): platform-settled fiat (Paystack); FIAT and CRYPTO charge kinds both
 * record amounts in DB without on-chain send to the merchant.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { initializePayment, isPaystackConfigured } from "../../services/paystack.service.js";
import { getEnv } from "../../config/env.js";
import { successEnvelope } from "../../lib/api-helpers.js";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import { PERMISSION_CONNECT_TRANSACTIONS } from "../../lib/permissions.js";
import type {
  IdentityType,
  MerchantEnvironment,
  PaymentProvider,
  TransactionType,
} from "../../../prisma/generated/prisma/client.js";
import type { Decimal } from "@prisma/client/runtime/client";
import { paymentLinkAmountIsOpen } from "../../lib/payment-link-amount-open.js";

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function formatCommercePayerIdentifier(
  payerEmail: string,
  payerWallet: string | undefined,
  platformFallback: string
): { fromIdentifier: string; fromType: IdentityType } {
  const w = payerWallet?.trim() ?? "";
  const walletOk = w && EVM_ADDRESS_RE.test(w) ? w : "";
  const e = payerEmail.trim().toLowerCase();
  if (e && walletOk) {
    return { fromIdentifier: `${e} · ${walletOk}`, fromType: "EMAIL" };
  }
  if (walletOk) {
    return { fromIdentifier: walletOk, fromType: "ADDRESS" };
  }
  if (e) {
    return { fromIdentifier: e, fromType: "EMAIL" };
  }
  return { fromIdentifier: platformFallback, fromType: "EMAIL" };
}

const PAYSTACK_CHANNEL_ENUM = z.enum([
  "card",
  "bank",
  "apple_pay",
  "ussd",
  "qr",
  "mobile_money",
  "bank_transfer",
  "eft",
  "payattitude",
]);

const InitializeBodySchema = z
  .object({
    email: z.string().email().optional(),
    customer_email: z.string().email().optional(),
    amount: z.coerce.number().positive().optional(),
    currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "currency must be a 3-letter code").optional().default("NGN"),
    callback_url: z.string().url().optional(),
    channels: z.array(PAYSTACK_CHANNEL_ENUM).optional(),
    transaction_id: z.string().uuid().optional(),
    /** Commerce: server loads amount/currency from this PaymentLink (fixed) or validates open link + payer amount. */
    payment_link_id: z.string().uuid().optional(),
    /** Required for open-amount CRYPTO charge links: quoted crypto amount to settle (matches checkout UI). */
    settlement_crypto_amount: z.coerce.number().positive().optional(),
    /** Optional connected EVM wallet (checkout); combined with email in fromIdentifier when both present. */
    payer_wallet: z
      .string()
      .trim()
      .optional()
      .refine((s) => !s || EVM_ADDRESS_RE.test(s), "payer_wallet must be a 42-char 0x EVM address"),
    metadata: z.record(z.union([z.string(), z.number()])).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.payment_link_id && data.transaction_id) {
      ctx.addIssue({
        code: "custom",
        message: "Provide either payment_link_id or transaction_id, not both.",
        path: ["payment_link_id"],
      });
    }
    if (!data.payment_link_id && !data.transaction_id && data.amount == null) {
      ctx.addIssue({
        code: "custom",
        message: "amount is required unless payment_link_id or transaction_id is set.",
        path: ["amount"],
      });
    }
  });

export async function paystackPaymentsApiRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: unknown }>(
    "/api/paystack/payments/initialize",
    async (req: FastifyRequest<{ Body: unknown }>, reply) => {
      if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS, { allowMerchant: true })) return;
      if (!isPaystackConfigured()) {
        return reply.status(503).send({
          success: false,
          error: "Paystack is not configured. Set PAYSTACK_SECRET_KEY.",
        });
      }
      const parse = InitializeBodySchema.safeParse(req.body);
      if (!parse.success) {
        return reply.status(400).send({
          success: false,
          error: "Validation failed",
          details: parse.error.flatten(),
        });
      }
      const {
        email,
        customer_email: customerEmail,
        amount: bodyAmount,
        currency: bodyCurrency,
        callback_url,
        channels,
        transaction_id,
        payment_link_id,
        settlement_crypto_amount: settlementCryptoAmountBody,
        payer_wallet: payerWalletRaw,
        metadata,
      } = parse.data;

      const platformPaystackEmail = getEnv().PAYSTACK_PLATFORM_EMAIL?.trim().toLowerCase() ?? "";
      if (!platformPaystackEmail || !platformPaystackEmail.includes("@")) {
        req.log.warn(
          { route: "paystack.initialize" },
          "Paystack initialize blocked: PAYSTACK_PLATFORM_EMAIL not set in Core env"
        );
        return reply.status(400).send({
          success: false,
          error: "Card payment isn’t available right now. Please pay with crypto or try again later.",
          code: "PAYSTACK_PLATFORM_EMAIL_REQUIRED",
        });
      }

      const payerEmail =
        customerEmail?.trim().toLowerCase() ?? email?.trim().toLowerCase() ?? "";
      const payerWallet =
        payerWalletRaw && EVM_ADDRESS_RE.test(payerWalletRaw.trim())
          ? payerWalletRaw.trim()
          : undefined;
      const payerIdentity = formatCommercePayerIdentifier(
        payerEmail,
        payerWallet,
        platformPaystackEmail
      );

      let currency = (bodyCurrency ?? "NGN").trim().toUpperCase();
      const channelsNormalized = channels?.map((channel) => channel.trim().toLowerCase());
      let majorAmount: number | undefined = bodyAmount;
      let commerceLink: {
        id: string;
        businessId: string;
        environment: MerchantEnvironment;
        amount: Decimal | null;
        currency: string;
        chargeKind: string | null;
        isOneTime: boolean;
        paidAt: Date | null;
      } | null = null;

      if (payment_link_id) {
        const link = await prisma.paymentLink.findFirst({
          where: { id: payment_link_id.trim(), isActive: true },
          select: {
            id: true,
            businessId: true,
            environment: true,
            amount: true,
            currency: true,
            chargeKind: true,
            isOneTime: true,
            paidAt: true,
          },
        });
        if (!link) {
          return reply.status(404).send({
            success: false,
            error: "Payment link not found or inactive.",
          });
        }
        commerceLink = link;
        if (link.isOneTime && link.paidAt != null) {
          return reply.status(409).send({
            success: false,
            error: "This one-time payment link has already been paid.",
            code: "PAYMENT_LINK_ALREADY_PAID",
          });
        }
        const open = paymentLinkAmountIsOpen(link.amount);
        const chargeKind = (link.chargeKind ?? "FIAT").toString().toUpperCase();
        if (chargeKind === "CRYPTO") {
          if (majorAmount == null) {
            req.log.warn({ payment_link_id }, "Paystack init: missing amount for CRYPTO link (PAYSTACK_FIAT_QUOTE_REQUIRED)");
            return reply.status(400).send({
              success: false,
              error: "Choose an amount and currency, or pay with crypto instead.",
              code: "PAYSTACK_FIAT_QUOTE_REQUIRED",
            });
          }
          if (!bodyCurrency?.trim()) {
            req.log.warn({ payment_link_id }, "Paystack init: missing currency for CRYPTO link (PAYSTACK_FIAT_QUOTE_REQUIRED)");
            return reply.status(400).send({
              success: false,
              error: "Choose a currency before continuing, or pay with crypto instead.",
              code: "PAYSTACK_FIAT_QUOTE_REQUIRED",
            });
          }
          if (open && (settlementCryptoAmountBody == null || !Number.isFinite(settlementCryptoAmountBody))) {
            req.log.warn({ payment_link_id }, "Paystack init: open CRYPTO link missing settlement_crypto_amount");
            return reply.status(400).send({
              success: false,
              error: "This checkout couldn’t load the payment amount. Refresh the page or pay with crypto.",
              code: "SETTLEMENT_CRYPTO_AMOUNT_REQUIRED",
            });
          }
        } else if (open) {
          currency = link.currency.trim().toUpperCase();
          if (majorAmount == null) {
            return reply.status(400).send({
              success: false,
              error: "amount is required for open-amount payment links.",
            });
          }
        } else {
          currency = link.currency.trim().toUpperCase();
          if (link.amount == null) {
            return reply.status(400).send({
              success: false,
              error: "Invalid payment link amount.",
            });
          }
          majorAmount = Number(link.amount);
        }
      }

      if (majorAmount == null || !Number.isFinite(majorAmount) || majorAmount <= 0) {
        return reply.status(400).send({
          success: false,
          error: "Invalid amount.",
        });
      }

      const amountSubunits = payment_link_id
        ? Math.round(majorAmount * 100)
        : Number.isInteger(majorAmount) && majorAmount >= 100
          ? majorAmount
          : Math.round(majorAmount * 100);
      if (amountSubunits < 100) {
        return reply.status(400).send({
          success: false,
          error: "Amount must be at least 1 unit (100 subunits).",
        });
      }

      const chargeKindUpper = commerceLink
        ? (commerceLink.chargeKind ?? "FIAT").toString().toUpperCase()
        : null;
      const openForCommerce = commerceLink
        ? paymentLinkAmountIsOpen(commerceLink.amount as Decimal | null)
        : false;

      let settlementCryptoMajor: number | null = null;
      if (commerceLink && chargeKindUpper === "CRYPTO") {
        if (!openForCommerce && commerceLink.amount != null) {
          settlementCryptoMajor = Number(commerceLink.amount);
        } else if (settlementCryptoAmountBody != null && Number.isFinite(settlementCryptoAmountBody)) {
          settlementCryptoMajor = settlementCryptoAmountBody;
        }
        if (
          settlementCryptoMajor == null ||
          !Number.isFinite(settlementCryptoMajor) ||
          settlementCryptoMajor <= 0
        ) {
          req.log.warn(
            { payment_link_id: payment_link_id ?? null, open: openForCommerce },
            "Paystack initialize: SETTLEMENT_CRYPTO_AMOUNT_REQUIRED (missing crypto amount for CRYPTO link)"
          );
          return reply.status(400).send({
            success: false,
            error: "This checkout couldn’t load the payment amount. Refresh the page or pay with crypto.",
            code: "SETTLEMENT_CRYPTO_AMOUNT_REQUIRED",
          });
        }
      }

      let ourTransactionId = transaction_id;
      if (!ourTransactionId) {
        try {
          const isCommerceCrypto = commerceLink && chargeKindUpper === "CRYPTO";
          const t_amount = isCommerceCrypto && settlementCryptoMajor != null ? settlementCryptoMajor : 0;
          const t_chain = "BASE";
          const t_token = "USDC";
          const tx = await prisma.transaction.create({
            data: {
              type: "BUY" as TransactionType,
              status: "PENDING",
              fromIdentifier: payerIdentity.fromIdentifier,
              fromType: payerIdentity.fromType,
              toIdentifier: null,
              toType: null,
              f_amount: amountSubunits / 100,
              t_amount,
              exchangeRate: 1,
              f_tokenPriceUsd: 1,
              t_tokenPriceUsd: 1,
              f_chain: "MOMO",
              t_chain,
              f_token: currency,
              t_token,
              f_provider: "PAYSTACK" as PaymentProvider,
              t_provider: "NONE",
              providerPrice: null,
              businessId: commerceLink?.businessId ?? null,
              environment: commerceLink?.environment ?? "LIVE",
              paymentLinkId: commerceLink?.id ?? null,
            },
          });
          ourTransactionId = tx.id;
        } catch (err) {
          req.log.error({ err }, "Create transaction for Paystack initialize");
          return reply.status(500).send({
            success: false,
            error: "Failed to create transaction.",
            code: "PAYSTACK_TRANSACTION_CREATE_FAILED",
          });
        }
      } else {
        const existing = await prisma.transaction.findUnique({
          where: { id: ourTransactionId },
        });
        if (!existing) {
          return reply.status(404).send({
            success: false,
            error: "Transaction not found.",
          });
        }
        await prisma.transaction.update({
          where: { id: ourTransactionId },
          data: {
            providerSessionId: null,
            fromIdentifier: payerIdentity.fromIdentifier,
            fromType: payerIdentity.fromType,
          },
        });
      }

      try {
        let result;
        try {
          result = await initializePayment({
            email: platformPaystackEmail,
            amount: amountSubunits,
            currency,
            callback_url,
            channels: channelsNormalized,
            metadata: {
              transaction_id: ourTransactionId,
              ...(payerEmail ? { payer_email: payerEmail } : {}),
              ...(metadata ?? {}),
            },
          });
        } catch (initErr) {
          const msg = initErr instanceof Error ? initErr.message.toLowerCase() : "";
          if (channelsNormalized?.length && msg.includes("channel")) {
            req.log.warn(
              {
                payment_link_id: payment_link_id ?? null,
                transaction_id: ourTransactionId ?? null,
                currency,
                channels: channelsNormalized,
              },
              "Retrying Paystack initialize without explicit channels"
            );
            result = await initializePayment({
              email: platformPaystackEmail,
              amount: amountSubunits,
              currency,
              callback_url,
              metadata: {
                transaction_id: ourTransactionId,
                ...(payerEmail ? { payer_email: payerEmail } : {}),
                ...(metadata ?? {}),
              },
            });
          } else {
            throw initErr;
          }
        }

        await prisma.transaction.update({
          where: { id: ourTransactionId },
          data: { providerSessionId: result.reference },
        });

        return successEnvelope(
          reply,
          {
            authorization_url: result.authorization_url,
            access_code: result.access_code,
            reference: result.reference,
            transaction_id: ourTransactionId,
          },
          201
        );
      } catch (err) {
        const paystackResponse =
          err && typeof err === "object" && "paystackResponse" in err
            ? (err as { paystackResponse?: { message?: string } }).paystackResponse
            : undefined;
        req.log.error(
          {
            err,
            context: {
              payment_link_id: payment_link_id ?? null,
              transaction_id: ourTransactionId ?? null,
              payment_link_charge_kind:
                commerceLink?.chargeKind?.toString().toUpperCase() ?? null,
              payment_link_currency: commerceLink?.currency ?? null,
              payment_link_environment: commerceLink?.environment ?? null,
              currency,
              channels: channelsNormalized ?? null,
              amountSubunits,
              runtime_env: process.env.NODE_ENV ?? "unknown",
            },
          },
          "Paystack initialize"
        );
        const msg = err instanceof Error ? err.message : "Paystack initialization failed.";
        const normalized = msg.toLowerCase();
        const code = normalized.includes("no active channel")
          ? "PAYSTACK_NO_ACTIVE_CHANNEL"
          : normalized.includes("channel")
            ? "PAYSTACK_INVALID_CHANNELS"
            : normalized.includes("currency")
              ? "PAYSTACK_INVALID_CURRENCY"
              : "PAYSTACK_INITIALIZE_FAILED";
        req.log.error(
          { code, paystackMessage: paystackResponse?.message, errMessage: msg },
          "Paystack initialize upstream error (client gets generic message)"
        );
        return reply.status(502).send({
          success: false,
          error: "We couldn’t start the payment with our provider. Please try again in a moment.",
          code,
          detail: undefined,
        });
      }
    }
  );
}
