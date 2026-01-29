import { Queue, Worker, Job } from "bullmq";
import { getRedis, getRedisConnectionForWorker } from "./redis.js";

const POLL_QUEUE_NAME = "poll";

export type PollJobData = {
  transactionId: string;
};

let pollQueue: Queue<PollJobData> | null = null;

export function getPollQueue(): Queue<PollJobData> {
  if (!pollQueue) {
    pollQueue = new Queue<PollJobData>(POLL_QUEUE_NAME, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: { count: 1000 },
      },
    });
  }
  return pollQueue;
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
      connection: getRedisConnectionForWorker(),
      concurrency: 5,
    }
  );
  return worker;
}

export async function closeQueue(): Promise<void> {
  if (pollQueue) {
    await pollQueue.close();
    pollQueue = null;
  }
}
