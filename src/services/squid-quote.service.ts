/**
 * Squid Router quote integration for swap/bridge quotes.
 * Docs: https://docs.squidrouter.com/
 * Uses 0xeeee... for native token.
 */

import { getEnv } from "../config/env.js";
import { getSwapFeeConfigForProvider } from "./platform-settings.service.js";
import { toSquidNativeToken } from "../lib/native-token.js";
import { toSquidChainParam } from "../lib/aggregator-chain-ids.js";
import type { SwapQuoteRequest, SwapQuoteResponse, SwapQuoteTransaction } from "../lib/swap-quote.types.js";

const SQUID_BASE = "https://v2.api.squidrouter.com/v2";

const NATIVE_SQUID_LOWER = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

/** Squid accepts lowercase ERC-20 addresses; keep 0xeeee… for native. */
function normalizeSquidTokenAddress(addr: string): string {
  const t = toSquidNativeToken(addr.trim());
  if (t.toLowerCase() === NATIVE_SQUID_LOWER) return t;
  if (/^0x[a-fA-F0-9]{40}$/.test(t)) return t.toLowerCase();
  return t;
}

function getIntegratorId(): string | null {
  const id = getEnv().SQUID_INTEGRATOR_ID;
  return id && id.length > 0 ? id : null;
}

export function isSquidConfigured(): boolean {
  return getIntegratorId() !== null;
}

type SquidRouteResponse = {
  route: {
    estimate: {
      fromAmount: string;
      toAmount: string;
      toAmountMin: string;
      estimatedRouteDuration: number;
    };
    transactionRequest?: {
      target: string;
      data: string;
      value: string;
      gasLimit?: string;
      gasPrice?: string;
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: string;
    };
  };
};

/**
 * Fetch swap/bridge quote from Squid (v2 /route).
 * Uses quoteOnly=true and empty toAddress when unset — matches Squid quote exploration; quoteOnly:false
 * can return errors like "swaps unavailable" for routes that still return estimates with quoteOnly:true.
 */
export async function getSquidQuote(
  params: SwapQuoteRequest
): Promise<{ ok: true; quote: SwapQuoteResponse } | { ok: false; error: string; status?: number }> {
  const integratorId = getIntegratorId();
  if (!integratorId) {
    return { ok: false, error: "Squid integrator ID not configured (SQUID_INTEGRATOR_ID)" };
  }

  const fromAddress = params.from_address?.trim();
  if (!fromAddress) {
    return { ok: false, error: "from_address is required for Squid quotes" };
  }

  const fromToken = normalizeSquidTokenAddress(params.from_token);
  const toToken = normalizeSquidTokenAddress(params.to_token);
  const toAddrRaw = params.to_address?.trim();
  const toAddress = toAddrRaw != null && toAddrRaw !== "" ? toAddrRaw : "";

  const body: Record<string, unknown> = {
    fromAddress,
    fromChain: toSquidChainParam(params.from_chain),
    fromToken,
    fromAmount: params.amount,
    toChain: toSquidChainParam(params.to_chain),
    toToken,
    toAddress,
    slippage: params.slippage ?? 1,
    enableBoost: false,
    quoteOnly: true,
  };

  const config = await getSwapFeeConfigForProvider();
  const feeRecipient = config.squidFeeRecipient?.trim() || getEnv().SQUID_FEE_RECIPIENT?.trim();
  const feeBps = config.squidFeeBps ?? getEnv().SQUID_FEE_BPS;
  if (feeRecipient && /^0x[a-fA-F0-9]{40}$/.test(feeRecipient) && typeof feeBps === "number" && feeBps >= 0 && feeBps <= 10000) {
    body.collectFees = {
      integratorAddress: feeRecipient,
      fee: feeBps,
    };
  }

  let res: Response;
  try {
    res = await fetch(`${SQUID_BASE}/route`, {
      method: "POST",
      headers: {
        "x-integrator-id": integratorId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Squid request failed: ${message}` };
  }

  const data = (await res.json().catch(() => ({}))) as
    | SquidRouteResponse
    | { message?: string; error?: string };

  if (!res.ok) {
    const msg =
      (data as { message?: string }).message ??
      (data as { error?: string }).error ??
      `HTTP ${res.status}`;
    return { ok: false, error: String(msg), status: res.status };
  }

  const route = (data as SquidRouteResponse).route;
  if (!route?.estimate) {
    return { ok: false, error: "Invalid Squid route response" };
  }

  const crossChain = params.from_chain !== params.to_chain;
  const sameToken = fromToken.toLowerCase() === toToken.toLowerCase();

  let transaction: SwapQuoteTransaction | null = null;
  const tr = route.transactionRequest;
  if (
    tr &&
    typeof tr.target === "string" &&
    tr.target.length > 0 &&
    typeof tr.data === "string" &&
    tr.data.length > 0
  ) {
    transaction = {
      target: tr.target,
      data: tr.data,
      value: tr.value ?? "0",
      gas_limit: tr.gasLimit,
      gas_price: tr.gasPrice,
      max_fee_per_gas: tr.maxFeePerGas,
      max_priority_fee_per_gas: tr.maxPriorityFeePerGas,
    };
  }

  const estimatedDuration =
    route.estimate.estimatedRouteDuration > 0 ? route.estimate.estimatedRouteDuration : null;

  const quote: SwapQuoteResponse = {
    provider: "squid",
    from_chain_id: params.from_chain,
    to_chain_id: params.to_chain,
    cross_chain: crossChain,
    same_chain: !crossChain,
    token_type: sameToken ? "same_token" : "cross_token",
    from_amount: route.estimate.fromAmount,
    to_amount: route.estimate.toAmount,
    next_quote_timer_seconds: null,
    estimated_duration_seconds: estimatedDuration,
    transaction,
  };

  return { ok: true, quote };
}
