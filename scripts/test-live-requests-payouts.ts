#!/usr/bin/env node
/**
 * Live test — requests and payouts (payment request creation + notification, claim flow).
 * 1. POST /api/notification/channels — list channels
 * 2. POST /api/requests — create payment request (notifies payer via email/SMS)
 * 3. GET /api/requests/by-link/:linkId — load request by link (pay page)
 * 4. GET /api/claims/by-code/:code — load claim by code
 * 5. POST /api/claims/verify-otp — verify OTP
 * 6. POST /api/claims/claim — complete claim (crypto or fiat)
 *
 * Usage: pnpm run test:live:requests-payouts
 * Env: CORE_URL (default http://localhost:4000), CORE_API_KEY (required for create/list).
 */

import "dotenv/config";

const CORE_URL = (process.env.CORE_URL ?? "http://localhost:4000").replace(/\/$/, "");
const CORE_API_KEY = process.env.CORE_API_KEY ?? "";

async function fetchJson(
  path: string,
  options?: RequestInit
): Promise<{ ok: boolean; status: number; data?: unknown; error?: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };
  if (CORE_API_KEY) headers["x-api-key"] = CORE_API_KEY;
  const res = await fetch(`${CORE_URL}${path}`, { ...options, headers });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  const data = (body as { data?: unknown }).data ?? body;
  const error = (body as { error?: string }).error;
  return { ok: res.ok, status: res.status, data, error };
}

async function main(): Promise<void> {
  console.log("Live test — Requests & Payouts\n");
  if (!CORE_API_KEY) {
    console.log("CORE_API_KEY not set. Set it for create/list requests.");
  }

  // 1. Notification channels
  const channelsRes = await fetchJson("/api/notification/channels");
  if (channelsRes.ok && channelsRes.data) {
    const d = channelsRes.data as { channels?: Array<{ code: string; label: string; configured: boolean }> };
    console.log("Notification channels:", d.channels ?? []);
  } else {
    console.log("Channels failed:", channelsRes.error ?? channelsRes.status);
  }

  // 2. Create payment request
  const createRes = await fetchJson("/api/requests", {
    method: "POST",
    body: JSON.stringify({
      payerEmail: "payer@example.com",
      payerPhone: "+233541234567",
      channels: ["EMAIL"],
      t_amount: 25,
      t_chain: "BASE",
      t_token: "USDC",
      toIdentifier: "receiver@example.com",
      receiveSummary: "25 USDC on Base",
    }),
  });

  if (!createRes.ok) {
    console.log("Create request failed:", createRes.error ?? createRes.data);
    process.exit(1);
  }

  const createData = createRes.data as {
    id?: string;
    code?: string;
    linkId?: string;
    transactionId?: string;
    claimId?: string;
    claimCode?: string;
    payLink?: string;
    notification?: Record<string, { ok?: boolean; error?: string }>;
  };
  console.log("\nRequest created:");
  console.log("  requestId:", createData.id);
  console.log("  linkId:", createData.linkId);
  console.log("  claimCode:", createData.claimCode);
  console.log("  payLink:", createData.payLink);
  console.log("  notification:", createData.notification);

  const linkId = createData.linkId;
  if (!linkId) {
    console.log("No linkId in response.");
    process.exit(1);
  }

  // 3. Get request by link
  const byLinkRes = await fetchJson(`/api/requests/by-link/${linkId}`);
  if (byLinkRes.ok) {
    console.log("\nRequest by link: found");
  } else {
    console.log("\nRequest by link failed:", byLinkRes.error);
  }

  const claimCode = createData.claimCode;
  if (claimCode) {
    const byCodeRes = await fetchJson(`/api/claims/by-code/${claimCode}`);
    if (byCodeRes.ok) {
      console.log("Claim by code: found");
    } else {
      console.log("Claim by code failed:", byCodeRes.error);
    }
  }

  console.log("\nDone. To test claim flow: when payment is completed for this request, call onRequestPaymentConfirmed(transactionId) to send claim notification + OTP; then POST /api/claims/verify-otp and POST /api/claims/claim.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
