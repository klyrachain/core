# Crypto / Swap Transactions API

This document describes the **crypto transaction** endpoints used to track swap executions via **0x**, **Squid**, and **LiFi**. When a user picks a quote and proceeds with a swap, the frontend (or backend when executing) records the transaction here; when the on-chain tx hash is available, it is updated. This enables:

- **Search by transaction ID** – Look up by our internal `id` or by blockchain `tx_hash`.
- **Audit and support** – Know which route was used and store reference data if a router fails.
- **Linking onramp/offramp** – Optional `transaction_id` links to the business `Transaction` (Paystack flow, request/claim) when the swap is part of an onramp or offramp.

**Base path:** `/api/crypto-transactions`  
**Auth:** Requires `x-api-key` (same as other API routes; quote endpoints are excluded).

---

## Model

| Field           | Type   | Description |
|-----------------|--------|-------------|
| `id`            | uuid   | Our internal id. |
| `provider`      | string | `"0x"` \| `"squid"` \| `"lifi"`. |
| `status`        | enum   | `PENDING` \| `SUBMITTED` \| `CONFIRMED` \| `FAILED`. |
| `fromChainId`   | int    | Source chain ID. |
| `toChainId`     | int    | Destination chain ID. |
| `fromToken`     | string | Source token address (or native). |
| `toToken`       | string | Destination token address. |
| `fromAmount`    | string | Amount in wei/smallest unit. |
| `toAmount`      | string | Amount in wei/smallest unit. |
| `txHash`        | string?| Blockchain transaction hash (set when submitted/confirmed). |
| `txUrl`         | string?| Block explorer link (optional). |
| `transactionId` | uuid? | Our business `Transaction` id when part of onramp/offramp. |
| `metadata`      | json? | Optional quote snapshot, from_address, to_address, etc. |

**Status flow:** `PENDING` (quote accepted) → `SUBMITTED` (tx sent) → `CONFIRMED` or `FAILED`.

---

## Endpoints

### POST /api/crypto-transactions

Record a new crypto/swap transaction (e.g. when user picks a quote and proceeds). Returns `{ id }` for later update with `tx_hash` / `status`.

**Body (JSON):**

| Field            | Type   | Description |
|------------------|--------|-------------|
| `provider`       | string | **Required.** `"0x"` \| `"squid"` \| `"lifi"`. |
| `from_chain_id`  | number | **Required.** Source chain ID. |
| `to_chain_id`    | number | **Required.** Destination chain ID. |
| `from_token`     | string | **Required.** Source token address. |
| `to_token`       | string | **Required.** Destination token address. |
| `from_amount`    | string | **Required.** Amount in wei/smallest unit. |
| `to_amount`      | string | **Required.** Amount in wei/smallest unit. |
| `transaction_id`  | string | Optional. Our business Transaction uuid (onramp/offramp). |
| `metadata`       | object | Optional. Quote snapshot, addresses, etc. |

**Response (201):** `{ "success": true, "data": { "id": "uuid" } }`

---

### PATCH /api/crypto-transactions/:id

Update a crypto transaction (e.g. set `tx_hash` and `status` when tx is submitted or confirmed).

**Body (JSON):** All fields optional.

| Field            | Type   | Description |
|------------------|--------|-------------|
| `status`         | string | `PENDING` \| `SUBMITTED` \| `CONFIRMED` \| `FAILED`. |
| `tx_hash`        | string | Blockchain transaction hash. |
| `tx_url`         | string | Block explorer URL. |
| `transaction_id` | string | Our business Transaction uuid. |
| `metadata`       | object | Replace metadata. |

**Response (200):** `{ "success": true, "data": { "id": "uuid" } }`  
**404** – Crypto transaction not found.

---

### GET /api/crypto-transactions

List crypto transactions with pagination and optional filters.

**Query:**

| Field     | Type   | Description |
|-----------|--------|-------------|
| `page`    | number | Default 1. |
| `limit`   | number | Default 20, max 100. |
| `provider`| string | Optional. `0x` \| `squid` \| `lifi`. |
| `status`  | string | Optional. `PENDING` \| `SUBMITTED` \| `CONFIRMED` \| `FAILED`. |

**Response (200):**

```json
{
  "success": true,
  "data": [ { "id": "...", "provider": "0x", "status": "CONFIRMED", ... } ],
  "meta": { "page": 1, "limit": 20, "total": 42 }
}
```

---

### GET /api/crypto-transactions/:id

Get a crypto transaction by our internal id. Includes linked `transaction` (business Transaction) when present.

**Response (200):** `{ "success": true, "data": { ... } }`  
**404** – Not found.

---

### GET /api/crypto-transactions/by-hash/:txHash

Get a crypto transaction by blockchain transaction hash. Use for lookup when the only identifier is the on-chain tx hash.

**Response (200):** `{ "success": true, "data": { ... } }`  
**404** – Not found.

---

### GET /api/crypto-transactions/:id/status

Check / verify swap status with the provider (0x, Squid, LiFi). The record must have `tx_hash` set (use PATCH first after the tx is broadcast). The backend calls the provider’s status API and returns a normalized status.

**Query:**

| Field   | Type   | Description |
|---------|--------|-------------|
| `update`| string | Optional. `1` or `true` to update our record with the normalized status and `tx_url` from the provider. |
| `raw`   | string | Optional. `1` to include the provider’s raw response in the payload. |

**Response (200):**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "provider": "0x",
    "normalized": "CONFIRMED",
    "provider_status": "confirmed",
    "provider_message": null,
    "tx_hash": "0x...",
    "tx_url": "https://..."
  }
}
```

- **normalized** – One of `PENDING`, `SUBMITTED`, `CONFIRMED`, `FAILED` (mapped from provider-specific values).
- **provider_status** – Raw status from the provider (e.g. 0x: `pending`|`submitted`|`succeeded`|`confirmed`|`failed`; Squid: `SUCCESS`|`ONGOING`|…; LiFi: `PENDING`|`DONE`|`FAILED`).

**0x trade-hash:** 0x’s status API uses a path parameter that may be the on-chain tx hash or an internal trade id from their submit response. If status returns 404 or “not found”, store 0x’s submit response trade id in **metadata** as `zero_x_trade_hash` when creating or updating the crypto transaction; the status endpoint will use that for 0x instead of `tx_hash` when present.

**Errors:**

- **400** – No `tx_hash` on the record yet, or unknown provider.
- **404** – Crypto transaction not found.
- **502** – Provider status API error.

---

## Tracking: best vs all quotes

The frontend can use either:

- **POST /api/quote/best** – Get the single best quote (and optional alternative). When the user proceeds, the frontend knows which provider was used (e.g. from the response) and sends that **provider** in **POST /api/crypto-transactions**.
- **POST /api/quote/swap** per provider (or multiple quotes) – Frontend fetches quotes from 0x, Squid, LiFi and filters/ranks itself. When the user picks one route and proceeds, the frontend still sends **provider** (and amounts, chains, tokens) when recording the crypto transaction.

In both cases the **request demands the provider** when creating the record, so we always track which swap provider was used. Optionally store in **metadata** whether the quote came from “best” or “alternative” or a custom choice (e.g. `metadata: { source: "best" }` or `{ source: "alternative" }`).

---

## Admin: transaction history

- **Our data** – **GET /api/crypto-transactions** (with optional `provider`, `status`, pagination) returns all swap transactions we have recorded. Use this for dashboards and support.
- **Admin-only list** – **GET /api/admin/crypto-transactions** returns the same list but **requires** the API key to have **ADMIN** or **\*** permission. Query params: `page`, `limit`, `provider`, `status`. **403** if the key does not have ADMIN or \*.
- **Provider-side history** – Some providers (e.g. LiFi) expose “list filtered transfers” or analytics endpoints. If you need to sync or display transaction history from the provider’s side, that can be a separate **admin-only** endpoint that calls the provider’s history API (and optionally merges with our DB). For now, our list is the source of truth for “which swaps we know about.”

---

## Integration flow

1. **Quote** – User gets a swap quote from POST `/api/quote/swap` or POST `/api/quote/best`.
2. **Proceed** – User picks a route and proceeds. Frontend (or backend) calls **POST /api/crypto-transactions** with provider, chains, tokens, amounts; optionally `transaction_id` if this swap is part of an onramp/offramp that already has a business Transaction. Store the returned `id`.
3. **Submit** – After the user signs and the tx is broadcast, call **PATCH /api/crypto-transactions/:id** with `status: "SUBMITTED"`, `tx_hash`, and optionally `tx_url`.
4. **Confirm / Fail** – When the chain confirms or the tx fails, call **PATCH** again with `status: "CONFIRMED"` or `status: "FAILED"`. Alternatively, call **GET /api/crypto-transactions/:id/status?update=1** to fetch status from the provider and update our record.
5. **Verify** – Support or user can verify a swap with **GET /api/crypto-transactions/:id/status** (and optional `?update=1` to persist the result).
6. **Search** – Support or dashboard can look up by **GET /api/crypto-transactions/:id** or **GET /api/crypto-transactions/by-hash/:txHash**.

When onramp/offramp is wired to Paystack and business `Transaction` is created first, pass that `Transaction.id` as `transaction_id` when creating the crypto transaction so the swap is linked for audit and payout flows.

For onramp/offramp flows, receiver handling (wallet vs email/phone), and Paystack linking, see [onramp-offramp-integration.md](./onramp-offramp-integration.md).
