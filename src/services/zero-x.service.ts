/**
 * 0x Swap API integration for token swap quotes.
 * Uses permit2 quote endpoint: https://api.0x.org/swap/permit2/quote
 */

import { getEnv } from "../config/env.js";

const ZEROX_BASE = "https://api.0x.org";

export type ZeroXQuoteParams = {
  chainId: number;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  taker?: string;
};

/** Normalized quote result for our API. */
export type ZeroXQuoteResult = {
  buyAmount: string;
  sellAmount: string;
  buyToken: string;
  sellToken: string;
  chainId: number;
  /** Raw 0x response for advanced use (permit2, gas, etc.). */
  raw?: Record<string, unknown>;
};

/** 0x API error or no-liquidity response. */
export type ZeroXQuoteError = {
  code?: string;
  reason?: string;
  message?: string;
};

/**
 * Fetch a swap quote from 0x (permit2 endpoint).
 * Requires ZEROX_API_KEY in env. sellToken/buyToken are contract addresses (use 0xeeee... for native ETH).
 */
export async function getZeroXSwapQuote(
  params: ZeroXQuoteParams
): Promise<{ ok: true; quote: ZeroXQuoteResult } | { ok: false; error: string; status?: number }> {
  const apiKey = getEnv().ZEROX_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "0x API key not configured (ZEROX_API_KEY)" };
  }

  const search = new URLSearchParams({
    chainId: params.chainId.toString(),
    sellToken: params.sellToken,
    buyToken: params.buyToken,
    sellAmount: params.sellAmount,
  });
  if (params.taker) {
    search.set("taker", params.taker);
  }

  const url = `${ZEROX_BASE}/swap/permit2/quote?${search.toString()}`;
  const headers: Record<string, string> = {
    "0x-api-key": apiKey,
    "0x-version": "v2",
  };

  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `0x request failed: ${message}` };
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { buyAmount?: string; sellAmount?: string; buyToken?: string; sellToken?: string; code?: string; reason?: string };

  if (!res.ok) {
    const msg = (data.reason as string) ?? (data.message as string) ?? `HTTP ${res.status}`;
    return { ok: false, error: msg, status: res.status };
  }

  const buyAmount = typeof data.buyAmount === "string" ? data.buyAmount : String(data.buyAmount ?? "0");
  const sellAmount = typeof data.sellAmount === "string" ? data.sellAmount : params.sellAmount;

  return {
    ok: true,
    quote: {
      buyAmount,
      sellAmount,
      buyToken: (data.buyToken as string) ?? params.buyToken,
      sellToken: (data.sellToken as string) ?? params.sellToken,
      chainId: params.chainId,
      raw: data,
    },
  };
}
