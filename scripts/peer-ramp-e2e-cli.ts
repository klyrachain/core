#!/usr/bin/env node
/**
 * Manual E2E CLI for peer-ramp APIs (two terminals: onramp / offramp).
 *
 * Env:
 *   CORE_URL — core HTTP base (default http://localhost:4000)
 *   CORE_API_KEY — platform API key; sent as header `x-api-key` (same key as dashboard / Connect).
 *     Put it in `.env` next to core or export it in your shell. Required for GET /api/quote and peer-ramp routes.
 *   PEER_RAMP_CLI_CHAIN_ID — numeric chain for on-chain orders only (default 84532 = Base Sepolia test USDC)
 *
 * Quotes: GET /api/quote always uses chain **BASE** (Base mainnet USDC pricing). The pricing engine does not
 * support Base Sepolia (84532); fiat amounts use mainnet rates as reference while orders use Sepolia USDC.
 *
 *   PEER_RAMP_CLI_DEFAULT_FIAT — primary fiat for settlement + quote (default GHS)
 *   PEER_RAMP_CLI_QUOTE_FIATS_FROM_EXCHANGE — default ON: use GET /api/rates/fiat/codes (cached latest/USD table, 160+ ISO codes) for multi-fiat log. Set to 0 to use only GET /api/countries?supported=fonbnk (smaller list).
 *   PEER_RAMP_CLI_QUOTE_FIATS — comma-separated fiats if exchange codes + Fonbnk country list both fail (default GHS,NGN,KES,ZAR,CAD,EUR,GBP)
 *   PEER_RAMP_CLI_QUOTES_LOG — append quote lines here (default peer-ramp-cli-quotes.log)
 *   PEER_RAMP_CLI_SKIP_TX_POLL=1 — after commit-onramp, do not poll GET /api/transactions/:id for USDC delivery
 *   PEER_RAMP_CLI_SKIP_PAYSTACK_VERIFY_POLL=1 — do not call GET /api/paystack/transactions/verify/:reference during tx poll (webhook-only path)
 *   PEER_RAMP_CLI_TX_POLL_MAX_MS — max time to poll for crypto send (default 600000 = 10 min)
 *
 * Usage:
 *   pnpm run peer-ramp:e2e-cli -- onramp
 *   pnpm run peer-ramp:e2e-cli -- offramp
 */

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "readline";

const CORE_URL = (process.env.CORE_URL ?? "http://localhost:4000").replace(/\/$/, "");
const CORE_API_KEY = process.env.CORE_API_KEY ?? "";

const PEER_RAMP_CLI_CHAIN_ID = Number(process.env.PEER_RAMP_CLI_CHAIN_ID ?? 84532);

/** Must match validation-cache chain code for Base mainnet; pricing does not support 84532. */
const QUOTE_PRICING_CHAIN = "BASE";

const DEFAULT_FIAT = (process.env.PEER_RAMP_CLI_DEFAULT_FIAT ?? "GHS").toUpperCase();
const FALLBACK_QUOTE_FIATS = (process.env.PEER_RAMP_CLI_QUOTE_FIATS ?? "GHS,NGN,KES,ZAR,CAD,EUR,GBP")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

async function resolveQuoteFiatsForLog(): Promise<string[]> {
  const useExchangeTable = process.env.PEER_RAMP_CLI_QUOTE_FIATS_FROM_EXCHANGE !== "0";
  if (useExchangeTable) {
    const ex = await fetchJson("/api/rates/fiat/codes");
    const payload = ex.data as { codes?: string[] } | undefined;
    if (ex.ok && payload?.codes?.length) {
      return [...payload.codes];
    }
    console.warn(
      "[quotes] GET /api/rates/fiat/codes failed or empty (need EXCHANGERATE_API_KEY on Core). Falling back to Fonbnk countries."
    );
  }
  const r = await fetchJson("/api/countries?supported=fonbnk");
  const payload = r.data as { countries?: { currency?: string }[] } | undefined;
  if (r.ok && payload?.countries?.length) {
    const set = new Set(
      payload.countries
        .map((c) => (c.currency ?? "").trim().toUpperCase())
        .filter(Boolean)
    );
    if (set.size > 0) return [...set].sort();
  }
  return [...FALLBACK_QUOTE_FIATS];
}
const QUOTES_LOG = process.env.PEER_RAMP_CLI_QUOTES_LOG ?? "peer-ramp-cli-quotes.log";

const USDC_BY_CHAIN: Record<number, { addr: string; decimals: number }> = {
  84532: { addr: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", decimals: 6 },
  8453: {
    addr: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
  },
};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function q(prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, (a) => resolve((a ?? "").trim())));
}

const TX_POLL_INTERVAL_MS = 5000;
const TX_POLL_MAX_MS = Number(process.env.PEER_RAMP_CLI_TX_POLL_MAX_MS ?? 600_000);
const SKIP_PAYSTACK_VERIFY_POLL = process.env.PEER_RAMP_CLI_SKIP_PAYSTACK_VERIFY_POLL === "1";

/**
 * When webhooks cannot reach Core (localhost), GET /api/paystack/transactions/verify/:reference pulls charge status
 * from Paystack and triggers the same settlement + on-chain send as the webhook.
 */
async function tryPaystackVerifyByReference(reference: string): Promise<void> {
  const r = await fetchJson(`/api/paystack/transactions/verify/${encodeURIComponent(reference)}`);
  if (r.ok) {
    console.log(
      "[paystack verify] Pulled charge status from Paystack — if payment succeeded, Core should set paymentConfirmedAt and send USDC."
    );
  } else {
    console.warn("[paystack verify]", r.status, r.error ?? "");
  }
}

/** After Paystack + commit, wait until platform sends USDC — delivery tx is `cryptoSendTxHash` (not the offramp escrow hash). */
async function pollTransactionUntilCryptoDelivered(
  transactionId: string,
  options?: { paystackReference?: string }
): Promise<void> {
  const maxAttempts = Math.max(1, Math.ceil(TX_POLL_MAX_MS / TX_POLL_INTERVAL_MS));
  const ref = options?.paystackReference?.trim();
  console.log(
    `\nPolling GET /api/transactions/${transactionId} every ${TX_POLL_INTERVAL_MS / 1000}s (max ${Math.round((maxAttempts * TX_POLL_INTERVAL_MS) / 60000)} min). Complete Paystack in another tab if needed.\n`
  );
  console.log(
    "Why PENDING can stick: Core normally learns payment status from Paystack’s webhook (POST /webhook/paystack). " +
      "On localhost Paystack cannot POST to you — this CLI also calls GET /api/paystack/transactions/verify/:reference every ~30s (unless PEER_RAMP_CLI_SKIP_PAYSTACK_VERIFY_POLL=1) to confirm the charge by reference.\n"
  );
  if (ref) {
    console.log(`Paystack reference: ${ref}`);
    console.log(`Manual one-shot: GET ${CORE_URL}/api/paystack/transactions/verify/${encodeURIComponent(ref)} (same x-api-key as CORE_API_KEY)\n`);
  }
  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, TX_POLL_INTERVAL_MS));
    const r = await fetchJson(`/api/transactions/${encodeURIComponent(transactionId)}`);
    if (!r.ok || !r.data || typeof r.data !== "object") {
      console.warn("[tx poll]", r.status, r.error ?? "no data");
      continue;
    }
    const d = r.data as {
      status?: string;
      cryptoSendTxHash?: string | null;
      paymentConfirmedAt?: string | null;
    };
    if (d.status === "FAILED" || d.status === "CANCELLED") {
      console.error("Transaction ended with status:", d.status);
      return;
    }
    if (
      ref &&
      !SKIP_PAYSTACK_VERIFY_POLL &&
      !d.paymentConfirmedAt &&
      d.status === "PENDING" &&
      i > 0 &&
      (i === 3 || (i > 3 && i % 6 === 0))
    ) {
      await tryPaystackVerifyByReference(ref);
    }
    if (d.paymentConfirmedAt && !d.cryptoSendTxHash) {
      if (i === 0 || i % 12 === 0) {
        console.log("Payment confirmed — waiting for platform on-chain send…");
      }
    }
    if (d.status === "COMPLETED" && d.cryptoSendTxHash) {
      console.log("\nOnramp leg complete. USDC delivery tx (to your recipient wallet):", d.cryptoSendTxHash);
      console.log(
        "(A confirmation email is sent if RESEND is configured — hash above is the receive leg, not the counterparty’s manual escrow hash.)"
      );
      return;
    }
    if (i > 0 && i % 6 === 0) {
      const pay = d.paymentConfirmedAt ? "paymentConfirmed=yes" : "paymentConfirmed=no (webhook not applied yet?)";
      console.log(`… still waiting (status=${d.status ?? "?"}, ${pay})`);
    }
  }
  console.warn(
    "\nPoll window ended. Check GET /api/transactions/" + transactionId + " or your email for the delivery hash when ready."
  );
}

async function fetchJson(
  pathStr: string,
  opts?: RequestInit
): Promise<{
  ok: boolean;
  status: number;
  data?: unknown;
  error?: string;
  code?: string;
  /** Offramp submit-escrow-tx: viem-parsed receipt when TRANSFER_MISMATCH */
  verificationDetails?: unknown;
}> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts?.headers as Record<string, string>),
  };
  if (CORE_API_KEY) headers["x-api-key"] = CORE_API_KEY;
  const res = await fetch(`${CORE_URL}${pathStr}`, { ...opts, headers });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* ignore */
  }
  return {
    ok: res.ok,
    status: res.status,
    data: body.data as unknown,
    error: (body.error as string) ?? (!res.ok ? text.slice(0, 200) : undefined),
    code: body.code as string | undefined,
    verificationDetails: body.verificationDetails as unknown,
  };
}

type QuoteLeg = { amount: string; currency: string; chain?: string };

function parseNum(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** GET /api/quote — onramp: user wants `usdcAmount` USDC; fiat = fToken. */
async function fetchBuyQuoteForCryptoAmount(usdcAmount: number, fToken: string): Promise<Record<string, unknown> | null> {
  const params = new URLSearchParams({
    action: "buy",
    amount: String(usdcAmount),
    input_side: "to",
    f_token: fToken,
    t_token: "USDC",
    chain: QUOTE_PRICING_CHAIN,
  });
  const r = await fetchJson(`/api/quote?${params.toString()}`);
  if (!r.ok || !r.data || typeof r.data !== "object") {
    console.warn(`[quote] buy ${fToken} failed`, r.status, r.error);
    return null;
  }
  return r.data as Record<string, unknown>;
}

/** GET /api/quote — offramp: user sells `usdcAmount` USDC for fToken. */
async function fetchSellQuoteForCryptoAmount(usdcAmount: number, tToken: string): Promise<Record<string, unknown> | null> {
  const params = new URLSearchParams({
    action: "sell",
    amount: String(usdcAmount),
    input_side: "from",
    f_token: "USDC",
    t_token: tToken,
    chain: QUOTE_PRICING_CHAIN,
  });
  const r = await fetchJson(`/api/quote?${params.toString()}`);
  if (!r.ok || !r.data || typeof r.data !== "object") {
    console.warn(`[quote] sell → ${tToken} failed`, r.status, r.error);
    return null;
  }
  return r.data as Record<string, unknown>;
}

function quoteSnapshotFromBuy(data: Record<string, unknown>, settlementFiat: string): {
  fiatAmount: number;
  fiatCurrency: string;
  cryptoAmount: number;
} {
  const input = data.input as QuoteLeg;
  const output = data.output as QuoteLeg;
  const fiatAmount = parseNum(input.amount);
  const cryptoAmount = parseNum(output.amount);
  if (!Number.isFinite(fiatAmount) || !Number.isFinite(cryptoAmount)) {
    throw new Error("Invalid quote response: input/output amounts");
  }
  return {
    fiatAmount,
    fiatCurrency: (input.currency ?? settlementFiat).toUpperCase(),
    cryptoAmount,
  };
}

function quoteSnapshotFromSell(data: Record<string, unknown>, settlementFiat: string): {
  fiatAmount: number;
  fiatCurrency: string;
  cryptoAmount: number;
} {
  const input = data.input as QuoteLeg;
  const output = data.output as QuoteLeg;
  const cryptoAmount = parseNum(input.amount);
  const fiatAmount = parseNum(output.amount);
  if (!Number.isFinite(fiatAmount) || !Number.isFinite(cryptoAmount)) {
    throw new Error("Invalid quote response: input/output amounts");
  }
  return {
    fiatAmount,
    fiatCurrency: (output.currency ?? settlementFiat).toUpperCase(),
    cryptoAmount,
  };
}

function appendQuotesLog(line: string): void {
  try {
    const p = path.isAbsolute(QUOTES_LOG) ? QUOTES_LOG : path.join(process.cwd(), QUOTES_LOG);
    fs.appendFileSync(p, line + "\n", "utf8");
  } catch (e) {
    console.warn("[quotes log]", e instanceof Error ? e.message : e);
  }
}

async function logMultiCurrencyBuyQuotes(usdcAmount: number): Promise<void> {
  const fiats = await resolveQuoteFiatsForLog();
  console.log(
    `Multi-currency log: ${fiats.length} fiat codes → ${QUOTES_LOG} (one GET /api/quote per code; uses GHS Fonbnk leg + USD pivot when needed).`
  );
  const ts = new Date().toISOString();
  for (const fiat of fiats) {
    const data = await fetchBuyQuoteForCryptoAmount(usdcAmount, fiat);
    if (!data) {
      appendQuotesLog(`${ts} | buy | USDC=${usdcAmount} | ${fiat} | ERROR`);
      continue;
    }
    const ex = data.exchangeRate as string | undefined;
    const qid = data.quoteId as string | undefined;
    const inp = data.input as QuoteLeg | undefined;
    const out = data.output as QuoteLeg | undefined;
    appendQuotesLog(
      `${ts} | buy | USDC=${usdcAmount} | fiat=${fiat} | rate=${ex ?? "—"} | in=${inp?.amount} ${inp?.currency} | out=${out?.amount} ${out?.currency} | quoteId=${qid ?? "—"}`
    );
  }
}

async function logMultiCurrencySellQuotes(usdcAmount: number): Promise<void> {
  const fiats = await resolveQuoteFiatsForLog();
  console.log(
    `Multi-currency log: ${fiats.length} fiat codes → ${QUOTES_LOG} (one GET /api/quote per code; uses GHS Fonbnk leg + USD pivot when needed).`
  );
  const ts = new Date().toISOString();
  for (const fiat of fiats) {
    const data = await fetchSellQuoteForCryptoAmount(usdcAmount, fiat);
    if (!data) {
      appendQuotesLog(`${ts} | sell | USDC=${usdcAmount} | ${fiat} | ERROR`);
      continue;
    }
    const ex = data.exchangeRate as string | undefined;
    const qid = data.quoteId as string | undefined;
    const inp = data.input as QuoteLeg | undefined;
    const out = data.output as QuoteLeg | undefined;
    appendQuotesLog(
      `${ts} | sell | USDC=${usdcAmount} | fiat=${fiat} | rate=${ex ?? "—"} | in=${inp?.amount} ${inp?.currency} | out=${out?.amount} ${out?.currency} | quoteId=${qid ?? "—"}`
    );
  }
}

type FillRow = {
  id: string;
  offrampOrderId?: string;
  onrampOrderId?: string;
  cryptoAmount: string;
  onrampAcceptedAt?: string | null;
  offrampAcceptedAt?: string | null;
};

function serializeFillsFromOrder(order: Record<string, unknown>, side: "onramp" | "offramp"): FillRow[] {
  const key = side === "onramp" ? "fillsAsOnramp" : "fillsAsOfframp";
  const raw = order[key];
  if (!Array.isArray(raw)) return [];
  return raw.map((f) => {
    const row = f as Record<string, unknown>;
    return {
      id: String(row.id),
      offrampOrderId: row.offrampOrderId != null ? String(row.offrampOrderId) : undefined,
      onrampOrderId: row.onrampOrderId != null ? String(row.onrampOrderId) : undefined,
      cryptoAmount: String(row.cryptoAmount ?? ""),
      onrampAcceptedAt: row.onrampAcceptedAt != null ? String(row.onrampAcceptedAt) : null,
      offrampAcceptedAt: row.offrampAcceptedAt != null ? String(row.offrampAcceptedAt) : null,
    };
  });
}

async function pollOrder(id: string): Promise<Record<string, unknown>> {
  console.log(`Polling GET /api/peer-ramp/orders/${id} every 4s (Ctrl+C to stop)...`);
  for (;;) {
    const r = await fetchJson(`/api/peer-ramp/orders/${id}`);
    if (r.ok && r.data && typeof r.data === "object") {
      const d = r.data as Record<string, unknown>;
      const fills = [...serializeFillsFromOrder(d, "onramp"), ...serializeFillsFromOrder(d, "offramp")];
      const fillSummary = fills.length ? ` fills=${fills.length}` : "";
      console.log(
        `status=${d.status} remaining=${d.cryptoAmountRemaining} linkedTx=${d.linkedTransactionId ?? "—"}${fillSummary}`
      );
      if (d.status === "AWAITING_SETTLEMENT" && String(d.cryptoAmountRemaining) === "0") {
        console.log("Fully matched. Proceed with dual-accept on each fill, then commit / escrow.");
        return d;
      }
    } else {
      console.warn("poll error", r.status, r.error);
    }
    await new Promise((r2) => setTimeout(r2, 4000));
  }
}

async function acceptFill(fillId: string, side: "ONRAMP" | "OFFRAMP"): Promise<boolean> {
  const r = await fetchJson(`/api/peer-ramp/fills/${fillId}/accept`, {
    method: "POST",
    body: JSON.stringify({ side }),
  });
  if (!r.ok) {
    console.error("accept failed", r.status, r.error, r.code);
    return false;
  }
  return true;
}

async function dualAcceptAllFillsForOnramp(orderAfterPoll: Record<string, unknown>): Promise<boolean> {
  const fills = serializeFillsFromOrder(orderAfterPoll, "onramp");
  if (fills.length === 0) {
    console.log("No fills on this onramp order (nothing to accept).");
    return true;
  }
  for (const f of fills) {
    console.log(`Fill ${f.id} size=${f.cryptoAmount} USDC — onramp side must accept, then offramp side.`);
    const a1 = (await q(`Accept as ONRAMP for fill ${f.id}? (y/N): `)).toLowerCase();
    if (a1 !== "y" && a1 !== "yes") {
      console.log("Skipped.");
      continue;
    }
    if (!(await acceptFill(f.id, "ONRAMP"))) return false;
    const a2 = (await q(`Accept as OFFRAMP for fill ${f.id}? (y/N): `)).toLowerCase();
    if (a2 !== "y" && a2 !== "yes") {
      console.log("Offramp accept skipped.");
      continue;
    }
    if (!(await acceptFill(f.id, "OFFRAMP"))) return false;
  }
  return true;
}

async function dualAcceptAllFillsForOfframp(orderAfterPoll: Record<string, unknown>): Promise<boolean> {
  const fills = serializeFillsFromOrder(orderAfterPoll, "offramp");
  if (fills.length === 0) {
    console.log("No fills on this offramp order.");
    return true;
  }
  for (const f of fills) {
    console.log(`Fill ${f.id} size=${f.cryptoAmount} USDC`);
    const a1 = (await q(`Accept as ONRAMP for fill ${f.id}? (y/N): `)).toLowerCase();
    if (a1 === "y" || a1 === "yes") {
      if (!(await acceptFill(f.id, "ONRAMP"))) return false;
    }
    const a2 = (await q(`Accept as OFFRAMP for fill ${f.id}? (y/N): `)).toLowerCase();
    if (a2 === "y" || a2 === "yes") {
      if (!(await acceptFill(f.id, "OFFRAMP"))) return false;
    }
  }
  return true;
}

function printEscrowVerificationHint(txHash: string): void {
  const ch = PEER_RAMP_CLI_CHAIN_ID;
  const explorer =
    ch === 84532
      ? `https://sepolia.basescan.org/tx/${txHash}`
      : ch === 8453
        ? `https://basescan.org/tx/${txHash}`
        : null;
  const m = USDC_BY_CHAIN[ch];
  console.log(
    `TRANSFER_MISMATCH: Core verified this hash on chainId ${ch} (not the quote pricing chain). ` +
      `The receipt must include an ERC-20 Transfer of the order’s USDC amount to PEER_RAMP_PLATFORM_ESCROW_ADDRESS — same network as the order.`
  );
  if (m) console.log(`Expected USDC token on this chain: ${m.addr}`);
  if (explorer) console.log(`Open in explorer: ${explorer}`);
}

async function submitEscrowTx(
  offrampOrderId: string,
  txHash: string
): Promise<{ ok: true } | { ok: false; error?: string; code?: string }> {
  const r = await fetchJson(`/api/peer-ramp/orders/${offrampOrderId}/submit-escrow-tx`, {
    method: "POST",
    body: JSON.stringify({ txHash }),
  });
  if (!r.ok) {
    console.error("submit-escrow-tx failed", r.status, r.error, r.code);
    if (r.verificationDetails != null && typeof r.verificationDetails === "object") {
      console.log(
        "[escrow verify] Parsed receipt (viem @ chainId " +
          String((r.verificationDetails as { chainId?: number }).chainId ?? "?") +
          "):",
        JSON.stringify(r.verificationDetails, null, 2)
      );
    }
    if (r.code === "TRANSFER_MISMATCH") printEscrowVerificationHint(txHash.trim());
    return { ok: false, error: r.error, code: r.code };
  }
  console.log("Escrow tx verified:", JSON.stringify(r.data, null, 2));
  return { ok: true };
}

const ESCROW_HASH_MAX_ATTEMPTS = 3;

async function promptEscrowTxHashUntilSuccessOrExhausted(offrampOrderId: string): Promise<boolean> {
  for (let attempt = 1; attempt <= ESCROW_HASH_MAX_ATTEMPTS; attempt++) {
    const txHash = await q(`Transaction hash (0x...) [${attempt}/${ESCROW_HASH_MAX_ATTEMPTS}]: `);
    const trimmed = txHash.trim();
    if (!trimmed) {
      console.error("Empty hash — enter a valid 0x transaction hash.");
      if (attempt === ESCROW_HASH_MAX_ATTEMPTS) return false;
      continue;
    }
    const result = await submitEscrowTx(offrampOrderId, trimmed);
    if (result.ok) return true;
    if (attempt < ESCROW_HASH_MAX_ATTEMPTS) {
      console.log(
        `Could not verify this hash on-chain for this order (e.g. wrong tx, wrong token, or amount). Try again (${ESCROW_HASH_MAX_ATTEMPTS - attempt} left).`
      );
    }
  }
  console.error(`Giving up after ${ESCROW_HASH_MAX_ATTEMPTS} failed escrow submissions.`);
  return false;
}

function tokenMeta(chainId: number): { tokenAddress: string; decimals: number } {
  const m = USDC_BY_CHAIN[chainId];
  if (!m) {
    throw new Error(`Unsupported PEER_RAMP_CLI_CHAIN_ID=${chainId}; add USDC_BY_CHAIN in peer-ramp-e2e-cli.ts`);
  }
  return { tokenAddress: m.addr, decimals: m.decimals };
}

async function onrampFlow(): Promise<void> {
  if (!CORE_API_KEY) console.warn("Warning: CORE_API_KEY empty — requests will 401.");
  const amount = Number(await q("USDC amount (crypto to receive, e.g. 30): "));
  if (!Number.isFinite(amount) || amount <= 0) {
    console.error("Invalid amount");
    process.exit(1);
  }

  console.log(
    `Fetching platform quote (pricing=${QUOTE_PRICING_CHAIN} USDC; orders=chainId ${PEER_RAMP_CLI_CHAIN_ID}, fiat=${DEFAULT_FIAT})...`
  );
  const primary = await fetchBuyQuoteForCryptoAmount(amount, DEFAULT_FIAT);
  if (!primary) {
    console.error("Primary quote failed. Check CORE_URL, CORE_API_KEY (x-api-key), and that core pricing supports BASE.");
    process.exit(1);
  }
  const snap = quoteSnapshotFromBuy(primary, DEFAULT_FIAT);
  console.log(
    `Quote: pay ~${snap.fiatAmount} ${snap.fiatCurrency} for ~${snap.cryptoAmount} USDC (pricing engine).`
  );

  await logMultiCurrencyBuyQuotes(amount);

  const email = await q("Payer email: ");
  const wallet = (await q("Recipient 0x address: ")).trim();
  const session = (await q("cliSessionId (optional, for correlation): ")) || undefined;

  const { tokenAddress, decimals } = tokenMeta(PEER_RAMP_CLI_CHAIN_ID);
  const body = {
    chainId: PEER_RAMP_CLI_CHAIN_ID,
    tokenAddress,
    decimals,
    cryptoAmount: snap.cryptoAmount,
    quoteSnapshot: {
      fiatAmount: snap.fiatAmount,
      fiatCurrency: snap.fiatCurrency,
      cryptoAmount: snap.cryptoAmount,
    },
    settlementCurrency: snap.fiatCurrency,
    payerEmail: email,
    recipientAddress: wallet,
    cliSessionId: session,
  };

  const r = await fetchJson("/api/peer-ramp/orders/onramp", { method: "POST", body: JSON.stringify(body) });
  if (!r.ok) {
    console.error("create onramp failed", r.status, r.error);
    process.exit(1);
  }
  const order = r.data as Record<string, unknown>;
  console.log("Created onramp", order.id);
  console.log("Fills (initial):", JSON.stringify(serializeFillsFromOrder(order, "onramp"), null, 2));

  const polled = await pollOrder(String(order.id));
  const ok = await dualAcceptAllFillsForOnramp(polled);
  if (!ok) process.exit(1);

  const commit = (await q("Commit onramp → Transaction + Paystack? (y/N): ")).toLowerCase();
  if (commit === "y" || commit === "yes") {
    const payEmail = (await q("Paystack customer email (optional, enter for metadata): ")) || email;
    const cr = await fetchJson(`/api/peer-ramp/orders/${order.id}/commit-onramp`, {
      method: "POST",
      body: JSON.stringify({
        initializePaystack: true,
        paystackCustomerEmail: payEmail,
      }),
    });
    if (!cr.ok) {
      console.error("commit failed", cr.status, cr.error, cr.code);
      process.exit(1);
    }
    const cd = cr.data as Record<string, unknown>;
    console.log("transactionId", cd.transactionId);
    let paystackReference: string | undefined;
    if (cd.paystack && typeof cd.paystack === "object") {
      const p = cd.paystack as Record<string, unknown>;
      console.log("Paystack authorization_url:\n", p.authorization_url);
      if (typeof p.reference === "string" && p.reference.length > 0) {
        paystackReference = p.reference;
      }
    }
    if (typeof cd.transactionId === "string" && process.env.PEER_RAMP_CLI_SKIP_TX_POLL !== "1") {
      await pollTransactionUntilCryptoDelivered(cd.transactionId, { paystackReference });
    } else if (typeof cd.transactionId === "string") {
      console.log(
        "\nSkipping tx poll (PEER_RAMP_CLI_SKIP_TX_POLL=1). Poll GET /api/transactions/" +
          cd.transactionId +
          " for status COMPLETED and cryptoSendTxHash."
      );
    }
  }
}

async function offrampFlow(): Promise<void> {
  if (!CORE_API_KEY) console.warn("Warning: CORE_API_KEY empty — requests will 401.");
  const amount = Number(await q("USDC amount to sell (crypto): "));
  if (!Number.isFinite(amount) || amount <= 0) {
    console.error("Invalid amount");
    process.exit(1);
  }

  console.log(
    `Fetching platform quote (pricing=${QUOTE_PRICING_CHAIN} USDC; orders=chainId ${PEER_RAMP_CLI_CHAIN_ID}, fiat=${DEFAULT_FIAT})...`
  );
  const primary = await fetchSellQuoteForCryptoAmount(amount, DEFAULT_FIAT);
  if (!primary) {
    console.error("Primary quote failed. Check CORE_URL and CORE_API_KEY.");
    process.exit(1);
  }
  const snap = quoteSnapshotFromSell(primary, DEFAULT_FIAT);
  console.log(
    `Quote: sell ~${snap.cryptoAmount} USDC for ~${snap.fiatAmount} ${snap.fiatCurrency} (pricing engine).`
  );

  await logMultiCurrencySellQuotes(amount);

  const email = await q("Your email: ");
  const session = (await q("cliSessionId (optional): ")) || undefined;

  const { tokenAddress, decimals } = tokenMeta(PEER_RAMP_CLI_CHAIN_ID);
  const body = {
    chainId: PEER_RAMP_CLI_CHAIN_ID,
    tokenAddress,
    decimals,
    cryptoAmount: snap.cryptoAmount,
    quoteSnapshot: {
      fiatAmount: snap.fiatAmount,
      fiatCurrency: snap.fiatCurrency,
      cryptoAmount: snap.cryptoAmount,
    },
    settlementCurrency: snap.fiatCurrency,
    payerEmail: email,
    cliSessionId: session,
  };

  const r = await fetchJson("/api/peer-ramp/orders/offramp", { method: "POST", body: JSON.stringify(body) });
  if (!r.ok) {
    console.error("create offramp failed", r.status, r.error);
    process.exit(1);
  }
  const payload = r.data as Record<string, unknown>;
  console.log(JSON.stringify(payload, null, 2));
  const order = payload.order as Record<string, unknown> | undefined;
  if (!order?.id) return;

  const polled = await pollOrder(String(order.id));
  const ok = await dualAcceptAllFillsForOfframp(polled);
  if (!ok) process.exit(1);

  const doEscrow = (await q("Submit USDC escrow tx hash after sending to platform address? (y/N): ")).toLowerCase();
  if (doEscrow === "y" || doEscrow === "yes") {
    await promptEscrowTxHashUntilSuccessOrExhausted(String(order.id));
  }
}

function parseCliMode(): "onramp" | "offramp" | null {
  for (const a of process.argv.slice(2)) {
    const lower = a.toLowerCase();
    if (lower === "onramp" || lower === "--onramp") return "onramp";
    if (lower === "offramp" || lower === "--offramp") return "offramp";
  }
  return null;
}

async function main(): Promise<void> {
  const mode = parseCliMode();
  if (mode === "onramp") await onrampFlow();
  else if (mode === "offramp") await offrampFlow();
  else {
    console.error("Usage: pnpm run peer-ramp:e2e-cli -- <onramp|offramp>");
    process.exit(1);
  }
  rl.close();
}

main().catch((e) => {
  console.error(e);
  rl.close();
  process.exit(1);
});
