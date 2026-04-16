/**
 * Platform settings: get/set by key (general, financials, providers, risk, api).
 * Values stored as JSON. Used by /api/settings/* routes.
 */

import type { Prisma } from "../../prisma/generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";

export type PlatformSettingKey = "general" | "financials" | "providers" | "risk" | "api" | "swapFee";

/** Default swap-fee config. Fee recipient is never exposed to client; only set via admin. */
const DEFAULT_SWAP_FEE: SwapFeeConfig = {
  squidFeeRecipient: null,
  squidFeeBps: null,
  lifiIntegrator: "klyra",
  lifiFeePercent: null,
};

export type SwapFeeConfig = {
  squidFeeRecipient: string | null;
  squidFeeBps: number | null;
  lifiIntegrator: string | null;
  lifiFeePercent: number | null;
};

/** Server-only: get raw swap-fee config for Squid/LiFi (from DB then env). Never expose to client. */
export async function getSwapFeeConfigForProvider(): Promise<SwapFeeConfig> {
  const current = await getPlatformSetting("swapFee");
  const fromDb = current
    ? {
        squidFeeRecipient: (current.squidFeeRecipient as string) ?? null,
        squidFeeBps: typeof current.squidFeeBps === "number" ? current.squidFeeBps : null,
        lifiIntegrator: (current.lifiIntegrator as string) ?? "klyra",
        lifiFeePercent: typeof current.lifiFeePercent === "number" ? current.lifiFeePercent : null,
      }
    : { ...DEFAULT_SWAP_FEE };
  return { ...DEFAULT_SWAP_FEE, ...fromDb };
}

/** Mask address for API response (e.g. "0x1234...abcd"). Never return full recipient to client. */
export function maskAddress(value: string | null | undefined, prefix = 6, suffix = 4): string {
  if (value == null || value === "") return "";
  const s = String(value).trim();
  if (s.length <= prefix + suffix) return "••••••••";
  return s.slice(0, prefix) + "..." + s.slice(-suffix);
}

/** Get swap-fee config for admin GET only: masked recipient, safe to return. */
export async function getSwapFeeConfigMasked(): Promise<{
  squidFeeRecipientMasked: string;
  squidFeeBps: number | null;
  lifiIntegrator: string | null;
  lifiFeePercent: number | null;
  configured: boolean;
}> {
  const raw = await getSwapFeeConfigForProvider();
  const configured =
    (raw.squidFeeRecipient != null && raw.squidFeeRecipient.length > 0 && raw.squidFeeBps != null) ||
    (raw.lifiFeePercent != null && raw.lifiFeePercent > 0);
  return {
    squidFeeRecipientMasked: maskAddress(raw.squidFeeRecipient),
    squidFeeBps: raw.squidFeeBps,
    lifiIntegrator: raw.lifiIntegrator,
    lifiFeePercent: raw.lifiFeePercent,
    configured,
  };
}

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
