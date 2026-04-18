import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_URL: z.string().min(1, "DIRECT_URL is required"),

  /**
   * Redis connection string. If unset, Core will build one from
   * REDIS_HOST/REDIS_PORT/REDIS_USERNAME/REDIS_PASSWORD (+ REDIS_TLS).
   * If set without userinfo, `REDIS_PASSWORD` (and optional `REDIS_USERNAME`) are merged in (Redis Cloud).
   */
  REDIS_URL: z.string().url().optional(),
  /** Redis host (used only when REDIS_URL is unset). */
  REDIS_HOST: z.string().min(1).optional(),
  /** Redis port (used only when REDIS_URL is unset). */
  REDIS_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  /** Redis username (used only when REDIS_URL is unset). */
  REDIS_USERNAME: z.string().min(1).optional(),
  /** Redis password (used only when REDIS_URL is unset). */
  REDIS_PASSWORD: z.string().min(1).optional(),
  /** When true, use rediss:// (TLS) for the built Redis URL. */
  REDIS_TLS: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),

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
  /** TTL (ms) for cached `latest/USD` bulk table. Default 600000 (10 minutes). */
  EXCHANGERATE_CACHE_TTL_MS: z.coerce.number().int().positive().optional(),

  /**
   * WebAuthn RP ID: hostname only (no port), e.g. `localhost` or `admin.example.com`.
   * Must match the host you open the **admin dashboard** in (the RP ID is not the Core API host).
   */
  ADMIN_RP_ID: z.string().min(1).optional(),
  /** Default origin when building WebAuthn config if the request has no Origin. */
  ADMIN_ORIGIN: z.string().url().optional(),
  /**
   * Comma-separated full origins for the admin UI (scheme + host + port), e.g.
   * `http://localhost:3001,http://127.0.0.1:3001` for klyra-admin on 3001.
   * Must include the exact tab origin or passkey registration fails with SecurityError (logged server-side).
   */
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
  /**
   * Optional full Resend `from` string, e.g. `"Morapay Business" <noreply@morapay.com>`.
   * When set, overrides per-template display names and RESEND_FROM_*_DISPLAY_NAME.
   */
  RESEND_FROM: z.string().min(1).optional(),
  /**
   * Display name for **general** transactional mail (receipts, peer ramp, payment links, etc.).
   * Default when unset: `Morapay`.
   */
  RESEND_FROM_DISPLAY_NAME: z.string().min(1).max(120).optional(),
  /**
   * Display name for **business** mail (portal magic link, team invites).
   * Default when unset: `Morapay Business`.
   */
  RESEND_FROM_BUSINESS_DISPLAY_NAME: z.string().min(1).max(120).optional(),

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

  /** Inbox for POST /api/public/contact (marketing site). If unset, endpoint returns 503. */
  CONTACT_INBOX_EMAIL: z.string().email().optional(),

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

  /**
   * WebAuthn RP ID for business portal passkeys (hostname only, e.g. `business.example.com`).
   * When unset, Core derives RP ID from the request `Origin` hostname (so Vercel previews work).
   * For strict control, set this and `BUSINESS_WEBAUTHN_ORIGINS` explicitly in production.
   */
  BUSINESS_WEBAUTHN_RP_ID: z.string().min(1).optional(),
  /** Comma-separated origins allowed for business portal WebAuthn (e.g. http://localhost:3000). */
  BUSINESS_WEBAUTHN_ORIGINS: z.string().optional(),

  /**
   * Optional: override swap quote `fromAddress` used for server-side route estimates
   * when the user has not connected a wallet. Must be a valid EVM address.
   */
  QUOTE_ESTIMATE_FROM_ADDRESS: z.string().optional(),

  /** When "1" or "true", core starts BullMQ worker for peer-ramp match queue (requires Redis). */
  PEER_RAMP_WORKER_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),

  /** Base Sepolia (test): platform USDC escrow address for peer offramp instructions (0x + 40 hex). */
  PEER_RAMP_PLATFORM_ESCROW_ADDRESS: z.string().optional(),
  /**
   * Optional: private key for the escrow EOA (must match PEER_RAMP_PLATFORM_ESCROW_ADDRESS).
   * Peer-ramp onramp USDC sends use this wallet so delivery txs are escrow→user. If unset, TESTNET_SEND_PRIVATE_KEY is used and must match the escrow address when both are set.
   */
  PEER_RAMP_ESCROW_SENDER_PRIVATE_KEY: z.string().min(1).optional(),

  /** HMAC secret for peer-ramp app session JWT after email OTP (defaults to ENCRYPTION_KEY). */
  PEER_RAMP_APP_JWT_SECRET: z.string().min(32).optional(),
  /** Peer-ramp app session length in seconds (default 24h). */
  PEER_RAMP_APP_SESSION_SECONDS: z.coerce.number().int().positive().optional().default(86_400),
  /** Minimum seconds between OTP emails per address (default 60). */
  PEER_RAMP_APP_OTP_COOLDOWN_SECONDS: z.coerce.number().int().min(10).optional().default(60),

  // ── KYC providers ───────────────────────────────────────────────────────────

  /** DIDIT: x-api-key for https://verification.didit.me/v3/ */
  DIDIT_API_KEY: z.string().min(1).optional(),
  /** DIDIT: Client ID from the Didit Console (identifies your application). */
  DIDIT_CLIENT_ID: z.string().uuid().optional(),
  /**
   * DIDIT: Workflow for **Peer Ramp consumer person KYC** (ramp app users, `PeerRampAppUser`).
   * Not the business-portal merchant flow — that uses `User.portalKyc*` and separate product surfaces.
   */
  DIDIT_WORKFLOW_ID: z.string().uuid().optional(),
  /**
   * DIDIT: Workflow for **merchant company KYB** when the **founding user** runs KYB from the business dashboard.
   * Optional until KYB is enabled; distinct from `DIDIT_WORKFLOW_ID` (ramp consumer person KYC).
   */
  DIDIT_KYB_WORKFLOW_ID: z.string().uuid().optional(),
  /** DIDIT: Webhook secret for X-Signature-V2 HMAC verification. */
  DIDIT_WEBHOOK_SECRET: z.string().min(1).optional(),

  /** Persona: Bearer API key (sandbox key starts with persona_sandbox_). */
  PERSONA_API_KEY: z.string().min(1).optional(),
  /** Persona: Inquiry template ID (itmpl_...). */
  PERSONA_TEMPLATE_ID: z.string().min(1).optional(),
  /** Persona: Environment ID (env_...) — returned to CDN client, not a secret. */
  PERSONA_ENVIRONMENT_ID: z.string().min(1).optional(),
  /** Persona: Webhook secret for Persona-Signature HMAC verification. */
  PERSONA_WEBHOOK_SECRET: z.string().min(1).optional(),

  /**
   * KYC service routing map (JSON string).
   * Used by **Peer Ramp** `/api/peer-ramp-app/kyc/*` only — maps opaque service IDs to didit|persona.
   * Example: {"svc_kyc_01":"didit","svc_kyc_02":"persona"}
   */
  KYC_SERVICE_MAP: z.string().optional(),

  /**
   * Default KYC service ID (must exist in KYC_SERVICE_MAP).
   * When set, `x-kyc-service` is optional for **Peer Ramp** `POST /api/peer-ramp-app/kyc/init` only.
   * Example: "svc_kyc_01"
   */
  DEFAULT_KYC_SERVICE: z.string().optional(),
});

type ParsedEnv = z.infer<typeof envSchema>;

/** Runtime env after `loadEnv()` normalizes derived values (e.g. REDIS_URL). */
export type Env = Omit<ParsedEnv, "REDIS_URL"> & { REDIS_URL: string };

/**
 * Redis Cloud and similar often ship `REDIS_URL` as `redis://host:port` with the password only in a
 * separate field. If the URL has no userinfo but `REDIS_PASSWORD` is set, inject ACL user + password.
 * Default username is `default` (Redis Cloud default ACL user).
 * When `REDIS_TLS` is true, upgrade `redis://` → `rediss://` for TLS endpoints.
 */
function mergeRedisAuthIntoUrl(redisUrl: string, d: ParsedEnv): string {
  const pw = d.REDIS_PASSWORD?.trim();
  if (!pw) return redisUrl;

  let s = redisUrl.trim();
  if (!s.startsWith("redis://") && !s.startsWith("rediss://")) {
    const scheme = d.REDIS_TLS ? "rediss" : "redis";
    s = `${scheme}://${s}`;
  }

  try {
    const u = new URL(s);
    if (u.username || u.password) return s;

    u.username = d.REDIS_USERNAME?.trim() || "default";
    u.password = pw;

    if (d.REDIS_TLS && u.protocol === "redis:") {
      u.protocol = "rediss:";
    }
    return u.href;
  } catch {
    return redisUrl;
  }
}

let env: Env;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.errors
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${msg}`);
  }
  const d = parsed.data;

  const redisUrlRaw =
    d.REDIS_URL ??
    (() => {
      const host = d.REDIS_HOST?.trim();
      const port = d.REDIS_PORT ?? 6379;
      if (!host) return "redis://localhost:6379";
      const scheme = d.REDIS_TLS ? "rediss" : "redis";
      const username = d.REDIS_USERNAME?.trim();
      const password = d.REDIS_PASSWORD?.trim();
      const auth =
        username && password
          ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
          : password
            ? `:${encodeURIComponent(password)}@`
            : username
              ? `${encodeURIComponent(username)}@`
              : "";
      return `${scheme}://${auth}${host}:${port}`;
    })();

  const redisUrl = mergeRedisAuthIntoUrl(redisUrlRaw, d);

  env = {
    ...d,
    REDIS_URL: redisUrl,
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
