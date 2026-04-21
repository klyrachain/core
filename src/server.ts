import Fastify from "fastify";
import { loadEnv, getEnv } from "./config/env.js";
import { prisma, disconnectPrisma } from "./lib/prisma.js";
import { getRedis, disconnectRedis } from "./lib/redis.js";
import {
  createPollWorker,
  closeQueue,
  createProviderCatalogWorker,
  ensureProviderCatalogRepeatableJob,
} from "./lib/queue.js";
import { processPollJob } from "./workers/poll.worker.js";
import { orderWebhookRoutes } from "./routes/webhook/order.js";
import { adminWebhookRoutes } from "./routes/webhook/admin.js";
import { usersApiRoutes } from "./routes/api/users.js";
import { transactionsApiRoutes } from "./routes/api/transactions.js";
import { requestsApiRoutes } from "./routes/api/requests.js";
import { claimsApiRoutes } from "./routes/api/claims.js";
import { walletsApiRoutes } from "./routes/api/wallets.js";
import { inventoryApiRoutes } from "./routes/api/inventory.js";
import { cacheApiRoutes } from "./routes/api/cache.js";
import { queueApiRoutes } from "./routes/api/queue.js";
import { quoteApiRoutes } from "./routes/api/quote.js";
import { countriesApiRoutes } from "./routes/api/countries.js";
import { chainsTokensApiRoutes } from "./routes/api/chains-tokens.js";
import { invoicesApiRoutes } from "./routes/api/invoices.js";
import { accessApiRoutes } from "./routes/api/access.js";
import { connectApiRoutes } from "./routes/api/connect.js";
import { platformApiRoutes } from "./routes/api/platform.js";
import { settingsApiRoutes } from "./routes/api/settings.js";
import { providersApiRoutes } from "./routes/api/providers.js";
import { providerMetadataApiRoutes } from "./routes/api/provider-metadata.js";
import { validationApiRoutes } from "./routes/api/validation.js";
import { notificationApiRoutes } from "./routes/api/notification.js";
import { adminSentTemplatesRoutes } from "./routes/api/admin-sent-templates.js";
import { ratesApiRoutes } from "./routes/api/rates.js";
import { cryptoTransactionsApiRoutes } from "./routes/api/crypto-transactions.js";
import { logsApiRoutes } from "./routes/api/logs.js";
import { paystackBanksApiRoutes } from "./routes/api/paystack-banks.js";
import { paystackMobileApiRoutes } from "./routes/api/paystack-mobile.js";
import { paystackPaymentsApiRoutes } from "./routes/api/paystack-payments.js";
import { paystackPayoutsApiRoutes } from "./routes/api/paystack-payouts.js";
import { paystackTransactionsApiRoutes } from "./routes/api/paystack-transactions.js";
import { paystackTransfersApiRoutes } from "./routes/api/paystack-transfers.js";
import { offrampApiRoutes } from "./routes/api/offramp.js";
import { appTransferApiRoutes } from "./routes/api/app-transfer.js";
import { platformPoolDestinationsApiRoutes } from "./routes/api/platform-pool-destinations.js";
import { paymentLinkDispatchApiRoutes } from "./routes/api/payment-link-dispatch.js";
import { testApiRoutes } from "./routes/api/test.js";
import { peerRampApiRoutes } from "./routes/api/peer-ramp.js";
import { peerRampAppApiRoutes } from "./routes/api/peer-ramp-app.js";
import { peerRampKycApiRoutes } from "./routes/api/peer-ramp-kyc.js";
import { adminPeerRampKycApiRoutes } from "./routes/api/admin-peer-ramp-kyc.js";
import { adminBusinessKybApiRoutes } from "./routes/api/admin-business-kyb.js";
import { kycWebhookRoutes } from "./routes/webhook/kyc.js";
import { metaApiRoutes } from "./routes/api/meta.js";
import { publicPaymentLinksApiRoutes } from "./routes/api/public-payment-links.js";
import { publicGasApiRoutes } from "./routes/api/public-gas.js";
import { gasPlatformApiRoutes } from "./routes/api/gas-platform.js";
import { publicCurrenciesApiRoutes } from "./routes/api/public-currencies.js";
import { publicWrappedApiRoutes } from "./routes/api/public-wrapped.js";
import { publicContactApiRoutes } from "./routes/api/public-contact.js";
import { v1QuotesRoutes } from "./routes/api/v1/quotes.js";
import { adminAuthRoutes } from "./routes/api/admin-auth.js";
import { businessAuthRoutes } from "./routes/api/business-auth.js";
import { paystackWebhookRoutes } from "./routes/webhook/paystack.js";
import { onRequestLog, onResponseLog } from "./lib/request-log-hooks.js";
import { refreshPlatformQuoteWalletsFromInfisical } from "./lib/platform-quote-wallets.js";
import { requireApiKeyOrSession, resolveApiKeyIfPresent } from "./lib/auth.guard.js";
import { resolveAdminSessionIfPresent } from "./lib/admin-auth.guard.js";
import {
  handleMerchantV1Auth,
  resolveInvoicesPortalTenantIfEligible,
} from "./lib/business-portal-tenant.guard.js";
import { merchantV1Routes } from "./routes/api/v1/merchant.js";
import { ensureValidationCache, loadValidationCache } from "./services/validation-cache.service.js";
import { processPendingEmails } from "./services/email.service.js";
import { reconcileStaleCommercePaystackTransactions } from "./services/paystack-reconcile.service.js";
import { runProviderCatalogSync } from "./services/provider-catalog-sync.service.js";

loadEnv();

const VALIDATION_CACHE_REFRESH_MS = 24 * 60 * 60 * 1000; // 24h

const app = Fastify({
  logger: {
    level: getEnv().NODE_ENV === "development" ? "info" : "warn",
  },
});

// Match `application/json`, `application/json; charset=utf-8`, etc. so webhooks keep `rawBody` for HMAC.
app.addContentTypeParser(
  /^application\/json(?:\s*;.*)?$/i,
  { parseAs: "string" },
  (req, body, done) => {
    (req as { rawBody?: string }).rawBody = typeof body === "string" ? body : "";
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch (e) {
      done(e as Error, undefined);
    }
  }
);

app.addHook("preValidation", onRequestLog);
app.addHook("onResponse", onResponseLog);

// Auth: health/ready, auth routes, GET /api/requests/by-link/:linkId, GET /api/public/payment-links/:slug, GET /api/public/currencies, GET /api/meta/checkout-base-url, /webhook/paystack are public.
app.addHook("preHandler", async (request, reply) => {
  const path = (request.url ?? "").split("?")[0];
  const method = (request.method ?? "").toUpperCase();
  if (path === "/" || path === "") return;
  if (path === "/api/health" || path === "/api/ready") return;
  if (path.startsWith("/api/auth")) return;
  if (path.startsWith("/api/business-auth")) return;
  if (path === "/signup/business") return;
  if (path === "/webhook/paystack") return; // Paystack does not send x-api-key; we verify x-paystack-signature instead
  if (path === "/webhook/didit" || path === "/webhooks/didit")
    return; // DIDIT webhook: HMAC verified inside handler
  if (path === "/webhook/persona") return; // Persona webhook: HMAC verified inside handler
  if (method === "GET" && path.startsWith("/api/requests/by-link/")) return; // Public pay link for request
  if (method === "GET" && path === "/api/meta/checkout-base-url") return;
  if (method === "GET" && path === "/api/meta/verification-webhooks") return;
  if (method === "GET" && path.startsWith("/api/public/")) return;
  if (method === "POST" && path === "/api/public/gas-usage") return;
  if (method === "POST" && path === "/api/public/contact") return;
  if (method === "GET" && path === "/api/chains") return;
  if (
    method === "GET" &&
    (path === "/api/tokens" || path === "/api/tokens/list")
  ) {
    return;
  }
  if (method === "OPTIONS") return;
  if (path.startsWith("/api/peer-ramp-app/")) return;

  await resolveApiKeyIfPresent(request);
  await resolveAdminSessionIfPresent(request);

  if (path.startsWith("/api/v1/merchant")) {
    const merchantOk = await handleMerchantV1Auth(request, reply);
    if (!merchantOk) return;
    return;
  }

  if (path.startsWith("/api/invoices")) {
    await resolveInvoicesPortalTenantIfEligible(request, reply);
    if (reply.sent) return;
  }

  /** Portal JWT + X-Business-Id (same as invoices) so GET /api/access can return merchant context. */
  if (method === "GET" && path === "/api/access") {
    await resolveInvoicesPortalTenantIfEligible(request, reply);
    if (reply.sent) return;
  }

  requireApiKeyOrSession(request, reply);
});

app.get("/", async (_, reply) => {
  return reply.status(200).send({
    success: true,
    service: "morapay-core",
    message: "Core API (pricing, liquidity, webhooks, platform routes).",
    hint: "Use /api/health for liveness. Most /api/* routes require x-api-key or a session.",
    endpoints: {
      health: "/api/health",
      ready: "/api/ready",
    },
  });
});

app.get("/api/health", async (_, reply) => {
  return reply.status(200).send({ ok: true });
});

app.get("/api/ready", async (_, reply) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const redis = getRedis();
    await redis.ping();
  } catch (_err) {
    return reply.status(503).send({ ok: false, error: "Database or Redis unavailable" });
  }
  return reply.status(200).send({ ok: true });
});

await app.register(orderWebhookRoutes, { prefix: "" });
await app.register(adminWebhookRoutes, { prefix: "" });
await app.register(usersApiRoutes, { prefix: "" });
await app.register(transactionsApiRoutes, { prefix: "" });
await app.register(requestsApiRoutes, { prefix: "" });
await app.register(claimsApiRoutes, { prefix: "" });
await app.register(walletsApiRoutes, { prefix: "" });
await app.register(inventoryApiRoutes, { prefix: "" });
await app.register(cacheApiRoutes, { prefix: "" });
await app.register(queueApiRoutes, { prefix: "" });
await app.register(quoteApiRoutes, { prefix: "" });
await app.register(v1QuotesRoutes, { prefix: "/api/v1" });
await app.register(merchantV1Routes, { prefix: "/api/v1/merchant" });
await app.register(adminAuthRoutes, { prefix: "" });
await app.register(businessAuthRoutes, { prefix: "" });
await app.register(metaApiRoutes, { prefix: "" });
await app.register(publicPaymentLinksApiRoutes, { prefix: "" });
await app.register(publicGasApiRoutes, { prefix: "" });
await app.register(gasPlatformApiRoutes, { prefix: "" });
await app.register(publicCurrenciesApiRoutes, { prefix: "" });
await app.register(publicWrappedApiRoutes, { prefix: "" });
await app.register(publicContactApiRoutes, { prefix: "" });
await app.register(countriesApiRoutes, { prefix: "" });
await app.register(chainsTokensApiRoutes, { prefix: "" });
await app.register(invoicesApiRoutes, { prefix: "" });
await app.register(accessApiRoutes, { prefix: "" });
await app.register(connectApiRoutes, { prefix: "" });
await app.register(platformApiRoutes, { prefix: "" });
await app.register(settingsApiRoutes, { prefix: "" });
await app.register(providersApiRoutes, { prefix: "" });
await app.register(providerMetadataApiRoutes, { prefix: "" });
await app.register(validationApiRoutes, { prefix: "" });
await app.register(notificationApiRoutes, { prefix: "" });
await app.register(adminSentTemplatesRoutes, { prefix: "" });
await app.register(ratesApiRoutes, { prefix: "" });
await app.register(cryptoTransactionsApiRoutes, { prefix: "" });
await app.register(logsApiRoutes, { prefix: "" });
await app.register(paystackBanksApiRoutes, { prefix: "" });
await app.register(paystackMobileApiRoutes, { prefix: "" });
await app.register(paystackPaymentsApiRoutes, { prefix: "" });
await app.register(paystackPayoutsApiRoutes, { prefix: "" });
await app.register(paystackTransactionsApiRoutes, { prefix: "" });
await app.register(paystackTransfersApiRoutes, { prefix: "" });
await app.register(offrampApiRoutes, { prefix: "" });
await app.register(appTransferApiRoutes, { prefix: "" });
await app.register(platformPoolDestinationsApiRoutes, { prefix: "" });
await app.register(paymentLinkDispatchApiRoutes, { prefix: "" });
await app.register(testApiRoutes, { prefix: "" });
await app.register(peerRampApiRoutes, { prefix: "" });
await app.register(peerRampAppApiRoutes, { prefix: "" });
await app.register(peerRampKycApiRoutes, { prefix: "" });
await app.register(adminPeerRampKycApiRoutes, { prefix: "" });
await app.register(adminBusinessKybApiRoutes, { prefix: "" });
await app.register(paystackWebhookRoutes, { prefix: "" });
await app.register(kycWebhookRoutes, { prefix: "" });

const pollWorker = createPollWorker(processPollJob);

const providerCatalogWorker = createProviderCatalogWorker(async () => {
  await runProviderCatalogSync({ logger: app.log });
});

let validationCacheInterval: ReturnType<typeof setInterval> | null = null;
let paystackReconcileInterval: ReturnType<typeof setInterval> | null = null;

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;

  if (validationCacheInterval) clearInterval(validationCacheInterval);
  if (paystackReconcileInterval) clearInterval(paystackReconcileInterval);
  await pollWorker.close();
  await providerCatalogWorker.close();
  await closeQueue();
  await disconnectRedis();
  await disconnectPrisma();
  await app.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const port = getEnv().PORT;

const startServer = async () => {
  try {
    await refreshPlatformQuoteWalletsFromInfisical(app.log).catch((e) =>
      app.log.warn({ err: e }, "Platform quote wallet preload from Infisical failed")
    );
    const address = await app.listen({ port, host: "0.0.0.0" });
    app.log.info(`Server listening at ${address}`);
    await ensureValidationCache().catch((e) =>
      app.log.warn("Validation cache initial load failed:", e)
    );
    processPendingEmails().catch((e) =>
      app.log.warn("Pending emails processing failed:", e)
    );
    validationCacheInterval = setInterval(() => {
      loadValidationCache().catch((e) =>
        app.log.warn("Validation cache refresh failed:", e)
      );
    }, VALIDATION_CACHE_REFRESH_MS);

    const env = getEnv();
    await ensureProviderCatalogRepeatableJob().catch((e) =>
      app.log.warn({ err: e }, "Provider catalog repeatable job registration failed")
    );

    if (env.PAYSTACK_RECONCILE_ENABLED) {
      const tick = () => {
        reconcileStaleCommercePaystackTransactions({
          minAgeMs: env.PAYSTACK_RECONCILE_MIN_AGE_MS,
          maxBatch: env.PAYSTACK_RECONCILE_MAX_BATCH,
        })
          .then((r) => {
            if (
              r.processed > 0 ||
              r.settled > 0 ||
              r.failedMarked > 0 ||
              r.errors > 0
            ) {
              app.log.info(
                {
                  paystackReconcile: r,
                },
                "Paystack commerce reconciliation tick"
              );
            }
          })
          .catch((e) => app.log.warn({ err: e }, "Paystack reconciliation failed"));
      };
      paystackReconcileInterval = setInterval(tick, env.PAYSTACK_RECONCILE_INTERVAL_MS);
      setImmediate(tick);
    }
  } catch (err) {
    app.log.error(err, "Failed to start server");
    process.exit(1);
  }
};

startServer();