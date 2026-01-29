import { getEnv } from "../config/env.js";
import { triggerToChannel } from "./pusher.service.js";

const ADMIN_CHANNEL = "admin-dashboard";
const ADMIN_EVENT = "admin-event";

export type AdminEventPayload = {
  event: string;
  data: Record<string, unknown>;
  timestamp?: string;
};

/**
 * Sends data to the admin dashboard via HTTP webhook and/or Pusher.
 * Set ADMIN_WEBHOOK_URL to POST payloads to your dashboard backend.
 */
export async function sendToAdminDashboard(payload: AdminEventPayload): Promise<void> {
  const env = getEnv();
  const body = {
    ...payload,
    timestamp: payload.timestamp ?? new Date().toISOString(),
  };

  if (env.ADMIN_WEBHOOK_URL && env.ADMIN_WEBHOOK_URL.length > 0) {
    try {
      const res = await fetch(env.ADMIN_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.warn(`Admin webhook failed: ${res.status} ${res.statusText}`);
      }
    } catch (err) {
      console.warn("Admin webhook request failed", err);
    }
  }

  await triggerToChannel(ADMIN_CHANNEL, ADMIN_EVENT, body);
}
