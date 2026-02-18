#!/usr/bin/env node
/**
 * Push Sent.dm templates from JSON files in sent-templates/ to the Sent API.
 * Creates templates and prints their IDs for .env (SENT_DM_TEMPLATE_PAYMENT_REQUEST, SENT_DM_TEMPLATE_CLAIM_NOTIFICATION).
 *
 * Usage: pnpm run sent:push-templates
 * Env: SENT_DM_API_KEY, SENT_DM_SENDER_ID (required). Loaded from .env via dotenv.
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";

const SENT_API_BASE = "https://api.sent.dm";
const TEMPLATES_DIR = path.join(process.cwd(), "sent-templates");

const SENT_DM_API_KEY = process.env.SENT_DM_API_KEY ?? "";
const SENT_DM_SENDER_ID = process.env.SENT_DM_SENDER_ID ?? "";

/** Map our logical name → env var name for output. */
const TEMPLATE_ENV_KEYS: Record<string, string> = {
  "payment-request": "SENT_DM_TEMPLATE_PAYMENT_REQUEST",
  "claim-notification": "SENT_DM_TEMPLATE_CLAIM_NOTIFICATION",
};

function getAuthHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-key": SENT_DM_API_KEY,
    "x-sender-id": SENT_DM_SENDER_ID,
  };
}

type JsonTemplate = {
  displayName?: string;
  category?: string;
  language?: string;
  submitForReview?: boolean;
  definition: unknown;
};

async function createTemplate(payload: { category?: string; language?: string; definition: unknown; submitForReview?: boolean }): Promise<{ id: string } | { error: string }> {
  const res = await fetch(`${SENT_API_BASE}/v2/templates`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({
      category: payload.category ?? null,
      language: payload.language ?? null,
      definition: payload.definition,
      submitForReview: payload.submitForReview ?? false,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    try {
      const j = JSON.parse(text) as { message?: string };
      return { error: j.message ?? text || `HTTP ${res.status}` };
    } catch {
      return { error: text || `HTTP ${res.status}` };
    }
  }
  try {
    const data = JSON.parse(text) as { id: string };
    return { id: data.id };
  } catch {
    return { error: "Invalid response: no id" };
  }
}

async function main(): Promise<void> {
  if (!SENT_DM_API_KEY || !SENT_DM_SENDER_ID) {
    console.error("Set SENT_DM_API_KEY and SENT_DM_SENDER_ID in .env");
    process.exit(1);
  }

  if (!fs.existsSync(TEMPLATES_DIR)) {
    console.error("sent-templates/ directory not found. Create it and add payment-request.json, claim-notification.json.");
    process.exit(1);
  }

  const names = Object.keys(TEMPLATE_ENV_KEYS);
  const results: Record<string, string> = {};

  for (const name of names) {
    const filePath = path.join(TEMPLATES_DIR, `${name}.json`);
    if (!fs.existsSync(filePath)) {
      console.warn(`Skip ${name}: ${filePath} not found`);
      continue;
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    let json: JsonTemplate;
    try {
      json = JSON.parse(raw) as JsonTemplate;
    } catch (e) {
      console.error(`Invalid JSON: ${filePath}`, e);
      process.exit(1);
    }
    const payload = {
      category: json.category ?? "UTILITY",
      language: json.language ?? "en_US",
      definition: json.definition,
      submitForReview: json.submitForReview ?? false,
    };
    const out = await createTemplate(payload);
    if ("error" in out) {
      console.error(`Failed to create ${name}:`, out.error);
      process.exit(1);
    }
    results[name] = out.id;
    console.log(`Created ${name}: ${out.id}`);
  }

  console.log("\n--- Add these to your .env ---\n");
  for (const [name, id] of Object.entries(results)) {
    const key = TEMPLATE_ENV_KEYS[name];
    if (key) console.log(`${key}=${id}`);
  }
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
