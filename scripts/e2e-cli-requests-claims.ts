#!/usr/bin/env node
/**
 * E2E CLI — Request & Claim flow (menu-driven).
 *
 * Menu:
 *  (1) Make a payment request — requester asks payer for money; notify payer by email (link/code).
 *  (2) Pay a request — payer enters link/code, pays (fiat or crypto); request auto-settles to requester.
 *  (3) Make a payment — sender sends funds; recipient gets a claim (code + OTP) and chooses payout (use app/API).
 *  (4) Claim — recipient enters claim code, verifies OTP, completes claim (crypto address or fiat target).
 *
 * Rules: no fiat-to-fiat; crypto not same chain+token. Receiver wants crypto ⇒ payer can pay fiat (onramp) or crypto.
 *        Receiver wants fiat ⇒ payer pays crypto (offramp + payout to receiver).
 *
 * Usage: pnpm run e2e:cli:requests-claims
 * Env: CORE_URL (default http://localhost:4000), CORE_API_KEY (required for create, pay init, simulate).
 */

import "dotenv/config";
import * as readline from "readline";

const CORE_URL = (process.env.CORE_URL ?? "http://localhost:4000").replace(/\/$/, "");
const CORE_API_KEY = process.env.CORE_API_KEY ?? "";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, (ans) => resolve((ans ?? "").trim())));
}

async function fetchJson(
  path: string,
  options?: RequestInit
): Promise<{ ok: boolean; status: number; data?: unknown; error?: string; code?: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };
  if (CORE_API_KEY) headers["x-api-key"] = CORE_API_KEY;
  try {
    const res = await fetch(`${CORE_URL}${path}`, { ...options, headers });
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }
    return {
      ok: res.ok,
      status: res.status,
      data: (body as { data?: unknown }).data ?? body,
      error: (body as { error?: string }).error,
      code: (body as { code?: string }).code,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Chains/tokens (for crypto receive and pay flows) ---
type SupportedPair = { chainCode: string; chainId: number; symbol: string };
let onchainPairs: SupportedPair[] = [];

async function loadChainsAndTokens(): Promise<void> {
  const [chainsRes, tokensRes] = await Promise.all([
    fetchJson("/api/chains"),
    fetchJson("/api/tokens"),
  ]);
  const chains = (chainsRes.data as { chains?: Array<{ chainId: number; name: string }> })?.chains ?? [];
  const tokens = (tokensRes.data as { tokens?: Array<{ chainId: number; symbol: string }> })?.tokens ?? [];
  const chainIdToCode = new Map(chains.map((c) => [c.chainId, c.name.toUpperCase()]));
  const fiatCodes = ["MOMO", "BANK", "CARD"];
  onchainPairs = (tokens as Array<{ chainId: number; symbol: string }>)
    .map((t) => ({
      chainCode: chainIdToCode.get(t.chainId) ?? "",
      chainId: t.chainId,
      symbol: t.symbol,
    }))
    .filter((p) => p.chainCode && !fiatCodes.includes(p.chainCode));
}

type QuoteData = {
  quoteId: string;
  expiresAt: string;
  input: { amount: string; currency: string };
  output: { amount: string; currency: string; chain?: string };
};

async function getQuote(opts: {
  action: "ONRAMP" | "OFFRAMP";
  inputAmount: string;
  inputCurrency: string;
  outputCurrency: string;
  chain: string;
  inputSide?: "from" | "to";
}): Promise<{ ok: true; data: QuoteData } | { ok: false; error: string; status?: number }> {
  const res = await fetchJson("/api/v1/quotes", {
    method: "POST",
    body: JSON.stringify({
      action: opts.action,
      inputAmount: opts.inputAmount,
      inputCurrency: opts.inputCurrency,
      outputCurrency: opts.outputCurrency,
      chain: opts.chain,
      inputSide: opts.inputSide ?? "from",
    }),
  });
  if (!res.ok) return { ok: false, error: res.error ?? "Quote failed", status: res.status };
  const data = res.data as QuoteData | undefined;
  if (!data?.quoteId || !data.input || !data.output) return { ok: false, error: "Invalid quote response" };
  return { ok: true, data };
}

function extractLinkId(input: string): string {
  const s = input.trim();
  const m = s.match(/\/pay\/request\/([a-f0-9]+)/i) ?? s.match(/^([a-f0-9]{16})$/) ?? [];
  return m[1] ?? s;
}

// --- (1) Make a payment request ---
async function runMakeRequest(): Promise<void> {
  console.log("\n--- Make a payment request ---");
  const payerEmail = await question("Payer email (who will pay; we send them the link) [payer@example.com]: ") || "payer@example.com";
  const payerPhone = await question("Payer phone (optional) [+233541234567]: ") || "";

  const receiveType = await question("What does the requester want to receive? (1) crypto  (2) fiat [1]: ") || "1";
  const wantsCrypto = receiveType !== "2";

  let t_chain: string;
  let t_token: string;
  let t_amount: number;
  let receiveSummary: string;

  if (wantsCrypto) {
    if (onchainPairs.length === 0) {
      console.error("No crypto pairs. Seed chains/tokens (pnpm db:seed).");
      return;
    }
    console.log("\nSupported chain + token:");
    onchainPairs.forEach((p, i) => console.log(`  ${i + 1}. ${p.chainCode} / ${p.symbol}`));
    const pairIdx = parseInt(await question(`Choose (1-${onchainPairs.length}) [1]: `) || "1", 10);
    const pair = onchainPairs[Math.max(0, pairIdx - 1)] ?? onchainPairs[0]!;
    t_chain = pair.chainCode;
    t_token = pair.symbol;
    const amountStr = await question(`Amount (${t_token}) to receive [25]: `) || "25";
    t_amount = parseFloat(amountStr);
    if (!Number.isFinite(t_amount) || t_amount <= 0) {
      console.error("Invalid amount.");
      return;
    }
    receiveSummary = `${t_amount} ${t_token} on ${t_chain}`;
  } else {
    t_chain = "MOMO";
    t_token = "GHS";
    const amountStr = await question("Amount (GHS) to receive [100]: ") || "100";
    t_amount = parseFloat(amountStr);
    if (!Number.isFinite(t_amount) || t_amount <= 0) {
      console.error("Invalid amount.");
      return;
    }
    receiveSummary = `${t_amount} GHS (mobile money)`;
  }

  const requesterName = await question("Requester name (shown to payer) [Jane Doe]: ") || "Jane Doe";
  const toIdentifier = await question("Requester email (notifications) [receiver@example.com]: ") || "receiver@example.com";
  receiveSummary = `${receiveSummary} — Requested by ${requesterName} (${toIdentifier})`;

  let payoutTarget: string | undefined;
  if (wantsCrypto) {
    const addr = await question("Your receiving wallet address (we send crypto here when paid) [0x...]: ");
    if (addr?.trim() && addr.trim().startsWith("0x")) payoutTarget = addr.trim();
  }

  const createBody: Record<string, unknown> = {
    payerEmail,
    payerPhone: payerPhone || undefined,
    channels: ["EMAIL"],
    t_amount: t_amount,
    t_chain,
    t_token,
    toIdentifier,
    receiveSummary,
  };
  if (payoutTarget) createBody.payoutTarget = payoutTarget;

  const createRes = await fetchJson("/api/requests", {
    method: "POST",
    body: JSON.stringify(createBody),
  });

  if (!createRes.ok) {
    console.error("Create request failed:", (createRes.data as { error?: string })?.error ?? createRes.error);
    return;
  }

  const d = createRes.data as {
    id?: string;
    linkId?: string;
    transactionId?: string;
    claimCode?: string;
    payLink?: string;
    notification?: Record<string, { ok?: boolean; error?: string }>;
  };
  console.log("\n--- Request created ---");
  console.log("  requestId:", d.id);
  console.log("  linkId:", d.linkId);
  console.log("  payLink:", d.payLink);
  console.log("  claimCode (for recipient):", d.claimCode);
  if (d.notification) {
    console.log("  notification:", Object.entries(d.notification).map(([k, v]) => `${k}: ${v?.ok ? "ok" : v?.error ?? "—"}`).join(", "));
  }
}

// --- (2) Pay a request ---
async function runPayRequest(): Promise<void> {
  console.log("\n--- Pay a request ---");
  const linkInput = await question("Request link ID or full pay URL (e.g. http://localhost:3000/pay/request/2c9edf8a75639de2): ");
  if (!linkInput) {
    console.error("Link or ID required.");
    return;
  }
  const linkId = extractLinkId(linkInput);
  const byLinkRes = await fetchJson(`/api/requests/by-link/${linkId}`);
  if (!byLinkRes.ok) {
    console.error("Request not found:", byLinkRes.error);
    return;
  }

  const reqData = byLinkRes.data as {
    id: string;
    linkId: string;
    transaction?: { toIdentifier?: string; t_amount?: string; t_chain?: string; t_token?: string; id?: string; status?: string };
    claim?: { code?: string };
  };
  const tx = reqData.transaction;
  if (!tx) {
    console.error("Request has no transaction.");
    return;
  }

  const t_chain = (tx.t_chain ?? "").toUpperCase();
  const t_token = tx.t_token ?? "";
  const t_amount = parseFloat(String(tx.t_amount ?? "0"));
  const isReceiverWantsFiat = t_chain === "MOMO" || t_chain === "BANK";

  console.log("\n--- Request details (who you are paying) ---");
  console.log("  Requester (receiver):", tx.toIdentifier);
  console.log("  Amount:", t_amount, t_token);
  console.log("  Settlement:", isReceiverWantsFiat ? "fiat (mobile money/bank)" : "crypto");

  const accept = await question("\nAccept and pay? (Y/n): ");
  if (accept.toLowerCase() === "n" || accept.toLowerCase() === "no") {
    console.log("Cancelled.");
    return;
  }

  const transactionId = tx.id;

  // E2E: simulate payment (no real Paystack)
  const simulate = await question("Simulate payment (test endpoint, no real Paystack)? (Y/n): ");
  const doSimulate = simulate.toLowerCase() !== "n" && simulate.toLowerCase() !== "no";
  if (doSimulate) {
    const simRes = await fetchJson("/api/test/request/simulate-payment", {
      method: "POST",
      body: JSON.stringify({ transaction_id: transactionId }),
    });
    if (!simRes.ok) {
      console.error("Simulate payment failed:", (simRes.data as { error?: string })?.error ?? simRes.error);
      return;
    }
    const simData = simRes.data as { settled?: boolean; already_completed?: boolean; message?: string };
    console.log("  Payment simulated. Request settled.");
    console.log("  ", simData.message ?? "Payer and requester notified by email.");
    return;
  }

  if (isReceiverWantsFiat) {
    // Payer pays crypto → we do offramp then payout to receiver.
    console.log("\nReceiver wants fiat. You pay in crypto (offramp).");
    if (onchainPairs.length === 0) await loadChainsAndTokens();
    if (onchainPairs.length === 0) {
      console.error("No crypto pairs. Cannot get quote.");
      return;
    }
    console.log("Supported chain + token:");
    onchainPairs.forEach((p, i) => console.log(`  ${i + 1}. ${p.chainCode} / ${p.symbol}`));
    const pairIdx = parseInt(await question(`Choose chain/token to pay (1-${onchainPairs.length}) [1]: `) || "1", 10);
    const pair = onchainPairs[Math.max(0, pairIdx - 1)] ?? onchainPairs[0]!;
    const quoteChain = pair.chainCode === "BASE SEPOLIA" ? "BASE" : pair.chainCode;
    const quoteRes = await getQuote({
      action: "OFFRAMP",
      inputAmount: String(t_amount),
      inputCurrency: t_token,
      outputCurrency: "GHS",
      chain: quoteChain,
      inputSide: "from",
    });
    if (!quoteRes.ok) {
      console.error("Quote failed:", quoteRes.error);
      return;
    }
    const outGhs = parseFloat(quoteRes.data.output.amount);
    console.log(`  You send: ${quoteRes.data.input.amount} ${quoteRes.data.input.currency} → receiver gets ~${outGhs.toFixed(2)} GHS.`);
    console.log("  Use the pay link or offramp flow to send crypto; then paste tx hash to confirm.");
    const txHash = await question("Paste the transaction hash (0x...) after sending crypto: ");
    if (!txHash) {
      console.error("Tx hash required for offramp confirm.");
      return;
    }
    // Offramp confirm expects an order; for request we don't have a pre-created offramp order. So we'd need to create order then confirm.
    // Simplification: for E2E we only implement "receiver wants crypto" (payer pays fiat via Paystack) here; "receiver wants fiat" can be simulated or done via test endpoint.
    console.log("  (Offramp + payout to receiver is not wired in this CLI yet. Use simulate or full app.)");
    return;
  }

  // Receiver wants crypto ⇒ payer can pay fiat (Paystack) or crypto (send to platform, paste tx hash).
  const payWith = await question("Pay with (1) fiat (Paystack)  (2) crypto (send to platform, paste tx hash) [1]: ") || "1";
  if (payWith === "2") {
    const calldataRes = await fetchJson(`/api/requests/calldata?transaction_id=${transactionId}`);
    if (!calldataRes.ok) {
      console.error("Calldata failed:", (calldataRes.data as { error?: string })?.error ?? calldataRes.error);
      return;
    }
    const calldata = calldataRes.data as { toAddress?: string; amount?: string; token?: string; chain?: string };
    console.log("\n--- Send crypto to platform ---");
    console.log("  To address:", calldata.toAddress);
    console.log("  Amount:", calldata.amount, calldata.token);
    console.log("  Chain:", calldata.chain);
    console.log("  Send this amount to the address above, then paste the transaction hash below.");
    const txHash = await question("Paste tx hash (0x...): ");
    if (!txHash?.trim()) {
      console.error("Tx hash required.");
      return;
    }
    const confirmRes = await fetchJson("/api/requests/confirm-crypto", {
      method: "POST",
      body: JSON.stringify({ transaction_id: transactionId, tx_hash: txHash.trim() }),
    });
    if (!confirmRes.ok) {
      console.error("Confirm failed:", (confirmRes.data as { error?: string })?.error ?? confirmRes.error);
      return;
    }
    console.log("  Payment confirmed. Request settled to requester; both parties notified.");
    return;
  }

  const payerEmail = await question("Your email (for Paystack) [payer@example.com]: ") || "payer@example.com";
  const quoteChain = t_chain === "BASE SEPOLIA" ? "BASE" : t_chain;
  const quoteRes = await getQuote({
    action: "ONRAMP",
    inputAmount: String(t_amount),
    inputCurrency: t_token,
    outputCurrency: "GHS",
    chain: quoteChain,
    inputSide: "to",
  });
  if (!quoteRes.ok) {
    console.error("Quote failed:", quoteRes.error);
    return;
  }
  const ghsAmount = parseFloat(quoteRes.data.output.amount);
  const amountPesewas = Math.round(ghsAmount * 100);

  const initRes = await fetchJson("/api/paystack/payments/initialize", {
    method: "POST",
    body: JSON.stringify({
      email: payerEmail,
      amount: amountPesewas,
      currency: "GHS",
      transaction_id: transactionId,
    }),
  });
  if (!initRes.ok) {
    console.error("Initialize payment failed:", (initRes.data as { error?: string })?.error ?? initRes.error);
    return;
  }
  const initData = initRes.data as { authorization_url?: string; reference?: string; transaction_id?: string };
  console.log("\n--- Pay with Paystack ---");
  console.log("  GHS amount:", ghsAmount.toFixed(2));
  console.log("  URL:", initData.authorization_url);
  console.log("  Reference:", initData.reference);
  console.log("\nAfter paying, paste the Paystack reference to verify (or press Enter to poll transaction status): ");
  const refInput = await question("Reference (or Enter to poll): ");

  if (refInput) {
    const verifyRes = await fetchJson(`/api/paystack/transactions/verify/${refInput.trim()}`);
    if (!verifyRes.ok) {
      console.error("Verify failed:", verifyRes.error);
      return;
    }
    console.log("  Payment verified.");
  } else {
    console.log("Polling transaction status...");
    for (let i = 0; i < 60; i++) {
      await sleep(2000);
      const txRes = await fetchJson(`/api/transactions/${transactionId}`);
      if (txRes.ok && txRes.data) {
        const status = (txRes.data as { status?: string }).status;
        if (status === "COMPLETED") {
          console.log("  Transaction COMPLETED.");
          break;
        }
        if (status === "FAILED") {
          console.error("Transaction FAILED.");
          return;
        }
      }
      if (i === 59) console.log("Timeout waiting for COMPLETED.");
    }
  }
  console.log("  Request settled; requester and payer notified by email.");
}

// --- (3) Make a payment (direct send → claim) ---
async function runMakePayment(): Promise<void> {
  console.log("\n--- Make a payment (direct send) ---");
  console.log("  You send funds; recipient gets a claim (code + OTP) and chooses how to receive.");
  const sendWith = await question("Send with (1) fiat (Paystack)  (2) crypto [1]: ") || "1";

  const senderEmail = await question("Your email (sender) [sender@example.com]: ") || "sender@example.com";
  const receiverEmail = await question("Recipient email (gets claim) [receiver@example.com]: ") || "receiver@example.com";

  if (sendWith === "1") {
    // Fiat → receiver gets crypto (onramp-style). Optional payoutTarget = send to wallet immediately; else they claim.
    const ghsStr = await question("Amount in GHS to send [10]: ") || "10";
    const ghsAmount = parseFloat(ghsStr);
    if (!Number.isFinite(ghsAmount) || ghsAmount <= 0) {
      console.error("Invalid amount.");
      return;
    }
    if (onchainPairs.length === 0) await loadChainsAndTokens();
    if (onchainPairs.length === 0) {
      console.error("No crypto pairs for quote.");
      return;
    }
    console.log("What should the recipient receive (crypto)?");
    onchainPairs.forEach((p, i) => console.log(`  ${i + 1}. ${p.chainCode} / ${p.symbol}`));
    const pairIdx = parseInt(await question(`Choose (1-${onchainPairs.length}) [1]: `) || "1", 10);
    const pair = onchainPairs[Math.max(0, pairIdx - 1)] ?? onchainPairs[0]!;
    const recipientWallet = await question("Recipient wallet for immediate send (0x... or Enter to let them claim later): ");
    const quoteChain = pair.chainCode === "BASE SEPOLIA" ? "BASE" : pair.chainCode;
    const quoteRes = await getQuote({
      action: "ONRAMP",
      inputAmount: String(ghsAmount),
      inputCurrency: "GHS",
      outputCurrency: pair.symbol,
      chain: quoteChain,
      inputSide: "from",
    });
    if (!quoteRes.ok) {
      console.error("Quote failed:", quoteRes.error);
      return;
    }
    const t_amount = parseFloat(quoteRes.data.output.amount);
    const receiveSummary = `~${t_amount} ${pair.symbol} on ${pair.chainCode} (you pay ${ghsAmount} GHS)`;
    const createBody: Record<string, unknown> = {
      payerEmail: senderEmail,
      channels: ["EMAIL"],
      t_amount,
      t_chain: pair.chainCode,
      t_token: pair.symbol,
      toIdentifier: receiverEmail,
      receiveSummary,
      skipPaymentRequestNotification: true,
    };
    if (recipientWallet?.trim().startsWith("0x")) (createBody as Record<string, string>).payoutTarget = recipientWallet.trim();
    const createRes = await fetchJson("/api/requests", { method: "POST", body: JSON.stringify(createBody) });
    if (!createRes.ok) {
      console.error("Create failed:", (createRes.data as { error?: string })?.error ?? createRes.error);
      return;
    }
    const createData = createRes.data as { transactionId?: string; data?: { transactionId?: string } };
    const transactionId = createData.transactionId ?? createData.data?.transactionId;
    if (!transactionId) {
      console.error("No transaction ID in response.");
      return;
    }

    const sim = await question("Simulate payment (no real Paystack)? (Y/n): ") || "Y";
    if (sim.toLowerCase() !== "n" && sim.toLowerCase() !== "no") {
      const simRes = await fetchJson("/api/test/request/simulate-payment", {
        method: "POST",
        body: JSON.stringify({ transaction_id: transactionId }),
      });
      if (simRes.ok) {
        console.log("  Simulated. You get an email that you made the payment; recipient gets", recipientWallet?.trim().startsWith("0x") ? "crypto to wallet + email." : "claim (code + OTP) to receive.");
      } else {
        console.error("Simulate failed:", (simRes.data as { error?: string })?.error ?? simRes.error);
      }
      return;
    }

    const amountPesewas = Math.round(ghsAmount * 100);
    const initRes = await fetchJson("/api/paystack/payments/initialize", {
      method: "POST",
      body: JSON.stringify({ email: senderEmail, amount: amountPesewas, currency: "GHS", transaction_id: transactionId }),
    });
    if (!initRes.ok) {
      console.error("Initialize payment failed:", (initRes.data as { error?: string })?.error ?? initRes.error);
      return;
    }
    const initData = initRes.data as { authorization_url?: string; reference?: string };
    const paystackReference = initData.reference ?? "";
    console.log("\n--- Pay with Paystack ---");
    console.log("  GHS:", ghsAmount.toFixed(2));
    console.log("  URL:", initData.authorization_url);
    if (paystackReference) {
      console.log("  Reference (use this to verify if needed):", paystackReference);
    }
    console.log("  Open the URL, complete payment, then come back here.");
    const refInput = await question("Paste Paystack reference after paying (or Enter to verify using the reference above): ");
    const refToUse = refInput?.trim() || paystackReference;
    if (refToUse) {
      console.log("Verifying payment...");
      const verifyRes = await fetchJson(`/api/paystack/transactions/verify/${refToUse}`);
      if (!verifyRes.ok) {
        console.error("Verify failed:", verifyRes.error);
        return;
      }
      console.log("  Payment verified. Crypto sent (if wallet was provided); emails sent to both parties.");
    } else {
      console.log("No reference available. Polling transaction status...");
      for (let i = 0; i < 60; i++) {
        await sleep(2000);
        const txRes = await fetchJson(`/api/transactions/${transactionId}`);
        if (txRes.ok && txRes.data) {
          const status = (txRes.data as { status?: string }).status;
          if (status === "COMPLETED") {
            console.log("  Transaction COMPLETED.");
            break;
          }
          if (status === "FAILED") {
            console.error("Transaction FAILED.");
            return;
          }
        }
        if (i === 59) console.log("Timeout waiting for COMPLETED.");
      }
    }
    console.log("  You'll get an email that you made the payment to the recipient.");
    console.log("  Recipient will get", recipientWallet?.trim().startsWith("0x") ? "crypto to their wallet + email (with tx hash)." : "a claim (code + OTP) to receive the crypto.");
    return;
  }

  // Crypto: sender sends f_chain/f_token/f_amount; receiver gets t_chain/t_token (optional payoutTarget for immediate send)
  if (onchainPairs.length === 0) await loadChainsAndTokens();
  if (onchainPairs.length === 0) {
    console.error("No crypto pairs.");
    return;
  }
  console.log("What are you sending (chain + token)?");
  onchainPairs.forEach((p, i) => console.log(`  ${i + 1}. ${p.chainCode} / ${p.symbol}`));
  const fromIdx = parseInt(await question(`Choose (1-${onchainPairs.length}) [1]: `) || "1", 10);
  const fromPair = onchainPairs[Math.max(0, fromIdx - 1)] ?? onchainPairs[0]!;
  const sendAmountStr = await question(`Amount (${fromPair.symbol}) to send [25]: `) || "25";
  const f_amount = parseFloat(sendAmountStr);
  if (!Number.isFinite(f_amount) || f_amount <= 0) {
    console.error("Invalid amount.");
    return;
  }
  console.log("What should the recipient receive? (can be same or different token)");
  onchainPairs.forEach((p, i) => console.log(`  ${i + 1}. ${p.chainCode} / ${p.symbol}`));
  const toIdx = parseInt(await question(`Choose (1-${onchainPairs.length}) [1]: `) || "1", 10);
  const toPair = onchainPairs[Math.max(0, toIdx - 1)] ?? onchainPairs[0]!;
  const payoutTarget = await question("Recipient wallet for immediate send (0x... or Enter to let them claim later): ");
  const receiveSummary = `${f_amount} ${fromPair.symbol} on ${fromPair.chainCode} → recipient gets ${toPair.chainCode} ${toPair.symbol}`;
  const createBody: Record<string, unknown> = {
    payerEmail: senderEmail,
    channels: ["EMAIL"],
    t_amount: f_amount,
    t_chain: toPair.chainCode,
    t_token: toPair.symbol,
    toIdentifier: receiverEmail,
    receiveSummary,
    f_chain: fromPair.chainCode,
    f_token: fromPair.symbol,
    f_amount,
  };
  if (payoutTarget?.trim().startsWith("0x")) (createBody as Record<string, unknown>).payoutTarget = payoutTarget.trim();
  const createRes = await fetchJson("/api/requests", { method: "POST", body: JSON.stringify(createBody) });
  if (!createRes.ok) {
    console.error("Create failed:", (createRes.data as { error?: string })?.error ?? createRes.error);
    return;
  }
  const createData = createRes.data as { transactionId?: string; id?: string; data?: { transactionId?: string; id?: string } };
  const transactionId = createData.transactionId ?? createData.data?.transactionId;
  if (!transactionId) {
    console.error("No transaction ID in response.");
    return;
  }
  const calldataRes = await fetchJson(`/api/requests/calldata?transaction_id=${transactionId}`);
  if (!calldataRes.ok) {
    console.error("Calldata failed:", (calldataRes.data as { error?: string })?.error ?? calldataRes.error);
    return;
  }
  const calldata = calldataRes.data as { toAddress?: string; amount?: string; token?: string; chain?: string };
  console.log("\n--- Send crypto to platform ---");
  console.log("  To:", calldata.toAddress);
  console.log("  Amount:", calldata.amount, calldata.token);
  console.log("  Chain:", calldata.chain);
  console.log("  Send this, then paste the tx hash below.");
  const txHash = await question("Paste tx hash (0x...): ");
  if (!txHash?.trim()) {
    console.error("Tx hash required.");
    return;
  }
  const confirmRes = await fetchJson("/api/requests/confirm-crypto", {
    method: "POST",
    body: JSON.stringify({ transaction_id: transactionId, tx_hash: txHash.trim() }),
  });
  if (!confirmRes.ok) {
    console.error("Confirm failed:", (confirmRes.data as { error?: string })?.error ?? confirmRes.error);
    return;
  }
  if (payoutTarget?.trim().startsWith("0x")) {
    console.log("  Payment confirmed. Sent to recipient; both parties notified by email.");
  } else {
    console.log("  Payment confirmed. Recipient will get claim (code + OTP) by email. They use menu (4) Claim to receive.");
  }
}

// --- (4) Claim ---
async function runClaim(): Promise<void> {
  console.log("\n--- Claim (recipient) ---");
  const claimCode = await question("Claim code (6 characters, e.g. T8NWAZ): ");
  if (!claimCode || claimCode.length < 4) {
    console.error("Valid claim code required.");
    return;
  }
  const codeNorm = claimCode.trim().toUpperCase();
  const byCodeRes = await fetchJson(`/api/claims/by-code/${codeNorm}`);
  if (!byCodeRes.ok) {
    console.error("Claim not found:", byCodeRes.error);
    return;
  }
  const claimData = byCodeRes.data as {
    id?: string;
    code?: string;
    value?: string;
    token?: string;
    toIdentifier?: string;
    otpVerified?: boolean;
    request?: { transaction?: { status?: string } };
  };
  console.log("  Value:", claimData.value, claimData.token);
  console.log("  Recipient:", claimData.toIdentifier);
  if (claimData.otpVerified) {
    console.log("  OTP already verified.");
  } else {
    const otp = await question("Enter OTP from email/SMS: ");
    if (!otp) {
      console.error("OTP required.");
      return;
    }
    const verifyRes = await fetchJson("/api/claims/verify-otp", {
      method: "POST",
      body: JSON.stringify({ code: codeNorm, otp }),
    });
    if (!verifyRes.ok) {
      console.error("Verify OTP failed:", (verifyRes.data as { error?: string })?.error ?? verifyRes.error);
      return;
    }
    console.log("  OTP verified. You can now claim.");
  }

  const payoutType = await question("Payout type: (1) crypto  (2) fiat [1]: ") || "1";
  const payoutTypeVal = payoutType === "2" ? "fiat" : "crypto";
  const payoutTarget = await question(
    payoutTypeVal === "crypto" ? "Receiving wallet address (0x...): " : "Payout target (e.g. mobile number): "
  );
  if (!payoutTarget) {
    console.error("Payout target required.");
    return;
  }

  const claimRes = await fetchJson("/api/claims/claim", {
    method: "POST",
    body: JSON.stringify({ code: codeNorm, payout_type: payoutTypeVal, payout_target: payoutTarget }),
  });
  if (!claimRes.ok) {
    console.error("Claim failed:", (claimRes.data as { error?: string })?.error ?? claimRes.error);
    return;
  }
  const result = claimRes.data as { claim_id?: string; transaction_id?: string; message?: string };
  console.log("  Claim completed.");
  console.log("  claim_id:", result.claim_id);
  console.log("  transaction_id:", result.transaction_id);
  console.log("  message:", result.message);
}

// --- Main ---
async function main(): Promise<void> {
  console.log("E2E CLI — Request & Claim flow\n");

  const health = await fetchJson("/api/health");
  if (!health.ok) {
    console.error("Health check failed. Is the server running at", CORE_URL, "? Start with: pnpm dev");
    rl.close();
    process.exit(1);
  }

  await loadChainsAndTokens();

  for (;;) {
    console.log("\n--- Menu ---");
    console.log("  (1) Make a payment request");
    console.log("  (2) Pay a request");
    console.log("  (3) Make a payment");
    console.log("  (4) Claim");
    console.log("  (q) Quit");
    const choice = await question("Choice [1]: ") || "1";
    if (choice.toLowerCase() === "q" || choice.toLowerCase() === "quit") {
      console.log("Bye.");
      break;
    }
    if (choice === "1") await runMakeRequest();
    else if (choice === "2") await runPayRequest();
    else if (choice === "3") await runMakePayment();
    else if (choice === "4") await runClaim();
    else console.log("Unknown option.");
  }
  rl.close();
}

main().catch((err) => {
  console.error(err);
  rl.close();
  process.exit(1);
});
