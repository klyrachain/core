import Pusher from "pusher";
import { getEnv } from "../config/env.js";
import type { TransactionStatus } from "@prisma/client";

const CHANNEL_NOTIFICATIONS = "notifications";
const CHANNEL_EMAIL = "email";
const CHANNEL_NUMBER = "number";
const EVENT_TRANSACTION_STATUS = "transaction-status";

let pusherClient: Pusher | null = null;

function getPusher(): Pusher | null {
  if (pusherClient) return pusherClient;
  const env = getEnv();
  if (!env.PUSHER_APP_ID || !env.PUSHER_KEY || !env.PUSHER_SECRET) {
    return null;
  }
  pusherClient = new Pusher({
    appId: env.PUSHER_APP_ID,
    key: env.PUSHER_KEY,
    secret: env.PUSHER_SECRET,
    cluster: env.PUSHER_CLUSTER,
    useTLS: true,
  });
  return pusherClient;
}

export type TransactionStatusPayload = {
  transactionId: string;
  status: TransactionStatus;
  type?: string;
};

/**
 * Triggers Pusher events when a Transaction status changes.
 * Channels: notifications, email, number (stub – actual channel names may be user-specific).
 */
export async function triggerTransactionStatusChange(
  payload: TransactionStatusPayload
): Promise<void> {
  const pusher = getPusher();
  if (!pusher) {
    return;
  }

  await pusher.trigger(CHANNEL_NOTIFICATIONS, EVENT_TRANSACTION_STATUS, payload);
  await pusher.trigger(CHANNEL_EMAIL, EVENT_TRANSACTION_STATUS, payload);
  await pusher.trigger(CHANNEL_NUMBER, EVENT_TRANSACTION_STATUS, payload);
}

/**
 * Trigger to a user-specific channel (e.g. private-user-{userId}).
 */
export async function triggerToChannel(
  channel: string,
  event: string,
  data: Record<string, unknown>
): Promise<void> {
  const pusher = getPusher();
  if (!pusher) return;
  await pusher.trigger(channel, event, data);
}
