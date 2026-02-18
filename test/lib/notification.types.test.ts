import { describe, it, expect } from "vitest";
import {
  normalizeNotificationChannels,
  getAvailableChannels,
  DEFAULT_NOTIFICATION_CHANNEL,
  NOTIFICATION_CHANNELS,
} from "../../src/lib/notification.types.js";

describe("notification.types", () => {
  describe("normalizeNotificationChannels", () => {
    it("returns [EMAIL] when input is null or undefined", () => {
      expect(normalizeNotificationChannels(null)).toEqual([DEFAULT_NOTIFICATION_CHANNEL]);
      expect(normalizeNotificationChannels(undefined)).toEqual([DEFAULT_NOTIFICATION_CHANNEL]);
    });

    it("returns [EMAIL] when input is empty array", () => {
      expect(normalizeNotificationChannels([])).toEqual([DEFAULT_NOTIFICATION_CHANNEL]);
    });

    it("accepts valid channel and returns it", () => {
      expect(normalizeNotificationChannels(["EMAIL"])).toEqual(["EMAIL"]);
      expect(normalizeNotificationChannels(["SMS"])).toEqual(["SMS"]);
      expect(normalizeNotificationChannels(["WHATSAPP"])).toEqual(["WHATSAPP"]);
    });

    it("accepts multiple valid channels and deduplicates", () => {
      expect(normalizeNotificationChannels(["EMAIL", "SMS", "EMAIL"])).toEqual(["EMAIL", "SMS"]);
    });

    it("drops invalid channels and defaults to EMAIL when none valid", () => {
      expect(normalizeNotificationChannels(["INVALID"])).toEqual([DEFAULT_NOTIFICATION_CHANNEL]);
      expect(normalizeNotificationChannels(["email", "SMS"])).toEqual(["EMAIL", "SMS"]);
    });

    it("handles single string input", () => {
      expect(normalizeNotificationChannels("SMS")).toEqual(["SMS"]);
    });
  });

  describe("getAvailableChannels", () => {
    it("returns all NOTIFICATION_CHANNELS", () => {
      const list = getAvailableChannels();
      expect(list).toEqual([...NOTIFICATION_CHANNELS]);
      expect(list).toContain("EMAIL");
      expect(list).toContain("SMS");
      expect(list).toContain("WHATSAPP");
    });
  });
});
