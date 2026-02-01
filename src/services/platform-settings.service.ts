/**
 * Platform settings: get/set by key (general, financials, providers, risk, api).
 * Values stored as JSON. Used by /api/settings/* routes.
 */

import type { Prisma } from "../../prisma/generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";

const SETTING_KEYS = ["general", "financials", "providers", "risk", "api"] as const;
export type PlatformSettingKey = (typeof SETTING_KEYS)[number];

export async function getPlatformSetting<K extends PlatformSettingKey>(
  key: K
): Promise<Record<string, unknown> | null> {
  const row = await prisma.platformSetting.findUnique({
    where: { key },
    select: { value: true },
  });
  if (!row || row.value == null) return null;
  return row.value as Record<string, unknown>;
}

export async function getPlatformSettingOrDefault<K extends PlatformSettingKey>(
  key: K,
  defaults: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const current = await getPlatformSetting(key);
  if (!current) return { ...defaults };
  return { ...defaults, ...current };
}

export async function setPlatformSetting(
  key: PlatformSettingKey,
  value: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const jsonValue = value as unknown as Prisma.InputJsonValue;
  await prisma.platformSetting.upsert({
    where: { key },
    create: { key, value: jsonValue },
    update: { value: jsonValue },
  });
  return value;
}

/** Merge partial update into existing setting; returns full result. */
export async function patchPlatformSetting(
  key: PlatformSettingKey,
  defaults: Record<string, unknown>,
  patch: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const current = await getPlatformSettingOrDefault(key, defaults);
  const next = { ...current, ...patch };
  await setPlatformSetting(key, next);
  return next;
}

/** Mask a secret for API response (e.g. "sk_live_••••••••"). */
export function maskSecret(value: string | null | undefined, prefixLength = 7): string {
  if (value == null || value === "") return "";
  const s = String(value).trim();
  if (s.length <= prefixLength) return "••••••••";
  return s.slice(0, prefixLength) + "••••••••";
}
