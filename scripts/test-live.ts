#!/usr/bin/env node
/**
 * Live test script — simulates user actions for testing and development.
 * Runs until Ctrl+C. After random intervals (seconds/minutes), performs
 * order actions (buy, sell, request, claim), Paystack API calls (prioritized),
 * quote API (fee, swap, onramp), crypto-transactions record, and other fetch APIs.
 *
 * Real-world flows: order→Paystack initialize; banks list→resolve (dynamic bank_code);
 * swap quote→POST crypto-transactions; onramp quote; payout request (when COMPLETED tx exists).
 * Fetch variants: transactions (status/type), inventory/history, crypto-transactions list.
 *
 * Usage: pnpm test:live [options]
 *   -f, --from <cats>  Only run actions in these "from" categories (comma-separated).
 *   -t, --to <cats>    Only run actions in these "to" categories (comma-separated).
 *   -f paystack -t klyra  → run only paystack and order (klyra) actions.
 *   Categories: paystack, order, klyra (alias of order), quote, fetch, admin.
 *   --help             Show this help and exit.
 *
 * Env: CORE_URL (default http://localhost:4000), CORE_API_KEY (required for protected routes),
 *      INTERVAL_MIN_MS, INTERVAL_MAX_MS. Paystack routes return 503 if PAYSTACK_SECRET_KEY is not set.
 */

import "dotenv/config";

const VALID_CATEGORIES = ["paystack", "order", "klyra", "quote", "fetch", "admin"] as const;
const CATEGORY_ALIASES: Record<string, string> = { klyra: "order" };

function parseArgs(): { from: string[]; to: string[]; help: boolean } {
  const argv = process.argv.slice(2);
  let from: string[] = [];
  let to: string[] = [];
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "-f" || arg === "--from") {
      const val = argv[++i];
      if (val) from.push(...val.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
      continue;
    }
    if (arg === "-t" || arg === "--to") {
      const val = argv[++i];
      if (val) to.push(...val.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
      continue;
    }
  }

  from = from.map((c) => CATEGORY_ALIASES[c] ?? c);
  to = to.map((c) => CATEGORY_ALIASES[c] ?? c);
  const validSet = new Set(VALID_CATEGORIES);
  const validFrom = from.filter((c) => validSet.has(c as (typeof VALID_CATEGORIES)[number]));
  const validTo = to.filter((c) => validSet.has(c as (typeof VALID_CATEGORIES)[number]));
  if (validFrom.length !== from.length || validTo.length !== to.length) {
    const unknown = [...from.filter((c) => !validSet.has(c as (typeof VALID_CATEGORIES)[number])), ...to.filter((c) => !validSet.has(c as (typeof VALID_CATEGORIES)[number]))];
    if (unknown.length > 0) {
      console.warn(`Unknown category(ies) ignored: ${[...new Set(unknown)].join(", ")}. Valid: ${VALID_CATEGORIES.join(", ")}`);
    }
  }
  return { from: validFrom, to: validTo, help };
}

function printHelp(): void {
  console.log(`
Live test — hit Core API at random intervals.

Usage: pnpm test:live [options]

Options:
  -f, --from <categories>   Only run actions in these "from" categories (comma-separated).
  -t, --to <categories>     Only run actions in these "to" categories (comma-separated).
  -h, --help                Show this help.

Categories: ${VALID_CATEGORIES.join(", ")}

Examples:
  pnpm test:live                    Run all action types (default mix).
  pnpm test:live -f paystack        Run only Paystack API calls.
  pnpm test:live -t klyra            Run only order webhooks (KLYRA provider).
  pnpm test:live -f paystack -t klyra   Run Paystack + order actions only.
  pnpm test:live -f quote,fetch     Run only quote (fee + swap) and fetch APIs.
`);
}

const CORE_URL = process.env.CORE_URL ?? "http://localhost:4000";
const CORE_API_KEY = process.env.CORE_API_KEY ?? "";
const INTERVAL_MIN_MS = parseInt(process.env.INTERVAL_MIN_MS ?? "3000", 10) || 2000; // 2s default
const INTERVAL_MAX_MS = parseInt(process.env.INTERVAL_MAX_MS ?? "60000", 10) || 3000; // 1/2 min default

const TEST_USERS = [
  { email: "alice@example.com", address: "0xf0830060f836B8d54bF02049E5905F619487989e", type: "EMAIL" as const },
  { email: "bob@example.com", address: "0xf0830060f836B8d54bF02049E5905F619487989e", type: "EMAIL" as const },
  { email: "charlie@example.com", number: "233201234567", type: "NUMBER" as const },
];

/** Token + chain options for cross-chain (e.g. USDC on BASE → ETH on ETHEREUM). */
const TOKEN_CHAINS: { symbol: string; chain: string }[] = [
  { symbol: "USDC", chain: "ETHEREUM" },
  { symbol: "USDC", chain: "BASE" },
  { symbol: "ETH", chain: "ETHEREUM" },
  // { symbol: "GHS", chain: "ETHEREUM" },
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

/** Paystack GET endpoints for live testing. 503 when PAYSTACK_SECRET_KEY is not set. */
const PAYSTACK_ACTIONS: { path: string; name: string }[] = [
  { path: "/api/paystack/banks?country=ghana", name: "paystack/banks (ghana)" },
  { path: "/api/paystack/banks?country=nigeria", name: "paystack/banks (nigeria)" },
  { path: "/api/paystack/banks/resolve?account_number=0123456789&bank_code=063", name: "paystack/banks/resolve" },
  { path: "/api/paystack/mobile/providers?currency=GHS", name: "paystack/mobile (GHS)" },
  { path: "/api/paystack/mobile/providers?currency=KES", name: "paystack/mobile (KES)" },
  { path: "/api/paystack/transactions?perPage=5", name: "paystack/transactions" },
  { path: "/api/paystack/transfers?perPage=5", name: "paystack/transfers" },
  { path: "/api/paystack/payouts/history?perPage=5", name: "paystack/payouts/history" },
];

/** Quote API: fee (GET) and swap (POST) variants. */
const QUOTE_FETCH_ACTIONS: { path: string; name: string }[] = [
  {
    path: "/api/quote?action=buy&f_amount=100&t_amount=0.033&f_price=1&t_price=3000&f_chain=BASE&t_chain=ETHEREUM&f_token=USDC&t_token=ETH",
    name: "quote (buy)",
  },
  {
    path: "/api/quote?action=sell&f_amount=100&t_amount=0.033&f_price=1&t_price=3000&f_chain=ETHEREUM&t_chain=BASE&f_token=USDC&t_token=ETH",
    name: "quote (sell)",
  },
  {
    path: "/api/quote?action=request&f_amount=50&t_amount=50&f_price=1&t_price=1&f_chain=ETHEREUM&t_chain=BASE&f_token=GHS&t_token=USDC",
    name: "quote (request)",
  },
  {
    path: "/api/quote?action=claim&f_amount=25&t_amount=25&f_price=1&t_price=3000&f_chain=BASE&t_chain=ETHEREUM&f_token=USDC&t_token=ETH",
    name: "quote (claim)",
  },
];

const OTHER_FETCH_ACTIONS: { path: string; name: string }[] = [
  { path: "/api/transactions?limit=5", name: "transactions" },
  { path: "/api/transactions?status=PENDING&limit=5", name: "transactions (PENDING)" },
  { path: "/api/transactions?status=COMPLETED&limit=5", name: "transactions (COMPLETED)" },
  { path: "/api/transactions?type=BUY&limit=5", name: "transactions (type=BUY)" },
  { path: "/api/users?limit=5", name: "users" },
  { path: "/api/inventory?limit=5", name: "inventory" },
  { path: "/api/inventory/history?limit=5", name: "inventory/history" },
  { path: "/api/queue/poll", name: "queue/poll" },
  { path: "/api/cache/balances?limit=10", name: "cache/balances" },
  { path: "/api/requests?limit=5", name: "requests" },
  { path: "/api/claims?limit=5", name: "claims" },
  { path: "/api/wallets?limit=5", name: "wallets" },
  { path: "/api/crypto-transactions?limit=5", name: "crypto-transactions" },
];

type Action =
  | { type: "order"; action: "buy" | "sell" | "request" | "claim" }
  | { type: "paystack"; path: string; name: string }
  | { type: "paystackInit" }
  | { type: "paystackBanksResolve" }
  | { type: "payoutRequest" }
  | { type: "quote"; path: string; name: string }
  | { type: "quoteSwap" }
  | { type: "onrampQuote" }
  | { type: "quoteThenCrypto" }
  | { type: "fetch"; path: string; name: string }
  | { type: "admin"; event: string };

function getActionCategory(action: Action): string {
  switch (action.type) {
    case "paystack":
    case "paystackInit":
    case "paystackBanksResolve":
    case "payoutRequest":
      return "paystack";
    case "order":
      return "order";
    case "quote":
    case "quoteSwap":
    case "onrampQuote":
    case "quoteThenCrypto":
      return "quote";
    case "fetch":
      return "fetch";
    case "admin":
      return "admin";
    default:
      return "fetch";
  }
}

/** Build full list of action "templates" for filtering. One entry per concrete option. */
function buildAllActionTemplates(): Action[] {
  const templates: Action[] = [];
  for (const a of PAYSTACK_ACTIONS) {
    templates.push({ type: "paystack", path: a.path, name: a.name });
  }
  templates.push({ type: "paystackInit" });
  templates.push({ type: "paystackBanksResolve" });
  templates.push({ type: "payoutRequest" });
  for (const action of ["buy", "sell", "request", "claim"] as const) {
    templates.push({ type: "order", action });
  }
  for (const a of QUOTE_FETCH_ACTIONS) {
    templates.push({ type: "quote", path: a.path, name: a.name });
  }
  templates.push({ type: "quoteSwap" });
  templates.push({ type: "onrampQuote" });
  templates.push({ type: "quoteThenCrypto" });
  for (const a of OTHER_FETCH_ACTIONS) {
    templates.push({ type: "fetch", path: a.path, name: a.name });
  }
  for (const event of ["test.ping", "test.order.placed", "alert.low_balance"]) {
    templates.push({ type: "admin", event });
  }
  return templates;
}

const ALL_ACTION_TEMPLATES = buildAllActionTemplates();

/** When filter is active, only these templates are used; never the default mix. */
let FILTERED_TEMPLATES: Action[] | null = null;

function setFilteredTemplates(filterFrom: string[], filterTo: string[]): void {
  const hasFilter = filterFrom.length > 0 || filterTo.length > 0;
  if (!hasFilter) {
    FILTERED_TEMPLATES = null;
    return;
  }
  const union = [...new Set([...filterFrom, ...filterTo])];
  const filtered = ALL_ACTION_TEMPLATES.filter((a) => union.includes(getActionCategory(a)));
  if (filtered.length === 0) {
    console.warn("Filter matched no actions; valid categories: " + VALID_CATEGORIES.join(", "));
    FILTERED_TEMPLATES = null;
    return;
  }
  FILTERED_TEMPLATES = filtered;
}

function pickRandomAction(filterFrom: string[], filterTo: string[]): Action {
  if (FILTERED_TEMPLATES && FILTERED_TEMPLATES.length > 0) {
    return randomChoice(FILTERED_TEMPLATES);
  }

  const roll = Math.random();
  if (roll < 0.38) {
    const a = randomChoice(PAYSTACK_ACTIONS);
    return { type: "paystack", path: a.path, name: a.name };
  }
  if (roll < 0.42) {
    return { type: "paystackInit" };
  }
  if (roll < 0.44) {
    return { type: "paystackBanksResolve" };
  }
  if (roll < 0.45) {
    return { type: "payoutRequest" };
  }
  if (roll < 0.62) {
    return { type: "order", action: randomChoice(["buy", "sell", "request", "claim"]) };
  }
  if (roll < 0.74) {
    const pool = [...QUOTE_FETCH_ACTIONS, ...OTHER_FETCH_ACTIONS];
    const f = randomChoice(pool);
    return f.path.startsWith("/api/quote") ? { type: "quote", path: f.path, name: f.name } : { type: "fetch", path: f.path, name: f.name };
  }
  if (roll < 0.80) {
    return { type: "quoteSwap" };
  }
  if (roll < 0.84) {
    return { type: "onrampQuote" };
  }
  if (roll < 0.88) {
    return { type: "quoteThenCrypto" };
  }
  return { type: "admin", event: randomChoice(["test.ping", "test.order.placed", "alert.low_balance"]) };
}

/**
 * Build order payload using token+chain and /api/quote.
 * Supports cross-chain (e.g. USDC on BASE → ETH on ETHEREUM). Fetches quote then sends f_chain, t_chain, f_token, t_token.
 */
const TEST_USERS_WITH_ADDRESS = TEST_USERS.filter((u) => "address" in u && (u as { address?: string }).address);

async function buildOrderPayloadWithQuote(
  action: "buy" | "sell" | "request" | "claim"
): Promise<{ payload: Record<string, unknown>; quote?: QuoteData }> {
  const providers = providersForAction(action);
  const from = randomChoice(TEST_USERS);
  const to =
    providers.t_provider === "KLYRA" && TEST_USERS_WITH_ADDRESS.length > 0
      ? randomChoice(TEST_USERS_WITH_ADDRESS)
      : action === "request" || action === "claim"
        ? randomChoice(TEST_USERS_WITH_ADDRESS.length > 0 ? TEST_USERS_WITH_ADDRESS : TEST_USERS)
        : randomChoice(TEST_USERS);

  let fToken: string;
  let tToken: string;
  let fChain: string;
  let tChain: string;
  let fAmount: number;
  let tAmount: number;
  let fPrice: number;
  let tPrice: number;

  // request/claim: t_provider is KLYRA (on-chain) so t_token must be on-chain (not GHS/USD). Avoid same-token same-chain.
  if (action === "request" || action === "claim") {
    fToken = "GHS"; // payer pays fiat (f_provider ANY)
    tToken = randomChoice(["USDC", "ETH"]); // requester receives on-chain (t_provider KLYRA)
    fChain = "ETHEREUM";
    tChain = tToken === "USDC" ? randomChoice(["ETHEREUM", "BASE"]) : "ETHEREUM";
    fAmount = randomAmount(10, 100);
    tAmount = tToken === "ETH" ? randomAmount(0.001, 0.1) : randomAmount(10, 100);
    fPrice = TOKEN_PRICES[fToken] ?? 1;
    tPrice = TOKEN_PRICES[tToken] ?? 1;
    tAmount = Math.round(tAmount * 1e8) / 1e8;
    fAmount = Math.round(fAmount * 1e8) / 1e8;
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

  const toUser = to as { email?: string; number?: string; address?: string; type?: string };
  const toIdentifier =
    providers.t_provider === "KLYRA" && toUser.address ? toUser.address : getIdentifier(to);
  const toType =
    providers.t_provider === "KLYRA" && toUser.address ? "ADDRESS" : (to as { type: string }).type;

  const payload: Record<string, unknown> = {
    action,
    fromIdentifier: getIdentifier(from),
    fromType: from.type,
    toIdentifier,
    toType,
    f_amount: fAmount,
    t_amount: tAmount,
    f_price: fPrice,
    t_price: tPrice,
    f_chain: fChain,
    t_chain: tChain,
    f_token: fToken,
    t_token: tToken,
    f_provider: providers.f_provider,
    t_provider: providers.t_provider,
  };

  return { payload, quote: quoteResult.quote };
}

/** Use available providers per action; required for all transactions. */
function providersForAction(action: "buy" | "sell" | "request" | "claim"): {
  f_provider: "KLYRA" | "ANY";
  t_provider: "KLYRA";
} {
  switch (action) {
    case "request":
    case "claim":
      return { f_provider: "ANY", t_provider: "KLYRA" };
    case "buy":
    case "sell":
    default:
      return { f_provider: "KLYRA", t_provider: "KLYRA" };
  }
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
  if (action.type === "paystack") {
    const result = await fetchJson(action.path);
    if (result.ok) {
      const count = Array.isArray(result.data) ? result.data.length : result.data && typeof result.data === "object" ? "ok" : "-";
      console.log(`[${ts}] GET ${action.name} → 200 (${count})`);
    } else if (result.status === 503) {
      console.log(`[${ts}] GET ${action.name} → 503 (Paystack not configured)`);
    } else {
      console.log(`[${ts}] GET ${action.name} → ${result.status} ${result.error ?? "error"}`);
    }
    return;
  }
  if (action.type === "paystackInit") {
    const { payload } = await buildOrderPayloadWithQuote("buy");
    const orderRes = await fetchJson("/webhook/order", { method: "POST", body: JSON.stringify(payload) });
    const txId = orderRes.ok && orderRes.data && typeof orderRes.data === "object" && "id" in orderRes.data ? (orderRes.data as { id: string }).id : null;
    if (!txId) {
      console.log(`[${ts}] Paystack init (order first) → order ${orderRes.status}; skip initialize`);
      return;
    }
    // Supported currencies: GHS, USD
    const currency = randomChoice(["GHS", "USD"] as const);
    const amountSubunits = currency === "GHS" ? 5000 : 1000; // 50 GHS or 10 USD (cents)
    const initRes = await fetchJson("/api/paystack/payments/initialize", {
      method: "POST",
      body: JSON.stringify({
        email: "test@example.com",
        amount: amountSubunits,
        currency,
        transaction_id: txId,
      }),
    });
    if (initRes.ok && initRes.data && typeof initRes.data === "object" && "authorization_url" in (initRes.data as object)) {
      console.log(`[${ts}] Paystack init → 201 tx=${txId} currency=${currency} (authorization_url present)`);
    } else if (initRes.status === 503) {
      console.log(`[${ts}] Paystack init → 503 (Paystack not configured)`);
    } else {
      console.log(`[${ts}] Paystack init → ${initRes.status} ${initRes.error ?? "error"}`);
    }
    return;
  }
  if (action.type === "paystackBanksResolve") {
    const country = randomChoice(["nigeria", "ghana"]);
    const banksRes = await fetchJson(`/api/paystack/banks?country=${country}`);
    if (!banksRes.ok || !banksRes.data || typeof banksRes.data !== "object" || !("banks" in (banksRes.data as object))) {
      console.log(`[${ts}] Paystack banks→resolve → banks ${banksRes.status}; skip resolve`);
      return;
    }
    console.log(`[${ts}] Paystack banks→resolve → banksRes=${JSON.stringify(banksRes.data)}`);
    const banks = (banksRes.data as { banks?: { code: string }[] }).banks;
    const bank = Array.isArray(banks) && banks.length > 0 ? randomChoice(banks) : null;
    const bankCode = bank?.code ?? "063";
    console.log(`[${ts}] Paystack banks→resolve → bankCode=${bankCode}`);
    console.log(`[${ts}] Paystack banks→resolve → country=${country}`);
    const resolveRes = await fetchJson(`/api/paystack/banks/resolve?account_number=1400005000124&bank_code=${encodeURIComponent(bankCode)}`);
    console.log(`[${ts}] Paystack banks->details → ${resolveRes.data}`);
    if (resolveRes.ok) {
      const name = resolveRes.data && typeof resolveRes.data === "object" && "account_name" in (resolveRes.data as object) ? (resolveRes.data as { account_name: string }).account_name : "-";
      console.log(`[${ts}] Paystack banks→resolve → 200 account_name=${name}`);
    } else if (resolveRes.status === 503) {
      console.log(`[${ts}] Paystack banks→resolve → 503 (Paystack not configured)`);
    } else {
      console.log(`[${ts}] Paystack banks→resolve → ${resolveRes.status} ${resolveRes.error ?? "error"}`);
    }
    return;
  }
  if (action.type === "payoutRequest") {
    const listRes = await fetchJson("/api/transactions?status=COMPLETED&limit=1");
    const list = listRes.ok && Array.isArray(listRes.data) ? listRes.data : listRes.ok && listRes.data && typeof listRes.data === "object" && "transactions" in (listRes.data as object) ? (listRes.data as { transactions: unknown[] }).transactions : [];
    const first = Array.isArray(list) && list.length > 0 && list[0] && typeof list[0] === "object" && "id" in (list[0] as object) ? (list[0] as { id: string }).id : null;
    if (!first) {
      console.log(`[${ts}] Payout request → no COMPLETED tx; skip`);
      return;
    }
    const payoutRes = await fetchJson("/api/paystack/payouts/request", {
      method: "POST",
      body: JSON.stringify({ transaction_id: first }),
    });
    if (payoutRes.ok && payoutRes.data && typeof payoutRes.data === "object" && "code" in (payoutRes.data as object)) {
      console.log(`[${ts}] Payout request → 201 tx=${first} code present`);
    } else if (payoutRes.status === 503) {
      console.log(`[${ts}] Payout request → 503 (Paystack not configured)`);
    } else {
      console.log(`[${ts}] Payout request → ${payoutRes.status} ${payoutRes.error ?? "error"}`);
    }
    return;
  }
  if (action.type === "onrampQuote") {
    const country = randomChoice(["GH", "NG"]);
    const chainId = randomChoice([1, 8453]);
    const token = randomChoice(["USDC", "ETH"]);
    const amount = randomAmount(10, 200);
    const amountIn = randomChoice(["fiat", "crypto"]);
    const body = { country, chain_id: chainId, token, amount, amount_in: amountIn };
    const res = await fetchJson("/api/quote/onramp", { method: "POST", body: JSON.stringify(body) });
    if (res.ok) {
      const data = res.data as { total_crypto?: string; total_fiat?: number } | undefined;
      const info = data ? ` total_crypto=${data.total_crypto ?? "-"} total_fiat=${data.total_fiat ?? "-"}` : "";
      console.log(`[${ts}] POST quote/onramp → 200${info}`);
    } else if (res.status === 503) {
      console.log(`[${ts}] POST quote/onramp → 503 (Fonbnk not configured)`);
    } else {
      console.log(`[${ts}] POST quote/onramp → ${res.status} ${res.error ?? "error"}`);
    }
    return;
  }
  if (action.type === "quoteThenCrypto") {
    const swapBody = {
      provider: "0x",
      from_token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      to_token: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      amount: "1000000",
      from_chain: 1,
      to_chain: 1,
      from_address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    };
    const swapRes = await fetchJson("/api/quote/swap", { method: "POST", body: JSON.stringify(swapBody) });
    const data = swapRes.ok && swapRes.data && typeof swapRes.data === "object" ? (swapRes.data as { from_chain_id?: number; to_chain_id?: number; from_token?: string; to_token?: string; from_amount?: string; to_amount?: string; provider?: string }) : null;
    if (data && typeof data.from_chain_id === "number" && typeof data.to_chain_id === "number" && data.from_token && data.to_token && data.from_amount && data.to_amount) {
      const createRes = await fetchJson("/api/crypto-transactions", {
        method: "POST",
        body: JSON.stringify({
          provider: data.provider ?? "0x",
          from_chain_id: data.from_chain_id,
          to_chain_id: data.to_chain_id,
          from_token: data.from_token,
          to_token: data.to_token,
          from_amount: data.from_amount,
          to_amount: data.to_amount,
        }),
      });
      if (createRes.ok && createRes.data && typeof createRes.data === "object" && "id" in (createRes.data as object)) {
        console.log(`[${ts}] Quote→crypto-transactions → 201 id=${(createRes.data as { id: string }).id}`);
      } else {
        console.log(`[${ts}] Quote→crypto-transactions → ${createRes.status} ${createRes.error ?? "error"}`);
      }
    } else {
      const msg = swapRes.status === 503 ? " (swap not configured)" : swapRes.status === 502 ? ` ${swapRes.error ?? ""}` : "";
      console.log(`[${ts}] Quote→crypto-transactions (swap first) → swap ${swapRes.status}${msg}; skip record`);
    }
    return;
  }
  if (action.type === "quote" || action.type === "fetch") {
    const result = await fetchJson(action.path);
    if (result.ok) {
      const count = Array.isArray(result.data) ? result.data.length : result.data && typeof result.data === "object" ? "ok" : "-";
      console.log(`[${ts}] GET ${action.name} → 200 (${count})`);
    } else {
      console.log(`[${ts}] GET ${action.name} → ${result.status} ${result.error ?? "error"}`);
    }
    return;
  }
  if (action.type === "quoteSwap") {
    const result = await fetchJson("/api/quote/swap", {
      method: "POST",
      body: JSON.stringify({
        "provider": "squid",
        "from_token": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "to_token": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        "amount": "100000000000",
        "from_chain": 8453,
        "to_chain": 1,
        "from_address": "0xf0830060f836B8d54bF02049E5905F619487989e"
      }),
    });
    if (result.ok) {
      const data = result.data as { provider?: string; to_amount?: string } | undefined;
      const info = data?.to_amount ? ` to_amount=${data.to_amount}` : "";
      console.log(`[${ts}] POST quote/swap → 200${info}`);
    } else {
      const msg = result.status === 503 ? " (swap not configured)" : result.status === 502 ? ` ${result.error ?? ""}` : "";
      console.log(`[${ts}] POST quote/swap → ${result.status}${msg}`);
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
  const { from: filterFrom, to: filterTo, help } = parseArgs();
  if (help) {
    printHelp();
    process.exit(0);
  }

  setFilteredTemplates(filterFrom, filterTo);
  const filterActive = filterFrom.length > 0 || filterTo.length > 0;
  const filterLabel = filterActive
    ? ` (filter: from=[${filterFrom.join(",") || "any"}] to=[${filterTo.join(",") || "any"}])`
    : "";
  const onlyRunning =
    filterActive && FILTERED_TEMPLATES && FILTERED_TEMPLATES.length > 0
      ? ` Only running: ${[...new Set(FILTERED_TEMPLATES.map(getActionCategory))].join(", ")} (${FILTERED_TEMPLATES.length} actions).`
      : "";

  console.log(`Live test → ${CORE_URL} (interval ${INTERVAL_MIN_MS}–${INTERVAL_MAX_MS} ms)${filterLabel}.${onlyRunning} Ctrl+C to stop.\n`);

  if (!CORE_API_KEY) {
    console.error("CORE_API_KEY is not set. Protected routes require x-api-key. Add it to .env (e.g. from pnpm key:generate).");
    process.exit(1);
  }

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
    const action = pickRandomAction(filterFrom, filterTo);
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
