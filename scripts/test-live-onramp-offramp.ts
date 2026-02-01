#!/usr/bin/env node
/**
 * Live test — onramp (Paystack → KLYRA) and offramp (KLYRA → Paystack) only.
 * Onramp: fiat (MOMO/BANK) → onchain token (target is an address on ETHEREUM/BASE etc., not offchain).
 * Offramp: onchain token (source is address on ETHEREUM/BASE etc.) → fiat (MOMO/BANK).
 * Logs: amounts, tokens, chains, cost price, fee, reported prices, provider prices, etc.
 *
 * Usage: pnpm test:live:onramp-offramp [--scenario onramp|offramp|all] [--delay ms] [--live]
 * Env: CORE_URL (default http://localhost:4000), CORE_API_KEY (required).
 */

import "dotenv/config";

const CORE_URL = process.env.CORE_URL ?? "http://localhost:4000";
const CORE_API_KEY = process.env.CORE_API_KEY ?? "";

const TOTAL_PREMIUM_CAP = 0.06;
const TOTAL_DISCOUNT_CAP = 0.06;
const DEFAULT_PROVIDER_FEE = 0.005;

function volatilityToPremium(volatility: number): number {
  const v = volatility < 0 ? 0 : volatility;
  if (v < 0.005) return 0;
  if (v < 0.015) return 0.005;
  if (v < 0.03) return 0.015;
  return 0.03;
}

function effectiveBaseProfit(platformFeePercent: number, providerFeeDecimal: number): number {
  const platform = platformFeePercent / 100;
  const provider = typeof providerFeeDecimal === "number" ? providerFeeDecimal : 0;
  return Math.min(platform + provider, 0.06);
}

function quoteOnRamp(input: {
  providerPrice: number;
  baseProfit: number;
  volatility: number;
  avgBuyPrice?: number;
}): number {
  const { providerPrice, baseProfit, volatility } = input;
  if (providerPrice <= 0) throw new Error("providerPrice must be positive");
  const avgBuyPrice = input.avgBuyPrice ?? 0;
  const inventoryRisk =
    avgBuyPrice > providerPrice ? Math.max(0, (avgBuyPrice - providerPrice) / providerPrice) : 0;
  const volatilityPremium = volatilityToPremium(volatility);
  const totalPremium = Math.min(baseProfit + inventoryRisk + volatilityPremium, TOTAL_PREMIUM_CAP);
  return providerPrice * (1 + totalPremium);
}

function quoteOffRamp(input: {
  providerPrice: number;
  baseProfit: number;
  volatility: number;
  fiatUtilization?: number;
}): number {
  const { providerPrice, baseProfit, volatility } = input;
  if (providerPrice <= 0) throw new Error("providerPrice must be positive");
  const fiatUtil = Math.min(1, Math.max(0, input.fiatUtilization ?? 0));
  const volatilityPremium = volatilityToPremium(volatility);
  const fiatRiskPremium = fiatUtil * 0.02;
  const totalDiscount = Math.min(
    baseProfit + volatilityPremium + fiatRiskPremium,
    TOTAL_DISCOUNT_CAP
  );
  return providerPrice * (1 - totalDiscount);
}

function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

const TEST_USERS = [
  { email: "alice@example.com", address: "0xf0830060f836B8d54bF02049E5905F619487989e", type: "EMAIL" as const },
  { number: "233201234567", address: "0xf0830060f836B8d54bF02049E5905F619487989e", type: "NUMBER" as const },
];
const PAYSTACK_IDENTIFIER = TEST_USERS[0].email ?? (TEST_USERS[1] as { number?: string }).number ?? "";
const PAYSTACK_FROM_TYPE = "EMAIL" as const;
const PAYSTACK_TO_TYPE = "NUMBER" as const;

type SupportedPair = { chainCode: string; chainId: number; symbol: string };
let supportedOnchain: SupportedPair[] = [];
let supportedFiatChains: string[] = [];
/** Onchain only: exclude fiat rails (MOMO, BANK). Onramp targets and offramp sources must be onchain (address), not offchain. */
let onchainOnlyPairs: SupportedPair[] = [];
/** Onchain pairs that have a balance in Redis (from inventory). Use these for transactions. */
let onchainWithBalance: SupportedPair[] = [];
/** Cached balance amount by "chain:token" (from Redis after sync). */
let balanceByChainToken: Map<string, number> = new Map();

async function fetchJson(
  path: string,
  options?: RequestInit
): Promise<{ ok: boolean; status: number; data?: unknown; error?: string; code?: string }> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options?.headers as Record<string, string>),
    };
    if (CORE_API_KEY) headers["x-api-key"] = CORE_API_KEY;
    const res = await fetch(`${CORE_URL}${path}`, { ...options, headers });
    const body = await res.json().catch(() => ({}));
    const data = (body as { data?: unknown }).data;
    const error = (body as { error?: string }).error;
    const code = (body as { code?: string }).code;
    return { ok: res.ok, status: res.status, data, error, code };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

async function getSupportedChainsAndTokens(): Promise<{ onchain: SupportedPair[]; fiatChains: string[] }> {
  const chainsRes = await fetchJson("/api/chains");
  const tokensRes = await fetchJson("/api/tokens");
  const chains = (chainsRes.data as { chains?: Array<{ chainId: number; name: string }> })?.chains ?? [];
  const tokens = (tokensRes.data as { tokens?: Array<{ chainId: number; symbol: string }> })?.tokens ?? [];
  const chainIdToCode = new Map(chains.map((c) => [c.chainId, c.name.toUpperCase()]));
  const onchain: SupportedPair[] = [];
  for (const t of tokens) {
    const code = chainIdToCode.get(t.chainId);
    if (code) onchain.push({ chainCode: code, chainId: t.chainId, symbol: t.symbol });
  }
  const fiatCodes = ["MOMO", "BANK", "CARD"];
  const fiatChains = chains.map((c) => c.name.toUpperCase()).filter((code) => fiatCodes.includes(code));
  return { onchain, fiatChains };
}

async function getPricingQuote(chain?: string, token?: string): Promise<{
  pricingQuote: { providerBuyPrice: number; providerSellPrice: number; volatility: number; costPrice?: number } | null;
  platformFee: { baseFeePercent: number; fixedFee: number } | null;
}> {
  const q = new URLSearchParams();
  if (chain) q.set("chain", chain);
  if (token) q.set("token", token);
  const path = q.toString() ? `/api/validation/pricing-quote?${q.toString()}` : "/api/validation/pricing-quote";
  const res = await fetchJson(path);
  if (!res.ok || !res.data || typeof res.data !== "object") return { pricingQuote: null, platformFee: null };
  const o = res.data as {
    pricingQuote?: { providerBuyPrice?: number; providerSellPrice?: number; volatility?: number; costPrice?: number };
    platformFee?: { baseFeePercent?: number; fixedFee?: number };
  };
  const pricingQuote =
    o.pricingQuote &&
    typeof o.pricingQuote.providerBuyPrice === "number" &&
    typeof o.pricingQuote.providerSellPrice === "number" &&
    typeof o.pricingQuote.volatility === "number"
      ? {
          providerBuyPrice: o.pricingQuote.providerBuyPrice,
          providerSellPrice: o.pricingQuote.providerSellPrice,
          volatility: o.pricingQuote.volatility,
          costPrice: o.pricingQuote.costPrice,
        }
      : null;
  const platformFee =
    o.platformFee && typeof o.platformFee.baseFeePercent === "number"
      ? { baseFeePercent: o.platformFee.baseFeePercent, fixedFee: o.platformFee.fixedFee ?? 0 }
      : null;
  return { pricingQuote, platformFee };
}

/** Get onramp/offramp quote from API (Fonbnk). Used so order amounts match server validation. */
async function getOnrampQuoteFromApi(params: {
  country: string;
  chain_id: number;
  token: string;
  amount: number;
  amount_in: "fiat" | "crypto";
  purchase_method: "buy" | "sell";
}): Promise<{ total_crypto: string; total_fiat: number } | null> {
  const res = await fetchJson("/api/quote/onramp", {
    method: "POST",
    body: JSON.stringify({
      country: params.country,
      chain_id: params.chain_id,
      token: params.token,
      amount: params.amount,
      amount_in: params.amount_in,
      purchase_method: params.purchase_method,
    }),
  });
  if (!res.ok || !res.data || typeof res.data !== "object") return null;
  const d = res.data as { total_crypto?: string; total_fiat?: number };
  if (d.total_crypto == null || d.total_fiat == null) return null;
  return { total_crypto: String(d.total_crypto), total_fiat: Number(d.total_fiat) };
}

async function getFeeQuote(params: {
  action: string;
  f_amount: number;
  t_amount: number;
  f_price: number;
  t_price: number;
  f_chain: string;
  t_chain: string;
  f_token: string;
  t_token: string;
}): Promise<{ feeAmount?: number; totalCost?: number; totalReceived?: number; profit?: number } | null> {
  const q = new URLSearchParams({
    action: params.action,
    f_amount: String(params.f_amount),
    t_amount: String(params.t_amount),
    f_price: String(params.f_price),
    t_price: String(params.t_price),
    f_chain: params.f_chain,
    t_chain: params.t_chain,
    f_token: params.f_token,
    t_token: params.t_token,
  });
  const res = await fetchJson(`/api/quote?${q.toString()}`);
  if (!res.ok || !res.data || typeof res.data !== "object") return null;
  return res.data as { feeAmount?: number; totalCost?: number; totalReceived?: number; profit?: number };
}

async function getBalance(chain: string, token: string): Promise<number | null> {
  const res = await fetchJson(`/api/cache/balances/${encodeURIComponent(chain)}/${encodeURIComponent(token)}`);
  if (!res.ok || !res.data || typeof res.data !== "object") return null;
  const amount = (res.data as { amount?: string }).amount;
  if (amount == null) return null;
  const n = parseFloat(amount);
  return Number.isFinite(n) ? n : null;
}

/** Refresh validation cache from DB (chains, tokens, etc.) so MOMO/BANK and new chains are included. Call at startup. */
async function refreshValidationCache(): Promise<void> {
  const res = await fetchJson("/api/validation/cache/refresh", { method: "POST" });
  if (!res.ok) {
    console.warn("Validation cache refresh failed:", res.status, res.error);
    return;
  }
  console.log("Validation cache refreshed (chains/tokens from DB).");
}

/** Sync inventory to Redis, then load all cached balances. Call at startup so transactions use Redis balances. */
async function syncAndLoadBalances(): Promise<void> {
  const syncRes = await fetchJson("/api/cache/sync-balances", { method: "POST" });
  if (!syncRes.ok) {
    console.warn("Sync balances failed:", syncRes.status, syncRes.error);
    return;
  }
  const synced = (syncRes.data as { synced?: number })?.synced ?? 0;

  const listRes = await fetchJson("/api/cache/balances?limit=100");
  if (!listRes.ok || !Array.isArray(listRes.data)) return;
  const items = listRes.data as Array<{ chain?: string; token?: string; amount?: string }>;
  balanceByChainToken = new Map();
  for (const item of items) {
    const chain = item.chain ?? "";
    const token = item.token ?? "";
    const amount = item.amount != null ? parseFloat(item.amount) : 0;
    if (chain && token && Number.isFinite(amount)) {
      balanceByChainToken.set(`${chain}:${token}`, amount);
    }
  }

  onchainWithBalance = onchainOnlyPairs.filter((p) => {
    const amt = balanceByChainToken.get(`${p.chainCode}:${p.symbol}`);
    return amt != null && amt > 0;
  });
  if (synced > 0 || onchainWithBalance.length > 0) {
    console.log(`Synced ${synced} balances to Redis; ${onchainWithBalance.length} onchain pairs with balance > 0.`);
  }
}

function buildOrderPayload(opts: {
  action: "buy" | "sell";
  f_amount: number;
  t_amount: number;
  f_price: number;
  t_price: number;
  f_chain: string;
  t_chain: string;
  f_token: string;
  t_token: string;
  f_provider: "KLYRA" | "PAYSTACK";
  t_provider: "KLYRA" | "PAYSTACK";
  fromType?: "ADDRESS" | "EMAIL" | "NUMBER";
  toType?: "ADDRESS" | "EMAIL" | "NUMBER";
}): Record<string, unknown> {
  const fromId = opts.fromType === "ADDRESS" ? (TEST_USERS[0] as { address?: string }).address : PAYSTACK_IDENTIFIER;
  const toId = opts.toType === "ADDRESS" ? (TEST_USERS[0] as { address?: string }).address : PAYSTACK_IDENTIFIER;
  const fromType = opts.fromType ?? (opts.f_provider === "PAYSTACK" ? PAYSTACK_FROM_TYPE : "ADDRESS");
  const toType = opts.toType ?? (opts.t_provider === "KLYRA" ? "ADDRESS" : PAYSTACK_TO_TYPE);
  return {
    action: opts.action,
    fromIdentifier: fromId,
    fromType,
    toIdentifier: toId,
    toType,
    f_amount: round8(opts.f_amount),
    t_amount: round8(opts.t_amount),
    f_price: round8(opts.f_price),
    t_price: round8(opts.t_price),
    f_chain: opts.f_chain,
    t_chain: opts.t_chain,
    f_token: opts.f_token,
    t_token: opts.t_token,
    f_provider: opts.f_provider,
    t_provider: opts.t_provider,
  };
}

/** Rich log: flow, amounts, tokens, chains, cost price, fee, reported prices, provider prices, etc. */
function logOnrampOfframp(opts: {
  flow: "Paystack → KLYRA (onramp)" | "KLYRA → Paystack (offramp)";
  f_chain: string;
  t_chain: string;
  f_token: string;
  t_token: string;
  f_amount: number;
  t_amount: number;
  f_price: number;
  t_price: number;
  providerBuyPrice?: number;
  providerSellPrice?: number;
  costPrice?: number;
  platformFeePercent?: number;
  platformFixedFee?: number;
  feeAmount?: number;
  profit?: number;
  totalCost?: number;
  totalReceived?: number;
  volatility?: number;
  orderId?: string;
  status: "created" | "skip" | "error";
  message?: string;
}): void {
  const ts = new Date().toISOString();
  const fAmountStr = opts.status !== "created" && opts.f_amount === 0 ? "n/a" : String(opts.f_amount);
  const tAmountStr = opts.status !== "created" && opts.t_amount === 0 ? "n/a" : String(opts.t_amount);
  const lines = [
    `[${ts}] ---------- ${opts.flow} ----------`,
    `  flow          ${opts.flow}`,
    `  f_chain       ${opts.f_chain}   t_chain       ${opts.t_chain}`,
    `  f_token       ${opts.f_token}   t_token       ${opts.t_token}`,
    `  f_amount      ${fAmountStr}   t_amount      ${tAmountStr}`,
    `  f_price       ${opts.f_price}   t_price       ${opts.t_price}   (reported prices in order)`,
    `  providerBuy   ${opts.providerBuyPrice ?? "-"}   providerSell  ${opts.providerSellPrice ?? "-"}`,
    `  costPrice     ${opts.costPrice ?? "-"}   (inventory cost basis)`,
    `  platformFee   ${opts.platformFeePercent ?? "-"}%   fixedFee   ${opts.platformFixedFee ?? "-"}`,
    `  feeAmount     ${opts.feeAmount ?? "-"}   profit       ${opts.profit ?? "-"}`,
    `  totalCost     ${opts.totalCost ?? "-"}   totalReceived ${opts.totalReceived ?? "-"}`,
    `  volatility    ${opts.volatility ?? "-"}`,
    `  status        ${opts.status}${opts.orderId ? `   orderId   ${opts.orderId}` : ""}${opts.message ? `   ${opts.message}` : ""}`,
  ];
  console.log(lines.join("\n"));
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- Onramp: Paystack → KLYRA (fiat → onchain token). Target = onchain address only (exclude fiat chains). ----------
async function runOnramp(): Promise<boolean> {
  const ts = new Date().toISOString();
  if (supportedFiatChains.length === 0) {
    logOnrampOfframp({
      flow: "Paystack → KLYRA (onramp)",
      f_chain: "-",
      t_chain: "-",
      f_token: "-",
      t_token: "-",
      f_amount: 0,
      t_amount: 0,
      f_price: 0,
      t_price: 0,
      status: "skip",
      message: "no supported fiat chain (MOMO/BANK)",
    });
    return false;
  }
  if (onchainOnlyPairs.length === 0) {
    logOnrampOfframp({
      flow: "Paystack → KLYRA (onramp)",
      f_chain: "-",
      t_chain: "-",
      f_token: "-",
      t_token: "-",
      f_amount: 0,
      t_amount: 0,
      f_price: 0,
      t_price: 0,
      status: "skip",
      message: "no onchain target pairs (need ETHEREUM/BASE etc., not MOMO/BANK)",
    });
    return false;
  }
  const f_chain = supportedFiatChains[0];
  const f_token = f_chain === "MOMO" ? "GHS" : "USD";
  const tOpt = onchainWithBalance.length > 0 ? randomChoice(onchainWithBalance) : randomChoice(onchainOnlyPairs);
  const t_chain = tOpt.chainCode;
  const t_token = tOpt.symbol;

  const { pricingQuote, platformFee } = await getPricingQuote(t_chain, t_token);
  if (!pricingQuote || !platformFee) {
    logOnrampOfframp({
      flow: "Paystack → KLYRA (onramp)",
      f_chain,
      t_chain,
      f_token,
      t_token,
      f_amount: 0,
      t_amount: 0,
      f_price: 0,
      t_price: 0,
      status: "skip",
      message: "no pricing quote",
    });
    return false;
  }

  const balance = await getBalance(t_chain, t_token);
  const country = "GH";
  const chainId = tOpt.chainId;
  const intendedFiat = 51;
  const onrampQuote = await getOnrampQuoteFromApi({
    country,
    chain_id: chainId,
    token: t_token,
    amount: intendedFiat,
    amount_in: "fiat",
    purchase_method: "buy",
  });

  let f_amount: number;
  let t_amount: number;
  let t_price: number;
  let f_price: number;

  if (onrampQuote) {
    t_amount = parseFloat(onrampQuote.total_crypto);
    f_amount = onrampQuote.total_fiat;
    if (!Number.isFinite(t_amount) || t_amount <= 0 || !Number.isFinite(f_amount) || f_amount <= 0) {
      logOnrampOfframp({
        flow: "Paystack → KLYRA (onramp)",
        f_chain,
        t_chain,
        f_token,
        t_token,
        f_amount: 0,
        t_amount: 0,
        f_price: 0,
        t_price: 0,
        status: "skip",
        message: "onramp quote returned invalid amounts",
      });
      return false;
    }
    if (balance != null && balance > 0 && t_amount > balance * 0.1) {
      logOnrampOfframp({
        flow: "Paystack → KLYRA (onramp)",
        f_chain,
        t_chain,
        f_token,
        t_token,
        f_amount,
        t_amount,
        f_price: 1,
        t_price: t_amount > 0 ? f_amount / t_amount : 0,
        providerBuyPrice: pricingQuote.providerBuyPrice,
        costPrice: pricingQuote.costPrice,
        platformFeePercent: platformFee.baseFeePercent,
        platformFixedFee: platformFee.fixedFee,
        volatility: pricingQuote.volatility,
        status: "skip",
        message: `KLYRA balance ${balance} < t_amount ${t_amount} (cap 10%)`,
      });
      return false;
    }
    t_price = t_amount > 0 ? f_amount / t_amount : pricingQuote.providerBuyPrice;
    f_price = 1;
  } else {
    const baseProfit = effectiveBaseProfit(platformFee.baseFeePercent, DEFAULT_PROVIDER_FEE);
    t_price = quoteOnRamp({
      providerPrice: pricingQuote.providerBuyPrice,
      baseProfit,
      volatility: pricingQuote.volatility,
      avgBuyPrice: pricingQuote.costPrice,
    });
    f_price = 1;
    const intendedTAmount = t_token === "ETH" ? 0.033 : 50;
    const intendedFAmount = round8(intendedTAmount * t_price);
    t_amount = Math.min(intendedTAmount, (balance ?? 0) * 0.1);
    if (balance == null || balance <= 0 || t_amount <= 0) {
      logOnrampOfframp({
        flow: "Paystack → KLYRA (onramp)",
        f_chain,
        t_chain,
        f_token,
        t_token,
        f_amount: intendedFAmount,
        t_amount: intendedTAmount,
        f_price,
        t_price,
        providerBuyPrice: pricingQuote.providerBuyPrice,
        providerSellPrice: pricingQuote.providerSellPrice,
        costPrice: pricingQuote.costPrice,
        platformFeePercent: platformFee.baseFeePercent,
        platformFixedFee: platformFee.fixedFee,
        volatility: pricingQuote.volatility,
        status: "skip",
        message: `KLYRA balance ${balance ?? "n/a"} for ${t_chain}/${t_token}`,
      });
      return false;
    }
    f_amount = round8(t_amount * t_price);
  }

  if (f_amount <= 0 || t_amount <= 0) {
    logOnrampOfframp({
      flow: "Paystack → KLYRA (onramp)",
      f_chain,
      t_chain,
      f_token,
      t_token,
      f_amount,
      t_amount,
      f_price,
      t_price,
      providerBuyPrice: pricingQuote.providerBuyPrice,
      providerSellPrice: pricingQuote.providerSellPrice,
      costPrice: pricingQuote.costPrice,
      platformFeePercent: platformFee.baseFeePercent,
      platformFixedFee: platformFee.fixedFee,
      volatility: pricingQuote.volatility,
      status: "skip",
      message: "f_amount and t_amount must be positive (would be zero)",
    });
    return false;
  }

  const feeQuote = await getFeeQuote({
    action: "buy",
    f_amount,
    t_amount,
    f_price,
    t_price,
    f_chain,
    t_chain,
    f_token,
    t_token,
  });

  const payload = buildOrderPayload({
    action: "buy",
    f_amount,
    t_amount,
    f_price,
    t_price,
    f_chain,
    t_chain,
    f_token,
    t_token,
    f_provider: "PAYSTACK",
    t_provider: "KLYRA",
    fromType: PAYSTACK_FROM_TYPE,
    toType: "ADDRESS",
  });
  const result = await fetchJson("/webhook/order", { method: "POST", body: JSON.stringify(payload) });

  if (result.ok && result.data && typeof result.data === "object" && "id" in result.data) {
    const orderId = (result.data as { id: string }).id;
    logOnrampOfframp({
      flow: "Paystack → KLYRA (onramp)",
      f_chain,
      t_chain,
      f_token,
      t_token,
      f_amount,
      t_amount,
      f_price,
      t_price,
      providerBuyPrice: pricingQuote.providerBuyPrice,
      providerSellPrice: pricingQuote.providerSellPrice,
      costPrice: pricingQuote.costPrice,
      platformFeePercent: platformFee.baseFeePercent,
      platformFixedFee: platformFee.fixedFee,
      feeAmount: feeQuote?.feeAmount,
      profit: feeQuote?.profit,
      totalCost: feeQuote?.totalCost,
      totalReceived: feeQuote?.totalReceived,
      volatility: pricingQuote.volatility,
      orderId,
      status: "created",
    });
    return true;
  }

  logOnrampOfframp({
    flow: "Paystack → KLYRA (onramp)",
    f_chain,
    t_chain,
    f_token,
    t_token,
    f_amount,
    t_amount,
    f_price,
    t_price,
    providerBuyPrice: pricingQuote.providerBuyPrice,
    providerSellPrice: pricingQuote.providerSellPrice,
    costPrice: pricingQuote.costPrice,
    platformFeePercent: platformFee.baseFeePercent,
    platformFixedFee: platformFee.fixedFee,
    feeAmount: feeQuote?.feeAmount,
    profit: feeQuote?.profit,
    totalCost: feeQuote?.totalCost,
    totalReceived: feeQuote?.totalReceived,
    volatility: pricingQuote.volatility,
    status: "error",
    message: `${result.status} ${result.code ?? result.error ?? ""}`,
  });
  return false;
}

// ---------- Offramp: KLYRA → Paystack (onchain token → fiat). Source = onchain address only (exclude fiat chains). ----------
async function runOfframp(): Promise<boolean> {
  if (supportedFiatChains.length === 0) {
    logOnrampOfframp({
      flow: "KLYRA → Paystack (offramp)",
      f_chain: "-",
      t_chain: "-",
      f_token: "-",
      t_token: "-",
      f_amount: 0,
      t_amount: 0,
      f_price: 0,
      t_price: 0,
      status: "skip",
      message: "no supported fiat chain",
    });
    return false;
  }
  if (onchainOnlyPairs.length === 0) {
    logOnrampOfframp({
      flow: "KLYRA → Paystack (offramp)",
      f_chain: "-",
      t_chain: "-",
      f_token: "-",
      t_token: "-",
      f_amount: 0,
      t_amount: 0,
      f_price: 0,
      t_price: 0,
      status: "skip",
      message: "no onchain source pairs (need ETHEREUM/BASE etc., not MOMO/BANK)",
    });
    return false;
  }

  const t_chain = supportedFiatChains[0];
  const t_token = t_chain === "MOMO" ? "GHS" : "USD";
  const fromOpt = onchainWithBalance.length > 0 ? randomChoice(onchainWithBalance) : randomChoice(onchainOnlyPairs);
  const f_chain = fromOpt.chainCode;
  const f_token = fromOpt.symbol;

  const { pricingQuote: quoteF, platformFee } = await getPricingQuote(f_chain, f_token);
  const { pricingQuote: quoteT } = await getPricingQuote(t_chain, t_token);
  if (!quoteF || !platformFee) {
    logOnrampOfframp({
      flow: "KLYRA → Paystack (offramp)",
      f_chain,
      t_chain,
      f_token,
      t_token,
      f_amount: 0,
      t_amount: 0,
      f_price: 0,
      t_price: 0,
      status: "skip",
      message: "no pricing quote",
    });
    return false;
  }

  const balance = await getBalance(f_chain, f_token);
  const intendedFAmount = Math.min(30, (balance ?? 0) * 0.1);
  if (balance == null || balance <= 0 || intendedFAmount <= 0) {
    logOnrampOfframp({
      flow: "KLYRA → Paystack (offramp)",
      f_chain,
      t_chain,
      f_token,
      t_token,
      f_amount: 0,
      t_amount: 0,
      f_price: 0,
      t_price: 0,
      providerBuyPrice: quoteT?.providerBuyPrice,
      providerSellPrice: quoteF.providerSellPrice,
      costPrice: quoteF.costPrice,
      platformFeePercent: platformFee.baseFeePercent,
      platformFixedFee: platformFee.fixedFee,
      volatility: quoteF.volatility,
      status: "skip",
      message: `KLYRA balance ${balance ?? "n/a"} for ${f_chain}/${f_token}`,
    });
    return false;
  }

  const country = "GH";
  const offrampQuote = await getOnrampQuoteFromApi({
    country,
    chain_id: fromOpt.chainId,
    token: f_token,
    amount: intendedFAmount,
    amount_in: "crypto",
    purchase_method: "sell",
  });

  let f_amount: number;
  let t_amount: number;
  let f_price: number;
  let t_price: number;

  if (offrampQuote) {
    f_amount = intendedFAmount;
    t_amount = offrampQuote.total_fiat;
    if (!Number.isFinite(t_amount) || t_amount <= 0) {
      logOnrampOfframp({
        flow: "KLYRA → Paystack (offramp)",
        f_chain,
        t_chain,
        f_token,
        t_token,
        f_amount,
        t_amount: 0,
        f_price: 0,
        t_price: 0,
        status: "skip",
        message: "offramp quote returned invalid total_fiat",
      });
      return false;
    }
    f_price = f_amount > 0 ? t_amount / f_amount : quoteF.providerSellPrice;
    t_price = 1;
  } else {
    const baseProfitOff = effectiveBaseProfit(platformFee.baseFeePercent, DEFAULT_PROVIDER_FEE);
    const baseProfitOn = effectiveBaseProfit(platformFee.baseFeePercent, DEFAULT_PROVIDER_FEE);
    f_price = quoteOffRamp({
      providerPrice: quoteF.providerSellPrice,
      baseProfit: baseProfitOff,
      volatility: quoteF.volatility,
    });
    t_price = quoteOnRamp({
      providerPrice: quoteT?.providerBuyPrice ?? 1,
      baseProfit: baseProfitOn,
      volatility: quoteT?.volatility ?? 0.01,
      avgBuyPrice: quoteT?.costPrice,
    });
    f_amount = intendedFAmount;
    t_amount = f_price > 0 ? round8((f_amount * f_price) / t_price) : 30;
  }

  if (f_amount <= 0 || t_amount <= 0) {
    logOnrampOfframp({
      flow: "KLYRA → Paystack (offramp)",
      f_chain,
      t_chain,
      f_token,
      t_token,
      f_amount,
      t_amount,
      f_price,
      t_price,
      providerBuyPrice: quoteT?.providerBuyPrice,
      providerSellPrice: quoteF.providerSellPrice,
      costPrice: quoteF.costPrice,
      platformFeePercent: platformFee.baseFeePercent,
      platformFixedFee: platformFee.fixedFee,
      volatility: quoteF.volatility,
      status: "skip",
      message: "f_amount and t_amount must be positive (would be zero)",
    });
    return false;
  }

  const feeQuote = await getFeeQuote({
    action: "sell",
    f_amount,
    t_amount,
    f_price,
    t_price,
    f_chain,
    t_chain,
    f_token,
    t_token,
  });

  const payload = buildOrderPayload({
    action: "sell",
    f_amount,
    t_amount,
    f_price,
    t_price,
    f_chain,
    t_chain,
    f_token,
    t_token,
    f_provider: "KLYRA",
    t_provider: "PAYSTACK",
    fromType: "ADDRESS",
    toType: PAYSTACK_TO_TYPE,
  });
  const result = await fetchJson("/webhook/order", { method: "POST", body: JSON.stringify(payload) });

  if (result.ok && result.data && typeof result.data === "object" && "id" in result.data) {
    const orderId = (result.data as { id: string }).id;
    logOnrampOfframp({
      flow: "KLYRA → Paystack (offramp)",
      f_chain,
      t_chain,
      f_token,
      t_token,
      f_amount,
      t_amount,
      f_price,
      t_price,
      providerBuyPrice: quoteT?.providerBuyPrice,
      providerSellPrice: quoteF.providerSellPrice,
      costPrice: quoteF.costPrice,
      platformFeePercent: platformFee.baseFeePercent,
      platformFixedFee: platformFee.fixedFee,
      feeAmount: feeQuote?.feeAmount,
      profit: feeQuote?.profit,
      totalCost: feeQuote?.totalCost,
      totalReceived: feeQuote?.totalReceived,
      volatility: quoteF.volatility,
      orderId,
      status: "created",
    });
    return true;
  }

  logOnrampOfframp({
    flow: "KLYRA → Paystack (offramp)",
    f_chain,
    t_chain,
    f_token,
    t_token,
    f_amount,
    t_amount,
    f_price,
    t_price,
    providerBuyPrice: quoteT?.providerBuyPrice,
    providerSellPrice: quoteF.providerSellPrice,
    costPrice: quoteF.costPrice,
    platformFeePercent: platformFee.baseFeePercent,
    platformFixedFee: platformFee.fixedFee,
    feeAmount: feeQuote?.feeAmount,
    profit: feeQuote?.profit,
    totalCost: feeQuote?.totalCost,
    totalReceived: feeQuote?.totalReceived,
    volatility: quoteF.volatility,
    status: "error",
    message: `${result.status} ${result.code ?? result.error ?? ""}`,
  });
  return false;
}

function parseArgs(): { scenario: string; delayMs: number; live: boolean; help: boolean } {
  const argv = process.argv.slice(2);
  let scenario = "all";
  let delayMs = 1000;
  let live = false;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help" || argv[i] === "-h") help = true;
    else if (argv[i] === "--live") live = true;
    else if (argv[i] === "--scenario" && argv[i + 1]) scenario = argv[++i];
    else if (argv[i] === "--delay" && argv[i + 1]) delayMs = Math.max(100, parseInt(argv[++i], 10) || 1000);
  }
  return { scenario, delayMs, live, help };
}

async function main(): Promise<void> {
  const { scenario, delayMs, live, help } = parseArgs();
  if (help) {
    console.log(`
Live test — onramp (Paystack → KLYRA) and offramp (KLYRA → Paystack).
Logs: amount, token, chain, cost price, fee, reported price, provider prices, profit, totalCost, totalReceived.

Usage: pnpm test:live:onramp-offramp [options]
  --scenario onramp|offramp|all   Default: all.
  --delay <ms>                    Delay between rounds (default 1000).
  --live                          Loop every --delay ms.
  -h, --help                      Show this help.

Env: CORE_URL, CORE_API_KEY.
`);
    process.exit(0);
  }

  if (!CORE_API_KEY) {
    console.error("CORE_API_KEY is not set.");
    process.exit(1);
  }

  const health = await fetchJson("/health");
  if (!health.ok) {
    console.error("Health check failed. Is the server running at", CORE_URL, "?");
    process.exit(1);
  }

  const { onchain, fiatChains } = await getSupportedChainsAndTokens();
  supportedOnchain = onchain;
  supportedFiatChains = fiatChains;
  onchainOnlyPairs = onchain.filter((p) => !fiatChains.includes(p.chainCode));
  await refreshValidationCache();
  await syncAndLoadBalances();
  console.log(
    `Health OK. Supported: ${onchain.length} chain+token pairs, fiat: ${fiatChains.length > 0 ? fiatChains.join(", ") : "none"}, onchain-only: ${onchainOnlyPairs.length}, with balance in Redis: ${onchainWithBalance.length}\n`
  );

  const runOne = async (): Promise<{ ok: number; total: number }> => {
    let ok = 0;
    let total = 0;
    if (scenario === "all" || scenario === "onramp") {
      total++;
      if (await runOnramp()) ok++;
      await delay(100);
    }
    if (scenario === "all" || scenario === "offramp") {
      total++;
      if (await runOfframp()) ok++;
    }
    return { ok, total };
  };

  if (live) {
    let round = 0;
    while (true) {
      round++;
      console.log(`\n========== Round ${round} ==========`);
      const { ok, total } = await runOne();
      console.log(`Round ${round}: ${ok}/${total} passed.\n`);
      await delay(delayMs);
    }
  }

  const { ok, total } = await runOne();
  console.log(`\nDone. ${ok}/${total} passed.`);
  process.exit(ok === total ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
