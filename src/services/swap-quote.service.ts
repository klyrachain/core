/**
 * Unified swap quote: delegates to 0x, Squid, or LiFi and returns normalized response.
 */

import { getEnv } from "../config/env.js";
import { toZeroXNativeToken } from "../lib/native-token.js";
import type {
  BestQuoteRequest,
  BestQuoteResponse,
  SwapQuoteRequest,
  SwapQuoteResponse,
  SwapQuoteTransaction,
} from "../lib/swap-quote.types.js";
import { getZeroXSwapQuote } from "./zero-x.service.js";
import { getSquidQuote } from "./squid-quote.service.js";
import { getLiFiQuote } from "./lifi-quote.service.js";

export { isSquidConfigured } from "./squid-quote.service.js";
export { isLiFiConfigured } from "./lifi-quote.service.js";

export function isZeroXConfigured(): boolean {
  const key = getEnv().ZEROX_API_KEY;
  return !!(key && key.length > 0);
}

/**
 * Get swap quote from the given provider. Returns normalized SwapQuoteResponse.
 */
export async function getSwapQuote(
  params: SwapQuoteRequest
): Promise<{ ok: true; quote: SwapQuoteResponse } | { ok: false; error: string; status?: number }> {
  switch (params.provider) {
    case "0x":
      return getZeroXQuoteNormalized(params);
    case "squid":
      return getSquidQuote(params);
    case "lifi":
      return getLiFiQuote(params);
    default:
      return { ok: false, error: `Unknown provider: ${params.provider}` };
  }
}

async function getZeroXQuoteNormalized(
  params: SwapQuoteRequest
): Promise<{ ok: true; quote: SwapQuoteResponse } | { ok: false; error: string; status?: number }> {
  if (params.from_chain !== params.to_chain) {
    return { ok: false, error: "0x supports same-chain only; from_chain must equal to_chain" };
  }

  const sellToken = toZeroXNativeToken(params.from_token);
  const buyToken = toZeroXNativeToken(params.to_token);

  const result = await getZeroXSwapQuote({
    chainId: params.from_chain,
    sellToken,
    buyToken,
    sellAmount: params.amount,
    taker: params.from_address,
  });

  if (!result.ok) return result;

  const q = result.quote;
  const sameToken = sellToken.toLowerCase() === buyToken.toLowerCase();

  let transaction: SwapQuoteTransaction | null = null;
  if (q.raw && typeof q.raw === "object") {
    const r = q.raw as Record<string, unknown>;
    transaction = {
      raw: r,
      gas_limit: r.gas as string | undefined,
    };
  }

  const quote: SwapQuoteResponse = {
    provider: "0x",
    from_chain_id: q.chainId,
    to_chain_id: q.chainId,
    cross_chain: false,
    same_chain: true,
    token_type: sameToken ? "same_token" : "cross_token",
    from_amount: q.sellAmount,
    to_amount: q.buyAmount,
    next_quote_timer_seconds: null,
    estimated_duration_seconds: null,
    transaction,
  };

  return { ok: true, quote };
}

/** Competitive threshold: second quote is "alternative" if within this fraction of best to_amount. */
const COMPETITIVE_PCT = 0.05; // 5%

/** 0x often returns this for validation failures; prefer a more specific message from another provider when present. */
const GENERIC_ZEROX_STYLE = /^the input is invalid$/i;

type SwapQuoteAttemptResult = Awaited<ReturnType<typeof getSwapQuote>>;

function collectSwapProviderFailures(
  providers: readonly ("0x" | "squid" | "lifi")[],
  results: PromiseSettledResult<SwapQuoteAttemptResult>[]
): { provider: string; error: string }[] {
  const out: { provider: string; error: string }[] = [];
  providers.forEach((provider, i) => {
    const r = results[i];
    if (r == null) {
      out.push({ provider, error: "(no result)" });
      return;
    }
    if (r.status === "rejected") {
      const err =
        r.reason instanceof Error ? r.reason.message : String(r.reason ?? "rejected");
      out.push({ provider, error: err || "(rejected)" });
      return;
    }
    if (!r.value.ok) {
      out.push({ provider, error: r.value.error });
    }
  });
  return out;
}

function pickAggregateSwapError(failures: { provider: string; error: string }[]): string {
  const nonGeneric = failures.find((f) => !GENERIC_ZEROX_STYLE.test(f.error.trim()));
  if (nonGeneric) return nonGeneric.error;
  if (failures.length === 0) return "No provider returned a quote";
  return failures.map((f) => `${f.provider}: ${f.error}`).join("; ");
}

function logAllSwapProvidersFailed(
  params: BestQuoteRequest,
  failures: { provider: string; error: string }[]
): void {
  const fromTok =
    params.from_token.length > 22
      ? `${params.from_token.slice(0, 10)}…${params.from_token.slice(-8)}`
      : params.from_token;
  const toTok =
    params.to_token.length > 22
      ? `${params.to_token.slice(0, 10)}…${params.to_token.slice(-8)}`
      : params.to_token;
  console.warn(
    "[swap:getBestQuotes] all providers failed",
    JSON.stringify({
      from_chain: params.from_chain,
      to_chain: params.to_chain,
      from_token: fromTok,
      to_token: toTok,
      failures,
    })
  );
}

/**
 * Get best quote(s) by calling all applicable providers (same-chain: 0x, Squid, LiFi; cross-chain: Squid, LiFi).
 * Returns the single best by to_amount, and optionally a second competitive quote (within 5% of best amount)
 * so the user can choose between best rate and e.g. faster execution (estimated_duration_seconds).
 */
export async function getBestQuotes(
  params: BestQuoteRequest
): Promise<{ ok: true; data: BestQuoteResponse } | { ok: false; error: string }> {
  const sameChain = params.from_chain === params.to_chain;
  const providers: ("0x" | "squid" | "lifi")[] = sameChain ? ["0x", "squid", "lifi"] : ["squid", "lifi"];

  const results = await Promise.allSettled(
    providers.map((provider) =>
      getSwapQuote({
        ...params,
        provider,
      })
    )
  );

  const quotes: SwapQuoteResponse[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value.ok) {
      quotes.push(r.value.quote);
    }
  }

  if (quotes.length === 0) {
    const failures = collectSwapProviderFailures(providers, results);
    logAllSwapProvidersFailed(params, failures);
    const msg = pickAggregateSwapError(failures);
    return { ok: false, error: msg };
  }

  // Sort by to_amount descending (best rate first). Use BigInt for correct comparison.
  quotes.sort((a, b) => {
    const aAmount = BigInt(a.to_amount);
    const bAmount = BigInt(b.to_amount);
    return aAmount > bAmount ? -1 : aAmount < bAmount ? 1 : 0;
  });

  const best = quotes[0];
  let alternative: SwapQuoteResponse | undefined;

  if (quotes.length >= 2) {
    const bestAmount = BigInt(best.to_amount);
    const second = quotes[1];
    const secondAmount = BigInt(second.to_amount);
    const threshold = (bestAmount * BigInt(Math.floor((1 - COMPETITIVE_PCT) * 100))) / 100n;
    if (secondAmount >= threshold) {
      alternative = second;
    }
  }

  const data: BestQuoteResponse = alternative ? { best, alternative } : { best };
  return { ok: true, data };
}

/** Request same as getBestQuotes; returns all provider quotes (for tests / multi-provider picker). */
export type AllQuotesRequest = BestQuoteRequest;
export type AllQuotesResponse = { quotes: Array<{ provider: SwapQuoteResponse["provider"]; quote: SwapQuoteResponse }> };

export async function getAllQuotes(
  params: AllQuotesRequest
): Promise<{ ok: true; data: AllQuotesResponse } | { ok: false; error: string }> {
  const sameChain = params.from_chain === params.to_chain;
  const providers: ("0x" | "squid" | "lifi")[] = sameChain ? ["0x", "squid", "lifi"] : ["squid", "lifi"];

  const results = await Promise.allSettled(
    providers.map((provider) =>
      getSwapQuote({
        ...params,
        provider,
      })
    )
  );

  const quotes: Array<{ provider: SwapQuoteResponse["provider"]; quote: SwapQuoteResponse }> = [];
  providers.forEach((provider, i) => {
    const r = results[i];
    if (r?.status === "fulfilled" && r.value.ok) {
      quotes.push({ provider, quote: r.value.quote });
    }
  });

  return { ok: true, data: { quotes } };
}
