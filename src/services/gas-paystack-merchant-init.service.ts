/**
 * Start Paystack for a merchant-owned gas top-up payment link (metadata GAS_TOPUP_FIAT).
 * Mirrors commerce Paystack initialize without duplicating the full HTTP route.
 */

import type { IdentityType, MerchantEnvironment, PaymentProvider, TransactionType } from "../../prisma/generated/prisma/client.js";
import type { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "../lib/prisma.js";
import { getEnv } from "../config/env.js";
import { initializePayment, isPaystackConfigured } from "./paystack.service.js";
import { paymentLinkAmountIsOpen } from "../lib/payment-link-amount-open.js";
import { parsePaymentLinkPurpose } from "./clearing-balance.service.js";

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function formatPayerIdentity(
  payerEmail: string | undefined,
  payerWallet: string | undefined,
  platformFallback: string
): { fromIdentifier: string; fromType: IdentityType } {
  const w = payerWallet?.trim() ?? "";
  const walletOk = w && EVM_ADDRESS_RE.test(w) ? w : "";
  const e = (payerEmail ?? "").trim().toLowerCase();
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

export async function startGasTopupPaystackForMerchant(params: {
  businessId: string;
  paymentLinkId: string;
  payerEmail?: string | null;
  payerWallet?: string | null;
  callbackUrl?: string | null;
}): Promise<
  | { ok: true; authorization_url: string; access_code: string; reference: string; transaction_id: string }
  | { ok: false; error: string; status?: number; code?: string }
> {
  if (!isPaystackConfigured()) {
    return { ok: false, error: "Paystack is not configured.", status: 503, code: "PAYSTACK_NOT_CONFIGURED" };
  }
  const platformPaystackEmail = getEnv().PAYSTACK_PLATFORM_EMAIL?.trim().toLowerCase() ?? "";
  if (!platformPaystackEmail || !platformPaystackEmail.includes("@")) {
    return { ok: false, error: "PAYSTACK_PLATFORM_EMAIL is not set.", status: 400, code: "PAYSTACK_PLATFORM_EMAIL_REQUIRED" };
  }

  const link = await prisma.paymentLink.findFirst({
    where: { id: params.paymentLinkId.trim(), businessId: params.businessId, isActive: true },
  });
  if (!link) {
    return { ok: false, error: "Payment link not found.", status: 404 };
  }
  const purpose = parsePaymentLinkPurpose(link.metadata ?? null);
  if (purpose !== "GAS_TOPUP_FIAT") {
    return { ok: false, error: "Invalid gas top-up link.", status: 400 };
  }
  if (link.isOneTime && link.paidAt != null) {
    return { ok: false, error: "This link has already been paid.", status: 409, code: "PAYMENT_LINK_ALREADY_PAID" };
  }

  const currency = link.currency.trim().toUpperCase();
  const open = paymentLinkAmountIsOpen(link.amount as Decimal | null);
  if (open || link.amount == null) {
    return { ok: false, error: "Invalid gas link amount.", status: 400 };
  }
  const majorAmount = Number(link.amount);
  if (!Number.isFinite(majorAmount) || majorAmount <= 0) {
    return { ok: false, error: "Invalid amount.", status: 400 };
  }
  const amountSubunits = Math.round(majorAmount * 100);
  if (amountSubunits < 100) {
    return { ok: false, error: "Amount must be at least 1 unit.", status: 400 };
  }

  const payerIdentity = formatPayerIdentity(
    params.payerEmail ?? undefined,
    params.payerWallet ?? undefined,
    platformPaystackEmail
  );

  const environment: MerchantEnvironment = link.environment;
  const chargeKindUpper = (link.chargeKind ?? "FIAT").toString().toUpperCase();
  const isCommerceCrypto = chargeKindUpper === "CRYPTO";
  const t_amount = isCommerceCrypto ? majorAmount : 0;

  let ourTransactionId: string;
  try {
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
        t_chain: "BASE",
        f_token: currency,
        t_token: "USDC",
        f_provider: "PAYSTACK" as PaymentProvider,
        t_provider: "NONE",
        providerPrice: null,
        businessId: link.businessId,
        environment,
        paymentLinkId: link.id,
      },
    });
    ourTransactionId = tx.id;
  } catch {
    return { ok: false, error: "Failed to create transaction.", status: 500, code: "PAYSTACK_TRANSACTION_CREATE_FAILED" };
  }

  try {
    const result = await initializePayment({
      email: platformPaystackEmail,
      amount: amountSubunits,
      currency,
      callback_url: params.callbackUrl?.trim() || undefined,
      metadata: {
        transaction_id: ourTransactionId,
        ...(params.payerEmail?.trim() ? { payer_email: params.payerEmail.trim().toLowerCase() } : {}),
      },
    });
    await prisma.transaction.update({
      where: { id: ourTransactionId },
      data: { providerSessionId: result.reference },
    });
    return {
      ok: true,
      authorization_url: result.authorization_url,
      access_code: result.access_code,
      reference: result.reference,
      transaction_id: ourTransactionId,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Paystack initialization failed.";
    return { ok: false, error: msg, status: 502, code: "PAYSTACK_INITIALIZE_FAILED" };
  }
}
