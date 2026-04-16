/**
 * Currency → flag PNG URL via REST Countries API (free, no key).
 * One cached `all` fetch; map ISO4217 codes to a representative country's flag.
 */

const REST_URL = "https://restcountries.com/v3.1/all?fields=cca2,currencies,flags";

type CountryRow = {
  cca2?: string;
  currencies?: Record<string, { name?: string; symbol?: string }>;
  flags?: { png?: string; svg?: string };
};

let cache: { map: Record<string, string>; at: number } | null = null;
const TTL_MS = 24 * 60 * 60 * 1000;

function pickBetterPng(
  prev: { cca2: string; png: string } | undefined,
  cca2: string,
  png: string
): { cca2: string; png: string } {
  if (!prev) return { cca2, png };
  return cca2.localeCompare(prev.cca2) < 0 ? { cca2, png } : prev;
}

export async function getCurrencyToFlagPngMap(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.map;

  const http = await fetch(REST_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!http.ok) {
    throw new Error(`REST Countries HTTP ${http.status}`);
  }
  const rows = (await http.json()) as CountryRow[];
  if (!Array.isArray(rows)) {
    throw new Error("REST Countries: invalid JSON");
  }

  const best = new Map<string, { cca2: string; png: string }>();
  for (const row of rows) {
    const png = row.flags?.png?.trim();
    const cca = row.cca2?.trim().toUpperCase();
    if (!png || !cca || !row.currencies) continue;
    for (const code of Object.keys(row.currencies)) {
      const cur = code.trim().toUpperCase();
      if (!cur) continue;
      const next = pickBetterPng(best.get(cur), cca, png);
      best.set(cur, next);
    }
  }

  const map: Record<string, string> = {};
  for (const [cur, v] of best) {
    map[cur] = v.png;
  }
  cache = { map, at: now };
  return map;
}

/** @internal tests */
export function _resetRestCountriesFlagCacheForTests(): void {
  cache = null;
}

export async function buildFiatFlagUrlsForCodes(codes: string[]): Promise<Record<string, string>> {
  let full: Record<string, string>;
  try {
    full = await getCurrencyToFlagPngMap();
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const raw of codes) {
    const c = raw.trim().toUpperCase();
    const u = full[c];
    if (u) out[c] = u;
  }
  return out;
}
