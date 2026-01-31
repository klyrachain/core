/**
 * Types for fiat exchange-rate (e.g. ExchangeRate-API).
 * USD is the recommended pivot for conversions to Fonbnk currencies.
 */

export interface FiatQuoteRequest {
  /** Source currency code (e.g. USD, GHS, GBP). */
  from: string;
  /** Target currency code (e.g. GHS, NGN, USD). */
  to: string;
  /** Optional amount in source currency; if omitted, returns 1:1 rate only. */
  amount?: number;
}

export interface FiatQuoteResponse {
  from: string;
  to: string;
  /** Rate: 1 unit of `from` = `rate` units of `to`. */
  rate: number;
  timeLastUpdateUtc?: string;
  /** Set when request included amount: amount in source, convertedAmount in target. */
  amount?: number;
  convertedAmount?: number;
}
