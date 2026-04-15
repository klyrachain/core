/**
 * Regional-indicator flag emoji from ISO 3166-1 alpha-2 (no per-fiat manual table).
 * Multi-region ISO4217 codes use small overrides (e.g. EUR).
 */

const REGIONAL_BASE = 0x1f1e6;

/** ISO 4217 → flag when currency spans multiple countries (not derivable from one alpha-2). */
export const FIAT_FLAG_OVERRIDES: Record<string, string> = {
  EUR: "\u{1f1ea}\u{1f1fa}", // EU
  XCD: "\u{1f1e6}\u{1f1ec}", // AG — Eastern Caribbean (representative)
};

export function iso2ToFlagEmoji(iso2: string): string {
  const u = iso2.trim().toUpperCase();
  if (u.length !== 2 || u[0] < "A" || u[0] > "Z" || u[1] < "A" || u[1] > "Z") {
    return "";
  }
  return String.fromCodePoint(REGIONAL_BASE + u.charCodeAt(0) - 65, REGIONAL_BASE + u.charCodeAt(1) - 65);
}

export function flagEmojiForFiatCurrency(fiat: string, countryIso2: string): string {
  const c = fiat.trim().toUpperCase();
  const o = FIAT_FLAG_OVERRIDES[c];
  if (o) return o;
  return iso2ToFlagEmoji(countryIso2);
}
