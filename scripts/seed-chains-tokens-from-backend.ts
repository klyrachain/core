#!/usr/bin/env node
/**
 * Seed Chain and SupportedToken from the external Morapay backend (Squid chains/tokens).
 * Idempotent: run again to add new or update existing; chains/tokens with invalid data are skipped.
 * Stores chain logos (iconUri) and token logos (logoUri) from the API when provided.
 *
 * Env:
 *   KLYRA_BACKEND_URL  Base URL (default http://localhost:4001). Set to remote URL if not using local backend.
 *   KLYRA_BACKEND_AUTH Optional "Bearer <token>" for Authorization header
 *   KLYRA_BACKEND_API_KEY  Optional API key (sets x-api-key header)
 *   TESTNET            Set to 1 to request testnet-only chains/tokens (?testnet=1).
 *   SEED_ALL           Set to 1 to request mainnet + testnet combined (?all=1). Overrides TESTNET when set.
 *   SEED_VERBOSE       Set to 1 to log each skipped chain/token (for debugging)
 *
 * Usage: pnpm run db:seed-chains-tokens
 * Requires: DIRECT_URL or DATABASE_URL; run db:migrate first.
 */

import "dotenv/config";
import { createHash } from "node:crypto";
import { PrismaClient } from "../prisma/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadEnv } from "../src/config/env.js";

const BASE_URL = (process.env.KLYRA_BACKEND_URL ?? "http://localhost:4001").replace(/\/$/, "");
const AUTH = process.env.KLYRA_BACKEND_AUTH ?? "";
const API_KEY = process.env.KLYRA_BACKEND_API_KEY ?? "";
const SEED_ALL = process.env.SEED_ALL === "1" || process.env.SEED_ALL === "true";
const TESTNET = process.env.TESTNET === "1" || process.env.TESTNET === "true";
const VERBOSE = process.env.SEED_VERBOSE === "1" || process.env.SEED_VERBOSE === "true";

function chainsQueryString(): string {
  if (SEED_ALL) return "?all=1";
  if (TESTNET) return "?testnet=1";
  return "";
}

function tokensQueryString(): string {
  if (SEED_ALL) return "?all=1";
  if (TESTNET) return "?testnet=1";
  return "";
}

function buildHeaders(): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json" };
  if (API_KEY) h["x-api-key"] = API_KEY;
  if (AUTH) h["Authorization"] = AUTH.startsWith("Bearer ") ? AUTH : `Bearer ${AUTH}`;
  return h;
}

interface ExternalChain {
  chainId?: number | string;
  chain_id?: number | string;
  name?: string;
  networkName?: string;
  iconURI?: string;
  chainIconURI?: string;
  rpcUrl?: string;
  rpc?: string;
}

interface ExternalToken {
  chainId?: number | string;
  chain_id?: number | string;
  symbol?: string;
  address?: string;
  tokenAddress?: string;
  contract_address?: string;
  decimals?: number;
  name?: string;
  logoURI?: string;
  logo_uri?: string;
  networkName?: string;
  rpc?: string;
}

async function fetchChains(): Promise<ExternalChain[]> {
  const qs = chainsQueryString();
  const res = await fetch(`${BASE_URL}/api/squid/chains${qs}`, { headers: buildHeaders() });
  if (!res.ok) {
    throw new Error(`Chains API ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { chains?: ExternalChain[]; data?: ExternalChain[] };
  const list = data.chains ?? data.data ?? (Array.isArray(data) ? data : []);
  return Array.isArray(list) ? list : [];
}

async function fetchTokens(): Promise<ExternalToken[]> {
  const qs = tokensQueryString();
  const res = await fetch(`${BASE_URL}/api/squid/tokens${qs}`, { headers: buildHeaders() });
  if (!res.ok) {
    throw new Error(`Tokens API ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { tokens?: ExternalToken[]; data?: ExternalToken[] };
  const list = data.tokens ?? data.data ?? (Array.isArray(data) ? data : []);
  return Array.isArray(list) ? list : [];
}

/** Stable bigint for non-numeric chain IDs (e.g. "agoric-3", "osmosis-1"). Fits in PostgreSQL bigint (signed 8-byte). */
function stringToStableBigInt(s: string): bigint {
  const buf = createHash("sha256").update(s, "utf8").digest();
  const hex = buf.subarray(0, 7).toString("hex");
  return BigInt("0x" + hex);
}

function parseChainId(v: number | string | undefined): bigint | null {
  if (v === undefined || v === null) return null;
  const s = typeof v === "string" ? v.trim() : String(v);
  if (s === "" || s === "null" || s === "undefined") return null;
  try {
    const b = s.startsWith("0x") || s.startsWith("0X") ? BigInt(s) : BigInt(s.replace(/^0+/, "") || "0");
    return b > 0n ? b : null;
  } catch {
    const n = Math.floor(Number(s));
    if (Number.isFinite(n) && n > 0) {
      try {
        return BigInt(n);
      } catch {
        // fall through to string hash
      }
    }
    if (typeof v === "string" && /[^0-9]/.test(s)) {
      return stringToStableBigInt(s);
    }
    return null;
  }
}

function toDisplaySymbol(networkName: string, symbol: string): string {
  const n = (networkName ?? "").trim().toUpperCase();
  const s = (symbol ?? "").trim().toUpperCase();
  return n && s ? `${n} ${s}` : s || n || "";
}

async function main(): Promise<void> {
  try {
    loadEnv();
  } catch {
    console.warn("Env validation failed; using process.env for DB.");
  }

  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "";
  if (!connectionString) {
    console.error("Set DIRECT_URL or DATABASE_URL in .env");
    process.exit(1);
  }

  const mode = SEED_ALL ? "mainnet + testnet (all=1)" : TESTNET ? "testnet" : "mainnet";
  console.log("Fetching chains from", BASE_URL, `(${mode})`);
  const externalChains = await fetchChains();
  console.log("Fetching tokens from", BASE_URL, `(${mode})`);
  const externalTokens = await fetchTokens();

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });
  await prisma.$connect();

  const chainIdToName = new Map<bigint, string>();
  const chainIdToIconUri = new Map<bigint, string | undefined>();
  const chainIdToRpcSet = new Map<bigint, Set<string>>();

  let chainsSkipped = 0;
  for (const c of externalChains) {
    const rawChainId = c.chainId ?? c.chain_id;
    const chainId = parseChainId(rawChainId);
    if (chainId === null) {
      chainsSkipped++;
      if (VERBOSE) console.warn("[skip chain] invalid chainId:", JSON.stringify(rawChainId), "name:", c.name ?? c.networkName);
      continue;
    }
    const name = (c.name ?? c.networkName ?? `Chain ${chainId}`).trim() || `Chain ${chainId}`;
    chainIdToName.set(chainId, name);
    const iconUri = (c.iconURI ?? c.chainIconURI ?? "").trim() || undefined;
    chainIdToIconUri.set(chainId, iconUri);
    const chainRpc = (c.rpcUrl ?? c.rpc ?? "").trim();
    if (chainRpc) {
      let set = chainIdToRpcSet.get(chainId);
      if (!set) {
        set = new Set();
        chainIdToRpcSet.set(chainId, set);
      }
      set.add(chainRpc);
    }
  }

  for (const t of externalTokens) {
    const rawChainId = t.chainId ?? t.chain_id;
    const chainId = parseChainId(rawChainId);
    if (chainId === null || !chainIdToName.has(chainId)) continue;
    const tokenRpc = (t.rpc ?? "").trim();
    if (!tokenRpc) continue;
    let set = chainIdToRpcSet.get(chainId);
    if (!set) {
      set = new Set();
      chainIdToRpcSet.set(chainId, set);
    }
    set.add(tokenRpc);
  }

  // Infer chains that appear in tokens but not in the backend chains list (e.g. some testnet chains).
  const inferredChains = new Map<bigint, { name: string; rpcSet: Set<string> }>();
  for (const t of externalTokens) {
    const rawChainId = t.chainId ?? t.chain_id;
    const chainId = parseChainId(rawChainId);
    if (chainId === null || chainIdToName.has(chainId)) continue;
    let entry = inferredChains.get(chainId);
    if (!entry) {
      const name = (t.networkName ?? "").trim() || `Chain ${chainId}`;
      entry = { name, rpcSet: new Set<string>() };
      inferredChains.set(chainId, entry);
    }
    const tokenRpc = (t.rpc ?? "").trim();
    if (tokenRpc) entry.rpcSet.add(tokenRpc);
  }
  for (const [chainId, { name, rpcSet }] of inferredChains) {
    chainIdToName.set(chainId, name);
    if (rpcSet.size > 0) chainIdToRpcSet.set(chainId, rpcSet);
  }

  let chainsAdded = 0;
  let chainsUpdated = 0;

  for (const c of externalChains) {
    const rawChainId = c.chainId ?? c.chain_id;
    const chainId = parseChainId(rawChainId);
    if (chainId === null) {
      chainsSkipped++;
      continue;
    }
    const name = chainIdToName.get(chainId)!;
    const iconUri = chainIdToIconUri.get(chainId);
    const rpcSet = chainIdToRpcSet.get(chainId);
    const rpcUrls = rpcSet ? Array.from(rpcSet).filter(Boolean) : [];
    const rpcUrl = rpcUrls[0] ?? undefined;

    const existing = await prisma.chain.findUnique({ where: { chainId }, select: { id: true } });
    await prisma.chain.upsert({
      where: { chainId },
      create: {
        chainId,
        name,
        iconUri: iconUri ?? null,
        rpcUrl: rpcUrl ?? null,
        rpcUrls: rpcUrls.length ? rpcUrls : null,
      },
      update: {
        name,
        iconUri: iconUri ?? null,
        rpcUrl: rpcUrl ?? null,
        rpcUrls: rpcUrls.length ? rpcUrls : null,
      },
    });
    if (existing) chainsUpdated++;
    else chainsAdded++;
  }

  for (const [chainId, { name, rpcSet }] of inferredChains) {
    const rpcUrls = Array.from(rpcSet).filter(Boolean);
    const rpcUrl = rpcUrls[0] ?? undefined;
    const existing = await prisma.chain.findUnique({ where: { chainId }, select: { id: true } });
    await prisma.chain.upsert({
      where: { chainId },
      create: {
        chainId,
        name,
        iconUri: null,
        rpcUrl: rpcUrl ?? null,
        rpcUrls: rpcUrls.length ? rpcUrls : null,
      },
      update: {
        name,
        rpcUrl: rpcUrl ?? null,
        rpcUrls: rpcUrls.length ? rpcUrls : null,
      },
    });
    if (existing) chainsUpdated++;
    else chainsAdded++;
  }

  if (inferredChains.size > 0) {
    console.log("Chains inferred from tokens (not in backend list):", inferredChains.size);
  }
  console.log("Chains: added", chainsAdded, "| updated", chainsUpdated, "| skipped", chainsSkipped);

  let tokensAdded = 0;
  let tokensUpdated = 0;
  let tokensSkipped = 0;
  let tokensSkippedNoChain = 0;
  let tokensSkippedInvalid = 0;
  let tokensSkippedNoSymbolOrAddress = 0;

  for (const t of externalTokens) {
    const rawChainId = t.chainId ?? t.chain_id;
    const chainId = parseChainId(rawChainId);
    if (chainId === null) {
      tokensSkipped++;
      tokensSkippedInvalid++;
      if (VERBOSE) console.warn("[skip token] invalid chainId:", JSON.stringify(rawChainId), "symbol:", t.symbol);
      continue;
    }
    if (!chainIdToName.has(chainId)) {
      tokensSkipped++;
      tokensSkippedNoChain++;
      if (VERBOSE) console.warn("[skip token] chain not in DB:", String(chainId), "symbol:", t.symbol);
      continue;
    }
    const networkName = t.networkName ?? chainIdToName.get(chainId) ?? `Chain ${chainId}`;
    const symbol = (t.symbol ?? "").trim();
    const address = (t.address ?? t.tokenAddress ?? t.contract_address ?? "").trim();
    if (!symbol || !address) {
      tokensSkipped++;
      tokensSkippedNoSymbolOrAddress++;
      if (VERBOSE) console.warn("[skip token] missing symbol or address:", { symbol: symbol || "(empty)", address: address ? `${address.slice(0, 10)}...` : "(empty)" });
      continue;
    }
    const displaySymbol = toDisplaySymbol(networkName, symbol);

    const existing = await prisma.supportedToken.findUnique({
      where: { chainId_tokenAddress: { chainId, tokenAddress: address } },
      select: { id: true },
    });
    await prisma.supportedToken.upsert({
      where: {
        chainId_tokenAddress: { chainId, tokenAddress: address },
      },
      create: {
        chainId,
        tokenAddress: address,
        symbol,
        decimals: typeof t.decimals === "number" ? t.decimals : 18,
        name: t.name ?? undefined,
        logoUri: (t.logoURI ?? t.logo_uri ?? "").trim() || undefined,
        displaySymbol: displaySymbol || undefined,
        fonbnkCode: undefined,
      },
      update: {
        symbol,
        decimals: typeof t.decimals === "number" ? t.decimals : 18,
        name: t.name ?? undefined,
        logoUri: (t.logoURI ?? t.logo_uri ?? "").trim() || undefined,
        displaySymbol: displaySymbol || undefined,
      },
    });
    if (existing) tokensUpdated++;
    else tokensAdded++;
  }

  console.log("Tokens: added", tokensAdded, "| updated", tokensUpdated, "| skipped", tokensSkipped);
  if (tokensSkipped > 0) {
    console.log("  Skipped breakdown: invalid chainId:", tokensSkippedInvalid, "| chain not in DB:", tokensSkippedNoChain, "| no symbol/address:", tokensSkippedNoSymbolOrAddress);
  }
  if (chainsSkipped > 0 || tokensSkipped > 0) {
    console.log("Tip: run with SEED_VERBOSE=1 to log each skipped chain/token.");
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
