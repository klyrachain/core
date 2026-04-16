import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";

const QuerySchema = z.object({
  q: z.string().optional(),
});

type CurrencyItem = { code: string; name: string; kind: "fiat" | "crypto" };

type FetchResponseLike = {
  ok: boolean;
  json(): Promise<unknown>;
};

const CRYPTO_ITEMS: CurrencyItem[] = [
  { code: "BTC", name: "Bitcoin", kind: "crypto" },
  { code: "ETH", name: "Ethereum", kind: "crypto" },
  { code: "USDC", name: "USD Coin", kind: "crypto" },
  { code: "USDT", name: "Tether", kind: "crypto" },
  { code: "SOL", name: "Solana", kind: "crypto" },
  { code: "BNB", name: "BNB", kind: "crypto" },
  { code: "MATIC", name: "Polygon", kind: "crypto" },
  { code: "ARB", name: "Arbitrum", kind: "crypto" },
  { code: "OP", name: "Optimism", kind: "crypto" },
  { code: "BASE_ETH", name: "Base (ETH)", kind: "crypto" },
];

const FIAT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let fiatCache: { loadedAt: number; items: CurrencyItem[] } | null = null;

async function loadFiatCurrencies(): Promise<CurrencyItem[]> {
  if (fiatCache && Date.now() - fiatCache.loadedAt < FIAT_CACHE_TTL_MS) {
    return fiatCache.items;
  }
  const res = (await fetch(
    "https://restcountries.com/v3.1/all?fields=name,cca2,currencies",
    { signal: AbortSignal.timeout(20_000) }
  )) as unknown as FetchResponseLike;
  if (!res.ok) {
    if (fiatCache?.items.length) return fiatCache.items;
    return fallbackFiat();
  }
  const raw = (await res.json()) as Array<{
    name?: { common?: string };
    cca2?: string;
    currencies?: Record<string, { name?: string; symbol?: string }>;
  }>;
  const items: CurrencyItem[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    const cur = row.currencies;
    if (!cur || typeof cur !== "object") continue;
    for (const [code, meta] of Object.entries(cur)) {
      const c = code?.trim().toUpperCase();
      if (!c || c.length < 3 || c.length > 4 || seen.has(c)) continue;
      seen.add(c);
      const name = meta?.name?.trim() || c;
      items.push({ code: c, name, kind: "fiat" });
    }
  }
  items.sort((a, b) => a.code.localeCompare(b.code));
  fiatCache = { loadedAt: Date.now(), items };
  return items;
}

function fallbackFiat(): CurrencyItem[] {
  return [
    { code: "USD", name: "US Dollar", kind: "fiat" },
    { code: "EUR", name: "Euro", kind: "fiat" },
    { code: "GBP", name: "British Pound", kind: "fiat" },
    { code: "GHS", name: "Ghanaian Cedi", kind: "fiat" },
    { code: "NGN", name: "Nigerian Naira", kind: "fiat" },
    { code: "KES", name: "Kenyan Shilling", kind: "fiat" },
    { code: "ZAR", name: "South African Rand", kind: "fiat" },
  ];
}

function matchesQuery(item: CurrencyItem, q: string): boolean {
  const n = q.trim().toLowerCase();
  if (!n) return true;
  return (
    item.code.toLowerCase().includes(n) || item.name.toLowerCase().includes(n)
  );
}

export async function publicCurrenciesApiRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/public/currencies",
    async (req: FastifyRequest<{ Querystring: unknown }>, reply) => {
      try {
        const parsed = QuerySchema.safeParse(req.query);
        const q = parsed.success ? (parsed.data.q ?? "") : "";
        const [fiat, crypto] = await Promise.all([
          loadFiatCurrencies(),
          Promise.resolve(CRYPTO_ITEMS),
        ]);
        const merged = [...crypto, ...fiat];
        const filtered = q ? merged.filter((i) => matchesQuery(i, q)) : merged;
        const limit = 200;
        return successEnvelope(reply, { items: filtered.slice(0, limit) });
      } catch (err) {
        req.log.warn({ err }, "GET /api/public/currencies fallback");
        try {
          const parsed = QuerySchema.safeParse(req.query);
          const q = parsed.success ? (parsed.data.q ?? "") : "";
          const merged = [...CRYPTO_ITEMS, ...fallbackFiat()];
          const filtered = q ? merged.filter((i) => matchesQuery(i, q)) : merged;
          return successEnvelope(reply, { items: filtered.slice(0, 200) });
        } catch (e) {
          req.log.error({ err: e }, "GET /api/public/currencies");
          return errorEnvelope(reply, "Something went wrong.", 500);
        }
      }
    }
  );
}
