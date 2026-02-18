/**
 * Notification API: list available channels (EMAIL, SMS, WHATSAPP).
 * Request creation and claim notification are triggered from request/claim flows.
 */

import type { FastifyInstance } from "fastify";
import { successEnvelope } from "../../lib/api-helpers.js";
import { getAvailableChannels, NOTIFICATION_CHANNEL_DISPLAY } from "../../lib/notification.types.js";
import { isEmailConfigured } from "../../services/email.service.js";
import { isSentConfigured } from "../../services/sent.service.js";

export async function notificationApiRoutes(app: FastifyInstance): Promise<void> {
  /** GET /api/notification/channels — list notification channels (EMAIL, SMS, WHATSAPP). Only configured channels are useful. */
  app.get("/api/notification/channels", async (_, reply) => {
    const channels = getAvailableChannels();
    const emailOk = isEmailConfigured();
    const smsWhatsappOk = isSentConfigured();
    const list = channels.map((code) => ({
      code,
      label: NOTIFICATION_CHANNEL_DISPLAY[code],
      configured: code === "EMAIL" ? emailOk : smsWhatsappOk,
    }));
    return successEnvelope(reply, { channels: list });
  });
}
