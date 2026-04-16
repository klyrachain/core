/**
 * SSE-friendly multi-fiat quote run: priority fiat first, then Fonbnk batch + FX-pivot batch in parallel.
 */

import { prisma } from "../lib/prisma.js";
import { setStoredQuote, QUOTE_TTL_SECONDS } from "../lib/redis.js";
import {
  buildPublicQuote,
  normalizeQuoteAssetForRequest,
  type QuoteRequestDto,
} from "./public-quote.service.js";

export type QuoteStreamWrite = (event: string, payload: unknown) => void;

const MAX_FIATS = 250;

async function fonbnkCurrencySet(): Promise<Set<string>> {
  const rows = await prisma.country.findMany({
    where: { supportedFonbnk: true },
    select: { currency: true },
  });
  return new Set(
    rows.map((countryRow) => countryRow.currency.trim().toUpperCase()).filter(Boolean)
  );
}

function buildRequestForFiat(params: {
  action: "buy" | "sell";
  amount: number;
  inputSide: "from" | "to";
  chain: string;
  crypto: string;
  fiatCode: string;
}): QuoteRequestDto {
  const chain = params.chain.trim();
  const crypto = normalizeQuoteAssetForRequest(params.crypto);
  const fiat = normalizeQuoteAssetForRequest(params.fiatCode);
  if (params.action === "buy") {
    return {
      action: "ONRAMP",
      inputAmount: String(params.amount),
      inputCurrency: fiat,
      outputCurrency: crypto,
      chain,
      inputSide: params.inputSide === "to" ? "to" : "from",
    };
  }
  return {
    action: "OFFRAMP",
    inputAmount: String(params.amount),
    inputCurrency: crypto,
    outputCurrency: fiat,
    chain,
    inputSide: params.inputSide === "from" ? "from" : "to",
  };
}

async function runPoolStream(
  items: string[],
  limit: number,
  fn: (code: string) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      const code = items[idx];
      await fn(code);
    }
  });
  await Promise.all(workers);
}

export async function runPeerRampQuoteStream(
  write: QuoteStreamWrite,
  params: {
    action: "buy" | "sell";
    amount: number;
    inputSide: "from" | "to";
    chain: string;
    crypto: string;
    fiats: string[];
  }
): Promise<void> {
  const crypto = params.crypto.trim() || "USDC";
  const unique = [
    ...new Set(params.fiats.map((fiatCode) => fiatCode.trim().toUpperCase()).filter(Boolean)),
  ].slice(0, MAX_FIATS);
  if (unique.length === 0) return;

  const fonbnk = await fonbnkCurrencySet();
  const priority = unique.includes("GHS")
    ? "GHS"
    : unique.find((fiatCode) => fonbnk.has(fiatCode)) ?? unique[0];
  const rest = unique.filter((fiatCode) => fiatCode !== priority);
  const fonbnkBatch = rest.filter((fiatCode) => fonbnk.has(fiatCode));
  const pivotBatch = rest.filter((fiatCode) => !fonbnk.has(fiatCode));

  const quoteOne = async (fiatCode: string) => {
    try {
      const request = buildRequestForFiat({
        action: params.action,
        amount: params.amount,
        inputSide: params.inputSide,
        chain: params.chain,
        crypto,
        fiatCode,
      });
      const result = await buildPublicQuote(request);
      if (result.success) {
        await setStoredQuote(result.data.quoteId, JSON.stringify(result.data), QUOTE_TTL_SECONDS);
        write("quote", { code: fiatCode, ok: true, data: result.data });
      } else {
        write("quote", { code: fiatCode, ok: false, error: result.error });
      }
    } catch {
      write("quote", { code: fiatCode, ok: false });
    }
  };

  await quoteOne(priority);
  await Promise.all([runPoolStream(fonbnkBatch, 10, quoteOne), runPoolStream(pivotBatch, 10, quoteOne)]);
}
