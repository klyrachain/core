/**
 * Checkout (fiat invoice): payer covers a fiat amount by selling crypto → OFFRAMP quotes per token.
 * Composite row: Base USDC (offramp) → Ethereum WXRP via Squid swap (server-side only).
 */

import { buildPublicQuote } from "./public-quote.service.js";
import { getBestQuotes } from "./swap-quote.service.js";
import {
  DEFAULT_CHECKOUT_ROWS,
  type CheckoutRowSpec,
} from "../types/checkout-row-spec.js";

const CHAIN_ID_BASE = 8453;
const CHAIN_ID_ETHEREUM = 1;
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
/** Ethereum mainnet WXRP (Squid-supported; verify liquidity). */
const ETH_WXRP = "0x39fBBABf11738317a448031930706cd3e612e1B9";
const WXRP_DECIMALS = 18;

/** Matches Squid quote exploration (burn address); swap quotes do not need a funded wallet. */
const DEFAULT_FROM_ADDRESS = "0x0000000000000000000000000000000000000000";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitMessage(msg: string): boolean {
  const m = msg.toLowerCase();
  return m.includes("too many") || m.includes("rate") || m.includes("429");
}

export type CheckoutQuoteRowResult = {
  id: string;
  cryptoAmount: string | null;
  cryptoSymbol: string | null;
  error: string | null;
};

function formatFromRawUnits(raw: string, decimals: number): string {
  try {
    const n = BigInt(raw);
    const zero = BigInt(0);
    if (n < zero) return "";
    const div = BigInt(10) ** BigInt(decimals);
    const whole = n / div;
    const frac = n % div;
    if (frac === zero) return whole.toString();
    let fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
    if (fracStr.length === 0) return whole.toString();
    return `${whole}.${fracStr}`;
  } catch {
    return "";
  }
}

function usdcHumanToSmallestUnits(human: string): string {
  const n = parseFloat(human);
  if (!Number.isFinite(n) || n <= 0) return "0";
  return String(Math.round(n * 1e6));
}

/** Match checkout display: two decimal places for all token amounts. */
function formatCheckoutCryptoDisplay(human: string): string {
  const n = parseFloat(human);
  if (!Number.isFinite(n) || n < 0) return human;
  return n.toFixed(2);
}

/**
 * Fiat-denominated commerce: merchant asks for X fiat; payer sells `cryptoSymbol` on `chain`.
 * OFFRAMP inputSide "to": `inputAmount` = fiat to receive (invoice); response `input` = crypto to pay.
 */
async function quoteInvoiceOfframpRow(
  id: string,
  fiatAmount: string,
  fiatCurrency: string,
  chain: string,
  cryptoSymbol: string,
  /** When set (e.g. from token picker), resolves the exact SupportedToken row; avoids wrong symbol match. */
  tokenAddress?: string | null
): Promise<CheckoutQuoteRowResult> {
  const outputToken = tokenAddress?.trim() || cryptoSymbol;
  const r = await buildPublicQuote({
    action: "OFFRAMP",
    inputAmount: fiatAmount,
    inputCurrency: fiatCurrency,
    outputCurrency: outputToken,
    chain,
    inputSide: "to",
  });
  if (!r.success) {
    return {
      id,
      cryptoAmount: null,
      cryptoSymbol: null,
      error: r.error ?? "Quote unavailable",
    };
  }
  return {
    id,
    cryptoAmount: formatCheckoutCryptoDisplay(r.data.input.amount),
    cryptoSymbol: r.data.input.currency,
    error: null,
  };
}

async function quoteCompositeWxrpRow(
  id: string,
  fiatAmount: string,
  fiatCurrency: string,
  fromAddress: string,
  /** When set, skip re-quoting Base USDC (e.g. partial batch already has it). */
  baseUsdcHumanAmount: string | null
): Promise<CheckoutQuoteRowResult> {
  let baseHuman = baseUsdcHumanAmount;
  if (baseHuman == null || baseHuman === "") {
    const baseUsdc = await quoteInvoiceOfframpRow(
      "base-usdc",
      fiatAmount,
      fiatCurrency,
      "BASE",
      "USDC"
    );
    if (!baseUsdc.cryptoAmount || baseUsdc.error) {
      return {
        id,
        cryptoAmount: null,
        cryptoSymbol: null,
        error: baseUsdc.error ?? "Base USDC quote required for wXRP estimate",
      };
    }
    baseHuman = baseUsdc.cryptoAmount;
  }

  const amountSmallest = usdcHumanToSmallestUnits(baseHuman);
  if (amountSmallest === "0") {
    return {
      id,
      cryptoAmount: null,
      cryptoSymbol: null,
      error: "Swap quote unavailable",
    };
  }

  let lastSwapErr = "Swap quote unavailable";
  let gotWxrp = false;
  let wxrp: CheckoutQuoteRowResult = {
    id,
    cryptoAmount: null,
    cryptoSymbol: null,
    error: lastSwapErr,
  };

  for (let attempt = 0; attempt < 3 && !gotWxrp; attempt++) {
    if (attempt > 0) await sleep(600 * attempt);
    const bq = await getBestQuotes({
      from_chain: CHAIN_ID_BASE,
      to_chain: CHAIN_ID_ETHEREUM,
      from_token: BASE_USDC,
      to_token: ETH_WXRP,
      from_address: fromAddress,
      amount: amountSmallest,
    });
    if (bq.ok) {
      const human = formatFromRawUnits(bq.data.best.to_amount, WXRP_DECIMALS);
      if (human.length > 0) {
        wxrp = {
          id,
          cryptoAmount: formatCheckoutCryptoDisplay(human),
          cryptoSymbol: "WXRP",
          error: null,
        };
        gotWxrp = true;
        break;
      }
      lastSwapErr = "Swap quote unavailable";
    } else {
      lastSwapErr = bq.error ?? lastSwapErr;
      if (!isRateLimitMessage(lastSwapErr)) break;
    }
  }

  if (!gotWxrp) {
    wxrp = {
      id,
      cryptoAmount: null,
      cryptoSymbol: null,
      error: lastSwapErr,
    };
  }
  return wxrp;
}

export async function buildCheckoutPayoutQuotes(params: {
  inputAmount: string;
  inputCurrency: string;
  fromAddress?: string;
  /** When omitted, uses DEFAULT_CHECKOUT_ROWS. */
  rows?: CheckoutRowSpec[];
  /**
   * When set, only these row ids are computed and returned (for silent partial refresh).
   * Caller merges into existing client state.
   */
  refetchRowIds?: string[];
}): Promise<CheckoutQuoteRowResult[]> {
  const inputAmount = params.inputAmount.trim();
  const inputCurrency = params.inputCurrency.trim().toUpperCase();
  const fromAddress = params.fromAddress?.trim() || DEFAULT_FROM_ADDRESS;
  const rows =
    params.rows != null && params.rows.length > 0
      ? params.rows
      : DEFAULT_CHECKOUT_ROWS;
  const refetchIds = params.refetchRowIds?.filter((s) => s.trim().length > 0);
  const partial = refetchIds != null && refetchIds.length > 0;
  const want = partial ? new Set(refetchIds) : null;

  const results: CheckoutQuoteRowResult[] = [];

  const shouldCompute = (id: string): boolean => !want || want.has(id);

  const offrampSpecs = rows.filter(
    (r): r is Extract<CheckoutRowSpec, { kind: "offramp" }> =>
      r.kind === "offramp"
  );
  const compositeSpecs = rows.filter(
    (r): r is Extract<CheckoutRowSpec, { kind: "composite_wxrp" }> =>
      r.kind === "composite_wxrp"
  );

  const offrampToRun = partial
    ? offrampSpecs.filter((r) => shouldCompute(r.id))
    : offrampSpecs;

  const offrampResults = await Promise.all(
    offrampToRun.map((r) =>
      quoteInvoiceOfframpRow(
        r.id,
        inputAmount,
        inputCurrency,
        r.chain,
        r.symbol,
        r.tokenAddress
      )
    )
  );
  const byId = new Map(offrampResults.map((r) => [r.id, r]));

  const compositeToRun = partial
    ? compositeSpecs.filter((r) => shouldCompute(r.id))
    : compositeSpecs;

  let baseUsdcForWxrp: string | null = null;
  if (compositeToRun.length > 0) {
    const br = byId.get("base-usdc");
    if (br?.cryptoAmount && !br.error) {
      baseUsdcForWxrp = br.cryptoAmount;
    } else {
      const tmp = await quoteInvoiceOfframpRow(
        "base-usdc",
        inputAmount,
        inputCurrency,
        "BASE",
        "USDC"
      );
      if (tmp.cryptoAmount && !tmp.error) {
        baseUsdcForWxrp = tmp.cryptoAmount;
      }
    }
  }

  for (const spec of compositeToRun) {
    const r = await quoteCompositeWxrpRow(
      spec.id,
      inputAmount,
      inputCurrency,
      fromAddress,
      baseUsdcForWxrp
    );
    byId.set(spec.id, r);
  }

  if (partial) {
    for (const id of refetchIds!) {
      const r = byId.get(id);
      if (r) results.push(r);
    }
    return results;
  }

  for (const spec of rows) {
    const r = byId.get(spec.id);
    if (r) results.push(r);
  }
  return results;
}
