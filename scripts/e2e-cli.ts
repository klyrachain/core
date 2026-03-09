#!/usr/bin/env node
/**
 * E2E CLI — simulates the full onramp/offramp flow interactively.
 *
 * Flow:
 * 1. Select Onramp or Offramp
 * 2. Select token + chain (from supported pairs)
 * 3. Select amount type: fiat or crypto
 * 4. Enter amount → get quote (POST /api/v1/quotes)
 * 5. Optionally wait 30s and refresh quote
 * 6. Proceed with transaction? Y/N
 * 7. If Onramp: create order → get Paystack URL → you pay → we verify + poll until COMPLETED → transfer (inventory deducted when webhook runs)
 * 8. If Offramp: create order → instructions (inventory/transfer when crypto is received)
 *
 * Usage: pnpm run e2e:cli
 * Env: CORE_URL (default http://localhost:4000), CORE_API_KEY (required for Paystack init + transactions read).
 *       E2E_NETWORK=testnet | mainnet — testnet: only Base Sepolia etc.; mainnet: only Base, Ethereum, etc. Default: testnet.
 *
 * Note: For onramp completion, Paystack must be able to reach your webhook (e.g. ngrok). Otherwise transaction won't move to COMPLETED and executeOnrampSend won't run.
 */

import "dotenv/config";
import * as readline from "readline";

const CORE_URL = (process.env.CORE_URL ?? "http://localhost:4000").replace(/\/$/, "");
const CORE_API_KEY = process.env.CORE_API_KEY ?? "";
const E2E_NETWORK = (process.env.E2E_NETWORK ?? "testnet").toLowerCase();
const IS_TESTNET = E2E_NETWORK === "testnet";
/** Chain IDs considered testnet (e.g. Base Sepolia). E2E_NETWORK=testnet filters to these. */
const TESTNET_CHAIN_IDS = new Set([84532]);

type SupportedPair = { chainCode: string; chainId: number; symbol: string; displaySymbol: string };
let onchainPairs: SupportedPair[] = [];
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
      if (text.trimStart().startsWith("<")) {
        return {
          ok: false,
          status: res.status,
          error: `Server returned HTML instead of JSON (status ${res.status}). Check that CORE_URL points to the core API (e.g. http://localhost:4000) and CORE_API_KEY has permission for this endpoint.`,
        };
      }
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

async function loadChainsAndTokens(): Promise<void> {
  const [chainsRes, tokensRes] = await Promise.all([
    fetchJson("/api/chains"),
    fetchJson("/api/tokens"),
  ]);
  const chains = (chainsRes.data as { chains?: Array<{ chainId: string | number; name: string }> })?.chains ?? [];
  const tokens = (tokensRes.data as {
    tokens?: Array<{ chainId: string | number; symbol: string; networkName?: string; displaySymbol?: string }>;
  })?.tokens ?? [];
  const chainIdToCode = new Map(chains.map((c) => [String(c.chainId), c.name.toUpperCase()]));
  const fiatCodes = ["MOMO", "BANK", "CARD"];
  let pairs: SupportedPair[] = (tokens as Array<{ chainId: string | number; symbol: string; networkName?: string; displaySymbol?: string }>)
    .map((t) => {
      const chainIdStr = String(t.chainId);
      const chainIdNum = Number(t.chainId);
      const chainCode = chainIdToCode.get(chainIdStr) ?? "";
      const displaySymbol =
        (t.displaySymbol ?? (t.networkName ? `${t.networkName} ${t.symbol}`.trim() : `${chainCode} ${t.symbol}`.trim())) || t.symbol;
      return {
        chainCode,
        chainId: chainIdNum,
        symbol: t.symbol,
        displaySymbol,
      };
    })
    .filter((p) => p.chainCode && !fiatCodes.includes(p.chainCode));
  if (IS_TESTNET) {
    pairs = pairs.filter((p) => TESTNET_CHAIN_IDS.has(p.chainId));
  } else {
    pairs = pairs.filter((p) => !TESTNET_CHAIN_IDS.has(p.chainId));
  }
  onchainPairs = pairs;
}

type QuoteData = {
  quoteId: string;
  expiresAt: string;
  exchangeRate: string;
  basePrice?: string;
  input: { amount: string; currency: string };
  output: { amount: string; currency: string; chain?: string };
  fees: { networkFee: string; platformFee: string; totalFee: string };
  debug?: { basePrice: string };
};

async function getQuote(opts: {
  action: "ONRAMP" | "OFFRAMP";
  inputAmount: string;
  inputCurrency: string;
  outputCurrency: string;
  chain: string;
  inputSide?: "from" | "to";
}): Promise<{ ok: true; data: QuoteData } | { ok: false; error: string; code?: string; status: number }> {
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
  if (!res.ok) {
    return {
      ok: false,
      error: res.error ?? "Unknown error",
      code: res.code,
      status: res.status,
    };
  }
  const data = res.data as QuoteData | undefined;
  if (!data?.quoteId || !data.input || !data.output || !data.fees) {
    return { ok: false, error: "Invalid quote response", status: res.status ?? 400 };
  }
  return { ok: true, data };
}

function printQuote(data: QuoteData, label: string): void {
  console.log(`\n--- ${label} ---`);
  console.log(`  quoteId    ${data.quoteId}`);
  console.log(`  expiresAt  ${data.expiresAt}`);
  console.log(`  input      ${data.input.amount} ${data.input.currency}`);
  console.log(`  output     ${data.output.amount} ${data.output.currency}${data.output.chain ? ` (${data.output.chain})` : ""}`);
  console.log(`  rate       ${data.exchangeRate}`);
  console.log(`  fees       network ${data.fees.networkFee}  platform ${data.fees.platformFee}  total ${data.fees.totalFee}`);
  console.log("");
}

async function submitOrder(opts: {
  action: "buy" | "sell";
  f_amount: number;
  t_amount: number;
  f_price: number;
  t_price: number;
  f_chain: string;
  t_chain: string;
  f_token: string;
  t_token: string;
  quoteId?: string;
  providerPrice?: number;
  fromIdentifier?: string;
  toIdentifier?: string;
  fromType?: string;
  toType?: string;
  /** Use test endpoints (testnet-only). When true, sell → /api/test/offramp/order, buy → /api/test/onramp/order. */
  isTestnet?: boolean;
}): Promise<{ ok: true; orderId: string } | { ok: false; error: string; code?: string }> {
  const payload: Record<string, unknown> = {
    action: opts.action,
    fromIdentifier: opts.fromIdentifier ?? "alice@example.com",
    fromType: opts.fromType ?? "EMAIL",
    toIdentifier: opts.toIdentifier ?? "0xf0830060f836B8d54bF02049E5905F619487989e",
    toType: opts.toType ?? "ADDRESS",
    f_amount: opts.f_amount,
    t_amount: opts.t_amount,
    f_price: opts.f_price,
    t_price: opts.t_price,
    f_chain: opts.f_chain,
    t_chain: opts.t_chain,
    f_token: opts.f_token,
    t_token: opts.t_token,
    f_provider: opts.f_chain === "MOMO" || opts.f_chain === "BANK" ? "PAYSTACK" : "KLYRA",
    t_provider: opts.t_chain === "MOMO" || opts.t_chain === "BANK" ? "PAYSTACK" : "KLYRA",
  };
  if (opts.quoteId) payload.quoteId = opts.quoteId;
  if (opts.providerPrice != null && Number.isFinite(opts.providerPrice)) payload.providerPrice = opts.providerPrice;

  const orderPath =
    opts.isTestnet && opts.action === "sell"
      ? "/api/test/offramp/order"
      : opts.isTestnet && opts.action === "buy"
        ? "/api/test/onramp/order"
        : "/webhook/order";
  const res = await fetchJson(orderPath, { method: "POST", body: JSON.stringify(payload) });
  if (!res.ok) {
    return { ok: false, error: res.error ?? "Order failed", code: res.code };
  }
  const body = res.data as { id?: string } | undefined;
  const id = body?.id ?? (res as { data?: { id?: string } }).data?.id;
  if (!id) return { ok: false, error: "No transaction id in response" };
  return { ok: true, orderId: id };
}

async function getTransaction(id: string): Promise<{ ok: true; status: string; cryptoSendTxHash?: string | null } | { ok: false; error: string }> {
  const res = await fetchJson(`/api/transactions/${id}`);
  if (!res.ok) return { ok: false, error: res.error ?? "Not found" };
  const t = res.data as { status?: string; cryptoSendTxHash?: string | null } | undefined;
  return { ok: true, status: t?.status ?? "UNKNOWN", cryptoSendTxHash: t?.cryptoSendTxHash ?? null };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  console.log("E2E CLI — Onramp/Offramp flow\n");
  const health = await fetchJson("/api/health");
  if (!health.ok) {
    console.error("Health check failed. Is the server running at", CORE_URL, "? Start with: pnpm dev");
    process.exit(1);
  }
  await loadChainsAndTokens();
  if (onchainPairs.length === 0) {
    console.error(
      `No onchain token pairs for E2E_NETWORK=${E2E_NETWORK}. Seed chains/tokens (e.g. SEED_ALL=1 pnpm run db:seed-chains-tokens) and ensure /api/chains and /api/tokens return data for this network.`
    );
    process.exit(1);
  }
  console.log(`E2E network: ${E2E_NETWORK} (${onchainPairs.length} pairs)`);

  const flow = await question("Select flow: (1) Onramp  (2) Offramp  [1]: ") || "1";
  const isOnramp = flow !== "2";

  console.log("\nSupported chain + token (or type display symbol e.g. BASE USDC):");
  onchainPairs.forEach((p, i) => console.log(`  ${i + 1}. ${p.displaySymbol}`));
  const choice = await question(`Choose (1-${onchainPairs.length}) or type symbol [1]: `) || "1";
  const pairIdx = parseInt(choice, 10);
  const pairByIndex = Number.isFinite(pairIdx) && pairIdx >= 1 && pairIdx <= onchainPairs.length
    ? onchainPairs[pairIdx - 1]
    : null;
  const pairBySymbol = !pairByIndex
    ? onchainPairs.find((p) => p.displaySymbol.toUpperCase() === choice.trim().toUpperCase())
    : null;
  const pair = pairByIndex ?? pairBySymbol ?? onchainPairs[0]!;
  if (!pairByIndex && pairBySymbol) {
    console.log(`  Using: ${pair.displaySymbol}`);
  }

  // API supports only inputSide "from": Onramp = amount in fiat, Offramp = amount in crypto.
  const amountPrompt = isOnramp
    ? "Enter fiat amount (GHS) you will pay: "
    : `Enter crypto amount (${pair.symbol}) you are selling: `;
  const amountStr = await question(amountPrompt);
  const amount = parseFloat(amountStr);
  if (!Number.isFinite(amount) || amount <= 0) {
    console.error("Invalid amount.");
    rl.close();
    process.exit(1);
  }

  const action: "ONRAMP" | "OFFRAMP" = isOnramp ? "ONRAMP" : "OFFRAMP";
  const inputCurrency = isOnramp ? "GHS" : pair.symbol;
  const outputCurrency = isOnramp ? pair.symbol : "GHS";
  const inputSide = "from" as const;

  // For testnet (e.g. Base Sepolia), fetch quote using mainnet chain name so we get real market rates; execution still uses testnet.
  const quoteChain = IS_TESTNET && pair.chainCode === "BASE SEPOLIA" ? "BASE" : pair.chainCode;
  if (IS_TESTNET && pair.chainCode === "BASE SEPOLIA") {
    console.log("(Quoting with BASE for real rates; you will send on Base Sepolia.)");
  }

  const quoteResult = await getQuote({
    action,
    inputAmount: amountStr,
    inputCurrency,
    outputCurrency,
    chain: quoteChain,
    inputSide,
  });

  if (!quoteResult.ok) {
    console.error("Quote failed:", quoteResult.error, quoteResult.code ? `(${quoteResult.code})` : "");
    rl.close();
    process.exit(1);
  }

  const quoteData = quoteResult.data;
  printQuote(quoteData, "Quote");

  const refresh = await question("Refresh quote in 30 seconds? (y/N): ");
  if (refresh.toLowerCase() === "y" || refresh.toLowerCase() === "yes") {
    console.log("Waiting 30s...");
    await sleep(30000);
    const again = await getQuote({
      action,
      inputAmount: amountStr,
      inputCurrency,
      outputCurrency,
      chain: quoteChain,
      inputSide,
    });
    if (again.ok) printQuote(again.data, "Quote (after 30s)");
    else console.log("Refresh failed:", again.error);
  }

  const proceedPrompt = isOnramp
    ? "Create order and get Paystack payment link? (y/N): "
    : "Create order and continue to offramp flow? (y/N): ";
  const proceed = await question(proceedPrompt);
  if (proceed.toLowerCase() !== "y" && proceed.toLowerCase() !== "yes") {
    console.log("Exiting. (Say 'y' to create the order and get the Paystack link / complete the flow.)");
    rl.close();
    process.exit(0);
  }

  const f_amount = parseFloat(quoteData.input.amount);
  const t_amount = parseFloat(quoteData.output.amount);
  const exchangeRate = parseFloat(quoteData.exchangeRate);
  const basePrice = quoteData.basePrice ?? quoteData.debug?.basePrice;
  const providerPrice = basePrice != null ? parseFloat(basePrice) : undefined;

  if (CORE_API_KEY) {
    const syncRes = await fetchJson("/api/cache/sync-balances", { method: "POST" });
    if (syncRes.ok) {
      console.log("Synced inventory balances to cache (so order validation sees DB balances).");
    }
  }

  if (isOnramp) {
    const fromIdentifier = await question("Payer email (for Paystack) [alice@example.com]: ") || "alice@example.com";
    const toIdentifier = await question("Receiving wallet address [0xf0830060f836B8d54bF02049E5905F619487989e]: ") || "0xf0830060f836B8d54bF02049E5905F619487989e";

    const orderRes = await submitOrder({
      action: "buy",
      f_amount,
      t_amount,
      f_price: 1,
      t_price: exchangeRate,
      f_chain: "MOMO",
      t_chain: pair.chainCode,
      f_token: "GHS",
      t_token: pair.symbol,
      quoteId: quoteData.quoteId,
      providerPrice,
      fromIdentifier,
      toIdentifier,
      fromType: "EMAIL",
      toType: "ADDRESS",
      isTestnet: IS_TESTNET,
    });

    if (!orderRes.ok) {
      console.error("Order failed:", orderRes.error);
      rl.close();
      process.exit(1);
    }
    console.log("\nOrder created. Transaction id:", orderRes.orderId);

    if (!CORE_API_KEY) {
      console.log("CORE_API_KEY not set. Paystack initialize and transaction status require an API key. Set it and run again for full flow.");
      rl.close();
      process.exit(0);
    }

    const initRes = await fetchJson("/api/paystack/payments/initialize", {
      method: "POST",
      body: JSON.stringify({
        email: fromIdentifier,
        amount: Math.round(f_amount * 100),
        currency: "GHS",
        transaction_id: orderRes.orderId,
      }),
    });

    if (!initRes.ok) {
      const msg = (initRes.data as { error?: string })?.error ?? initRes.error ?? "Unknown error";
      console.error(`Paystack initialize failed (${initRes.status}):`, msg);
      rl.close();
      process.exit(1);
    }

    const initData = initRes.data as { authorization_url?: string; reference?: string; transaction_id?: string };
    const payUrl = initData?.authorization_url ?? "";
    const reference = initData?.reference ?? "";

    console.log("\n--- Paystack payment ---");
    console.log("  Open this URL to pay:", payUrl);
    console.log("  Reference:", reference);
    await question("\nPress Enter after you have completed payment (or Ctrl+C to exit)...");

    const verifyRes = await fetchJson(`/api/paystack/transactions/verify/${reference}`);
    if (verifyRes.ok) {
      console.log("  Verify: success.");
    } else {
      console.log("  Verify response:", verifyRes.error ?? verifyRes.data);
    }

    console.log("\nPolling transaction status (webhook will set COMPLETED when Paystack notifies us)...");
    for (let i = 0; i < 24; i++) {
      await sleep(5000);
      const tx = await getTransaction(orderRes.orderId);
      if (!tx.ok) {
        console.log("  Failed to fetch transaction:", tx.error);
        continue;
      }
      console.log(`  Status: ${tx.status}`);
      if (tx.status === "COMPLETED") {
        console.log("\nTransaction COMPLETED. Waiting for crypto send (Base Sepolia USDC)...");
        let hash: string | null | undefined = tx.cryptoSendTxHash ?? null;
        for (let j = 0; j < 8 && !hash; j++) {
          await sleep(2000);
          const txAgain = await getTransaction(orderRes.orderId);
          hash = txAgain.ok ? txAgain.cryptoSendTxHash ?? null : null;
        }
        if (hash) {
          console.log("  Crypto send txHash:", hash);
          console.log("  Base Sepolia explorer: https://sepolia.basescan.org/tx/" + hash);
        } else {
          console.log("  No cryptoSendTxHash. Ensure the server (that receives Paystack webhook) has in .env: ONRAMP_TESTNET_SEND=1 and TESTNET_SEND_PRIVATE_KEY=0x...");
          console.log("  Wallet must hold Base Sepolia USDC (0x036CbD53842c5426634e7929541eC2318f3dCF7e) and Base Sepolia ETH for gas. Check server logs for [onramp] Testnet send.");
        }
        rl.close();
        process.exit(0);
      }
      if (tx.status === "FAILED") {
        console.log("\nTransaction FAILED.");
        rl.close();
        process.exit(1);
      }
    }
    console.log("\nTimeout waiting for COMPLETED. Ensure Paystack webhook URL is reachable (e.g. ngrok) so charge.success can be received.");
  } else {
    const fromIdentifier = await question("Sender wallet address [0xf0830060f836B8d54bF02049E5905F619487989e]: ") || "0xf0830060f836B8d54bF02049E5905F619487989e";
    const toIdentifier = await question("Recipient for payout (mobile money). Test mode: use Paystack test numbers (e.g. Airtel 233541234567=pass, MTN 233201234567=fail) [233541234567]: ") || "233541234567";

    const orderRes = await submitOrder({
      action: "sell",
      f_amount,
      t_amount,
      f_price: exchangeRate,
      t_price: 1,
      f_chain: pair.chainCode,
      t_chain: "MOMO",
      f_token: pair.symbol,
      t_token: "GHS",
      quoteId: quoteData.quoteId,
      providerPrice,
      fromIdentifier,
      toIdentifier,
      fromType: "ADDRESS",
      toType: "NUMBER",
      isTestnet: IS_TESTNET,
    });

    if (!orderRes.ok) {
      console.error("Order failed:", orderRes.error);
      rl.close();
      process.exit(1);
    }
    console.log("\nOfframp order created. Transaction id:", orderRes.orderId);

    if (!CORE_API_KEY) {
      console.log("CORE_API_KEY required for calldata and confirm. Set it and run again.");
      rl.close();
      process.exit(0);
    }

    const calldataRes = await fetchJson(`/api/offramp/calldata?transaction_id=${orderRes.orderId}`);
    if (!calldataRes.ok || !calldataRes.data) {
      console.error("Calldata failed:", (calldataRes.data as { error?: string })?.error ?? calldataRes.error);
      rl.close();
      process.exit(1);
    }
    const calldata = calldataRes.data as {
      toAddress: string;
      chainId: number;
      chain: string;
      token: string;
      tokenAddress: string;
      amount: string;
      decimals: number;
    };
    console.log("\n--- Send crypto to platform ---");
    console.log("  To (platform receiving wallet):", calldata.toAddress);
    console.log("  Chain:", calldata.chain, "(chainId:", calldata.chainId + ")");
    if (calldata.chain === "BASE") console.log("  Note: BASE = mainnet. Send on Base mainnet only. For testnet use BASE SEPOLIA in the chain list.");
    console.log("  Token:", calldata.token, calldata.tokenAddress);
    console.log("  Amount:", calldata.amount, calldata.token);
    console.log("  Send this amount from your wallet to the address above; then paste the transaction hash here.");
    const txHashInput = await question("\nTransaction hash (0x...): ");
    const txHash = txHashInput.trim();
    if (!txHash) {
      console.log("No tx hash provided. Exiting. You can call POST /api/offramp/confirm later with transaction_id and tx_hash.");
      rl.close();
      process.exit(0);
    }

    const verifyRes = await fetchJson(
      `/api/transactions/verify-by-hash?chain=${encodeURIComponent(calldata.chain.replace(/\s+/g, " "))}&tx_hash=${encodeURIComponent(txHash)}`
    );
    if (verifyRes.ok && verifyRes.data) {
      const v = verifyRes.data as { status: string; transfers?: Array<{ token: string; from: string; to: string; valueRaw: string }> };
      console.log("  Verify-by-hash: status =", v.status);
      if (v.transfers?.length) {
        console.log("  ERC20 transfers:", v.transfers.length);
        v.transfers.forEach((t, i) => console.log(`    ${i + 1}. ${t.token} from ${t.from} → ${t.to} value=${t.valueRaw}`));
      }
    } else {
      const verifyErr = (verifyRes.data as { error?: string })?.error ?? verifyRes.error;
      console.log("  Verify-by-hash failed:", verifyErr);
      if (typeof verifyErr === "string" && verifyErr.includes("could not be found")) {
        console.log("  Tip: If you sent on Base Sepolia, choose BASE SEPOLIA in the chain list (not BASE).");
      }
    }

    const confirmRes = await fetchJson("/api/offramp/confirm", {
      method: "POST",
      body: JSON.stringify({ transaction_id: orderRes.orderId, tx_hash: txHash }),
    });
    if (!confirmRes.ok) {
      console.error("Confirm failed:", (confirmRes.data as { error?: string })?.error ?? confirmRes.error);
      rl.close();
      process.exit(1);
    }
    console.log("\nOfframp confirmed. On-chain transfer verified. Transaction completed.");

    // Request fiat payout and optionally execute so the full offramp (crypto received + fiat sent) completes.
    const requestPayoutRes = await fetchJson("/api/paystack/payouts/request", {
      method: "POST",
      body: JSON.stringify({ transaction_id: orderRes.orderId }),
    });
    if (!requestPayoutRes.ok) {
      console.log("Payout request failed (Paystack may not be configured):", (requestPayoutRes.data as { error?: string })?.error ?? requestPayoutRes.error);
      console.log("Full offramp: on-chain done. Request payout manually via POST /api/paystack/payouts/request then execute.");
      rl.close();
      return;
    }
    const payoutData = requestPayoutRes.data as { code?: string };
    const payoutCode = payoutData?.code;
    if (!payoutCode) {
      console.log("Payout requested but no code returned. Use POST /api/paystack/payouts/execute with the code from the request response.");
      rl.close();
      return;
    }
    const ghsAmountPesewas = Math.round(parseFloat(quoteData.output.amount) * 100);
    const executeRes = await fetchJson("/api/paystack/payouts/execute", {
      method: "POST",
      body: JSON.stringify({
        code: payoutCode,
        amount: ghsAmountPesewas,
        currency: "GHS",
        recipient_type: "mobile_money",
        name: "E2E Offramp",
        account_number: toIdentifier,
        bank_code: "MTN",
      }),
    });
    if (executeRes.ok) {
      const execData = executeRes.data as { reference?: string };
      console.log("Payout executed. Full offramp complete (crypto received + fiat payout sent).");
      if (execData?.reference) console.log("  Transfer reference:", execData.reference);
    } else {
      console.log("Payout execute failed:", (executeRes.data as { error?: string })?.error ?? executeRes.error);
      console.log("  Payout code:", payoutCode, "— complete manually via POST /api/paystack/payouts/execute.");
    }
  }

  rl.close();
}

main().catch((err) => {
  console.error(err);
  rl.close();
  process.exit(1);
});
