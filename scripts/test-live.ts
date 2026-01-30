#!/usr/bin/env node
/**
 * Live test script — simulates user actions for testing and development.
 * Runs until Ctrl+C. After random intervals (seconds/minutes), performs
 * order actions (buy, sell, request, claim) and fetch API calls.
 *
 * Usage: pnpm test:live
 * Env: CORE_URL (default http://localhost:4000), CORE_API_KEY (required for protected routes), INTERVAL_MIN_MS, INTERVAL_MAX_MS
 */

import "dotenv/config";

const CORE_URL = process.env.CORE_URL ?? "http://localhost:4000";
const CORE_API_KEY = process.env.CORE_API_KEY ?? "";
const INTERVAL_MIN_MS = parseInt(process.env.INTERVAL_MIN_MS ?? "3000", 10) || 3000; // 3s default
const INTERVAL_MAX_MS = parseInt(process.env.INTERVAL_MAX_MS ?? "60000", 10) || 60000; // 1 min default

const TEST_USERS = [
  { email: "alice@example.com", address: "0x1111111111111111111111111111111111111111", type: "EMAIL" as const },
  { email: "bob@example.com", address: "0x2222222222222222222222222222222222222222", type: "EMAIL" as const },
  { email: "charlie@example.com", number: "233201234567", type: "NUMBER" as const },
];

/** Token + chain options for cross-chain (e.g. USDC on BASE → ETH on ETHEREUM). */
const TOKEN_CHAINS: { symbol: string; chain: string }[] = [
  { symbol: "USDC", chain: "ETHEREUM" },
  { symbol: "USDC", chain: "BASE" },
  { symbol: "ETH", chain: "ETHEREUM" },
  { symbol: "GHS", chain: "ETHEREUM" },
  { symbol: "DAI", chain: "ETHEREUM" },
];

/** Token prices (e.g. 1 USDC = 1, 1 ETH = 3000). Used with /api/quote to build consistent order payloads. */
const TOKEN_PRICES: Record<string, number> = {
  USDC: 1,
  ETH: 3000,
  GHS: 1,
  DAI: 1,
};

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomAmount(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 1e8) / 1e8;
}

function randomDelayMs(): number {
  return randomInt(INTERVAL_MIN_MS, INTERVAL_MAX_MS);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(
  path: string,
  options?: RequestInit
): Promise<{ ok: boolean; status: number; data?: unknown; error?: string }> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json", ...(options?.headers as Record<string, string>) };
    if (CORE_API_KEY) headers["x-api-key"] = CORE_API_KEY;
    const res = await fetch(`${CORE_URL}${path}`, {
      ...options,
      headers,
    });
    const body = await res.json().catch(() => ({}));
    return {
      ok: res.ok,
      status: res.status,
      data: (body as { data?: unknown }).data,
      error: (body as { error?: string }).error,
    };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

type QuoteData = {
  feeAmount: number;
  feePercent: number;
  totalCost: number;
  totalReceived: number;
  rate: number;
  grossValue: number;
  profit: number;
};

/** Fetch quote from /api/quote; used to set t_price, t_amount etc. consistently. */
async function fetchQuote(params: {
  action: string;
  f_amount: number;
  t_amount: number;
  f_price: number;
  t_price: number;
  f_chain: string;
  t_chain: string;
  f_token: string;
  t_token: string;
}): Promise<{ ok: boolean; quote?: QuoteData; error?: string }> {
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
  if (!res.ok) return { ok: false, error: res.error };
  const quote = res.data as QuoteData | undefined;
  return quote ? { ok: true, quote } : { ok: false, error: "No quote data" };
}

type Action =
  | { type: "order"; action: "buy" | "sell" | "request" | "claim" }
  | { type: "fetch"; path: string; name: string }
  | { type: "admin"; event: string };

function pickRandomAction(): Action {
  const roll = Math.random();
  if (roll < 0.4) {
    return { type: "order", action: randomChoice(["buy", "sell", "request", "claim"]) };
  }
  if (roll < 0.85) {
    const fetches: { path: string; name: string }[] = [
      { path: "/api/transactions?limit=5", name: "transactions" },
      { path: "/api/users?limit=5", name: "users" },
      { path: "/api/inventory?limit=5", name: "inventory" },
      { path: "/api/queue/poll", name: "queue/poll" },
      { path: "/api/cache/balances?limit=10", name: "cache/balances" },
      { path: "/api/requests?limit=5", name: "requests" },
      { path: "/api/claims?limit=5", name: "claims" },
      { path: "/api/wallets?limit=5", name: "wallets" },
      {
        path: "/api/quote?action=buy&f_amount=100&t_amount=0.033&f_price=1&t_price=3000&f_chain=BASE&t_chain=ETHEREUM&f_token=USDC&t_token=ETH",
        name: "quote",
      },
    ];
    const f = randomChoice(fetches);
    return { type: "fetch", path: f.path, name: f.name };
  }
  return { type: "admin", event: randomChoice(["test.ping", "test.order.placed", "alert.low_balance"]) };
}

/**
 * Build order payload using token+chain and /api/quote.
 * Supports cross-chain (e.g. USDC on BASE → ETH on ETHEREUM). Fetches quote then sends f_chain, t_chain, f_token, t_token.
 */
async function buildOrderPayloadWithQuote(
  action: "buy" | "sell" | "request" | "claim"
): Promise<{ payload: Record<string, unknown>; quote?: QuoteData }> {
  const from = randomChoice(TEST_USERS);
  const to = randomChoice(TEST_USERS);

  let fToken: string;
  let tToken: string;
  let fChain: string;
  let tChain: string;
  let fAmount: number;
  let tAmount: number;
  let fPrice: number;
  let tPrice: number;

  if (action === "request" || action === "claim") {
    const ghs = TOKEN_CHAINS.find((x) => x.symbol === "GHS") ?? { symbol: "GHS", chain: "ETHEREUM" };
    fToken = ghs.symbol;
    tToken = ghs.symbol;
    fChain = ghs.chain;
    tChain = ghs.chain;
    fAmount = randomAmount(10, 100);
    tAmount = randomAmount(10, 100);
    fPrice = TOKEN_PRICES[fToken] ?? 1;
    tPrice = TOKEN_PRICES[tToken] ?? 1;
  } else {
    const fromOpt = randomChoice(TOKEN_CHAINS);
    const toOpt = randomChoice(TOKEN_CHAINS.filter((x) => x.symbol !== fromOpt.symbol || x.chain !== fromOpt.chain));
    fToken = fromOpt.symbol;
    fChain = fromOpt.chain;
    tToken = toOpt.symbol;
    tChain = toOpt.chain;
    fPrice = TOKEN_PRICES[fToken] ?? 1;
    tPrice = TOKEN_PRICES[tToken] ?? 1;
    if (action === "buy") {
      fAmount = randomAmount(10, 500);
      tAmount = (fAmount * fPrice) / tPrice;
    } else {
      tAmount = randomAmount(0.001, 2);
      fAmount = (tAmount * tPrice) / fPrice;
    }
    tAmount = Math.round(tAmount * 1e8) / 1e8;
    fAmount = Math.round(fAmount * 1e8) / 1e8;
  }

  const quoteResult = await fetchQuote({
    action,
    f_amount: fAmount,
    t_amount: tAmount,
    f_price: fPrice,
    t_price: tPrice,
    f_chain: fChain,
    t_chain: tChain,
    f_token: fToken,
    t_token: tToken,
  });

  const getIdentifier = (u: (typeof TEST_USERS)[number]): string => {
    const o = u as { email?: string; number?: string; address?: string };
    return o.email ?? o.number ?? o.address ?? "";
  };

  const payload: Record<string, unknown> = {
    action,
    fromIdentifier: getIdentifier(from),
    fromType: from.type,
    toIdentifier: getIdentifier(to),
    toType: to.type,
    f_amount: fAmount,
    t_amount: tAmount,
    f_price: fPrice,
    t_price: tPrice,
    f_chain: fChain,
    t_chain: tChain,
    f_token: fToken,
    t_token: tToken,
  };

  return { payload, quote: quoteResult.quote };
}

async function runAction(action: Action): Promise<void> {
  const ts = new Date().toISOString();
  if (action.type === "order") {
    const { payload, quote } = await buildOrderPayloadWithQuote(action.action);
    const result = await fetchJson("/webhook/order", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (result.ok && result.data && typeof result.data === "object" && "id" in result.data) {
      const quoteInfo = quote ? ` fee=${quote.feeAmount.toFixed(2)} totalCost=${quote.totalCost.toFixed(2)}` : "";
      console.log(`[${ts}] ORDER ${action.action.toUpperCase()} → 201 id=${(result.data as { id: string }).id}${quoteInfo}`);
    } else {
      console.log(`[${ts}] ORDER ${action.action.toUpperCase()} → ${result.status} ${result.error ?? "error"}`);
    }
    return;
  }
  if (action.type === "fetch") {
    const result = await fetchJson(action.path);
    if (result.ok) {
      const count = Array.isArray(result.data) ? result.data.length : result.data && typeof result.data === "object" ? "ok" : "-";
      console.log(`[${ts}] GET ${action.name} → 200 (${count})`);
    } else {
      console.log(`[${ts}] GET ${action.name} → ${result.status} ${result.error ?? "error"}`);
    }
    return;
  }
  if (action.type === "admin") {
    const result = await fetchJson("/webhook/admin", {
      method: "POST",
      body: JSON.stringify({ event: action.event, data: { source: "test-live", ts } }),
    });
    if (result.ok) {
      console.log(`[${ts}] POST /webhook/admin event=${action.event} → 202`);
    } else {
      console.log(`[${ts}] POST /webhook/admin → ${result.status} ${result.error ?? "error"}`);
    }
    return;
  }
}

async function main(): Promise<void> {
  console.log(`Live test → ${CORE_URL} (interval ${INTERVAL_MIN_MS}–${INTERVAL_MAX_MS} ms). Ctrl+C to stop.\n`);

  if (!CORE_API_KEY) {
    console.error("CORE_API_KEY is not set. Protected routes require x-api-key. Add it to .env (e.g. from pnpm key:generate).");
    process.exit(1);
  }

  // Quick health check
  const health = await fetchJson("/health");
  if (!health.ok) {
    console.error("Health check failed. Is the server running at", CORE_URL, "?");
    process.exit(1);
  }
  console.log("Health check OK.\n");

  let run = true;
  process.on("SIGINT", () => {
    run = false;
  });

  while (run) {
    const action = pickRandomAction();
    await runAction(action);
    const wait = randomDelayMs();
    if (run) {
      await delay(wait);
    }
  }

  console.log("\nStopped.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
