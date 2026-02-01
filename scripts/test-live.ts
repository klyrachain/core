#!/usr/bin/env node
/**
 * Live test script — swap, onramp, offramp scenarios with pricing validation.
 * Runs sequentially (fast). Ensures prices are validated before orders enter the poll.
 *
 * Scenarios:
 * 1. Swap: get quote (from/to amount, token, chain) → if KLYRA has t_token, use KLYRA; else expect INSUFFICIENT_FUNDS.
 *    Best case: valid prices + sufficient balance → 201. Worst: bad price (PRICE_OUT_OF_TOLERANCE) or insufficient balance (INSUFFICIENT_FUNDS).
 * 2. Onramp: fiat→token (buy). Check KLYRA has t_token + amount → add fee, user receivable → initiate. Best/worst.
 * 3. Offramp: check inventory (t_token we pay) → if sufficient, user receivable + fee → initiate (sell). Best/worst.
 *
 * Usage: pnpm test:live [--scenario swap|onramp|offramp|all] [--delay ms] [--live]
 *   --scenario all   Run all scenarios (default).
 *   --delay 1000     Ms between scenarios (default 1000; ~1 tx/sec with --live).
 *   --live           Run in a loop every --delay ms (transact every second by default).
 * Only uses chains/tokens returned by GET /api/chains and GET /api/tokens; amounts within balance.
 * For onramp/offramp, fiat chains (MOMO, BANK) can have chainId 0 (offchain).
 *
 * Env: CORE_URL (default http://localhost:4000), CORE_API_KEY (required; platform key for /api/validation/pricing-quote).
 */

import "dotenv/config";

const CORE_URL = process.env.CORE_URL ?? "http://localhost:4000";
const CORE_API_KEY = process.env.CORE_API_KEY ?? "";

// --- Pricing math (must match src/lib/pricing-engine.ts for validation to pass) ---
const TOTAL_PREMIUM_CAP = 0.06;
const TOTAL_DISCOUNT_CAP = 0.06;
const PRICE_TOLERANCE = 0.02;

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

// Default provider fee when not returned by API (match seed if possible)
const DEFAULT_PROVIDER_FEE = 0.005;

const TEST_USERS = [
  { email: "alice@example.com", address: "0xf0830060f836B8d54bF02049E5905F619487989e", type: "EMAIL" as const },
  { email: "bob@example.com", address: "0xf0830060f836B8d54bF02049E5905F619487989e", type: "EMAIL" as const },
  { number: "233201234567", address: "0xf0830060f836B8d54bF02049E5905F619487989e", type: "NUMBER" as const },
];
const TO_USER = TEST_USERS[0];
/** For Paystack (MOMO/bank): payer/recipient identifier. */
const PAYSTACK_IDENTIFIER = TEST_USERS[0].email ?? (TEST_USERS[2] as { number?: string }).number ?? "";
const PAYSTACK_FROM_TYPE = "EMAIL" as const;
const PAYSTACK_TO_TYPE = "NUMBER" as const;

/** Supported onchain (chain + token) from GET /api/chains + GET /api/tokens. Chain code = name.toUpperCase() for validation. */
type SupportedPair = { chainCode: string; chainId: number; symbol: string };
/** Fiat chain codes (e.g. MOMO, BANK) if present in Chain table. ChainId for fiat/offchain can be 0. */
let supportedOnchain: SupportedPair[] = [];
let supportedFiatChains: string[] = ["0"];

async function getSupportedChainsAndTokens(): Promise<{ onchain: SupportedPair[]; fiatChains: string[] }> {
  const chainsRes = await fetchJson("/api/chains");
  const tokensRes = await fetchJson("/api/tokens");
  const chainsData = chainsRes.data as { chains?: Array<{ chainId: number; name: string }> } | undefined;
  const tokensData = tokensRes.data as { tokens?: Array<{ chainId: number; symbol: string; networkName?: string }> } | undefined;
  const chains = chainsData?.chains ?? [];
  const tokens = tokensData?.tokens ?? [];

  // Debug: why "no supported fiat chain"? Fiat chains come from Chain table (name in MOMO, BANK, CARD). Seed only adds Base + Ethereum by default.
  const chainNames = chains.map((c) => `${c.name} (chainId=${c.chainId})`).join(", ");
  const fiatCodes = ["MOMO", "BANK", "CARD"];
  const fiatChains = chains
    .map((c) => c.name.toUpperCase())
    .filter((code) => fiatCodes.includes(code));
  if (fiatChains.length === 0 && chains.length > 0) {
    console.log(
      `[debug] Chains from API: ${chainNames}. Looking for fiat names: ${fiatCodes.join(", ")} → none match. Add MOMO/BANK to Chain table (e.g. run seed with fiat chains).`
    );
  }

  // chainId can be 0 for fiat/offchain (MOMO, BANK)
  const chainIdToCode = new Map(chains.map((c) => [c.chainId, c.name.toUpperCase()]));
  const onchain: SupportedPair[] = [];
  for (const t of tokens) {
    const code = chainIdToCode.get(t.chainId);
    if (code) onchain.push({ chainCode: code, chainId: t.chainId, symbol: t.symbol });
  }
  return { onchain, fiatChains };
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

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
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

type PricingQuote = {
  providerBuyPrice: number;
  providerSellPrice: number;
  volatility: number;
  costPrice?: number;
};
type PlatformFee = { baseFeePercent: number; fixedFee: number };

async function getPricingQuote(chain?: string, token?: string): Promise<{
  pricingQuote: PricingQuote | null;
  platformFee: PlatformFee | null;
}> {
  const q = new URLSearchParams();
  if (chain) q.set("chain", chain);
  if (token) q.set("token", token);
  const path = q.toString() ? `/api/validation/pricing-quote?${q.toString()}` : "/api/validation/pricing-quote";
  const res = await fetchJson(path);
  if (!res.ok || !res.data || typeof res.data !== "object") {
    return { pricingQuote: null, platformFee: null };
  }
  const o = res.data as {
    pricingQuote?: { providerBuyPrice?: number; providerSellPrice?: number; volatility?: number; costPrice?: number };
    platformFee?: { baseFeePercent?: number; fixedFee?: number };
  };
  const pricingQuote =
    o.pricingQuote &&
      typeof o.pricingQuote.providerBuyPrice === "number" &&
      typeof o.pricingQuote.providerSellPrice === "number" &&
      typeof o.pricingQuote.volatility === "number"
      ? (o.pricingQuote as PricingQuote)
      : null;
  const platformFee =
    o.platformFee && typeof o.platformFee.baseFeePercent === "number"
      ? { baseFeePercent: o.platformFee.baseFeePercent, fixedFee: o.platformFee.fixedFee ?? 0 }
      : null;
  return { pricingQuote, platformFee };
}

/** Log token tracking: t_token, f_token, t_price, f_price, buy price, cost price, fee, profit. */
function logTokenTrack(opts: {
  scenario: string;
  f_token: string;
  t_token: string;
  f_price: number;
  t_price: number;
  buyPrice?: number;
  costPrice?: number;
  feeAmount?: number;
  profit?: number;
  totalCost?: number;
  totalReceived?: number;
}): void {
  const { scenario, f_token, t_token, f_price, t_price, buyPrice, costPrice, feeAmount, profit, totalCost, totalReceived } = opts;
  console.log(
    `  [track] ${scenario} | f_token=${f_token} t_token=${t_token} | f_price=${f_price} t_price=${t_price} | buyPrice=${buyPrice ?? "-"} costPrice=${costPrice ?? "-"} | fee=${feeAmount ?? "-"} profit=${profit ?? "-"} | totalCost=${totalCost ?? "-"} totalReceived=${totalReceived ?? "-"}`
  );
}

async function getBalance(chain: string, token: string): Promise<number | null> {
  const res = await fetchJson(`/api/cache/balances/${encodeURIComponent(chain)}/${encodeURIComponent(token)}`);
  if (!res.ok || !res.data || typeof res.data !== "object") return null;
  const amount = (res.data as { amount?: string }).amount;
  if (amount == null) return null;
  const n = parseFloat(amount);
  return Number.isFinite(n) ? n : null;
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
  const d = res.data as { feeAmount?: number; totalCost?: number; totalReceived?: number; profit?: number };
  return d;
}

/** Build order payload. Swap: both KLYRA. Onramp: f_provider PAYSTACK, t_provider KLYRA. Offramp: f_provider KLYRA, t_provider PAYSTACK. */
function buildOrderPayload(opts: {
  action: "buy" | "sell" | "request" | "claim";
  f_amount: number;
  t_amount: number;
  f_price: number;
  t_price: number;
  f_chain: string;
  t_chain: string;
  f_token: string;
  t_token: string;
  f_provider: "KLYRA" | "PAYSTACK" | "ANY";
  t_provider: "KLYRA" | "PAYSTACK" | "ANY";
  fromType?: "ADDRESS" | "EMAIL" | "NUMBER";
  toType?: "ADDRESS" | "EMAIL" | "NUMBER";
}): Record<string, unknown> {
  const { action, f_amount, t_amount, f_price, t_price, f_chain, t_chain, f_token, t_token, f_provider, t_provider } = opts;
  const fromId = opts.fromType === "ADDRESS" ? (TO_USER as { address?: string }).address : PAYSTACK_IDENTIFIER;
  const toId = opts.toType === "ADDRESS" ? (TO_USER as { address?: string }).address : PAYSTACK_IDENTIFIER;
  const fromType = opts.fromType ?? (f_provider === "PAYSTACK" ? PAYSTACK_FROM_TYPE : "ADDRESS");
  const toType = opts.toType ?? (t_provider === "KLYRA" ? "ADDRESS" : PAYSTACK_TO_TYPE);
  return {
    action,
    fromIdentifier: fromId,
    fromType,
    toIdentifier: toId,
    toType,
    f_amount: round8(f_amount),
    t_amount: round8(t_amount),
    f_price: round8(f_price),
    t_price: round8(t_price),
    f_chain,
    t_chain,
    f_token,
    t_token,
    f_provider,
    t_provider,
  };
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

function log(ts: string, msg: string): void {
  console.log(`[${ts}] ${msg}`);
}

async function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- Scenario: Swap ----------
async function runSwapBest(): Promise<boolean> {
  const ts = new Date().toISOString();
  if (supportedOnchain.length < 2) {
    log(ts, "Swap (best): skip — need at least 2 supported chain+token pairs");
    return false;
  }
  const fromOpt = randomChoice(supportedOnchain);
  const toOpt = randomChoice(supportedOnchain.filter((x) => x.symbol !== fromOpt.symbol || x.chainCode !== fromOpt.chainCode));
  const f_token = fromOpt.symbol;
  const t_token = toOpt.symbol;
  const f_chain = fromOpt.chainCode;
  const t_chain = toOpt.chainCode;
  const { pricingQuote, platformFee } = await getPricingQuote(t_chain, t_token);
  if (!pricingQuote || !platformFee) {
    log(ts, "Swap (best): skip — pricing quote or platform fee not available");
    return false;
  }

  const baseProfitOn = effectiveBaseProfit(platformFee.baseFeePercent, DEFAULT_PROVIDER_FEE);
  const expectedTPrice = quoteOnRamp({
    providerPrice: pricingQuote.providerBuyPrice,
    baseProfit: baseProfitOn,
    volatility: pricingQuote.volatility,
    avgBuyPrice: pricingQuote.costPrice,
  });
  const expectedFPrice = f_token === t_token ? expectedTPrice : pricingQuote.providerSellPrice;
  const f_price = expectedFPrice;
  const t_price = expectedTPrice;

  const balance = await getBalance(t_chain, t_token);
  if (balance == null || balance <= 0) {
    log(ts, `Swap (best): skip — KLYRA balance for ${t_chain}/${t_token} = n/a`);
    return false;
  }
  const t_amount = Math.min(t_token === "ETH" ? 0.033 : 50, balance * 0.1);
  if (t_amount <= 0) {
    log(ts, `Swap (best): skip — KLYRA balance for ${t_chain}/${t_token} = ${balance}, need > 0`);
    return false;
  }
  const f_amount = round8(t_amount * (t_price / f_price));

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
  logTokenTrack({
    scenario: "swap(best)",
    f_token,
    t_token,
    f_price,
    t_price,
    buyPrice: pricingQuote.providerBuyPrice,
    costPrice: pricingQuote.costPrice,
    feeAmount: feeQuote?.feeAmount,
    profit: feeQuote?.profit,
    totalCost: feeQuote?.totalCost,
    totalReceived: feeQuote?.totalReceived,
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
    f_provider: "KLYRA",
    t_provider: "KLYRA",
  });
  const result = await fetchJson("/webhook/order", { method: "POST", body: JSON.stringify(payload) });
  if (result.ok && result.data && typeof result.data === "object" && "id" in result.data) {
    log(ts, `Swap (best) → 201 id=${(result.data as { id: string }).id} (prices validated, order in poll)`);
    return true;
  }
  log(ts, `Swap (best) → ${result.status} ${result.error ?? ""} ${result.code ?? ""}`);
  return false;
}

async function runSwapWorstPrice(): Promise<boolean> {
  const ts = new Date().toISOString();
  if (supportedOnchain.length < 2) {
    log(ts, "Swap (worst price): skip — need at least 2 supported pairs");
    return false;
  }
  const fromOpt = randomChoice(supportedOnchain);
  const toOpt = randomChoice(supportedOnchain.filter((x) => x.symbol !== fromOpt.symbol || x.chainCode !== fromOpt.chainCode));
  const { pricingQuote, platformFee } = await getPricingQuote(toOpt.chainCode, toOpt.symbol);
  if (!pricingQuote || !platformFee) {
    log(ts, "Swap (worst price): skip — no pricing quote");
    return false;
  }

  const f_amount = 100;
  const t_amount = 0.05;
  const baseProfitOn = effectiveBaseProfit(platformFee.baseFeePercent, DEFAULT_PROVIDER_FEE);
  const expectedTPrice = quoteOnRamp({
    providerPrice: pricingQuote.providerBuyPrice,
    baseProfit: baseProfitOn,
    volatility: pricingQuote.volatility,
  });
  const badTPrice = expectedTPrice * (1 - PRICE_TOLERANCE - 0.01);
  const f_price = 1;
  const t_price = round8(badTPrice);

  const payload = buildOrderPayload({
    action: "buy",
    f_amount,
    t_amount,
    f_price,
    t_price,
    f_chain: fromOpt.chainCode,
    t_chain: toOpt.chainCode,
    f_token: fromOpt.symbol,
    t_token: toOpt.symbol,
    f_provider: "KLYRA",
    t_provider: "KLYRA",
  });
  const result = await fetchJson("/webhook/order", { method: "POST", body: JSON.stringify(payload) });
  if (!result.ok && result.code === "PRICE_OUT_OF_TOLERANCE") {
    log(ts, `Swap (worst price) → 400 PRICE_OUT_OF_TOLERANCE (expected; price rejected before poll)`);
    return true;
  }
  log(ts, `Swap (worst price) → ${result.status} ${result.code ?? result.error ?? ""}`);
  return false;
}

async function runSwapWorstBalance(): Promise<boolean> {
  const ts = new Date().toISOString();
  if (supportedOnchain.length < 2) {
    log(ts, "Swap (worst balance): skip — need at least 2 supported pairs");
    return false;
  }
  const toOpt = randomChoice(supportedOnchain);
  const { pricingQuote, platformFee } = await getPricingQuote(toOpt.chainCode, toOpt.symbol);
  if (!pricingQuote || !platformFee) {
    log(ts, "Swap (worst balance): skip — no pricing quote");
    return false;
  }

  const balance = await getBalance(toOpt.chainCode, toOpt.symbol);
  const required = (balance ?? 0) + 1000;
  const baseProfitOn = effectiveBaseProfit(platformFee.baseFeePercent, DEFAULT_PROVIDER_FEE);
  const expectedTPrice = quoteOnRamp({
    providerPrice: pricingQuote.providerBuyPrice,
    baseProfit: baseProfitOn,
    volatility: pricingQuote.volatility,
    avgBuyPrice: pricingQuote.costPrice,
  });
  const f_amount = 100;
  const t_amount = round8(required);
  const f_price = 1;
  const t_price = expectedTPrice;
  const fromOpt = randomChoice(supportedOnchain.filter((x) => x.symbol !== toOpt.symbol || x.chainCode !== toOpt.chainCode));

  const payload = buildOrderPayload({
    action: "buy",
    f_amount,
    t_amount,
    f_price,
    t_price,
    f_chain: fromOpt.chainCode,
    t_chain: toOpt.chainCode,
    f_token: fromOpt.symbol,
    t_token: toOpt.symbol,
    f_provider: "KLYRA",
    t_provider: "KLYRA",
  });
  const result = await fetchJson("/webhook/order", { method: "POST", body: JSON.stringify(payload) });
  if (!result.ok && result.code === "INSUFFICIENT_FUNDS") {
    log(ts, `Swap (worst balance) → 400 INSUFFICIENT_FUNDS (expected; rejected before poll)`);
    return true;
  }
  log(ts, `Swap (worst balance) → ${result.status} ${result.code ?? result.error ?? ""}`);
  return false;
}

// ---------- Scenario: Onramp (fiat → onchain token, action buy). f_provider PAYSTACK; f_chain from supported (MOMO, BANK, etc.); t_provider KLYRA. ----------
async function runOnrampBest(): Promise<boolean> {
  const ts = new Date().toISOString();
  if (supportedFiatChains.length === 0) {
    log(ts, "Onramp (best): skip — no supported fiat chain (MOMO/BANK)");
    return false;
  }
  if (supportedOnchain.length === 0) {
    log(ts, "Onramp (best): skip — no supported onchain pairs");
    return false;
  }
  const f_chain = supportedFiatChains[0];
  const f_token = f_chain === "MOMO" ? "GHS" : "USD";
  const tOpt = randomChoice(supportedOnchain);
  const t_chain = tOpt.chainCode;
  const t_token = tOpt.symbol;
  const { pricingQuote, platformFee } = await getPricingQuote(t_chain, t_token);
  if (!pricingQuote || !platformFee) {
    log(ts, "Onramp (best): skip — no pricing quote");
    return false;
  }

  const balance = await getBalance(t_chain, t_token);
  const t_amount = Math.min(t_token === "ETH" ? 0.033 : 50, (balance ?? 0) * 0.1);
  if (balance == null || balance <= 0 || t_amount <= 0) {
    log(ts, `Onramp (best): skip — KLYRA ${t_chain}/${t_token} balance ${balance ?? "n/a"}`);
    return false;
  }

  const baseProfitOn = effectiveBaseProfit(platformFee.baseFeePercent, DEFAULT_PROVIDER_FEE);
  const t_price = quoteOnRamp({
    providerPrice: pricingQuote.providerBuyPrice,
    baseProfit: baseProfitOn,
    volatility: pricingQuote.volatility,
    avgBuyPrice: pricingQuote.costPrice,
  });
  const f_price = 1;
  const f_amount = round8(t_amount * t_price);

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
  const userReceivable = feeQuote?.totalReceived ?? t_amount;
  logTokenTrack({
    scenario: "onramp(best)",
    f_token,
    t_token,
    f_price,
    t_price,
    buyPrice: pricingQuote.providerBuyPrice,
    costPrice: pricingQuote.costPrice,
    feeAmount: feeQuote?.feeAmount,
    profit: feeQuote?.profit,
    totalCost: feeQuote?.totalCost,
    totalReceived: feeQuote?.totalReceived,
  });
  log(ts, `Onramp (best): fiat ${f_token} (${f_chain}) → ${t_token} on ${t_chain}; user receives ${userReceivable}`);

  const payload = buildOrderPayload({
    action: "buy",
    f_amount: round8(f_amount),
    t_amount: round8(t_amount),
    f_price: round8(f_price),
    t_price: round8(t_price),
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
    log(ts, `Onramp (best) → 201 id=${(result.data as { id: string }).id} (price validated, order in poll)`);
    return true;
  }
  log(ts, `Onramp (best) → ${result.status} ${result.error ?? ""} ${result.code ?? ""}`);
  return false;
}

async function runOnrampWorst(): Promise<boolean> {
  const ts = new Date().toISOString();
  if (supportedFiatChains.length === 0) {
    log(ts, "Onramp (worst): skip — no supported fiat chain");
    return false;
  }
  if (supportedOnchain.length === 0) {
    log(ts, "Onramp (worst): skip — no supported onchain pairs");
    return false;
  }
  const f_chain = supportedFiatChains[0];
  const f_token = f_chain === "MOMO" ? "GHS" : "USD";
  const tOpt = randomChoice(supportedOnchain);
  const t_chain = tOpt.chainCode;
  const t_token = tOpt.symbol;
  const { pricingQuote, platformFee } = await getPricingQuote(t_chain, t_token);
  if (!pricingQuote || !platformFee) {
    log(ts, "Onramp (worst): skip — no pricing quote");
    return false;
  }

  const baseProfitOn = effectiveBaseProfit(platformFee.baseFeePercent, DEFAULT_PROVIDER_FEE);
  const expectedTPrice = quoteOnRamp({
    providerPrice: pricingQuote.providerBuyPrice,
    baseProfit: baseProfitOn,
    volatility: pricingQuote.volatility,
  });
  const badTPrice = expectedTPrice * 0.5;
  const t_amount = 25;
  const f_amount = 100;
  const payload = buildOrderPayload({
    action: "buy",
    f_amount,
    t_amount,
    f_price: 1,
    t_price: round8(badTPrice),
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
  if (!result.ok && result.code === "PRICE_OUT_OF_TOLERANCE") {
    log(ts, `Onramp (worst) → 400 PRICE_OUT_OF_TOLERANCE (expected)`);
    return true;
  }
  log(ts, `Onramp (worst) → ${result.status} ${result.code ?? result.error ?? ""}`);
  return false;
}

// ---------- Scenario: Offramp (onchain token → fiat, action sell). f_provider KLYRA, t_provider PAYSTACK. ----------
async function runOfframpBest(): Promise<boolean> {
  const ts = new Date().toISOString();
  if (supportedFiatChains.length === 0) {
    log(ts, "Offramp (best): skip — no supported fiat chain (MOMO/BANK)");
    return false;
  }
  if (supportedOnchain.length === 0) {
    log(ts, "Offramp (best): skip — no supported onchain pairs");
    return false;
  }
  const t_chain = supportedFiatChains[0];
  const t_token = t_chain === "MOMO" ? "GHS" : "USD";
  const fromOpt = randomChoice(supportedOnchain);
  const f_chain = fromOpt.chainCode;
  const f_token = fromOpt.symbol;
  const { pricingQuote: quoteF, platformFee } = await getPricingQuote(f_chain, f_token);
  const { pricingQuote: quoteT } = await getPricingQuote(t_chain, t_token);
  if (!quoteF || !platformFee) {
    log(ts, "Offramp (best): skip — no pricing quote");
    return false;
  }

  const balance = await getBalance(f_chain, f_token);
  const f_amount = Math.min(30, (balance ?? 0) * 0.1);
  if (balance == null || balance <= 0 || f_amount <= 0) {
    log(ts, `Offramp (best): skip — KLYRA ${f_chain}/${f_token} balance ${balance ?? "n/a"}`);
    return false;
  }

  const baseProfitOff = effectiveBaseProfit(platformFee.baseFeePercent, DEFAULT_PROVIDER_FEE);
  const baseProfitOn = effectiveBaseProfit(platformFee.baseFeePercent, DEFAULT_PROVIDER_FEE);
  const f_price = quoteOffRamp({
    providerPrice: quoteF.providerSellPrice,
    baseProfit: baseProfitOff,
    volatility: quoteF.volatility,
  });
  const t_price = quoteOnRamp({
    providerPrice: quoteT?.providerBuyPrice ?? 1,
    baseProfit: baseProfitOn,
    volatility: quoteT?.volatility ?? 0.01,
    avgBuyPrice: quoteT?.costPrice,
  });
  const t_amount = f_price > 0 ? round8((f_amount * f_price) / t_price) : 30;

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
  const userReceivable = feeQuote?.totalReceived ?? t_amount - (t_amount * 0.01);
  logTokenTrack({
    scenario: "offramp(best)",
    f_token,
    t_token,
    f_price,
    t_price,
    buyPrice: quoteT?.providerBuyPrice,
    costPrice: quoteT?.costPrice,
    feeAmount: feeQuote?.feeAmount,
    profit: feeQuote?.profit,
    totalCost: feeQuote?.totalCost,
    totalReceived: feeQuote?.totalReceived,
  });
  log(ts, `Offramp (best): ${f_token} on ${f_chain} → fiat ${t_token} (${t_chain}); user receivable → ${userReceivable}`);

  const payload = buildOrderPayload({
    action: "sell",
    f_amount: round8(f_amount),
    t_amount: round8(t_amount),
    f_price: round8(f_price),
    t_price: round8(t_price),
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
    log(ts, `Offramp (best) → 201 id=${(result.data as { id: string }).id} (price validated, order in poll)`);
    return true;
  }
  log(ts, `Offramp (best) → ${result.status} ${result.error ?? ""} ${result.code ?? ""}`);
  return false;
}

async function runOfframpWorst(): Promise<boolean> {
  const ts = new Date().toISOString();
  if (supportedFiatChains.length === 0) {
    log(ts, "Offramp (worst): skip — no supported fiat chain");
    return false;
  }
  if (supportedOnchain.length === 0) {
    log(ts, "Offramp (worst): skip — no supported onchain pairs");
    return false;
  }
  const t_chain = supportedFiatChains[0];
  const t_token = t_chain === "MOMO" ? "GHS" : "USD";
  const fromOpt = randomChoice(supportedOnchain);
  const f_chain = fromOpt.chainCode;
  const f_token = fromOpt.symbol;
  const { pricingQuote: quoteF, platformFee } = await getPricingQuote(f_chain, f_token);
  const { pricingQuote: quoteT } = await getPricingQuote(t_chain, t_token);
  if (!quoteF || !platformFee) {
    log(ts, "Offramp (worst): skip — no pricing quote");
    return false;
  }

  const baseProfitOff = effectiveBaseProfit(platformFee.baseFeePercent, DEFAULT_PROVIDER_FEE);
  const expectedFPrice = quoteOffRamp({
    providerPrice: quoteF.providerSellPrice,
    baseProfit: baseProfitOff,
    volatility: quoteF.volatility,
  });
  const badFPrice = expectedFPrice * 0.5;
  const f_amount = 30;
  const t_amount = 100;
  const t_price = quoteT?.providerBuyPrice ?? 1;
  const payload = buildOrderPayload({
    action: "sell",
    f_amount: round8(f_amount),
    t_amount: round8(t_amount),
    f_price: round8(badFPrice),
    t_price: round8(t_price),
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
  if (!result.ok && result.code === "PRICE_OUT_OF_TOLERANCE") {
    log(ts, `Offramp (worst) → 400 PRICE_OUT_OF_TOLERANCE (expected)`);
    return true;
  }
  log(ts, `Offramp (worst) → ${result.status} ${result.code ?? result.error ?? ""}`);
  return false;
}

async function runOneRound(scenario: string): Promise<{ ok: number; total: number }> {
  const run = scenario === "all" ? ["swap", "onramp", "offramp"] : [scenario];
  let ok = 0;
  let total = 0;
  for (const s of run) {
    if (s === "swap") {
      total += 3;
      if (await runSwapBest()) ok++;
      await delay(100);
      if (await runSwapWorstPrice()) ok++;
      await delay(100);
      if (await runSwapWorstBalance()) ok++;
    } else if (s === "onramp") {
      total += 2;
      if (await runOnrampBest()) ok++;
      await delay(100);
      if (await runOnrampWorst()) ok++;
    } else if (s === "offramp") {
      total += 2;
      if (await runOfframpBest()) ok++;
      await delay(100);
      if (await runOfframpWorst()) ok++;
    }
  }
  return { ok, total };
}

async function main(): Promise<void> {
  const { scenario, delayMs, live, help } = parseArgs();
  if (help) {
    console.log(`
Live test — swap, onramp, offramp with pricing validation.

Usage: pnpm test:live [options]
  --scenario swap|onramp|offramp|all   Run scenario(s). Default: all.
  --delay <ms>                        Delay between rounds (default 1000).
  --live                              Run in a loop every --delay ms (transact every second by default).
  -h, --help                          Show this help.

Env: CORE_URL, CORE_API_KEY (required for /api/validation/pricing-quote).
`);
    process.exit(0);
  }

  if (!CORE_API_KEY) {
    console.error("CORE_API_KEY is not set. Required for /api/validation/pricing-quote.");
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
  console.log(
    `Health OK. Supported: ${onchain.length} chain+token pairs, fiat chains: ${fiatChains.length > 0 ? fiatChains.join(", ") : "none"}. Running scenarios.\n`
  );

  if (live) {
    let round = 0;
    while (true) {
      round++;
      const ts = new Date().toISOString();
      console.log(`[${ts}] --- Round ${round} ---`);
      const { ok, total } = await runOneRound(scenario);
      console.log(`[${ts}] Round ${round}: ${ok}/${total} passed.\n`);
      await delay(delayMs);
    }
  }

  const { ok, total } = await runOneRound(scenario);
  console.log(`\nDone. ${ok}/${total} scenario checks passed.`);
  process.exit(ok === total ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
