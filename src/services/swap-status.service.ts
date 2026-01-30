/**
 * Swap status / verification: check transaction status with 0x, Squid, LiFi.
 * Used to verify recorded crypto transactions and optionally update our DB.
 */

import { getEnv } from "../config/env.js";

const ZEROX_BASE = "https://api.0x.org";
const SQUID_BASE = "https://v2.api.squidrouter.com/v2";
const LIFI_BASE = "https://li.quest/v1";

export type SwapProvider = "0x" | "squid" | "lifi";

/** Normalized status returned to API. */
export type NormalizedStatus = "PENDING" | "SUBMITTED" | "CONFIRMED" | "FAILED";

export type SwapStatusResult = {
  ok: true;
  provider: SwapProvider;
  normalized: NormalizedStatus;
  providerStatus: string;
  providerMessage?: string;
  txHash?: string;
  txUrl?: string;
  raw?: Record<string, unknown>;
} | {
  ok: false;
  error: string;
  status?: number;
};

/** 0x: GET /tx-relay/v1/swap/status/:trade-hash. Headers: 0x-api-key, 0x-chain-id. */
export async function get0xSwapStatus(
  tradeHash: string,
  chainId: number
): Promise<SwapStatusResult> {
  const apiKey = getEnv().ZEROX_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "0x API key not configured (ZEROX_API_KEY)" };
  }
  const url = `${ZEROX_BASE}/tx-relay/v1/swap/status/${encodeURIComponent(tradeHash.trim())}`;
  const headers: Record<string, string> = {
    "0x-api-key": apiKey,
    "0x-chain-id": chainId.toString(),
  };
  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `0x request failed: ${message}` };
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
    status?: string;
    reason?: string;
    transactions?: Array<{ hash?: string; timestamp?: number }>;
  };
  if (!res.ok) {
    const msg = (data.reason as string) ?? (data.message as string) ?? `HTTP ${res.status}`;
    return { ok: false, error: msg, status: res.status };
  }
  const status = (data.status as string) ?? "";
  const normalized = map0xStatusToNormalized(status);
  const txHash = data.transactions?.[0]?.hash;
  return {
    ok: true,
    provider: "0x",
    normalized,
    providerStatus: status,
    providerMessage: data.reason as string | undefined,
    txHash: typeof txHash === "string" ? txHash : undefined,
    raw: data as Record<string, unknown>,
  };
}

function map0xStatusToNormalized(status: string): NormalizedStatus {
  switch (status.toLowerCase()) {
    case "pending":
      return "PENDING";
    case "submitted":
      return "SUBMITTED";
    case "succeeded":
    case "confirmed":
      return "CONFIRMED";
    case "failed":
      return "FAILED";
    default:
      return "PENDING";
  }
}

/** Squid: GET /v2/status?transactionId=&fromChainId=&toChainId=. Header: x-integrator-id. */
export async function getSquidSwapStatus(
  transactionId: string,
  fromChainId: number,
  toChainId: number
): Promise<SwapStatusResult> {
  const integratorId = getEnv().SQUID_INTEGRATOR_ID;
  if (!integratorId) {
    return { ok: false, error: "Squid integrator ID not configured (SQUID_INTEGRATOR_ID)" };
  }
  const params = new URLSearchParams({
    transactionId: transactionId.trim(),
    fromChainId: String(fromChainId),
    toChainId: String(toChainId),
  });
  const url = `${SQUID_BASE}/status?${params.toString()}`;
  const headers: Record<string, string> = {
    "x-integrator-id": integratorId,
  };
  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Squid request failed: ${message}` };
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
    squidTransactionStatus?: string;
    fromChain?: { transactionId?: string; explorerUrl?: string };
    toChain?: { transactionId?: string; explorerUrl?: string };
  };
  if (!res.ok) {
    const msg = (data.message as string) ?? `HTTP ${res.status}`;
    return { ok: false, error: msg, status: res.status };
  }
  const status = (data.squidTransactionStatus as string) ?? "";
  const normalized = mapSquidStatusToNormalized(status);
  const txHash = data.fromChain?.transactionId ?? data.toChain?.transactionId;
  const txUrl = data.fromChain?.explorerUrl ?? data.toChain?.explorerUrl;
  return {
    ok: true,
    provider: "squid",
    normalized,
    providerStatus: status,
    txHash: typeof txHash === "string" ? txHash : undefined,
    txUrl: typeof txUrl === "string" ? txUrl : undefined,
    raw: data as Record<string, unknown>,
  };
}

function mapSquidStatusToNormalized(status: string): NormalizedStatus {
  switch (status.toUpperCase()) {
    case "SUCCESS":
      return "CONFIRMED";
    case "NEEDS_GAS":
    case "ONGOING":
    case "NOT_FOUND":
      return "SUBMITTED";
    case "PARTIAL_SUCCESS":
    case "REFUND_STATUS":
      return "FAILED";
    default:
      return "PENDING";
  }
}

/** LiFi: GET /v1/status?txHash=&fromChain=&toChain=. Optional header: x-lifi-api-key. */
export async function getLiFiSwapStatus(
  txHash: string,
  fromChainId?: number,
  toChainId?: number
): Promise<SwapStatusResult> {
  const params = new URLSearchParams({ txHash: txHash.trim() });
  if (fromChainId != null) params.set("fromChain", String(fromChainId));
  if (toChainId != null) params.set("toChain", String(toChainId));
  const url = `${LIFI_BASE}/status?${params.toString()}`;
  const headers: Record<string, string> = {};
  const apiKey = getEnv().LIFI_API_KEY;
  if (apiKey) headers["x-lifi-api-key"] = apiKey;
  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `LiFi request failed: ${message}` };
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
    status?: string;
    substatusMessage?: string;
    sending?: { txHash?: string; txLink?: string };
    lifiExplorerLink?: string;
  };
  if (!res.ok) {
    const msg = (data.message as string) ?? `HTTP ${res.status}`;
    return { ok: false, error: msg, status: res.status };
  }
  const status = (data.status as string) ?? "";
  const normalized = mapLiFiStatusToNormalized(status);
  const txLink = data.sending?.txLink ?? data.lifiExplorerLink;
  return {
    ok: true,
    provider: "lifi",
    normalized,
    providerStatus: status,
    providerMessage: data.substatusMessage as string | undefined,
    txHash: data.sending?.txHash ?? txHash,
    txUrl: typeof txLink === "string" ? txLink : undefined,
    raw: data as Record<string, unknown>,
  };
}

function mapLiFiStatusToNormalized(status: string): NormalizedStatus {
  switch (status.toUpperCase()) {
    case "DONE":
      return "CONFIRMED";
    case "PENDING":
      return "SUBMITTED";
    case "FAILED":
    case "INVALID":
      return "FAILED";
    case "NOT_FOUND":
    default:
      return "PENDING";
  }
}

/**
 * Get swap status from the given provider. Use when you have tx_hash and provider.
 */
export async function getSwapStatusFromProvider(
  provider: SwapProvider,
  txHash: string,
  fromChainId: number,
  toChainId: number
): Promise<SwapStatusResult> {
  switch (provider) {
    case "0x":
      return get0xSwapStatus(txHash, fromChainId);
    case "squid":
      return getSquidSwapStatus(txHash, fromChainId, toChainId);
    case "lifi":
      return getLiFiSwapStatus(txHash, fromChainId, toChainId);
    default:
      return { ok: false, error: `Unknown provider: ${provider}` };
  }
}
