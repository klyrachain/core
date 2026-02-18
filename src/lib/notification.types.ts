/**
 * Notification channel types for request/claim flows.
 * Email = Resend; SMS/WhatsApp = Sent.dm. One or multiple can be selected.
 */

export const NOTIFICATION_CHANNELS = ["EMAIL", "SMS", "WHATSAPP"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_CHANNEL_DISPLAY: Record<NotificationChannel, string> = {
  EMAIL: "Email",
  SMS: "SMS",
  WHATSAPP: "WhatsApp",
};

/** Default channel when none or invalid selection. API returns this list so clients can pick; invalid → default EMAIL. */
export const DEFAULT_NOTIFICATION_CHANNEL: NotificationChannel = "EMAIL";

/**
 * Normalize channel list from request. Invalid or unknown channels are dropped.
 * If empty or all invalid, returns [DEFAULT_NOTIFICATION_CHANNEL].
 */
export function normalizeNotificationChannels(input: unknown): NotificationChannel[] {
  if (input == null) return [DEFAULT_NOTIFICATION_CHANNEL];
  const arr = Array.isArray(input) ? input : [input];
  const set = new Set<NotificationChannel>();
  for (const v of arr) {
    const s = String(v).trim().toUpperCase();
    if (NOTIFICATION_CHANNELS.includes(s as NotificationChannel)) {
      set.add(s as NotificationChannel);
    }
  }
  if (set.size === 0) return [DEFAULT_NOTIFICATION_CHANNEL];
  return [...set];
}

/** Return the list of valid channel enums for API responses (so clients know what they can pick). */
export function getAvailableChannels(): NotificationChannel[] {
  return [...NOTIFICATION_CHANNELS];
}
