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

## Integration flow

1. **Quote** – User gets a swap quote from POST `/api/quote/swap` or POST `/api/quote/best`.
2. **Proceed** – User picks a route and proceeds. Frontend (or backend) calls **POST /api/crypto-transactions** with provider, chains, tokens, amounts; optionally `transaction_id` if this swap is part of an onramp/offramp that already has a business Transaction. Store the returned `id`.
3. **Submit** – After the user signs and the tx is broadcast, call **PATCH /api/crypto-transactions/:id** with `status: "SUBMITTED"`, `tx_hash`, and optionally `tx_url`.
4. **Confirm / Fail** – When the chain confirms or the tx fails, call **PATCH** again with `status: "CONFIRMED"` or `status: "FAILED"`.
5. **Search** – Support or dashboard can look up by **GET /api/crypto-transactions/:id** or **GET /api/crypto-transactions/by-hash/:txHash**.

When onramp/offramp is wired to Paystack and business `Transaction` is created first, pass that `Transaction.id` as `transaction_id` when creating the crypto transaction so the swap is linked for audit and payout flows.
