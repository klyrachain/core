/**
 * Rules for claim payout UI + POST /api/claims/claim validation.
 *
 * - Fiat-funded requests use f_chain MOMO/BANK; beneficiary claims on-chain crypto to t_chain/t_token.
 * - Crypto-funded requests: beneficiary may claim a different on-chain asset (t_* ≠ f_*) or fiat (when allowed).
 *   Settlement `t_*` is updated only from explicit claimant selection (e.g. settlement-selection), not auto-repair.
 */

export function senderPaidFiatTx(tx: { f_chain: string }): boolean {
  const fc = tx.f_chain.toUpperCase();
  return fc === "MOMO" || fc === "BANK";
}

/** Settlement leg is on-chain crypto (not mobile-money / bank rails on the transaction row). */
export function settlementIsOnchainCrypto(tx: { t_chain: string }): boolean {
  const tc = tx.t_chain.toUpperCase();
  return tc !== "MOMO" && tc !== "BANK";
}

/**
 * True when we can execute executeRequestSettlementSend for this row (t_* is crypto and not same asset as f_* for crypto sends).
 */
export function cryptoPayoutAllowed(tx: {
  f_chain: string;
  f_token: string;
  t_chain: string;
  t_token: string;
}): boolean {
  if (!settlementIsOnchainCrypto(tx)) return false;
  if (senderPaidFiatTx(tx)) return true;
  return !(
    tx.f_chain.toUpperCase() === tx.t_chain.toUpperCase() &&
    tx.f_token.toUpperCase() === tx.t_token.toUpperCase()
  );
}

/** Receiver may choose Paystack fiat payout (only when payer did not already pay in fiat on this request). */
export function claimFiatAllowed(tx: { f_chain: string }): boolean {
  return !senderPaidFiatTx(tx);
}

/** Receiver may choose on-chain settlement to a wallet. */
export function claimCryptoAllowed(tx: { t_chain: string }): boolean {
  return settlementIsOnchainCrypto(tx);
}
