# Swap Quote API

This document describes the **swap quote** endpoints: a single POST endpoint that returns quotes from **0x**, **Squid Router**, or **LiFi** based on the `provider` parameter. No onramp/offramp quotes here; this is for **swap** (this token for that token) only.

For **onramp quotes** (fiat↔crypto via Fonbnk, with optional swap when the requested token is not in the pool), see [onramp-quote-api.md](./onramp-quote-api.md).

**Base path:** `/api/quote`  
**Auth:** Quote endpoints are excluded from `x-api-key`; no header required.

---

## Swap quote (unified)

### POST /api/quote/swap

Single endpoint for swap quotes. The **provider** in the body determines which router is used: `0x`, `squid`, or `lifi`.

**Body (JSON):**

| Field          | Type   | Description |
|----------------|--------|-------------|
| `provider`     | string | **Required.** One of: `0x`, `squid`, `lifi` |
| `from_token`   | string | Source token contract address (or native: `0x0000...` / `0xeeee...`) |
| `to_token`     | string | Destination token contract address (or native) |
| `amount`       | string | Amount in wei/smallest unit (e.g. `"1000000000000000000"`) |
| `from_chain`   | number | Source chain ID |
| `to_chain`     | number | Destination chain ID |
| `from_address` | string | **Required for `squid` and `lifi`.** Wallet address (used for route/quote) |
| `to_address`   | string | Optional; defaults to `from_address` for Squid/LiFi |
| `slippage`     | number | Optional; provider-specific (e.g. Squid 1 = 1%, LiFi 0.005 = 0.5%) |

**Native token:** Some wallets and providers use `0x0000...` or `0xeeee...` for the native token (ETH, MATIC, etc.). The backend normalizes per provider: **0x** and **Squid** use `0xeeee...`, **LiFi** accepts both (we send `0x0000...`).

**Provider behavior:**

- **0x** – Same-chain only. `from_chain` must equal `to_chain`. Returns quote and transaction/raw (permit2) when available.
- **Squid** – Cross-chain or same-chain. Returns quote and transaction (target, data, value, gas) when available.
- **LiFi** – Cross-chain or same-chain. Returns quote only; calldata requires a separate step (e.g. POST to backend to build transaction later).

**Response (200):**

```json
{
  "success": true,
  "data": {
    "provider": "squid",
    "from_chain_id": 1,
    "to_chain_id": 137,
    "cross_chain": true,
    "same_chain": false,
    "token_type": "cross_token",
    "from_amount": "1000000000000000000",
    "to_amount": "245000000000000000000",
    "next_quote_timer_seconds": null,
    "estimated_duration_seconds": 120,
    "transaction": {
      "target": "0x...",
      "data": "0x...",
      "value": "0",
      "gas_limit": "300000",
      "gas_price": "20000000000"
    }
  }
}
```

**Fields:**

- **`from_chain_id`**, **`to_chain_id`** – Chain IDs for the quote.
- **`cross_chain`** – `true` if `from_chain_id !== to_chain_id`.
- **`same_chain`** – `true` if same chain.
- **`token_type`** – `"cross_token"` or `"same_token"` (different vs same token).
- **`from_amount`**, **`to_amount`** – Amounts in smallest unit (strings).
- **`next_quote_timer_seconds`** – Quote validity: seconds after which to refresh the quote; `null` if the provider does not return this.
- **`estimated_duration_seconds`** – Execution time: estimated seconds for the swap to complete (Squid: route duration; LiFi: step execution duration). Used for “best by speed” and UI. `null` for 0x.
- **`transaction`** – Present when the provider returns calldata in the quote (0x, Squid). For **LiFi**, this is `null`; use a separate “build transaction” flow to get calldata.

**Errors:**

- **400** – Validation failed (e.g. missing `provider`, invalid enum, missing `from_address` for squid/lifi). **Same token on same chain:** if `from_chain === to_chain` and `from_token === to_token` (case-insensitive), returns 400 with `code: "SAME_TOKEN_SAME_CHAIN"` — swap must be to a different token or chain.
- **502** – Provider error (no route, API error).
- **503** – Provider not configured (missing `ZEROX_API_KEY`, `SQUID_INTEGRATOR_ID`, or optional `LIFI_API_KEY` for higher limits).

**Example (Squid cross-chain):**

```http
POST /api/quote/swap
Content-Type: application/json

{
  "provider": "squid",
  "from_token": "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  "to_token": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  "amount": "1000000000000000000",
  "from_chain": 1,
  "to_chain": 137,
  "from_address": "0xYourWalletAddress"
}
```

**Example (0x same-chain):**

```http
POST /api/quote/swap
Content-Type: application/json

{
  "provider": "0x",
  "from_token": "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  "to_token": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "amount": "1000000000000000000",
  "from_chain": 1,
  "to_chain": 1
}
```

---

## Best quote

### POST /api/quote/best

Returns the **best** quote by calling all applicable providers and comparing results. No `provider` in the body: the backend decides based on **same-chain** vs **cross-chain** (same-chain: 0x, Squid, LiFi; cross-chain: Squid, LiFi only). Returns the single best by **rate** (highest `to_amount`), and optionally a second **competitive** quote (within 5% of best amount) so the user can choose between best rate and e.g. faster execution (`estimated_duration_seconds`).

**Body (JSON):**

| Field          | Type   | Description |
|----------------|--------|-------------|
| `from_token`   | string | Source token address (or native `0x0000...` / `0xeeee...`) |
| `to_token`     | string | Destination token address |
| `amount`       | string | Amount in wei/smallest unit |
| `from_chain`   | number | Source chain ID |
| `to_chain`     | number | Destination chain ID |
| `from_address` | string | **Required.** Wallet address (needed for Squid and LiFi) |
| `to_address`   | string | Optional; defaults to `from_address` |
| `slippage`     | number | Optional |

**Response (200):**

```json
{
  "success": true,
  "data": {
    "best": {
      "provider": "squid",
      "from_chain_id": 1,
      "to_chain_id": 137,
      "cross_chain": true,
      "same_chain": false,
      "token_type": "cross_token",
      "from_amount": "1000000000000000000",
      "to_amount": "248000000000000000000",
      "next_quote_timer_seconds": null,
      "estimated_duration_seconds": 95,
      "transaction": { ... }
    },
    "alternative": {
      "provider": "lifi",
      "from_chain_id": 1,
      "to_chain_id": 137,
      "cross_chain": true,
      "same_chain": false,
      "token_type": "cross_token",
      "from_amount": "1000000000000000000",
      "to_amount": "245000000000000000000",
      "next_quote_timer_seconds": null,
      "estimated_duration_seconds": 120,
      "transaction": null
    }
  }
}
```

- **`best`** – Quote with the highest `to_amount` (best rate).
- **`alternative`** – Present only when a second provider’s quote is within 5% of the best amount. Lets the user choose between best rate and e.g. faster completion (`estimated_duration_seconds`).

**Errors:** 400 if validation fails (e.g. missing `from_address`). **Same token on same chain:** if `from_chain === to_chain` and `from_token === to_token`, returns 400 with `code: "SAME_TOKEN_SAME_CHAIN"`. 502 if no provider returns a quote.

**Example:**

```http
POST /api/quote/best
Content-Type: application/json

{
  "from_token": "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  "to_token": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  "amount": "1000000000000000000",
  "from_chain": 1,
  "to_chain": 137,
  "from_address": "0xYourWalletAddress"
}
```

---

## Fee quote (order)

### GET /api/quote

Returns a fee quote for an order (buy/sell/request/claim). Not related to swap providers.

**Query:** `action`, `f_amount`, `t_amount`, `f_price`, `t_price`, `f_token`, `t_token`, optional `f_chain`, `t_chain`.

**Validation:** Same token on same chain (`f_chain === t_chain` and `f_token === t_token`, case-insensitive) returns **400** with `code: "SAME_TOKEN_SAME_CHAIN"`.

**Response (200):** `{ "success": true, "data": { ... } }` (fee quote object).

---

## Environment

| Variable               | Description |
|------------------------|-------------|
| **ZEROX_API_KEY**      | 0x Swap API key. Required for `provider: "0x"`. If missing, 0x quotes return 503. |
| **SQUID_INTEGRATOR_ID**| Squid Router integrator ID. Required for `provider: "squid"`. If missing, Squid quotes return 503. |
| **LIFI_API_KEY**       | LiFi API key. Optional; improves rate limits when set. |

---

## Summary

- **Swap quote:** `POST /api/quote/swap` with `provider` in body (`0x` \| `squid` \| `lifi`). Returns one normalized quote.
- **Best quote:** `POST /api/quote/best` with no provider; backend calls all applicable providers (same-chain: 0x, Squid, LiFi; cross-chain: Squid, LiFi). Returns `best` (highest `to_amount`) and optional `alternative` (within 5% of best).
- **Timers:** `next_quote_timer_seconds` = quote validity/refresh; `estimated_duration_seconds` = how long the swap takes (Squid, LiFi). Both can inform “best” (rate vs speed).
- **Response:** Normalized quote includes `from_chain_id`, `to_chain_id`, `cross_chain`, `same_chain`, `token_type`, `from_amount`, `to_amount`, `next_quote_timer_seconds`, `estimated_duration_seconds`, and `transaction` when the provider returns calldata.
