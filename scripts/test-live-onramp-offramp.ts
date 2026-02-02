#!/usr/bin/env node
/**
 * Live test — onramp & offramp using POST /api/v1/quotes (source of truth).
 * Covers both input sides: "from" (enter fiat/crypto to pay) and "to" (enter crypto/fiat you want).
 * Runs continuously until Ctrl+C. Scenarios: onramp, onramp-reversed (want crypto), offramp, offramp-reversed (want fiat).
 *
 * Usage: pnpm test:live:onramp-offramp [--delay ms] [--submit]
 *   --delay   ms between iterations (default 2000)
 *   --submit  also POST to /webhook/order with quote amounts (validates full flow)
 * Env: CORE_URL (default http://localhost:4000), CORE_API_KEY (optional, for cache refresh/submit).
 */

import "dotenv/config";

const CORE_URL = process.env.CORE_URL ?? "http://localhost:4000";
const CORE_API_KEY = process.env.CORE_API_KEY ?? "";

type QuoteResponseData = {
  quoteId: string;
  expiresAt: string;
  exchangeRate: string;
  basePrice?: string;
  prices?: { providerPrice: string; sellingPrice: string; avgBuyPrice?: string };
  input: { amount: string; currency: string };
  output: { amount: string; currency: string; chain?: string };
  fees: { networkFee: string; platformFee: string; totalFee: string };
  debug?: { basePrice: string; profitMarginPct: string; volatilityPremium: string; inventoryRisk: string; costBasis?: string };
};

type SupportedPair = { chainCode: string; chainId: number; symbol: string };
let onchainPairs: SupportedPair[] = [];
let fiatChains: string[] = [];
const balanceByChainToken = new Map<string, number>();

async function fetchJson(
  path: string,
  options?: RequestInit
): Promise<{ ok: boolean; status: number; data?: unknown; error?: string; code?: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(options?.headers as Record<string, string>) };
  if (CORE_API_KEY) headers["x-api-key"] = CORE_API_KEY;
  try {
    const res = await fetch(`${CORE_URL}${path}`, { ...options, headers });
    const body = await res.json().catch(() => ({}));
    return {
      ok: res.ok,
      status: res.status,
      data: (body as { data?: unknown }).data,
      error: (body as { error?: string }).error,
      code: (body as { code?: string }).code,
    };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

async function getSupportedChainsAndTokens(): Promise<void> {
  const [chainsRes, tokensRes] = await Promise.all([fetchJson("/api/chains"), fetchJson("/api/tokens")]);
  const chains = (chainsRes.data as { chains?: Array<{ chainId: number; name: string }> })?.chains ?? [];
  const tokens = (tokensRes.data as { tokens?: Array<{ chainId: number; symbol: string }> })?.tokens ?? [];
  const chainIdToCode = new Map(chains.map((c) => [c.chainId, c.name.toUpperCase()]));
  const onchain: SupportedPair[] = [];
  for (const t of tokens) {
    const code = chainIdToCode.get(t.chainId);
    if (code) onchain.push({ chainCode: code, chainId: t.chainId, symbol: t.symbol });
  }
  const fiatCodes = ["MOMO", "BANK", "CARD"];
  fiatChains = chains.map((c) => c.name.toUpperCase()).filter((c) => fiatCodes.includes(c));
  onchainPairs = onchain.filter((p) => !fiatChains.includes(p.chainCode));
}

async function syncBalances(): Promise<void> {
  await fetchJson("/api/cache/sync-balances", { method: "POST" });
  const res = await fetchJson("/api/cache/balances?limit=100");
  if (!res.ok || !Array.isArray(res.data)) return;
  balanceByChainToken.clear();
  for (const item of res.data as Array<{ chain?: string; token?: string; amount?: string }>) {
    const chain = item.chain ?? "";
    const token = item.token ?? "";
    const amount = item.amount != null ? parseFloat(item.amount) : 0;
    if (chain && token && Number.isFinite(amount)) balanceByChainToken.set(`${chain}:${token}`, amount);
  }
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInRange(min: number, max: number, decimals = 2): string {
  const v = min + Math.random() * (max - min);
  return v.toFixed(decimals);
}

/** POST /api/v1/quotes — get quote (source of truth). inputSide "from" = amount is paying side; "to" = amount is receiving side. */
async function getV1Quote(
  body: {
    action: "ONRAMP" | "OFFRAMP";
    inputAmount: string;
    inputCurrency: string;
    outputCurrency: string;
    chain: string;
    inputSide?: "from" | "to";
  },
  options?: { retryOn5xx?: boolean }
): Promise<{ ok: true; data: QuoteResponseData } | { ok: false; error: string; code?: string; status: number }> {
  const attempt = async (): Promise<{ ok: true; data: QuoteResponseData } | { ok: false; error: string; code?: string; status: number }> => {
    const payload = { ...body };
    if (body.inputSide) payload.inputSide = body.inputSide;
    const res = await fetchJson("/api/v1/quotes", { method: "POST", body: JSON.stringify(payload) });
    if (!res.ok) {
      return { ok: false, error: res.error ?? "Unknown error", code: res.code, status: res.status };
    }
    const data = res.data as QuoteResponseData | undefined;
    if (!data || typeof data.exchangeRate !== "string" || !data.input || !data.output || !data.fees) {
      return { ok: false, error: "Invalid quote response", status: res.status };
    }
    return { ok: true, data };
  };
  const first = await attempt();
  if (first.ok) return first;
  if (options?.retryOn5xx && (first.status === 502 || first.status === 500)) {
    await new Promise((r) => setTimeout(r, 1000));
    return attempt();
  }
  return first;
}

/** POST /webhook/order — submit order using quote amounts. Sends quoteId and providerPrice so fee is computed correctly. */
async function submitOrder(opts: {
  action: "buy" | "sell";
  f_amount: number;
  t_amount: number;
  f_price: number;
  t_price: number;
  f_chain: string;
  t_chain: string;
  f_token: string;
  t_token: string;
  quoteId?: string;
  providerPrice?: number;
}): Promise<{ ok: boolean; orderId?: string; error?: string; code?: string }> {
  const payload: Record<string, unknown> = {
    action: opts.action,
    fromIdentifier: "alice@example.com",
    fromType: opts.f_chain === "MOMO" || opts.f_chain === "BANK" ? "EMAIL" : "ADDRESS",
    toIdentifier: opts.f_chain === "MOMO" || opts.f_chain === "BANK" ? "0xf0830060f836B8d54bF02049E5905F619487989e" : "233201234567",
    toType: opts.t_chain === "MOMO" || opts.t_chain === "BANK" ? "NUMBER" : "ADDRESS",
    f_amount: opts.f_amount,
    t_amount: opts.t_amount,
    f_price: opts.f_price,
    t_price: opts.t_price,
    f_chain: opts.f_chain,
    t_chain: opts.t_chain,
    f_token: opts.f_token,
    t_token: opts.t_token,
    f_provider: opts.f_chain === "MOMO" || opts.f_chain === "BANK" ? "PAYSTACK" : "KLYRA",
    t_provider: opts.t_chain === "MOMO" || opts.t_chain === "BANK" ? "PAYSTACK" : "KLYRA",
  };
  if (opts.quoteId) payload.quoteId = opts.quoteId;
  if (opts.providerPrice != null && Number.isFinite(opts.providerPrice)) payload.providerPrice = opts.providerPrice;
  const res = await fetchJson("/webhook/order", { method: "POST", body: JSON.stringify(payload) });
  if (res.ok && res.data && typeof res.data === "object" && "id" in res.data) {
    return { ok: true, orderId: (res.data as { id: string }).id };
  }
  return { ok: false, error: res.error, code: res.code };
}

function logQuote(flow: string, data: QuoteResponseData, submitResult?: { ok: boolean; orderId?: string; error?: string }): void {
  const ts = new Date().toISOString();
  const providerPrice = data.prices?.providerPrice ?? data.basePrice ?? data.debug?.basePrice ?? "—";
  const sellingPrice = data.prices?.sellingPrice ?? data.exchangeRate;
  const avgBuyPrice = data.prices?.avgBuyPrice ?? data.debug?.costBasis ?? "—";
  const lines = [
    `[${ts}] ---------- ${flow} ----------`,
    `  quoteId      ${data.quoteId}`,
    `  expiresAt    ${data.expiresAt}`,
    `  exchangeRate ${data.exchangeRate}`,
    `  input        ${data.input.amount} ${data.input.currency}`,
    `  output       ${data.output.amount} ${data.output.currency}${data.output.chain ? ` (${data.output.chain})` : ""}`,
    `  prices       provider ${providerPrice}  selling ${sellingPrice}  avgBuy(inventory) ${avgBuyPrice}`,
    `  fees         network ${data.fees.networkFee}  platform ${data.fees.platformFee}  total ${data.fees.totalFee}`,
  ];
  if (data.debug) {
    lines.push(`  debug        basePrice ${data.debug.basePrice}  margin ${data.debug.profitMarginPct}  volatility ${data.debug.volatilityPremium}  inventoryRisk ${data.debug.inventoryRisk}`);
  }
  if (submitResult !== undefined) {
    lines.push(`  order        ${submitResult.ok ? `created ${submitResult.orderId ?? ""}` : `error ${submitResult.error ?? submitResult.error}`}`);
  }
  console.log(lines.join("\n"));
}

async function runOnramp(doSubmit: boolean): Promise<boolean | void> {
  if (onchainPairs.length === 0) {
    console.log("[skip] No onchain pairs for onramp.");
    return;
  }
  const pair = randomChoice(onchainPairs);
  const inputAmount = randomInRange(20, 150, 2);
  const quote = await getV1Quote(
    {
      action: "ONRAMP",
      inputAmount,
      inputCurrency: "GHS",
      outputCurrency: pair.symbol,
      chain: pair.chainCode,
    },
    { retryOn5xx: true }
  );
  if (!quote.ok) {
    console.log(
      `[ONRAMP] quote failed: ${quote.status} ${quote.error} (${quote.code ?? ""}) — inputAmount=${inputAmount} chain=${pair.chainCode} output=${pair.symbol}`
    );
    return false;
  }
  let submitResult: { ok: boolean; orderId?: string; error?: string } | undefined;
  if (doSubmit) {
    const f_amount = parseFloat(quote.data.input.amount);
    const t_amount = parseFloat(quote.data.output.amount);
    const exchangeRate = parseFloat(quote.data.exchangeRate);
    const basePrice = quote.data.basePrice ?? quote.data.debug?.basePrice;
    submitResult = await submitOrder({
      action: "buy",
      f_amount,
      t_amount,
      f_price: 1,
      t_price: exchangeRate,
      f_chain: "MOMO",
      t_chain: pair.chainCode,
      f_token: "GHS",
      t_token: pair.symbol,
      quoteId: quote.data.quoteId,
      providerPrice: basePrice != null ? parseFloat(basePrice) : undefined,
    });
  }
  logQuote("ONRAMP", quote.data, submitResult);
  return true;
}

async function runOfframp(doSubmit: boolean): Promise<boolean | void> {
  if (onchainPairs.length === 0) {
    console.log("[skip] No onchain pairs for offramp.");
    return;
  }
  const pair = randomChoice(onchainPairs);
  const inputAmount = randomInRange(5, 50, 2);
  const quote = await getV1Quote(
    {
      action: "OFFRAMP",
      inputAmount,
      inputCurrency: pair.symbol,
      outputCurrency: "GHS",
      chain: pair.chainCode,
    },
    { retryOn5xx: true }
  );
  if (!quote.ok) {
    console.log(
      `[OFFRAMP] quote failed: ${quote.status} ${quote.error} (${quote.code ?? ""}) — inputAmount=${inputAmount} chain=${pair.chainCode} input=${pair.symbol}`
    );
    return false;
  }
  let submitResult: { ok: boolean; orderId?: string; error?: string } | undefined;
  if (doSubmit) {
    const f_amount = parseFloat(quote.data.input.amount);
    const t_amount = parseFloat(quote.data.output.amount);
    const f_price = parseFloat(quote.data.exchangeRate);
    const basePrice = quote.data.basePrice ?? quote.data.debug?.basePrice;
    submitResult = await submitOrder({
      action: "sell",
      f_amount,
      t_amount,
      f_price,
      t_price: 1,
      f_chain: pair.chainCode,
      t_chain: "MOMO",
      f_token: pair.symbol,
      t_token: "GHS",
      quoteId: quote.data.quoteId,
      providerPrice: basePrice != null ? parseFloat(basePrice) : undefined,
    });
  }
  logQuote("OFFRAMP", quote.data, submitResult);
  return true;
}

/** Onramp reversed: user enters crypto amount ("I want X USDC") → get fiat to pay. inputSide "to". */
async function runOnrampReversed(doSubmit: boolean): Promise<boolean | void> {
  if (onchainPairs.length === 0) {
    console.log("[skip] No onchain pairs for onramp reversed.");
    return;
  }
  const pair = randomChoice(onchainPairs);
  const cryptoAmount = randomInRange(1, 15, 2);
  const quote = await getV1Quote(
    {
      action: "ONRAMP",
      inputAmount: cryptoAmount,
      inputCurrency: pair.symbol,
      outputCurrency: "GHS",
      chain: pair.chainCode,
      inputSide: "to",
    },
    { retryOn5xx: true }
  );
  if (!quote.ok) {
    console.log(
      `[ONRAMP-reversed] quote failed: ${quote.status} ${quote.error} (${quote.code ?? ""}) — want ${cryptoAmount} ${pair.symbol}`
    );
    return false;
  }
  let submitResult: { ok: boolean; orderId?: string; error?: string } | undefined;
  if (doSubmit) {
    const f_amount = parseFloat(quote.data.input.amount);
    const t_amount = parseFloat(quote.data.output.amount);
    const exchangeRate = parseFloat(quote.data.exchangeRate);
    const basePrice = quote.data.basePrice ?? quote.data.debug?.basePrice;
    submitResult = await submitOrder({
      action: "buy",
      f_amount,
      t_amount,
      f_price: 1,
      t_price: exchangeRate,
      f_chain: "MOMO",
      t_chain: pair.chainCode,
      f_token: "GHS",
      t_token: pair.symbol,
      quoteId: quote.data.quoteId,
      providerPrice: basePrice != null ? parseFloat(basePrice) : undefined,
    });
  }
  logQuote("ONRAMP (want crypto)", quote.data, submitResult);
  return true;
}

/** Offramp reversed: user enters fiat amount ("I want X GHS") → get crypto to sell. inputSide "to". */
async function runOfframpReversed(doSubmit: boolean): Promise<boolean | void> {
  if (onchainPairs.length === 0) {
    console.log("[skip] No onchain pairs for offramp reversed.");
    return;
  }
  const pair = randomChoice(onchainPairs);
  const fiatAmount = randomInRange(50, 400, 2);
  const quote = await getV1Quote(
    {
      action: "OFFRAMP",
      inputAmount: fiatAmount,
      inputCurrency: "GHS",
      outputCurrency: pair.symbol,
      chain: pair.chainCode,
      inputSide: "to",
    },
    { retryOn5xx: true }
  );
  if (!quote.ok) {
    console.log(
      `[OFFRAMP-reversed] quote failed: ${quote.status} ${quote.error} (${quote.code ?? ""}) — want ${fiatAmount} GHS`
    );
    return false;
  }
  let submitResult: { ok: boolean; orderId?: string; error?: string } | undefined;
  if (doSubmit) {
    const f_amount = parseFloat(quote.data.input.amount);
    const t_amount = parseFloat(quote.data.output.amount);
    const f_price = parseFloat(quote.data.exchangeRate);
    const basePrice = quote.data.basePrice ?? quote.data.debug?.basePrice;
    submitResult = await submitOrder({
      action: "sell",
      f_amount,
      t_amount,
      f_price,
      t_price: 1,
      f_chain: pair.chainCode,
      t_chain: "MOMO",
      f_token: pair.symbol,
      t_token: "GHS",
      quoteId: quote.data.quoteId,
      providerPrice: basePrice != null ? parseFloat(basePrice) : undefined,
    });
  }
  logQuote("OFFRAMP (want fiat)", quote.data, submitResult);
  return true;
}

async function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(): { delayMs: number; submit: boolean; help: boolean } {
  const argv = process.argv.slice(2);
  let delayMs = 2000;
  let submit = false;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help" || argv[i] === "-h") help = true;
    else if (argv[i] === "--submit") submit = true;
    else if (argv[i] === "--delay" && argv[i + 1]) delayMs = Math.max(500, parseInt(argv[++i], 10) || 2000);
  }
  return { delayMs, submit, help };
}

async function main(): Promise<void> {
  const { delayMs, submit, help } = parseArgs();
  if (help) {
    console.log(`
Onramp/Offramp live test — uses POST /api/v1/quotes. Runs until Ctrl+C.

Usage: pnpm test:live:onramp-offramp [options]
  --delay <ms>   Delay between iterations (default 2000).
  --submit       Also POST to /webhook/order with quote amounts.
  -h, --help     Show this help.

Scenarios (25% each): onramp (enter fiat), onramp-reversed (want crypto), offramp (enter crypto), offramp-reversed (want fiat).
Env: CORE_URL, CORE_API_KEY (optional).
`);
    process.exit(0);
  }

  const health = await fetchJson("/health");
  if (!health.ok) {
    console.error("Health check failed. Is the server running at", CORE_URL, "?");
    process.exit(1);
  }

  await getSupportedChainsAndTokens();
  if (submit && CORE_API_KEY) {
    await fetchJson("/api/validation/cache/refresh", { method: "POST" });
    await syncBalances();
  }
  console.log(
    `Quotes test started. Supported: ${onchainPairs.length} onchain pairs, fiat: ${fiatChains.join(", ") || "none"}. Delay ${delayMs}ms. Submit orders: ${submit}. Stop with Ctrl+C.\n`
  );

  let round = 0;
  let okCount = 0;
  let failCount = 0;
  const summaryInterval = 20;

  for (; ;) {
    round++;
    const r = Math.random();
    const scenario = r < 0.25 ? "onramp" : r < 0.5 ? "onramp-reversed" : r < 0.75 ? "offramp" : "offramp-reversed";
    try {
      if (scenario === "onramp") {
        const hadQuote = await runOnramp(submit);
        if (hadQuote === true) okCount++;
        else if (hadQuote === false) failCount++;
      } else if (scenario === "onramp-reversed") {
        const hadQuote = await runOnrampReversed(submit);
        if (hadQuote === true) okCount++;
        else if (hadQuote === false) failCount++;
      } else if (scenario === "offramp") {
        const hadQuote = await runOfframp(submit);
        if (hadQuote === true) okCount++;
        else if (hadQuote === false) failCount++;
      } else {
        const hadQuote = await runOfframpReversed(submit);
        if (hadQuote === true) okCount++;
        else if (hadQuote === false) failCount++;
      }
    } catch (err) {
      console.error("[error]", err);
      failCount++;
    }
    if (round % summaryInterval === 0 && round > 0) {
      console.log(`[summary] Quotes: ${okCount} ok, ${failCount} failed (last ${summaryInterval} rounds)\n`);
      okCount = 0;
      failCount = 0;
    }
    await delay(delayMs);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
