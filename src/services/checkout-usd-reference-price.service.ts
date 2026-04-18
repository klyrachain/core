import { getEnv } from "../config/env.js";

const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  XRP: "ripple",
  WXRP: "ripple",
  BNB: "binancecoin",
  DOGE: "dogecoin",
  TRX: "tron",
  LTC: "litecoin",
  AVAX: "avalanche-2",
  DOT: "polkadot",
  LINK: "chainlink",
  MATIC: "matic-network",
  POL: "matic-network",
};

const STABLE_SYMBOLS = new Set([
  "USDC",
  "USDT",
  "DAI",
  "BUSD",
  "FDUSD",
  "USDB",
  "TUSD",
  "USDP",
  "GUSD",
]);

/** CoinGecko `simple/token_price/{platform}` platform id per checkout chain slug. */
const COINGECKO_PLATFORM_BY_CHECKOUT_CHAIN: Record<string, string> = {
  BASE: "base",
  BNB: "binance-smart-chain",
  ETHEREUM: "ethereum",
  SOLANA: "solana",
};

/**
 * Default mainnet mints/contracts for checkout rows when the client did not pass `tokenAddress`.
 * Must stay aligned with `checkout-payout-quotes.service` display legs.
 */
const DEFAULT_CHECKOUT_TOKEN_CA: Record<string, Record<string, string>> = {
  BASE: {
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  BNB: {
    USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  },
  ETHEREUM: {
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    WXRP: "0x39fBBABf11738317a448031930706cd3e612e1B9",
  },
  SOLANA: {
    USDC: "EPjFWdd5AufqSSqeM2qAq3h91M4A8fYf1R9n9xv8wYw",
    SOL: "So11111111111111111111111111111111111111112",
  },
};

let cache: { ids: string; prices: Record<string, number>; at: number } | null = null;
const CACHE_MS = 120_000;

const tokenPriceCache = new Map<string, { usd: number; at: number }>();

function coingeckoHeaders(): HeadersInit {
  try {
    const key = getEnv().COINGECKO_API_KEY?.trim();
    if (!key) return {};
    return { "x-cg-demo-api-key": key };
  } catch {
    return {};
  }
}

export function isStableCheckoutSymbol(symbol: string): boolean {
  return STABLE_SYMBOLS.has(symbol.trim().toUpperCase());
}

export function coingeckoIdForSymbol(symbol: string): string | null {
  return COINGECKO_IDS[symbol.trim().toUpperCase()] ?? null;
}

function resolveCheckoutReferenceContract(
  chainSlug: string,
  symbol: string,
  explicit?: string | null
): string | null {
  const t = explicit?.trim();
  if (t) return t;
  const c = chainSlug.trim().toUpperCase();
  const s = symbol.trim().toUpperCase();
  return DEFAULT_CHECKOUT_TOKEN_CA[c]?.[s] ?? null;
}

/**
 * Batch-fetch USD spot for the given CoinGecko `ids` (comma-separated), cached briefly.
 */
export async function fetchUsdSpotByCoingeckoId(ids: string[]): Promise<Map<string, number>> {
  const uniq = [...new Set(ids.map((s) => s.trim()).filter(Boolean))];
  const out = new Map<string, number>();
  if (uniq.length === 0) return out;

  const key = uniq.sort().join(",");
  const now = Date.now();
  if (cache && cache.ids === key && now - cache.at < CACHE_MS) {
    for (const id of uniq) {
      const v = cache.prices[id];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) out.set(id, v);
    }
    return out;
  }

  const url = new URL("https://api.coingecko.com/api/v3/simple/price");
  url.searchParams.set("ids", key);
  url.searchParams.set("vs_currencies", "usd");

  const res = await fetch(url.toString(), {
    headers: coingeckoHeaders(),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return out;

  const body = (await res.json()) as Record<string, { usd?: number } | undefined>;
  const prices: Record<string, number> = {};
  for (const id of uniq) {
    const u = body[id]?.usd;
    if (typeof u === "number" && Number.isFinite(u) && u > 0) {
      prices[id] = u;
      out.set(id, u);
    }
  }
  cache = { ids: key, prices, at: now };
  return out;
}

async function fetchUsdSpotByTokenContract(
  platform: string,
  contract: string
): Promise<number | null> {
  const addrParam = platform === "solana" ? contract.trim() : contract.trim().toLowerCase();
  if (!addrParam) return null;
  if (platform !== "solana" && !/^0x[a-fA-F0-9]{40}$/.test(addrParam)) return null;

  const cacheKey = `${platform}:${addrParam}`;
  const now = Date.now();
  const hit = tokenPriceCache.get(cacheKey);
  if (hit && now - hit.at < CACHE_MS) return hit.usd;

  const url = new URL(
    `https://api.coingecko.com/api/v3/simple/token_price/${encodeURIComponent(platform)}`
  );
  url.searchParams.set("contract_addresses", addrParam);
  url.searchParams.set("vs_currencies", "usd");

  const res = await fetch(url.toString(), {
    headers: coingeckoHeaders(),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;

  const body = (await res.json()) as Record<string, { usd?: number } | undefined>;
  const row = body[addrParam] ?? body[Object.keys(body)[0] ?? ""];
  const u = row?.usd;
  if (typeof u !== "number" || !Number.isFinite(u) || u <= 0) return null;
  tokenPriceCache.set(cacheKey, { usd: u, at: now });
  return u;
}

/**
 * Prefer on-chain contract / mint USD from CoinGecko when we know the platform; otherwise
 * fall back to `simple/price` by mapped coin id for the symbol.
 */
export async function fetchUsdSpotForCheckoutReference(params: {
  chainSlug: string;
  symbol: string;
  tokenAddress?: string | null;
}): Promise<number | null> {
  const chain = params.chainSlug.trim().toUpperCase();
  const sym = params.symbol.trim().toUpperCase();
  if (isStableCheckoutSymbol(sym)) return 1;

  const platform = COINGECKO_PLATFORM_BY_CHECKOUT_CHAIN[chain];
  const contract = resolveCheckoutReferenceContract(chain, sym, params.tokenAddress);
  if (platform && contract) {
    const byCa = await fetchUsdSpotByTokenContract(platform, contract);
    if (byCa != null) return byCa;
  }

  const cgId = coingeckoIdForSymbol(sym);
  if (!cgId) return null;
  const spots = await fetchUsdSpotByCoingeckoId([cgId]);
  return spots.get(cgId) ?? null;
}

/**
 * When `CHECKOUT_USD_REFERENCE_PRICE_WARN` is enabled, compares implied USD/token from the
 * checkout quote vs a public reference (CoinGecko). Large divergences are **logged server-side
 * only** — never returned to clients for payer-facing UI.
 */
export async function logCheckoutUsdReferenceVsSpotIfNeeded(params: {
  invoiceUsd: number;
  cryptoAmountStr: string;
  cryptoSymbol: string;
  chainSlug: string;
  tokenAddress?: string | null;
}): Promise<void> {
  let env: ReturnType<typeof getEnv>;
  try {
    env = getEnv();
  } catch {
    return;
  }
  if (!env.CHECKOUT_USD_REFERENCE_PRICE_WARN) return;

  const { invoiceUsd, cryptoAmountStr, cryptoSymbol, chainSlug, tokenAddress } = params;
  if (!Number.isFinite(invoiceUsd) || invoiceUsd <= 0) return;

  const sym = cryptoSymbol.trim().toUpperCase();
  if (isStableCheckoutSymbol(sym)) return;

  const cryptoAmt = Number.parseFloat(cryptoAmountStr.trim());
  if (!Number.isFinite(cryptoAmt) || cryptoAmt <= 0) return;

  const spot = await fetchUsdSpotForCheckoutReference({
    chainSlug,
    symbol: sym,
    tokenAddress,
  });
  if (spot == null || !Number.isFinite(spot) || spot <= 0) return;

  const implied = invoiceUsd / cryptoAmt;
  const ratio = Math.abs(implied - spot) / spot;
  const threshold = env.CHECKOUT_USD_REFERENCE_DEVIATION_RATIO;
  if (ratio < threshold) return;

  const contract = resolveCheckoutReferenceContract(chainSlug, sym, tokenAddress);
  console.warn(
    "[checkout-usd-reference] implied vs spot divergence",
    JSON.stringify({
      chainSlug: chainSlug.trim().toUpperCase(),
      symbol: sym,
      tokenContractOrMint: contract,
      invoiceUsd,
      cryptoAmount: cryptoAmt,
      impliedUsdPerToken: implied,
      referenceUsdPerToken: spot,
      deviationRatio: ratio,
      threshold,
    })
  );
}
