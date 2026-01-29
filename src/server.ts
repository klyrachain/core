import Fastify from "fastify";
import { loadEnv, getEnv } from "./config/env.js";
import { prisma, disconnectPrisma } from "./lib/prisma.js";
import { getRedis, disconnectRedis } from "./lib/redis.js";
import { createPollWorker, closeQueue } from "./lib/queue.js";
import { processPollJob } from "./workers/poll.worker.js";
import { orderWebhookRoutes } from "./routes/webhook/order.js";

loadEnv();

const app = Fastify({
  logger: {
    level: getEnv().NODE_ENV === "development" ? "info" : "warn",
  },
});

app.addContentTypeParser("application/json", { parseAs: "string" }, (_, body, done) => {
  try {
    done(null, body ? JSON.parse(body as string) : {});
  } catch (e) {
    done(e as Error, undefined);
  }
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
