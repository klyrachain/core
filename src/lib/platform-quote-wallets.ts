/**
 * Platform-controlled wallet addresses for server-side swap quote `fromAddress`
 * (and similar flows), loaded from Infisical at startup when configured.
 */

import type { FastifyBaseLogger } from "fastify";
import { getEnv } from "../config/env.js";
import {
  getInfisicalSecretValue,
  isInfisicalConfigured,
} from "../services/secrets/infisical-client.js";

export type PlatformQuoteWalletKey = "evm" | "solana" | "sui" | "stellar" | "bitcoin";

const SECRET_NAMES: Record<PlatformQuoteWalletKey, string> = {
  evm: "PLATFORM_WALLET_EVM_QUOTE",
  solana: "PLATFORM_WALLET_SOLANA_QUOTE",
  sui: "PLATFORM_WALLET_SUI_QUOTE",
  stellar: "PLATFORM_WALLET_STELLAR_QUOTE",
  bitcoin: "PLATFORM_WALLET_BITCOIN_QUOTE",
};

const memory: Partial<Record<PlatformQuoteWalletKey, string>> = {};

export function getCachedPlatformQuoteWallet(
  key: PlatformQuoteWalletKey
): string | undefined {
  const v = memory[key]?.trim();
  return v || undefined;
}

/**
 * Fetches all configured platform quote wallets from Infisical (parallel reads, cached per secret by infisical-client).
 * Safe to call when Infisical is not configured (no-op).
 */
export async function refreshPlatformQuoteWalletsFromInfisical(
  log?: Pick<FastifyBaseLogger, "info" | "debug" | "warn">
): Promise<void> {
  if (!isInfisicalConfigured()) {
    log?.debug?.("Infisical not configured; skipping platform quote wallet preload");
    return;
  }
  const secretPath = getEnv().INFISICAL_PLATFORM_WALLET_SECRET_PATH?.trim() || "/";
  const keys = Object.keys(SECRET_NAMES) as PlatformQuoteWalletKey[];
  let loaded = 0;
  await Promise.all(
    keys.map(async (k) => {
      const v = await getInfisicalSecretValue(SECRET_NAMES[k], secretPath);
      if (v) {
        memory[k] = v;
        loaded += 1;
      }
    })
  );
  log?.info?.(
    { platformQuoteWalletsLoaded: loaded, secretPath },
    "Platform quote wallets refreshed from Infisical"
  );
}

/** @internal Vitest */
export function __resetPlatformQuoteWalletsForTests(): void {
  for (const k of Object.keys(SECRET_NAMES) as PlatformQuoteWalletKey[]) {
    delete memory[k];
  }
}

/** @internal Vitest */
export function __setPlatformQuoteWalletForTests(
  key: PlatformQuoteWalletKey,
  value: string
): void {
  memory[key] = value;
}
