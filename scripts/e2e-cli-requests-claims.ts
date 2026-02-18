#!/usr/bin/env node
/**
 * E2E CLI — request & claim flow (like e2e-cli for onramp/offramp).
 *
 * Flow:
 * 1. Create payment request (POST /api/requests) → pay link + claim code
 * 2. Either simulate payment (test) or wait for real payment
 * 3. Verify OTP (POST /api/claims/verify-otp)
 * 4. Complete claim (POST /api/claims/claim) with payout type and target
 *
 * Usage: pnpm run e2e:cli:requests-claims
 * Env: CORE_URL (default http://localhost:4000), CORE_API_KEY (required for create + simulate).
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

async function main(): Promise<void> {
  console.log("E2E CLI — Request & Claim flow\n");

  const health = await fetchJson("/api/health");
  if (!health.ok) {
    console.error("Health check failed. Is the server running at", CORE_URL, "? Start with: pnpm dev");
    rl.close();
    process.exit(1);
  }

  if (!CORE_API_KEY) {
    console.error("CORE_API_KEY is required for creating requests and (optionally) simulating payment.");
    rl.close();
    process.exit(1);
  }

  // --- 1. Create request ---
  const payerEmail = await question("Payer email [payer@example.com]: ") || "payer@example.com";
  const payerPhone = await question("Payer phone (optional) [+233541234567]: ") || "";
  const tAmountStr = await question("Amount to request (e.g. 25) [25]: ") || "25";
  const tAmount = parseFloat(tAmountStr);
  if (!Number.isFinite(tAmount) || tAmount <= 0) {
    console.error("Invalid amount.");
    rl.close();
    process.exit(1);
  }
  const tChain = await question("Chain (e.g. BASE) [BASE]: ") || "BASE";
  const tToken = await question("Token (e.g. USDC) [USDC]: ") || "USDC";
  const toIdentifier = await question("Recipient (email or phone for claim notification) [receiver@example.com]: ") || "receiver@example.com";
  const receiveSummary = await question("Receive summary (e.g. 25 USDC on Base) [auto]: ") || `${tAmount} ${tToken} on ${tChain}`;

  const createRes = await fetchJson("/api/requests", {
    method: "POST",
    body: JSON.stringify({
      payerEmail,
      payerPhone: payerPhone || undefined,
      channels: ["EMAIL"],
      t_amount: tAmount,
      t_chain: tChain,
      t_token: tToken,
      toIdentifier,
      receiveSummary,
    }),
  });

  if (!createRes.ok) {
    console.error("Create request failed:", (createRes.data as { error?: string })?.error ?? createRes.error);
    rl.close();
    process.exit(1);
  }

  const createData = createRes.data as {
    id?: string;
    linkId?: string;
    transactionId?: string;
    claimId?: string;
    claimCode?: string;
    payLink?: string;
    notification?: Record<string, { ok?: boolean; error?: string }>;
  };

  const requestId = createData.id;
  const linkId = createData.linkId;
  const transactionId = createData.transactionId;
  const claimCode = createData.claimCode ?? "";

  console.log("\n--- Request created ---");
  console.log("  requestId:", requestId);
  console.log("  linkId:", linkId);
  console.log("  transactionId:", transactionId);
  console.log("  claimCode:", claimCode);
  console.log("  payLink:", createData.payLink);
  if (createData.notification) {
    console.log("  notification:", Object.entries(createData.notification).map(([k, v]) => `${k}: ${v?.ok ? "ok" : v?.error ?? "—"}`).join(", "));
  }

  if (!transactionId || !claimCode) {
    console.error("Missing transactionId or claimCode in response.");
    rl.close();
    process.exit(1);
  }

  // --- 2. Payment: simulate or real ---
  let otp: string;
  const simulate = await question("\nSimulate payment (test endpoint, no real Paystack)? (Y/n): ");
  const doSimulate = simulate.toLowerCase() !== "n" && simulate.toLowerCase() !== "no";

  if (doSimulate) {
    const simRes = await fetchJson("/api/test/request/simulate-payment", {
      method: "POST",
      body: JSON.stringify({ transaction_id: transactionId }),
    });
    if (!simRes.ok) {
      console.error("Simulate payment failed:", (simRes.data as { error?: string })?.error ?? simRes.error);
      rl.close();
      process.exit(1);
    }
    const simData = simRes.data as { claimCode?: string; otp?: string; already_completed?: boolean };
    otp = simData.otp ?? "";
    if (simData.already_completed) {
      console.log("  Transaction was already COMPLETED. OTP may be expired; use the one from email if you already claimed.");
    }
    if (!otp) {
      console.error("No OTP returned (maybe already consumed or expired). Use real payment flow and enter OTP from email.");
      rl.close();
      process.exit(1);
    }
    console.log("  Simulated payment. OTP (for next step):", otp);
  } else {
    console.log("\nWhen the payer has paid via the link, the transaction will move to COMPLETED (via Paystack webhook).");
    console.log("Polling transaction status...");
    for (let i = 0; i < 30; i++) {
      await sleep(2000);
      const txRes = await fetchJson(`/api/transactions/${transactionId}`);
      if (txRes.ok && txRes.data) {
        const status = (txRes.data as { status?: string }).status;
        console.log("  Status:", status);
        if (status === "COMPLETED") break;
        if (status === "FAILED") {
          console.error("Transaction FAILED.");
          rl.close();
          process.exit(1);
        }
      }
    }
    otp = await question("Enter the OTP the recipient received (email/SMS): ");
    if (!otp) {
      console.error("OTP required to continue.");
      rl.close();
      process.exit(1);
    }
  }

  // --- 3. Verify OTP ---
  console.log("\n--- Verify OTP ---");
  const verifyRes = await fetchJson("/api/claims/verify-otp", {
    method: "POST",
    body: JSON.stringify({ code: claimCode, otp }),
  });
  if (!verifyRes.ok) {
    console.error("Verify OTP failed:", (verifyRes.data as { error?: string })?.error ?? verifyRes.error);
    rl.close();
    process.exit(1);
  }
  console.log("  OTP verified. You can now claim.");

  // --- 4. Complete claim ---
  console.log("\n--- Complete claim ---");
  const payoutType = await question("Payout type: (1) crypto  (2) fiat [1]: ") || "1";
  const payoutTypeVal = payoutType === "2" ? "fiat" : "crypto";
  const payoutTarget = await question(
    payoutTypeVal === "crypto"
      ? "Receiving wallet address (e.g. 0x...): "
      : "Payout target (e.g. mobile number 233...): "
  );
  if (!payoutTarget) {
    console.error("Payout target required.");
    rl.close();
    process.exit(1);
  }

  const claimRes = await fetchJson("/api/claims/claim", {
    method: "POST",
    body: JSON.stringify({
      code: claimCode,
      payout_type: payoutTypeVal,
      payout_target: payoutTarget,
    }),
  });
  if (!claimRes.ok) {
    console.error("Claim failed:", (claimRes.data as { error?: string })?.error ?? claimRes.error, (claimRes.data as { code?: string })?.code ?? "");
    rl.close();
    process.exit(1);
  }
  const claimData = claimRes.data as { claimed?: boolean; claim_id?: string; transaction_id?: string; message?: string };
  console.log("  Claim completed.");
  console.log("  claim_id:", claimData.claim_id);
  console.log("  transaction_id:", claimData.transaction_id);
  console.log("  message:", claimData.message);

  console.log("\nDone. Request & claim E2E flow complete.");
  rl.close();
}

main().catch((err) => {
  console.error(err);
  rl.close();
  process.exit(1);
});
