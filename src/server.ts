import Fastify from "fastify";
import { loadEnv, getEnv } from "./config/env.js";
import { prisma, disconnectPrisma } from "./lib/prisma.js";
import { getRedis, disconnectRedis } from "./lib/redis.js";
import { createPollWorker, closeQueue } from "./lib/queue.js";
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
import { ratesApiRoutes } from "./routes/api/rates.js";
import { cryptoTransactionsApiRoutes } from "./routes/api/crypto-transactions.js";
import { logsApiRoutes } from "./routes/api/logs.js";
import { paystackBanksApiRoutes } from "./routes/api/paystack-banks.js";
import { paystackMobileApiRoutes } from "./routes/api/paystack-mobile.js";
import { paystackPaymentsApiRoutes } from "./routes/api/paystack-payments.js";
import { paystackPayoutsApiRoutes } from "./routes/api/paystack-payouts.js";
import { paystackTransactionsApiRoutes } from "./routes/api/paystack-transactions.js";
import { paystackTransfersApiRoutes } from "./routes/api/paystack-transfers.js";
import { paystackWebhookRoutes } from "./routes/webhook/paystack.js";
import { onRequestLog, onResponseLog } from "./lib/request-log-hooks.js";
import { requireApiKey } from "./lib/auth.guard.js";

loadEnv();

const app = Fastify({
  logger: {
    level: getEnv().NODE_ENV === "development" ? "info" : "warn",
  },
});

app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
  (req as { rawBody?: string }).rawBody = typeof body === "string" ? body : "";
  try {
    done(null, body ? JSON.parse(body as string) : {});
  } catch (e) {
    done(e as Error, undefined);
  }
});

app.addHook("preValidation", onRequestLog);
app.addHook("onResponse", onResponseLog);

// Require x-api-key for all routes except health and ready
app.addHook("preHandler", async (request, reply) => {
  const path = (request.url ?? "").split("?")[0];
  if (path === "/health" || path === "/ready" || path.startsWith("/api/quote") || path === "/api/countries" || path.startsWith("/api/rates") || path === "/api/chains" || path === "/api/tokens" || path === "/webhook/paystack") return;
  await requireApiKey(request, reply);
});

app.get("/health", async (_, reply) => {
  return reply.status(200).send({ ok: true });
});

app.get("/ready", async (_, reply) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const redis = getRedis();
    await redis.ping();
  } catch (err) {
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
await app.register(countriesApiRoutes, { prefix: "" });
await app.register(chainsTokensApiRoutes, { prefix: "" });
await app.register(invoicesApiRoutes, { prefix: "" });
await app.register(ratesApiRoutes, { prefix: "" });
await app.register(cryptoTransactionsApiRoutes, { prefix: "" });
await app.register(logsApiRoutes, { prefix: "" });
await app.register(paystackBanksApiRoutes, { prefix: "" });
await app.register(paystackMobileApiRoutes, { prefix: "" });
await app.register(paystackPaymentsApiRoutes, { prefix: "" });
await app.register(paystackPayoutsApiRoutes, { prefix: "" });
await app.register(paystackTransactionsApiRoutes, { prefix: "" });
await app.register(paystackTransfersApiRoutes, { prefix: "" });
await app.register(paystackWebhookRoutes, { prefix: "" });

const pollWorker = createPollWorker(processPollJob);

const shutdown = async () => {
  await pollWorker.close();
  await closeQueue();
  await disconnectRedis();
  await disconnectPrisma();
  await app.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const port = getEnv().PORT;
app.listen({ port, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server listening at ${address}`);
});
