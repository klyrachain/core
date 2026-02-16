/**
 * Onramp quote: fiat↔crypto via Fonbnk; when requested token is not in pool, chain Fonbnk + swap quote.
 */

import type { OnrampQuoteRequest, OnrampQuoteResponse } from "../lib/onramp-quote.types.js";
import {
  findPoolTokenFromDb,
  getIntermediatePoolTokenFromDb,
  getPoolTokenDecimalsFromDb,
  useDirectFonbnkForPoolToken,
} from "./supported-token.service.js";
import {
  getFonbnkQuote,
  getCurrencyForCountry,
} from "./fonbnk.service.js";
import { getBestQuotes } from "./swap-quote.service.js";

function humanToWei(amount: number, decimals: number): string {
  const s = Number(amount) * 10 ** decimals;
  return String(Math.round(s));
}

function weiToHuman(wei: string, decimals: number): number {
  const n = Number(BigInt(wei) / BigInt(10 ** decimals));
  const remainder = BigInt(wei) % BigInt(10 ** decimals);
  const frac = Number(remainder) / 10 ** decimals;
  return n + frac;
}

/**
 * Get onramp quote: fiat↔crypto. If requested token is in pool (Base/Ethereum USDC or ETH), use Fonbnk only.
 * If not, get Fonbnk quote for intermediate pool token and swap quote pool→requested (or requested→pool for amount_in crypto), then combine.
 */
export async function getOnrampQuote(
  request: OnrampQuoteRequest
): Promise<
  | { ok: true; data: OnrampQuoteResponse }
  | { ok: false; error: string; status?: number }
> {
  const {
    country,
    chain_id,
    token,
    amount,
    amount_in,
    purchase_method = "buy",
    from_address,
    token_decimals = 18,
  } = request;

  const countryCode = country.trim().toUpperCase().slice(0, 2);
  const currency = getCurrencyForCountry(country);
  const isSell = purchase_method === "sell";

  const pool = await findPoolTokenFromDb(chain_id, token);
  const useDirectFonbnk = pool != null && useDirectFonbnkForPoolToken(pool);
  // For swap path we need the requested token's contract address (getBestQuotes expects addresses, not symbols).
  if (!useDirectFonbnk && !pool) {
    return { ok: false, error: "Token not supported for this chain; add it in SupportedToken to get swap-based quotes.", status: 400 };
  }
  const requestedTokenAddress = pool?.address ?? token;
  if (useDirectFonbnk && pool) {
    // Sell + amount_in fiat: "I want X fiat, how much crypto to sell?" — Fonbnk only accepts crypto amount,
    // so we get a rate quote (nominal 1 unit) and compute counterpart.
    const isSellFiatTarget = isSell && amount_in === "fiat";
    const quoteAmount = isSellFiatTarget ? 1 : amount;
    const quoteAmountIn = isSellFiatTarget ? "crypto" : amount_in;

    const fonbnk = await getFonbnkQuote({
      country: countryCode,
      token: pool.fonbnkCode,
      purchaseMethod: isSell ? "sell" : "buy",
      amount: quoteAmount,
      amountIn: quoteAmountIn,
    });
    if (!fonbnk) {
      return { ok: false, error: "No Fonbnk quote for this pool token.", status: 404 };
    }
    let totalCrypto: string;
    let totalFiat: number;
    if (isSellFiatTarget) {
      // We got rate for "sell 1 crypto → fonbnk.total fiat". So crypto needed = amount / rate.
      const rate = fonbnk.rate > 0 ? fonbnk.rate : fonbnk.total;
      totalCrypto = String(amount / rate);
      totalFiat = amount;
    } else if (amount_in === "fiat") {
      // Buy, amount in fiat: total crypto = fonbnk.total, total fiat = amount
      totalCrypto = String(fonbnk.total);
      totalFiat = amount;
    } else {
      // amount_in === "crypto": total crypto = amount, total fiat = fonbnk.total
      totalCrypto = String(amount);
      totalFiat = fonbnk.total;
    }
    const data: OnrampQuoteResponse = {
      country: countryCode,
      currency,
      chain_id,
      token: pool.address,
      token_symbol: pool.symbol,
      amount,
      amount_in,
      rate: fonbnk.rate,
      fee: fonbnk.fee,
      total_crypto: totalCrypto,
      total_fiat: totalFiat,
    };
    return { ok: true, data };
  }

  const intermediate = await getIntermediatePoolTokenFromDb(chain_id);
  const poolDecimals = intermediate.decimals ?? await getPoolTokenDecimalsFromDb(intermediate.symbol);

  if (amount_in === "fiat") {
    // Sell + fiat: "I want X fiat" — get rate (nominal 1 crypto) then crypto needed = amount / rate.
    const isSellFiatTarget = isSell;
    const quoteAmount = isSellFiatTarget ? 1 : amount;
    const quoteAmountIn = isSellFiatTarget ? "crypto" : "fiat";

    const fonbnk = await getFonbnkQuote({
      country: countryCode,
      token: intermediate.fonbnkCode,
      purchaseMethod: isSell ? "sell" : "buy",
      amount: quoteAmount,
      amountIn: quoteAmountIn,
    });
    if (!fonbnk) {
      return { ok: false, error: "No Fonbnk quote for intermediate pool token.", status: 404 };
    }
    const poolAmountHuman = isSellFiatTarget ? amount / (fonbnk.rate > 0 ? fonbnk.rate : fonbnk.total) : fonbnk.total;
    const poolAmountWei = humanToWei(poolAmountHuman, poolDecimals);
    if (isSell) {
      const estimatePoolWei = humanToWei(1000, poolDecimals);
      const swapEstimate = await getBestQuotes({
        from_token: intermediate.address,
        to_token: requestedTokenAddress,
        amount: estimatePoolWei,
        from_chain: intermediate.chainId,
        to_chain: chain_id,
        from_address: from_address ?? "0x0000000000000000000000000000000000000000",
      });
      if (!swapEstimate.ok) {
        return { ok: false, error: swapEstimate.error, status: 502 };
      }
      const fromAmt = BigInt(swapEstimate.data.best.from_amount);
      const toAmt = BigInt(swapEstimate.data.best.to_amount);
      const neededRequestedWei =
        toAmt > 0n ? (BigInt(poolAmountWei) * fromAmt) / toAmt : 0n;
      const neededRequestedStr = neededRequestedWei > 0n ? neededRequestedWei.toString() : "1";
      const swapResult = await getBestQuotes({
        from_token: requestedTokenAddress,
        to_token: intermediate.address,
        amount: neededRequestedStr,
        from_chain: chain_id,
        to_chain: intermediate.chainId,
        from_address: from_address ?? "0x0000000000000000000000000000000000000000",
      });
      if (!swapResult.ok) {
        return { ok: false, error: swapResult.error, status: 502 };
      }
      const best = swapResult.data.best;
      const data: OnrampQuoteResponse = {
        country: countryCode,
        currency,
        chain_id,
        token,
        amount,
        amount_in: "fiat",
        rate: fonbnk.rate,
        fee: fonbnk.fee,
        total_crypto: best.from_amount,
        total_fiat: amount,
        swap: {
          from_chain_id: best.from_chain_id,
          from_token: token,
          to_chain_id: best.to_chain_id,
          to_token: intermediate.address,
          from_amount: best.from_amount,
          to_amount: best.to_amount,
          provider: best.provider,
        },
      };
      return { ok: true, data };
    }
    const swapResult = await getBestQuotes({
      from_token: intermediate.address,
      to_token: requestedTokenAddress,
      amount: poolAmountWei,
      from_chain: intermediate.chainId,
      to_chain: chain_id,
      from_address: from_address ?? "0x0000000000000000000000000000000000000000",
    });
    if (!swapResult.ok) {
      return { ok: false, error: swapResult.error, status: 502 };
    }
    const best = swapResult.data.best;
    const data: OnrampQuoteResponse = {
      country: countryCode,
      currency,
      chain_id,
      token,
      amount,
      amount_in: "fiat",
      rate: fonbnk.rate,
      fee: fonbnk.fee,
      total_crypto: best.to_amount,
      total_fiat: amount,
      swap: {
        from_chain_id: best.from_chain_id,
        from_token: intermediate.address,
        to_chain_id: best.to_chain_id,
        to_token: token,
        from_amount: best.from_amount,
        to_amount: best.to_amount,
        provider: best.provider,
      },
    };
    return { ok: true, data };
  }

  // amount_in === "crypto"
  const requestedWei = humanToWei(amount, token_decimals);
  if (isSell) {
    const swapResult = await getBestQuotes({
      from_token: requestedTokenAddress,
      to_token: intermediate.address,
      amount: requestedWei,
      from_chain: chain_id,
      to_chain: intermediate.chainId,
      from_address: from_address ?? "0x0000000000000000000000000000000000000000",
    });
    if (!swapResult.ok) {
      return { ok: false, error: swapResult.error, status: 502 };
    }
    const best = swapResult.data.best;
    const poolAmountHuman = weiToHuman(best.to_amount, poolDecimals);
    const fonbnk = await getFonbnkQuote({
      country: countryCode,
      token: intermediate.fonbnkCode,
      purchaseMethod: "sell",
      amount: poolAmountHuman,
      amountIn: "crypto",
    });
    if (!fonbnk) {
      return { ok: false, error: "No Fonbnk quote for intermediate pool amount.", status: 404 };
    }
    const data: OnrampQuoteResponse = {
      country: countryCode,
      currency,
      chain_id,
      token,
      amount,
      amount_in: "crypto",
      rate: fonbnk.rate,
      fee: fonbnk.fee,
      total_crypto: requestedWei,
      total_fiat: fonbnk.total,
      swap: {
        from_chain_id: best.from_chain_id,
        from_token: token,
        to_chain_id: best.to_chain_id,
        to_token: intermediate.address,
        from_amount: best.from_amount,
        to_amount: best.to_amount,
        provider: best.provider,
      },
    };
    return { ok: true, data };
  }
  const estimatePoolWei = humanToWei(1000, poolDecimals);
  const swapResult = await getBestQuotes({
    from_token: intermediate.address,
    to_token: requestedTokenAddress,
    amount: estimatePoolWei,
    from_chain: intermediate.chainId,
    to_chain: chain_id,
    from_address: from_address ?? "0x0000000000000000000000000000000000000000",
  });
  if (!swapResult.ok) {
    return { ok: false, error: swapResult.error, status: 502 };
  }
  const best = swapResult.data.best;
  const fromAmountBig = BigInt(best.from_amount);
  const toAmountBig = BigInt(best.to_amount);
  if (toAmountBig === 0n) {
    return { ok: false, error: "Swap quote returned zero output.", status: 502 };
  }
  const desiredToAmount = BigInt(requestedWei);
  const neededFromWei = (fromAmountBig * desiredToAmount) / toAmountBig;
  const neededFromWeiStr = neededFromWei > 0n ? neededFromWei.toString() : "1";
  const swapResult2 = await getBestQuotes({
    from_token: intermediate.address,
    to_token: requestedTokenAddress,
    amount: neededFromWeiStr,
    from_chain: intermediate.chainId,
    to_chain: chain_id,
    from_address: from_address ?? "0x0000000000000000000000000000000000000000",
  });
  if (!swapResult2.ok) {
    return { ok: false, error: swapResult2.error, status: 502 };
  }
  const best2 = swapResult2.data.best;
  const poolAmountHuman = weiToHuman(best2.from_amount, poolDecimals);
  const fonbnk = await getFonbnkQuote({
    country: countryCode,
    token: intermediate.fonbnkCode,
    purchaseMethod: "buy",
    amount: poolAmountHuman,
    amountIn: "crypto",
  });
  if (!fonbnk) {
    return { ok: false, error: "No Fonbnk quote for intermediate pool amount.", status: 404 };
  }
  const data: OnrampQuoteResponse = {
    country: countryCode,
    currency,
    chain_id,
    token,
    amount,
    amount_in: "crypto",
    rate: fonbnk.rate,
    fee: fonbnk.fee,
    total_crypto: best2.to_amount,
    total_fiat: fonbnk.total,
    swap: {
      from_chain_id: best2.from_chain_id,
      from_token: intermediate.address,
      to_chain_id: best2.to_chain_id,
      to_token: token,
      from_amount: best2.from_amount,
      to_amount: best2.to_amount,
      provider: best2.provider,
    },
  };
  return { ok: true, data };
}
