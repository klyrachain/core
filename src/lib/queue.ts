import { Queue, Worker, Job } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import { getRedis, getRedisConnectionForWorker } from "./redis.js";

const POLL_QUEUE_NAME = "poll";
const PROVIDER_CATALOG_QUEUE_NAME = "provider-catalog";

export type PollJobData = {
  transactionId: string;
};

export type ProviderCatalogJobData = Record<string, never>;

let pollQueue: Queue<PollJobData> | null = null;
let providerCatalogQueue: Queue<ProviderCatalogJobData> | null = null;

export function getPollQueue(): Queue<PollJobData> {
  if (!pollQueue) {
    pollQueue = new Queue<PollJobData>(POLL_QUEUE_NAME, {
      connection: getRedis() as ConnectionOptions,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: { count: 1000 },
      },
    });
  }
  return pollQueue as Queue<PollJobData>;
}

export async function addPollJob(transactionId: string): Promise<Job<PollJobData>> {
  const queue = getPollQueue();
  return queue.add("process", { transactionId }, { jobId: transactionId });
}

export function createPollWorker(
  processor: (job: Job<PollJobData>) => Promise<void>
): Worker<PollJobData> {
  const worker = new Worker<PollJobData>(
    POLL_QUEUE_NAME,
    async (job) => {
      await processor(job);
    },
    {
      connection: getRedisConnectionForWorker() as ConnectionOptions,
      concurrency: 5,
    }
  );
  return worker;
}

export function getProviderCatalogQueue(): Queue<ProviderCatalogJobData> {
  if (!providerCatalogQueue) {
    providerCatalogQueue = new Queue<ProviderCatalogJobData>(PROVIDER_CATALOG_QUEUE_NAME, {
      connection: getRedis() as ConnectionOptions,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 200 },
      },
    });
  }
  return providerCatalogQueue;
}

/** Register a repeatable job every 48h (Fonbnk asset table + Paystack country flags). Idempotent in Redis per queue name + pattern. */
export async function ensureProviderCatalogRepeatableJob(): Promise<void> {
  const queue = getProviderCatalogQueue();
  const everyMs = 48 * 60 * 60 * 1000;
  await queue.add("sync-provider-catalogs", {}, { repeat: { every: everyMs } });
}

export function createProviderCatalogWorker(
  processor: (job: Job<ProviderCatalogJobData>) => Promise<void>
): Worker<ProviderCatalogJobData> {
  return new Worker<ProviderCatalogJobData>(
    PROVIDER_CATALOG_QUEUE_NAME,
    async (job) => {
      await processor(job);
    },
    {
      connection: getRedisConnectionForWorker() as ConnectionOptions,
      concurrency: 1,
    }
  );
}

export async function closeQueue(): Promise<void> {
  if (pollQueue) {
    await pollQueue.close();
    pollQueue = null;
  }
  if (providerCatalogQueue) {
    await providerCatalogQueue.close();
    providerCatalogQueue = null;
  }
}
