# Inventory, Lots, Supported Tokens, Transactions PnL & Swap-Fee Admin API

This document describes endpoints for **inventory assets**, **inventory lots**, **supported chains/tokens**, **transaction PnL**, and **swap-fee admin** (collect-fee address and fee config). All of these require an API key (`x-api-key`) unless noted.

**Base path:** `/api`  
**Auth:** `x-api-key` required for all endpoints below except public GET `/api/chains` and `/api/tokens`. Admin endpoints require a **platform** key (no `businessId`).

---

## 1. Inventory assets (CRUD)

Inventory assets represent a wallet/address balance for a chain+token. Used for cost-basis and lot tracking.

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/inventory | Create asset (chain, chainId, tokenAddress, symbol, address, currentBalance, walletId?) |
| GET | /api/inventory | List assets (pagination; filter: chain?, chainId?, address?) |
| GET | /api/inventory/:id | Get one asset by ID |
| PATCH | /api/inventory/:id | Update asset (chain, chainId, tokenAddress, symbol, address, currentBalance, walletId?) |
| DELETE | /api/inventory/:id | Delete asset (and its history) |
| GET | /api/inventory/:id/lots | Lots for this asset (FIFO; query: onlyAvailable?) |
| GET | /api/inventory/:id/cost-basis | Volume-weighted average cost per token |
| GET | /api/inventory/:id/history | History rows for this asset (pagination) |

**List history (global):** `GET /api/inventory/history` — pagination; filter: `assetId?`, `chain?`.

**Body (POST):** `chain`, `chainId`, `tokenAddress`, `symbol`, `address`, `currentBalance?`, `walletId?`.  
**Body (PATCH):** same fields optional; `balance` is alias for `currentBalance`.

---

## 2. Inventory lots

Lots are FIFO units per asset (quantity + cost per token). Usually created by the system on purchase; readable for reporting.

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/lots | List lots (pagination; filter: assetId?, chain?, onlyAvailable?) |

**Query:** `page`, `limit`, `assetId`, `chain`, `onlyAvailable` (true = quantity > 0).

**Response:** Array of lots with `id`, `assetId`, `quantity`, `costPerToken`, `acquiredAt`, `sourceType`, `sourceTransactionId`, `asset` (summary).

**Per-asset lots:** `GET /api/inventory/:id/lots` returns lots for a single asset (see §1).

---

## 3. Supported chains and tokens

- **Public:** `GET /api/chains` — list chains (chainId, name, icon).  
- **Public:** `GET /api/tokens` — list supported tokens; query `?chain_id=8453` to filter by chain.

**Admin CRUD (platform key required; ADMIN or \* permission):**

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/admin/chains | List chains (admin) |
| POST | /api/admin/chains | Create chain (chain_id, name, icon_uri?) |
| PATCH | /api/admin/chains/:id | Update chain |
| DELETE | /api/admin/chains/:id | Delete chain |
| GET | /api/admin/tokens | List tokens (admin) |
| POST | /api/admin/tokens | Create token (chain_id, token_address, symbol, decimals?, name?, logo_uri?, fonbnk_code?) |
| PATCH | /api/admin/tokens/:id | Update token |
| DELETE | /api/admin/tokens/:id | Delete token |

See [chains-tokens-api.md](./chains-tokens-api.md) for full request/response shapes.

---

## 4. Transactions and PnL

**Transactions:** `GET /api/transactions` (list, pagination; filter: status?, type?).  
`GET /api/transactions/:id` — one transaction with user and request.

**Transaction PnL (FIFO lot attribution):**

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/transactions/:id/pnl | PnL rows for one transaction (quantity, costPerToken, providerPrice, sellingPrice, feeAmount, profitLoss, lot) |
| GET | /api/pnl | List PnL rows (pagination; filter: transactionId?) |

PnL rows link a transaction to lots used in a sale: `feeAmount = (sellingPrice - providerPrice) * quantity`, `profitLoss = (sellingPrice - costPerToken) * quantity`.

---

## 5. Swap-fee admin (collect-fee address and fee config)

The **recipient address** for Squid/LiFi swap fees is **never exposed** to the client. It is set only via **admin** and stored in platform settings. Quote endpoints (v1/quotes, /api/quote/swap, /api/quote/best) do **not** return fee config or recipient; the fee object cannot be set or overridden by client request bodies.

**Admin endpoints (platform key required; no businessId):**

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/settings/swap-fee | Get swap-fee config (masked). Returns `squidFeeRecipientMasked` (e.g. `0x1234...abcd`), `squidFeeBps`, `lifiIntegrator`, `lifiFeePercent`, `configured`. |
| PATCH | /api/settings/swap-fee | Set swap-fee config. Body: `squidFeeRecipient?`, `squidFeeBps?`, `lifiIntegrator?`, `lifiFeePercent?`. |

**PATCH body:**

- `squidFeeRecipient` — address (0x + 40 hex) or empty to clear. When set with `squidFeeBps`, Squid route requests include `collectFees: { integratorAddress, fee }`.
- `squidFeeBps` — basis points (e.g. 50 = 0.5%). 0–10000.
- `lifiIntegrator` — string (default `klyra`); tied to fee wallet in LiFi Portal.
- `lifiFeePercent` — decimal (e.g. 0.005 = 0.5%). 0–1.

**Security:**

- Fee recipient is **never** returned in any quote or public response; only a masked form in `GET /api/settings/swap-fee` for admin UI.
- Fee config is **only** writable via `PATCH /api/settings/swap-fee` with platform admin key. Client request bodies on quote endpoints cannot set or override fee/recipient.

---

## Summary

- **Inventory:** CRUD on assets; GET lots (global and per-asset), cost-basis, history.
- **Lots:** GET list with filters (assetId, chain, onlyAvailable).
- **Chains/tokens:** Public GET; admin CRUD (see chains-tokens-api.md).
- **Transactions:** Existing list/one; **PnL:** GET by transaction or list with filter.
- **Swap-fee:** Admin GET (masked) and PATCH only; recipient never exposed to client; fee object not settable from client.
