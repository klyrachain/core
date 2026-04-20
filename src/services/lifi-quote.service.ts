/**
 * LiFi quote integration for swap/bridge quotes.
 * Docs: https://docs.li.fi/
 * Accepts 0x0000 or 0xEeee for native; we normalize to 0x0000.
 * Calldata requires separate POST /advanced/stepTransaction (quotes-only in response).
 */

import { getEnv } from "../config/env.js";
import { getSwapFeeConfigForProvider } from "./platform-settings.service.js";
import { toLiFiNativeToken } from "../lib/native-token.js";
import { toLiFiChainId } from "../lib/aggregator-chain-ids.js";
import type { SwapQuoteRequest, SwapQuoteResponse } from "../lib/swap-quote.types.js";

const LIFI_BASE = "https://li.quest/v1";

function getApiKey(): string | null {
  const key = getEnv().LIFI_API_KEY;
  return key && key.length > 0 ? key : null;
}

export function isLiFiConfigured(): boolean {
  return true; // LiFi works without API key (rate limits)
}

type LiFiRoute = {
  id: string;
  fromChainId: number;
  toChainId: number;
  fromAmount: string;
  toAmount: string;
  toAmountMin?: string;
  steps?: Array<{ estimate?: { executionDuration?: number } }>;
};

type LiFiRoutesResponse = {
  routes?: LiFiRoute[];
  message?: string;
};

/**
 * Fetch swap/bridge quote from LiFi. Returns normalized quote; no transaction (use stepTransaction later to build tx).
 */
export async function getLiFiQuote(
  params: SwapQuoteRequest
): Promise<{ ok: true; quote: SwapQuoteResponse } | { ok: false; error: string; status?: number }> {
  const fromAddress = params.from_address?.trim();
  if (!fromAddress) {
    return { ok: false, error: "from_address is required for LiFi quotes" };
  }

  const fromToken = toLiFiNativeToken(params.from_token);
  const toToken = toLiFiNativeToken(params.to_token);

  const config = await getSwapFeeConfigForProvider();
  const env = getEnv();
  const integrator = config.lifiIntegrator?.trim() || env.LIFI_INTEGRATOR?.trim() || "klyra";
  const feePercent = config.lifiFeePercent ?? env.LIFI_FEE_PERCENT;
  const options: Record<string, unknown> = {
    slippage: params.slippage ?? 0.005,
    integrator,
    order: "CHEAPEST",
    maxPriceImpact: 0.1,
  };
  if (typeof feePercent === "number" && feePercent >= 0 && feePercent < 1) {
    options.fee = feePercent;
  }
  const body = {
    fromChainId: toLiFiChainId(params.from_chain),
    toChainId: toLiFiChainId(params.to_chain),
    fromTokenAddress: fromToken,
    toTokenAddress: toToken,
    fromAmount: params.amount,
    fromAddress,
    toAddress: params.to_address?.trim() || fromAddress,
    options,
  };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = getApiKey();
  if (apiKey) headers["x-lifi-api-key"] = apiKey;

  let res: Response;
  try {
    res = await fetch(`${LIFI_BASE}/advanced/routes`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `LiFi request failed: ${message}` };
  }

  const data = (await res.json().catch(() => ({}))) as LiFiRoutesResponse & { message?: string };

  if (!res.ok) {
    const msg = data.message ?? `HTTP ${res.status}`;
    return { ok: false, error: String(msg), status: res.status };
  }

  const routes = data.routes;
  if (!routes || routes.length === 0) {
    return { ok: false, error: "No LiFi routes found" };
  }

  const best = routes[0];
  const crossChain = params.from_chain !== params.to_chain;
  const sameToken = fromToken.toLowerCase() === toToken.toLowerCase();

  let estimatedDuration: number | null = null;
  const firstStep = best.steps?.[0];
  if (firstStep?.estimate?.executionDuration != null) {
    estimatedDuration = firstStep.estimate.executionDuration;
  }

  const quote: SwapQuoteResponse = {
    provider: "lifi",
    from_chain_id: params.from_chain,
    to_chain_id: params.to_chain,
    cross_chain: crossChain,
    same_chain: !crossChain,
    token_type: sameToken ? "same_token" : "cross_token",
    from_amount: best.fromAmount,
    to_amount: best.toAmount,
    next_quote_timer_seconds: null,
    estimated_duration_seconds: estimatedDuration,
    transaction: null, // LiFi requires POST /advanced/stepTransaction to get calldata
  };

  return { ok: true, quote };
}
