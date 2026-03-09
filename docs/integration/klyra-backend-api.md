# Klyra Backend API (External)

This document summarizes the **external Klyra backend** used as the upstream source for chains and tokens. Core seeds its `Chain` and `SupportedToken` tables from this API and then resolves symbols (e.g. `BASE USDC`) to `chainId` + token address only inside core.

**Base URL:** Set `KLYRA_BACKEND_URL` in core's `.env` (default for the seed script: `http://localhost:4001`). Use the remote URL (e.g. Vercel) when not running the backend locally.

---

## Chains

- **GET** `/api/squid/chains`
- **Query:**
  - `testnet=1` or `testnet=true` — optional; return testnet-only chains.
  - `all=1` or `all=true` — optional; return mainnet + testnet combined.
  - No query — mainnet only.
- **Response:** List of chains. Expected shape (fields may vary):
  - `chainId` (number or string)
  - `name` or `networkName` (string)
  - `iconURI` or `chainIconURI` (optional)
  - `rpc` or `rpcUrl` (optional; when provided, core stores it on `Chain` for balance/swap use)

---

## Tokens

- **GET** `/api/squid/tokens`
- **Query:**
  - `testnet=1` or `testnet=true` — optional; return testnet-only tokens.
  - `all=1` or `all=true` — optional; return mainnet + testnet combined.
  - No query — mainnet only.
- **Response:** List of tokens. Expected shape:
  - `chainId` (number or string)
  - `symbol` (string)
  - `address` (contract or native sentinel)
  - `decimals` (optional; default 18)
  - `name` (optional)
  - `logoURI` (optional)
  - `networkName` (optional; used for composite display symbol)
  - `rpc` (optional; core merges token RPCs into the chain’s `rpcUrls` when seeding)

Core builds a **composite display symbol** as `NETWORKNAME SYMBOL` (e.g. `BASE USDC`, `ETHEREUM MANA`) and stores it in `SupportedToken.displaySymbol` for display and lookup.

---

## Seed script (mainnet / testnet / all)

The seed script `pnpm run db:seed-chains-tokens` calls the backend as follows:

| Goal | Env | Backend query |
|------|-----|----------------|
| Mainnet only (default) | — | no query |
| Testnet only | `TESTNET=1` | `?testnet=1` |
| Mainnet + testnet | `SEED_ALL=1` | `?all=1` |

Use `SEED_ALL=1` to seed both mainnet and testnet chains and tokens in one run.

---

## Authentication

If the backend requires auth, set in core’s env:

- `KLYRA_BACKEND_API_KEY` — sets `x-api-key` header.
- `KLYRA_BACKEND_AUTH` — sets `Authorization` (use `Bearer <token>` if required).

Used by the seed script: `pnpm run db:seed-chains-tokens`.

---

## Other endpoints (backend)

The same backend may expose additional endpoints used by frontends or other services (e.g. balances, rates, Moolre). Document those in this file or in a separate backend API doc as they are stabilized.
