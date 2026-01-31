/**
 * Payment provider server: validation, session tracking, and provider calls.
 *
 * Use validation before creating a poll or adding a transaction to Redis/DB.
 * Session-based providers (e.g. PayStack) are linked via providerSessionId on Transaction;
 * on payment success we trigger the next process (e.g. send USDC from Klyra to user).
 *
 * Flows:
 * - Buy USDC (base) with momo (PayStack): PayStack session → on success → Klyra sends USDC to user.
 * - Request to be paid: f_provider = ANY (payer pays by any means), t_provider = KLYRA (we send on-chain to requestor).
 *   If payer pays via Squid (USDT on Arbitrum), Squid transacts from payer wallet to requestor destination.
 */

import type { PaymentProvider, IdentityType, TransactionType } from "../../prisma/generated/prisma/client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProviderPayload = {
  action: "buy" | "sell" | "request" | "claim";
  fromIdentifier?: string | null;
  fromType?: IdentityType | null;
  toIdentifier?: string | null;
  toType?: IdentityType | null;
  f_provider: PaymentProvider;
  t_provider: PaymentProvider;
  f_chain?: string;
  t_chain?: string;
  f_token?: string;
  t_token?: string;
};

export type ValidationResult =
  | { valid: true }
  | { valid: false; error: string; code?: string };

/** Providers that use an external session (we must track session and link to transaction). */
export const SESSION_TRACKING_PROVIDERS: PaymentProvider[] = [
  "PAYSTACK",
  // Add LIFI, SQUID etc. when they use session-based flows
];

/** Fiat currency symbols that are not on-chain tokens. KLYRA (on-chain) cannot send/receive these as tokens. */
export const FIAT_CURRENCIES = ["GHS", "USD", "NGN", "KES", "ZAR"] as const;

function isFiatCurrency(token: string): boolean {
  return FIAT_CURRENCIES.includes(token.toUpperCase().trim() as (typeof FIAT_CURRENCIES)[number]);
}

function sameTokenSameChain(
  fromChain: string | undefined,
  toChain: string | undefined,
  fromToken: string | undefined,
  toToken: string | undefined
): boolean {
  if (!fromChain || !toChain || !fromToken || !toToken) return false;
  return (
    fromChain.trim() === toChain.trim() &&
    fromToken.toLowerCase().trim() === toToken.toLowerCase().trim()
  );
}

/** Which identity types each provider expects for "from" and "to" identifiers. */
export const PROVIDER_IDENTITY_RULES: Record<
  PaymentProvider,
  { from: IdentityType[]; to: IdentityType[] }
> = {
  NONE: { from: [], to: [] },
  ANY: { from: ["ADDRESS", "EMAIL", "NUMBER"], to: ["ADDRESS", "EMAIL", "NUMBER"] },
  KLYRA: { from: [], to: ["ADDRESS"] }, // We send on-chain; destination must be wallet address
  SQUID: { from: ["ADDRESS"], to: ["ADDRESS"] }, // User wallet → destination address
  LIFI: { from: ["ADDRESS"], to: ["ADDRESS"] },
  PAYSTACK: { from: ["NUMBER", "EMAIL"], to: ["NUMBER", "EMAIL"] }, // Momo / bank / email
};

// ---------------------------------------------------------------------------
// Validation (use before creating poll or adding transaction to Redis/DB)
// ---------------------------------------------------------------------------

/**
 * Validate provider and identifier rules for the given payload.
 * Exceptions:
 * - CLAIM: user can claim to any provider → relax t_provider/t_identifier.
 * - REQUEST: f_provider can be ANY (payer pays by any means); t_provider is typically KLYRA (we send on-chain to requestor).
 */
export function validateProviderPayload(payload: ProviderPayload): ValidationResult {
  const {
    action,
    fromIdentifier,
    fromType,
    toIdentifier,
    toType,
    f_provider,
    t_provider,
    f_chain,
    t_chain,
    f_token,
    t_token,
  } = payload;

  const type = action.toUpperCase() as TransactionType;

  // ---- Currencies vs tokens: KLYRA (on-chain) cannot send/receive fiat as token ----
  if (f_provider === "KLYRA" && f_token && isFiatCurrency(f_token)) {
    return {
      valid: false,
      error: `${f_token} is a currency, not an on-chain token; KLYRA cannot send fiat`,
      code: "FIAT_NOT_ALLOWED_AS_TOKEN",
    };
  }
  if (t_provider === "KLYRA" && t_token && isFiatCurrency(t_token)) {
    return {
      valid: false,
      error: `${t_token} is a currency, not an on-chain token; KLYRA cannot receive fiat`,
      code: "FIAT_NOT_ALLOWED_AS_TOKEN",
    };
  }

  // ---- Same token on same chain is not allowed (no-op swap) ----
  if (sameTokenSameChain(f_chain, t_chain, f_token, t_token)) {
    return {
      valid: false,
      error: "Same token on same chain is not allowed; swap must be to a different token or chain",
      code: "SAME_TOKEN_SAME_CHAIN",
    };
  }

  // ---- CLAIM: allow claim to any provider; identifiers can be flexible ----
  if (type === "CLAIM") {
    return { valid: true };
  }

  // ---- REQUEST: f_provider can be ANY; t_provider typically KLYRA (we send to user on-chain) ----
  if (type === "REQUEST") {
    if (f_provider !== "ANY" && f_provider !== "NONE") {
      // If caller already set a specific f_provider, still validate to_ side
    }
    const toRules = PROVIDER_IDENTITY_RULES[t_provider];
    if (t_provider !== "ANY" && t_provider !== "NONE" && toRules.to.length > 0) {
      if (!toIdentifier?.trim()) {
        return { valid: false, error: "REQUEST requires toIdentifier when t_provider is set", code: "MISSING_TO_IDENTIFIER" };
      }
      if (toType && !toRules.to.includes(toType)) {
        return {
          valid: false,
          error: `t_provider ${t_provider} expects toType one of: ${toRules.to.join(", ")}`,
          code: "INVALID_TO_TYPE",
        };
      }
    }
    return { valid: true };
  }

  // ---- BUY / SELL / TRANSFER: strict provider ↔ identifier rules ----

  const fromRules = PROVIDER_IDENTITY_RULES[f_provider];
  const toRules = PROVIDER_IDENTITY_RULES[t_provider];

  if (f_provider !== "NONE" && f_provider !== "ANY" && fromRules.from.length > 0) {
    if (!fromIdentifier?.trim()) {
      return {
        valid: false,
        error: `f_provider ${f_provider} requires fromIdentifier (e.g. phone/bank for PayStack)`,
        code: "MISSING_FROM_IDENTIFIER",
      };
    }
    if (fromType && !fromRules.from.includes(fromType)) {
      return {
        valid: false,
        error: `f_provider ${f_provider} expects fromType one of: ${fromRules.from.join(", ")}`,
        code: "INVALID_FROM_TYPE",
      };
    }
  }

  if (t_provider !== "NONE" && t_provider !== "ANY" && toRules.to.length > 0) {
    if (!toIdentifier?.trim()) {
      return {
        valid: false,
        error: `t_provider ${t_provider} requires toIdentifier (e.g. wallet address for Klyra, phone for PayStack)`,
        code: "MISSING_TO_IDENTIFIER",
      };
    }
    if (toType && !toRules.to.includes(toType)) {
      return {
        valid: false,
        error: `t_provider ${t_provider} expects toType one of: ${toRules.to.join(", ")}`,
        code: "INVALID_TO_TYPE",
      };
    }
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Mock provider calls (replace with real integrations later)
// ---------------------------------------------------------------------------

export type InitiatePaymentInput = {
  provider: PaymentProvider;
  transactionId: string;
  amount: string;
  currency: string;
  toIdentifier?: string;
  toType?: IdentityType;
  metadata?: Record<string, string>;
};

export type InitiatePaymentResult =
  | { ok: true; sessionId: string; redirectUrl?: string }
  | { ok: false; error: string };

/**
 * Mock: initiate a payment with the given provider (e.g. create PayStack session).
 * Session-based providers return sessionId; store it on Transaction.providerSessionId.
 */
export async function initiatePayment(
  _input: InitiatePaymentInput
): Promise<InitiatePaymentResult> {
  // TODO: wire to PayStack/LIFI/Squid etc.
  if (_input.provider === "PAYSTACK") {
    return {
      ok: true,
      sessionId: `mock_ps_${_input.transactionId}_${Date.now()}`,
      redirectUrl: "https://checkout.paystack.com/mock",
    };
  }
  if (_input.provider === "KLYRA") {
    // Klyra is our own balance; no external session
    return { ok: true, sessionId: "" };
  }
  return {
    ok: true,
    sessionId: `mock_${_input.provider}_${_input.transactionId}`,
  };
}

export type CheckSessionStatusInput = {
  provider: PaymentProvider;
  sessionId: string;
};

export type SessionStatus = "pending" | "success" | "failed" | "expired";

export type CheckSessionStatusResult =
  | { ok: true; status: SessionStatus }
  | { ok: false; error: string };

/**
 * Mock: check external provider session status (e.g. PayStack transaction status).
 * When status === "success", trigger next process (e.g. send USDC from Klyra to user).
 */
export async function checkSessionStatus(
  _input: CheckSessionStatusInput
): Promise<CheckSessionStatusResult> {
  // TODO: call provider API (PayStack verify, etc.)
  return {
    ok: true,
    status: "pending",
  };
}

/**
 * Mock: execute Klyra on-chain send (same-chain; we have balance → send token to user address).
 * Call this after session-based provider confirms payment (e.g. PayStack success).
 */
export type KlyraSendInput = {
  transactionId: string;
  chain: string;
  token: string;
  amount: string;
  toAddress: string;
};

export type KlyraSendResult =
  | { ok: true; txHash?: string }
  | { ok: false; error: string };

export async function klyraSend(_input: KlyraSendInput): Promise<KlyraSendResult> {
  // TODO: use wallet-manager to send from our wallet to toAddress
  return { ok: true, txHash: `0xmock_${_input.transactionId}` };
}

/**
 * Whether this provider uses session tracking (link sessionId to transaction).
 */
export function requiresSessionTracking(provider: PaymentProvider): boolean {
  return SESSION_TRACKING_PROVIDERS.includes(provider);
}
