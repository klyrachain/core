/**
 * Checkout (fiat invoice): payer covers a fiat amount by selling crypto → OFFRAMP quotes per token.
 * Composite row: Base USDC (offramp) → Ethereum WXRP via Squid swap (server-side only).
 */

import { buildPublicQuote } from "./public-quote.service.js";
import {
  fetchUsdSpotForCheckoutReference,
  isStableCheckoutSymbol,
  logCheckoutUsdReferenceVsSpotIfNeeded,
} from "./checkout-usd-reference-price.service.js";
import { getBestQuotes } from "./swap-quote.service.js";
import {
  getSwapQuoteEstimateFromAddress,
  resolveSwapQuoteFromAddress,
} from "../lib/swap-quote-from-address.js";
import { prisma } from "../lib/prisma.js";
import {
  DEFAULT_CHECKOUT_ROWS,
  type CheckoutRowSpec,
} from "../types/checkout-row-spec.js";

const CHAIN_ID_BASE = 8453;
const CHAIN_ID_BNB = 56;
const CHAIN_ID_ETHEREUM = 1;
const CHAIN_ID_SOLANA = 101;
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
/** Ethereum mainnet USDC — intermediate leg when direct Base→WXRP cross-chain is unsupported. */
const ETH_MAINNET_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
/** Ethereum mainnet Wrapped XRP (ERC-20). */
const ETH_WXRP = "0x39fBBABf11738317a448031930706cd3e612e1B9";
const WXRP_DECIMALS = 18;
const BNB_USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const SOL_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT = "So11111111111111111111111111111111111111112";
/** Ethereum mainnet MANA — last-resort spot estimate when Solana swap + SOL spot fail. */
const ETHEREUM_MANA = "0x0f5d2fb29fb7d3cfee444a200298f468908cc942";
const USDC_DECIMALS = 6;
const SOL_DECIMALS = 9;

/** Non-zero placeholder so LiFi/Squid accept quote-only routes (see swap-quote-from-address). */
const DEFAULT_FROM_ADDRESS = getSwapQuoteEstimateFromAddress();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitMessage(msg: string): boolean {
  const m = msg.toLowerCase();
  return m.includes("too many") || m.includes("rate") || m.includes("429");
}

/** Short UI copy; raw provider text is logged server-side only. */
function mapCheckoutQuoteError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("no offers") || m.includes("no offer")) {
    return "No rate right now. Try another option.";
  }
  if (
    m.includes("unsupported chain") ||
    m.includes("chain is not supported") ||
    m.includes("fromchainid") ||
    m.includes("tochainid") ||
    m.includes("schema in oneof")
  ) {
    return "Quote unavailable.";
  }
  if (raw.length > 160) {
    return "Quote unavailable.";
  }
  return raw;
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
    const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
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

function humanToRawUnits(human: string, decimals: number): string {
  const n = Number.parseFloat(human);
  if (!Number.isFinite(n) || n <= 0) return "0";
  return String(Math.round(n * Math.pow(10, decimals)));
}

/**
 * `SOL_USDC` = SPL USDC mint (invoice “sell” side). `SOL_MINT` = native SOL (row “buy” side).
 * The swap asks aggregators: sell invoice USDC → receive SOL for display.
 * When swap APIs fail, approximate from USD spot (stables) then MANA as last resort.
 */
async function spotFallbackSolanaSolRow(
  invoiceAmount: string,
  invoiceSymbol: string
): Promise<{ cryptoAmount: string; cryptoSymbol: string } | null> {
  const sym = invoiceSymbol.trim().toUpperCase();
  if (!isStableCheckoutSymbol(sym)) {
    return null;
  }
  const usdValue = Number.parseFloat(invoiceAmount.trim());
  if (!Number.isFinite(usdValue) || usdValue <= 0) return null;

  const solUsd = await fetchUsdSpotForCheckoutReference({
    chainSlug: "SOLANA",
    symbol: "SOL",
    tokenAddress: SOL_MINT,
  });
  if (solUsd != null && solUsd > 0) {
    return {
      cryptoAmount: formatCheckoutCryptoDisplay(String(usdValue / solUsd)),
      cryptoSymbol: "SOL",
    };
  }

  const manaUsd = await fetchUsdSpotForCheckoutReference({
    chainSlug: "ETHEREUM",
    symbol: "MANA",
    tokenAddress: ETHEREUM_MANA,
  });
  if (manaUsd != null && manaUsd > 0) {
    return {
      cryptoAmount: formatCheckoutCryptoDisplay(String(usdValue / manaUsd)),
      cryptoSymbol: "MANA",
    };
  }
  return null;
}

/** Match checkout display: two decimal places for all token amounts. */
function formatCheckoutCryptoDisplay(human: string): string {
  const n = parseFloat(human);
  if (!Number.isFinite(n) || n < 0) return human;
  return n.toFixed(2);
}

const FIAT_CURRENCIES = new Set([
  "USD",
  "EUR",
  "GBP",
  "GHS",
  "NGN",
  "KES",
  "ZAR",
  "XOF",
  "XAF",
  "UGX",
  "TZS",
  "RWF",
  "MZN",
  "BWP",
  "ZMW",
]);

function isFiatCurrency(code: string): boolean {
  return FIAT_CURRENCIES.has(code.trim().toUpperCase());
}

type ChainTokenRef = { address: string; decimals: number };
const CHECKOUT_CHAIN_TO_ID: Record<string, number> = {
  BASE: CHAIN_ID_BASE,
  BNB: CHAIN_ID_BNB,
  ETHEREUM: CHAIN_ID_ETHEREUM,
  SOLANA: CHAIN_ID_SOLANA,
};
const CHAIN_SYMBOL_TOKEN: Record<string, Record<string, ChainTokenRef>> = {
  BASE: {
    USDC: { address: BASE_USDC, decimals: USDC_DECIMALS },
  },
  BNB: {
    USDC: { address: BNB_USDC, decimals: USDC_DECIMALS },
  },
  SOLANA: {
    USDC: { address: SOL_USDC, decimals: USDC_DECIMALS },
    SOL: { address: SOL_MINT, decimals: SOL_DECIMALS },
  },
  ETHEREUM: {
    USDC: { address: ETH_MAINNET_USDC, decimals: USDC_DECIMALS },
    WXRP: { address: ETH_WXRP, decimals: WXRP_DECIMALS },
  },
};

function getRowTargetToken(row: Extract<CheckoutRowSpec, { kind: "offramp" }>): ChainTokenRef | null {
  const chainMap = CHAIN_SYMBOL_TOKEN[row.chain];
  if (!chainMap) return null;
  const key = row.symbol.trim().toUpperCase();
  const fromMap = chainMap[key];
  if (fromMap) return fromMap;
  const explicit = row.tokenAddress?.trim();
  if (!explicit) return null;
  return { address: explicit, decimals: key === "USDC" ? USDC_DECIMALS : 18 };
}

async function resolveTokenFromSupported(
  chainCode: string,
  symbol: string
): Promise<ChainTokenRef | null> {
  const chainId = CHECKOUT_CHAIN_TO_ID[chainCode];
  if (!chainId) return null;
  const row = await prisma.supportedToken.findFirst({
    where: {
      chainId,
      symbol: symbol.trim().toUpperCase(),
    },
    select: {
      tokenAddress: true,
      decimals: true,
    },
  });
  if (!row?.tokenAddress) return null;
  return {
    address: row.tokenAddress,
    decimals: Number(row.decimals) || 18,
  };
}

async function quoteCryptoRow(
  id: string,
  row: Extract<CheckoutRowSpec, { kind: "offramp" }>,
  invoiceCryptoAmount: string,
  invoiceCryptoSymbol: string,
  fromAddress: string
): Promise<CheckoutQuoteRowResult> {
  const chainMap = CHAIN_SYMBOL_TOKEN[row.chain];
  if (!chainMap) {
    return { id, cryptoAmount: null, cryptoSymbol: null, error: "Unsupported checkout chain." };
  }
  const invoiceSymbol = invoiceCryptoSymbol.trim().toUpperCase();
  const source =
    chainMap[invoiceSymbol] ??
    (await resolveTokenFromSupported(row.chain, invoiceSymbol));
  const target =
    getRowTargetToken(row) ??
    (await resolveTokenFromSupported(row.chain, row.symbol));
  if (!source || !target) {
    return { id, cryptoAmount: null, cryptoSymbol: null, error: "Swap path unavailable for this token." };
  }

  const sameToken = source.address.toLowerCase() === target.address.toLowerCase();
  if (sameToken) {
    return {
      id,
      cryptoAmount: formatCheckoutCryptoDisplay(invoiceCryptoAmount),
      cryptoSymbol: row.symbol.trim().toUpperCase(),
      error: null,
    };
  }

  const rawIn = humanToRawUnits(invoiceCryptoAmount, source.decimals);
  if (rawIn === "0") {
    return { id, cryptoAmount: null, cryptoSymbol: null, error: "Invalid crypto amount." };
  }

  const chainId = CHECKOUT_CHAIN_TO_ID[row.chain];
  if (!chainId) {
    return { id, cryptoAmount: null, cryptoSymbol: null, error: "Unsupported checkout chain." };
  }
  const swapFromAddress = resolveSwapQuoteFromAddress({
    from_chain: chainId,
    to_chain: chainId,
    hint: fromAddress,
  });
  const bq = await getBestQuotes({
    from_chain: chainId,
    to_chain: chainId,
    from_token: source.address,
    to_token: target.address,
    from_address: swapFromAddress,
    amount: rawIn,
  });
  if (!bq.ok) {
    const raw = bq.error ?? "Swap quote unavailable";
    console.warn("[checkout:quoteCryptoRow] swap failed", JSON.stringify({ id, raw }));
    if (id === "solana-sol" && row.chain === "SOLANA" && row.symbol === "SOL") {
      const spot = await spotFallbackSolanaSolRow(invoiceCryptoAmount, invoiceCryptoSymbol);
      if (spot) {
        console.warn(
          "[checkout:quoteCryptoRow] spot fallback",
          JSON.stringify({ id, cryptoSymbol: spot.cryptoSymbol })
        );
        return {
          id,
          cryptoAmount: spot.cryptoAmount,
          cryptoSymbol: spot.cryptoSymbol,
          error: null,
        };
      }
    }
    return {
      id,
      cryptoAmount: null,
      cryptoSymbol: null,
      error: mapCheckoutQuoteError(raw),
    };
  }
  const outHuman = formatFromRawUnits(bq.data.best.to_amount, target.decimals);
  return {
    id,
    cryptoAmount: formatCheckoutCryptoDisplay(outHuman),
    cryptoSymbol: row.symbol.trim().toUpperCase(),
    error: null,
  };
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
  tokenAddress?: string | null,
  /** EVM address for indirect swap legs; defaults inside buildPublicQuote when omitted. */
  fromAddress?: string
): Promise<CheckoutQuoteRowResult> {
  const fiat = fiatCurrency.trim().toUpperCase();
  const sym = cryptoSymbol.trim().toUpperCase();
  /**
   * USD invoices paying with USDC: treat as 1:1 for payer display (offramp provider rates otherwise skew ~1%).
   */
  if (fiat === "USD" && sym === "USDC" && !tokenAddress?.trim()) {
    return {
      id,
      cryptoAmount: formatCheckoutCryptoDisplay(fiatAmount.trim()),
      cryptoSymbol: "USDC",
      error: null,
    };
  }

  const outputToken = tokenAddress?.trim() || cryptoSymbol;
  const r = await buildPublicQuote({
    action: "OFFRAMP",
    inputAmount: fiatAmount,
    inputCurrency: fiatCurrency,
    outputCurrency: outputToken,
    chain,
    inputSide: "to",
    fromAddress,
  });
  if (!r.success) {
    const raw = r.error ?? "Quote unavailable";
    console.warn("[checkout:quoteInvoiceOfframpRow] failed", JSON.stringify({ id, raw }));
    return {
      id,
      cryptoAmount: null,
      cryptoSymbol: null,
      error: mapCheckoutQuoteError(raw),
    };
  }
  const cryptoAmount = formatCheckoutCryptoDisplay(r.data.input.amount);
  const cryptoSym = r.data.input.currency;
  if (fiat === "USD") {
    const inv = Number.parseFloat(fiatAmount.trim());
    void logCheckoutUsdReferenceVsSpotIfNeeded({
      invoiceUsd: inv,
      cryptoAmountStr: cryptoAmount,
      cryptoSymbol: cryptoSym,
      chainSlug: chain.trim().toUpperCase(),
      tokenAddress: tokenAddress ?? null,
    });
  }
  return {
    id,
    cryptoAmount,
    cryptoSymbol: cryptoSym,
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
      "USDC",
      undefined,
      fromAddress
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

  // Fallback: Squid/LiFi often omit niche ERC-20s for cross-chain legs. Bridge Base USDC → ETH USDC,
  // then same-chain USDC → WXRP (0x / aggregators handle major→long-tail on L1).
  if (!gotWxrp) {
    const bridge = await getBestQuotes({
      from_chain: CHAIN_ID_BASE,
      to_chain: CHAIN_ID_ETHEREUM,
      from_token: BASE_USDC,
      to_token: ETH_MAINNET_USDC,
      from_address: fromAddress,
      amount: amountSmallest,
    });
    if (bridge.ok) {
      const usdcOut = bridge.data.best.to_amount;
      const same = await getBestQuotes({
        from_chain: CHAIN_ID_ETHEREUM,
        to_chain: CHAIN_ID_ETHEREUM,
        from_token: ETH_MAINNET_USDC,
        to_token: ETH_WXRP,
        from_address: fromAddress,
        amount: usdcOut,
      });
      if (same.ok) {
        const human = formatFromRawUnits(same.data.best.to_amount, WXRP_DECIMALS);
        if (human.length > 0) {
          wxrp = {
            id,
            cryptoAmount: formatCheckoutCryptoDisplay(human),
            cryptoSymbol: "WXRP",
            error: null,
          };
          gotWxrp = true;
        } else {
          lastSwapErr = "Swap quote returned zero WXRP output";
        }
      } else {
        lastSwapErr = same.error ?? lastSwapErr;
      }
    } else {
      lastSwapErr = bridge.error ?? lastSwapErr;
    }
  }

  if (!gotWxrp) {
    console.warn("[checkout:quoteCompositeWxrpRow] failed", JSON.stringify({ id, raw: lastSwapErr }));
    wxrp = {
      id,
      cryptoAmount: null,
      cryptoSymbol: null,
      error: mapCheckoutQuoteError(lastSwapErr),
    };
  } else if (wxrp.cryptoAmount && fiatCurrency.trim().toUpperCase() === "USD") {
    void logCheckoutUsdReferenceVsSpotIfNeeded({
      invoiceUsd: Number.parseFloat(fiatAmount.trim()),
      cryptoAmountStr: wxrp.cryptoAmount,
      cryptoSymbol: "WXRP",
      chainSlug: "ETHEREUM",
      tokenAddress: ETH_WXRP,
    });
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
  const refetchIds = params.refetchRowIds?.filter((rowId) => rowId.trim().length > 0);
  const partial = refetchIds != null && refetchIds.length > 0;
  const want = partial ? new Set(refetchIds) : null;
  const fiatMode = isFiatCurrency(inputCurrency);

  const results: CheckoutQuoteRowResult[] = [];

  const shouldCompute = (id: string): boolean => !want || want.has(id);

  const offrampSpecs = rows.filter(
    (row): row is Extract<CheckoutRowSpec, { kind: "offramp" }> =>
      row.kind === "offramp"
  );
  const compositeSpecs = rows.filter(
    (row): row is Extract<CheckoutRowSpec, { kind: "composite_wxrp" }> =>
      row.kind === "composite_wxrp"
  );

  const offrampToRun = partial
    ? offrampSpecs.filter((spec) => shouldCompute(spec.id))
    : offrampSpecs;

  const offrampResults = await Promise.all(
    offrampToRun.map((offrampSpec) => {
      if (fiatMode) {
        return quoteInvoiceOfframpRow(
          offrampSpec.id,
          inputAmount,
          inputCurrency,
          offrampSpec.chain,
          offrampSpec.symbol,
          offrampSpec.tokenAddress,
          fromAddress
        );
      }
      return quoteCryptoRow(offrampSpec.id, offrampSpec, inputAmount, inputCurrency, fromAddress);
    })
  );
  const byId = new Map(offrampResults.map((quoteRow) => [quoteRow.id, quoteRow]));

  const compositeToRun = partial
    ? compositeSpecs.filter((spec) => shouldCompute(spec.id))
    : compositeSpecs;

  let baseUsdcForWxrp: string | null = null;
  if (fiatMode && compositeToRun.length > 0) {
    const br = byId.get("base-usdc");
    if (br?.cryptoAmount && !br.error) {
      baseUsdcForWxrp = br.cryptoAmount;
    } else {
      const tmp = await quoteInvoiceOfframpRow(
        "base-usdc",
        inputAmount,
        inputCurrency,
        "BASE",
        "USDC",
        undefined,
        fromAddress
      );
      if (tmp.cryptoAmount && !tmp.error) {
        baseUsdcForWxrp = tmp.cryptoAmount;
      }
    }
  }

  for (const spec of compositeToRun) {
    if (fiatMode) {
      const r = await quoteCompositeWxrpRow(
        spec.id,
        inputAmount,
        inputCurrency,
        fromAddress,
        baseUsdcForWxrp
      );
      byId.set(spec.id, r);
      continue;
    }
    const syntheticRow: Extract<CheckoutRowSpec, { kind: "offramp" }> = {
      id: spec.id,
      kind: "offramp",
      chain: "ETHEREUM",
      symbol: "WXRP",
      tokenAddress: ETH_WXRP,
    };
    const r = await quoteCryptoRow(spec.id, syntheticRow, inputAmount, inputCurrency, fromAddress);
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
