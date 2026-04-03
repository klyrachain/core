import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_URL: z.string().min(1, "DIRECT_URL is required"),

  REDIS_URL: z.string().url().optional().default("redis://localhost:6379"),

  ENCRYPTION_KEY: z.string().min(32, "ENCRYPTION_KEY must be at least 32 characters"),

  PUSHER_APP_ID: z.string().optional().default(""),
  PUSHER_KEY: z.string().optional().default(""),
  PUSHER_SECRET: z.string().optional().default(""),
  PUSHER_CLUSTER: z.string().optional().default("mt1"),

  ADMIN_WEBHOOK_URL: z.string().optional().default(""),

  /** 0x Swap API key (for POST /api/quote/swap provider 0x). Optional; if missing, 0x quotes return 503. */
  ZEROX_API_KEY: z.string().min(1).optional(),

  /** Squid Router integrator ID (for POST /api/quote/swap provider squid). Optional; if missing, Squid quotes return 503. */
  SQUID_INTEGRATOR_ID: z.string().min(1).optional(),
  /** Squid: address to receive integrator fees (0x + 40 hex). Fee must be enabled for your integrator ID by Squid. */
  SQUID_FEE_RECIPIENT: z.string().min(1).optional(),
  /** Squid: integrator fee in basis points (e.g. 50 = 0.5%). Sent in collectFees.fee when SQUID_FEE_RECIPIENT is set. */
  SQUID_FEE_BPS: z.coerce.number().int().min(0).max(10000).optional(),

  /** LiFi API key (for POST /api/quote/swap provider lifi). Optional; higher rate limits when set. */
  LIFI_API_KEY: z.string().min(1).optional(),
  /** LiFi: integrator string for fee collection (tied to fee wallet in LiFi Portal). Default "klyra". */
  LIFI_INTEGRATOR: z.string().min(1).optional(),
  /** LiFi: integrator fee as decimal (e.g. 0.005 = 0.5%). Taken from sending asset. */
  LIFI_FEE_PERCENT: z.coerce.number().min(0).max(1).optional(),

  /** Paystack secret key for account verification, banks, transfers. Optional; if missing, Paystack routes return 503. */
  PAYSTACK_SECRET_KEY: z.string().min(1).optional(),
  /**
   * Required for POST /api/paystack/payments/initialize: this address is sent to Paystack as the customer email
   * so Paystack notifications go to your platform inbox; the payer’s email is stored on the transaction only.
   */
  PAYSTACK_PLATFORM_EMAIL: z.string().email().optional(),

  /** Fonbnk API for onramp fiat↔crypto quotes. Optional; if missing, onramp quote returns 503. */
  FONBNK_API_URL: z.string().optional(),
  FONBNK_CLIENT_ID: z.string().optional(),
  FONBNK_CLIENT_SECRET: z.string().optional(),
  FONBNK_TIMEOUT_MS: z.coerce.number().positive().optional(),

  /** ExchangeRate-API key for fiat↔fiat (USD pivot). Optional; used for non–Fonbnk countries. */
  EXCHANGERATE_API_KEY: z.string().min(1).optional(),

  /** WebAuthn (passkey) RP ID for admin dashboard. Default localhost for dev. */
  ADMIN_RP_ID: z.string().min(1).optional(),
  /** WebAuthn origin fallback when request Origin is not in allowlist. Default http://localhost:PORT. */
  ADMIN_ORIGIN: z.string().url().optional(),
  /** Comma-separated allowed origins for WebAuthn (admin dashboard URL(s), e.g. http://localhost:3000,https://admin.example.com). */
  ADMIN_ALLOWED_ORIGINS: z.string().optional(),

  /** Testnet-only: when set (e.g. "1"), onramp/request send uses Base Sepolia for orders where t_chain is "BASE SEPOLIA". Mainnet (BASE) is never affected. */
  ONRAMP_TESTNET_SEND: z.string().optional(),
  /** Testnet-only: private key for Base Sepolia send. Used only when ONRAMP_TESTNET_SEND is set and order t_chain is BASE SEPOLIA. */
  TESTNET_SEND_PRIVATE_KEY: z.string().min(1).optional(),
  /** RPC URL for Base mainnet (chainId 8453). Used for transaction verification. */
  BASE_RPC_URL: z.string().url().optional(),
  /** RPC URL for Base Sepolia (chainId 84532). Defaults to https://sepolia.base.org when not set. */
  BASE_SEPOLIA_RPC_URL: z.string().url().optional(),
  /** For testnet: when user enters "amount in USD" for ETH, convert using this rate (e.g. 3000 = 1 ETH = 3000 USD). If unset, t_amount is treated as ETH amount. */
  TESTNET_ETH_USD_RATE: z.coerce.number().positive().optional(),

  /** Resend: API key for transactional email. Optional; if missing, email service no-ops or logs. */
  RESEND_API_KEY: z.string().min(1).optional(),
  /** Resend: from address (e.g. noreply@mail.yourdomain.com). Use a verified domain at resend.com/domains to send to any recipient. When unset, uses Resend testing sender (onboarding@resend.dev), which can only send to your own email. */
  RESEND_FROM_EMAIL: z.string().min(1).optional(),

  /** Sent.dm: API key for SMS/WhatsApp. Optional; if missing, messaging service no-ops. */
  SENT_DM_API_KEY: z.string().min(1).optional(),
  /** Sent.dm: sender/customer identifier (x-sender-id header). */
  SENT_DM_SENDER_ID: z.string().min(1).optional(),
  /** Sent.dm: template UUID for payment-request message (SMS/WhatsApp). Variables: link, amount, currency, receiveSummary. */
  SENT_DM_TEMPLATE_PAYMENT_REQUEST: z.string().uuid().optional(),
  /** Sent.dm: template UUID for claim-notification message. Variables: claimCode, otp, link, amount, currency. */
  SENT_DM_TEMPLATE_CLAIM_NOTIFICATION: z.string().uuid().optional(),

  /** Frontend app base URL for payment/claim links (e.g. https://app.example.com). Used in email/SMS templates. */
  FRONTEND_APP_URL: z.string().url().optional().default("http://localhost:3000"),

  /** Payer checkout app origin (no trailing slash), e.g. https://pay.example.com. Exposed read-only via GET /api/meta/checkout-base-url. */
  CHECKOUT_BASE_URL: z.string().url().optional(),

  /** When true, periodically re-verify stale Paystack commerce pendings (requires PAYSTACK_SECRET_KEY). */
  PAYSTACK_RECONCILE_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  /** Interval for Paystack commerce reconciliation (ms). Default 5 minutes. */
  PAYSTACK_RECONCILE_INTERVAL_MS: z.coerce.number().int().positive().optional().default(300_000),
  /** Minimum age before a PENDING row is eligible (ms). Default 2 minutes to avoid racing initialize. */
  PAYSTACK_RECONCILE_MIN_AGE_MS: z.coerce.number().int().positive().optional().default(120_000),
  /** Max rows per reconciliation tick. */
  PAYSTACK_RECONCILE_MAX_BATCH: z.coerce.number().int().min(1).max(200).optional().default(30),

  /** HMAC secret for business portal JWT (signup / dashboard session). Defaults to ENCRYPTION_KEY. */
  BUSINESS_PORTAL_JWT_SECRET: z.string().min(32).optional(),

  /** HMAC for checkout gas-usage report tokens (defaults to ENCRYPTION_KEY if unset). */
  GAS_REPORT_HMAC_SECRET: z.string().min(32).optional(),

  /** Google OAuth for business signup (optional; omit to disable “Continue with Google”). */
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  /**
   * Must match Google Cloud console redirect URI exactly, e.g.
   * https://api.example.com/api/business-auth/google/callback
   */
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),

  /**
   * After Google OAuth, redirect here with ?portal_token= (dashboard route).
   * Production: set explicitly (e.g. https://app.example.com/business/signup).
   * Development: defaults to http://localhost:3001/business/signup when unset.
   */
  BUSINESS_SIGNUP_LANDING_URL: z.string().url().optional(),

  /**
   * Optional: force magic-link emails to Core’s /signup/business (e.g. http://127.0.0.1:4003).
   * Only used when BUSINESS_SIGNUP_LANDING_URL is unset. If landing URL is set, magic links use that instead.
   */
  BUSINESS_MAGIC_LINK_BASE_URL: z.string().url().optional(),

  /** WebAuthn RP ID for business portal passkeys (hostname only, e.g. localhost or app.example.com). */
  BUSINESS_WEBAUTHN_RP_ID: z.string().min(1).optional(),
  /** Comma-separated origins allowed for business portal WebAuthn (e.g. http://localhost:3000). */
  BUSINESS_WEBAUTHN_ORIGINS: z.string().optional(),

  /**
   * Optional: override swap quote `fromAddress` used for server-side route estimates
   * when the user has not connected a wallet. Must be a valid EVM address.
   */
  QUOTE_ESTIMATE_FROM_ADDRESS: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let env: Env;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
    throw new Error(`Invalid environment: ${msg}`);
  }
  const d = parsed.data;
  env = {
    ...d,
    BUSINESS_SIGNUP_LANDING_URL:
      d.BUSINESS_SIGNUP_LANDING_URL ??
      (d.NODE_ENV === "development" ? "http://localhost:3001/business/signup" : undefined),
  };
  return env;
}

export function getEnv(): Env {
  if (!env) {
    throw new Error("Env not loaded. Call loadEnv() at startup.");
  }
  return env;
}
