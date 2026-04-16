#!/usr/bin/env node
/**
 * Long-running **fiat FX demo** (not peer-ramp matching, not the core HTTP API).
 *
 * - Loads env via `loadEnv()` and calls `getFiatQuote` (ExchangeRate-API when configured).
 * - Does **not** open orders, aggregate the book, or POST to `/api/peer-ramp/*` — core can be stopped.
 * - Crypto leg is always a random **USDC** amount treated as **1:1 USD notional** for the USD→fiat offramp leg only;
 *   the onramp line is an unrelated random payer fiat amount → USD rate (illustrative, not a priced match).
 *
 * Usage: pnpm run peer-ramp:sim
 * Env: EXCHANGERATE_API_KEY (optional — without it, mock pivot message only).
 * Optional labels: PEER_RAMP_SIM_CHAIN, PEER_RAMP_SIM_TOKEN (logged only; no on-chain calls).
 *
 * Stop with Ctrl+C.
 */

import "dotenv/config";
import { loadEnv } from "../src/config/env.js";
import { isExchangeRateConfigured, getFiatQuote } from "../src/services/exchange-rate.service.js";

loadEnv();

const FIAT_POOL = [
  "USD",
  "GHS",
  "NGN",
  "CAD",
  "INR",
  "GBP",
  "EUR",
  "KES",
  "ZAR",
  "AUD",
];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function rnd<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

async function tick(): Promise<void> {
  const onrampFiat = rnd(FIAT_POOL);
  const offrampFiat = rnd(FIAT_POOL.filter((c) => c !== onrampFiat));
  const usdc = Math.round((5 + Math.random() * 95) * 100) / 100;

  if (!isExchangeRateConfigured()) {
    console.log(
      `[${new Date().toISOString()}] mock (no API key) onramp ${usdc} USDC ~ payer in ${onrampFiat} | offramp ${usdc} USDC ~ paid out ${offrampFiat} (set EXCHANGERATE_API_KEY for live crosses)`
    );
    return;
  }

  try {
    const payerAmount = 10 + Math.random() * 500;
    const toUsd = await getFiatQuote({ from: onrampFiat, to: "USD", amount: payerAmount });
    const usdNotional = usdc;
    const offLeg = await getFiatQuote({ from: "USD", to: offrampFiat, amount: usdNotional });
    console.log(
      `[${new Date().toISOString()}] peer-ramp sim | crypto=${usdc} USDC (assume 1:1 USD notion) | onramp ~ ${payerAmount} ${onrampFiat} → USD @ ${toUsd.rate} | offramp receive ~ ${offLeg.convertedAmount ?? usdNotional * offLeg.rate} ${offrampFiat}`
    );
  } catch (e) {
    console.warn(`[sim] quote error`, e instanceof Error ? e.message : e);
  }
}

async function main(): Promise<void> {
  const chainLabel = process.env.PEER_RAMP_SIM_CHAIN ?? "—";
  const tokenLabel = process.env.PEER_RAMP_SIM_TOKEN ?? "USDC";
  console.log(
    `Peer ramp fiat simulator (FX demo only; no core HTTP; crypto=${tokenLabel} @ chain label=${chainLabel}). Ctrl+C to stop.`
  );
  process.on("SIGINT", () => {
    console.log("\nStopped.");
    process.exit(0);
  });
  for (;;) {
    await tick();
    await sleep(Number(process.env.PEER_RAMP_SIM_INTERVAL_MS ?? 3000));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
