# Quote API

This document covers the **Public Quote API v1** (`POST /api/v1/quotes`) and the **legacy swap quote** endpoints (`POST /api/quote/swap`, `POST /api/quote/best`).

For **onramp quotes** (fiat↔crypto via Fonbnk, with optional swap when the requested token is not in the pool), see [onramp-quote-api.md](./onramp-quote-api.md).

---

## Public Quote API v1

**Endpoint:** `POST /api/v1/quotes`  
**Base path:** `/api/v1` (e.g. full URL `https://your-api.com/api/v1/quotes`)  
**Auth:** Public. Optional `x-api-key` (platform key, no `businessId`) returns `debug` in the response.

Unified quote endpoint for **ONRAMP**, **OFFRAMP**, and **SWAP**. Returns a single guaranteed price quote with fee breakdown. For onramp/offramp the platform uses Fonbnk and applies the pricing engine. For SWAP the platform uses 0x, Squid, and LiFi (best quote), applies the pricing engine, and can pass integrator fees to Squid/LiFi so the platform receives fees when swaps are executed.

### Request body (JSON)

| Field            | Type   | Required | Default | Description |
|------------------|--------|----------|---------|-------------|
| `action`         | string | Yes      | —       | `"ONRAMP"` \| `"OFFRAMP"` \| `"SWAP"` |
| `inputAmount`    | string | Yes      | —       | Amount (e.g. `"100"`). Positive number string. |
| `inputCurrency`  | string | Yes      | —       | Symbol or token address (0x + 40 hex). From side: fiat for onramp (e.g. `GHS`), crypto for offramp/swap. |
| `outputCurrency` | string | Yes      | —       | Symbol or token address. To side: crypto for onramp/swap, fiat for offramp (e.g. `GHS`). |
| `chain`          | string | Yes*     | —       | Chain code (e.g. `base`, `MOMO`). Required for ONRAMP, OFFRAMP, and SWAP. |
| `inputSide`      | string | No       | `"from"`| `"from"` = amount is what you pay; `"to"` = amount is what you want to receive. |

\* Required for all three actions.

### Response (200)

Unified result: **input** (amount + currency), **output** (amount + currency, chain for crypto), **exchangeRate** (final rate after pricing engine), **basePrice** (provider rate before pricing engine), **fees** (network, platform, total), and optional **debug** when `x-api-key` is present.

```json
{
  "success": true,
  "data": {
    "quoteId": "uuid",
    "expiresAt": "ISO8601",
    "exchangeRate": "15.25",
    "basePrice": "15.00",
    "prices": {
      "providerPrice": "15.00",
      "sellingPrice": "15.25",
      "avgBuyPrice": "14.80"
    },
    "input": { "amount": "100.00", "currency": "GHS" },
    "output": { "amount": "6.56", "currency": "USDC", "chain": "base" },
    "fees": {
      "networkFee": "0",
      "platformFee": "1.64",
      "totalFee": "1.64"
    },
    "debug": { ... }
  }
}
```

- **exchangeRate** — Final rate (after pricing engine). This is what the user gets.
- **basePrice** — Provider rate (e.g. Fonbnk for onramp/offramp; best of 0x/Squid/LiFi for SWAP) before pricing engine.
- **platformFee** — Platform margin (spread) for this quote. For SWAP this is in output token units (receive-side).

### SWAP: integrator fees and pricing engine

- **Pricing engine:** For SWAP, the platform applies the same auto base-profit logic (inventory/velocity/volatility) so the user receives slightly less output per unit input than the raw provider quote. The response `exchangeRate` and `output.amount` are already after this margin; `basePrice` is the provider rate.
- **Integrator fees (Squid / LiFi):** When requesting swap quotes, the backend can send fee parameters so that when the user executes the swap, the platform receives a fee:
  - **Squid:** Set `SQUID_FEE_RECIPIENT` (address) and `SQUID_FEE_BPS` (basis points, e.g. 50 = 0.5%). The route request includes `collectFees: { integratorAddress, fee }`. Fee collection must be enabled for your Squid integrator ID (contact Squid).
  - **LiFi:** Set `LIFI_INTEGRATOR` (string, default `klyra`) and `LIFI_FEE_PERCENT` (decimal, e.g. 0.005 = 0.5%). The routes request includes `options.fee` and `options.integrator`. Configure your fee wallet at [LiFi Portal](https://portal.li.fi/).
- **Recipient never exposed:** The collect-fee address is **never** returned in any quote or public API response. It is set only via **admin** (`PATCH /api/settings/swap-fee`) and cannot be overridden by client request bodies. See [inventory-lots-tokens-pnl-api.md](./inventory-lots-tokens-pnl-api.md) § Swap-fee admin.

The v1 response is **unified**: the user sees one **input** amount and one **output** amount (and **platformFee**). Any integrator fee passed to Squid/LiFi is reflected in the provider’s quote (lower `to_amount` / higher effective rate); the pricing engine margin is applied on top, and the final **exchangeRate** and **output.amount** are what the user gets.

### Errors

- **400** — Validation failed, unsupported pair, or missing `chain` for ONRAMP/OFFRAMP/SWAP.
- **502** — Rate/quote unavailable (provider error).

---

## Swap quote (legacy, unified)

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
| **SQUID_FEE_RECIPIENT**| Squid: address (0x + 40 hex) to receive integrator fees. Optional; fee must be enabled for your integrator ID by Squid. |
| **SQUID_FEE_BPS**      | Squid: integrator fee in basis points (e.g. 50 = 0.5%). Optional; used when SQUID_FEE_RECIPIENT is set. |
| **LIFI_API_KEY**       | LiFi API key. Optional; improves rate limits when set. |
| **LIFI_INTEGRATOR**    | LiFi: integrator string (tied to fee wallet in LiFi Portal). Optional; default `klyra`. |
| **LIFI_FEE_PERCENT**   | LiFi: integrator fee as decimal (e.g. 0.005 = 0.5%). Optional. |

---

## Summary

- **Swap quote:** `POST /api/quote/swap` with `provider` in body (`0x` \| `squid` \| `lifi`). Returns one normalized quote.
- **Best quote:** `POST /api/quote/best` with no provider; backend calls all applicable providers (same-chain: 0x, Squid, LiFi; cross-chain: Squid, LiFi). Returns `best` (highest `to_amount`) and optional `alternative` (within 5% of best).
- **Timers:** `next_quote_timer_seconds` = quote validity/refresh; `estimated_duration_seconds` = how long the swap takes (Squid, LiFi). Both can inform “best” (rate vs speed).
- **Response:** Normalized quote includes `from_chain_id`, `to_chain_id`, `cross_chain`, `same_chain`, `token_type`, `from_amount`, `to_amount`, `next_quote_timer_seconds`, `estimated_duration_seconds`, and `transaction` when the provider returns calldata.


Use these shapes for **POST /api/quote/onramp** (same endpoint for both; difference is `amount_in` and `purchase_method`).

---

**1. Onramp (buy) – “I pay 100 GHS, how much Polygon MANA do I get?”**

```json
{
  "country": "GH",
  "chain_id": 137,
  "token": "0xA1c57f48F0Deb89f529dF39EbD8200A0cfB952fe",
  "amount": 100,
  "amount_in": "fiat",
  "purchase_method": "buy",
  "from_address": "0xYourWalletAddress"
}
```

- `chain_id`: **137** = Polygon.
- `token`: MANA contract on Polygon. The one above is the usual Decentraland MANA on Polygon; if your app uses another address, swap it in.
- `amount`: fiat amount (e.g. 100 GHS).
- `from_address`: recommended so the swap (Base USDC → Polygon MANA) can be quoted properly.

---

**2. Offramp (sell) – “I sell 500 Polygon MANA, how much fiat do I get?”**

```json
{
  "country": "GH",
  "chain_id": 137,
  "token": "0xA1c57f48F0Deb89f529dF39EbD8200A0cfB952fe",
  "amount": 500,
  "amount_in": "crypto",
  "purchase_method": "sell",
  "token_decimals": 18,
  "from_address": "0xYourWalletAddress"
}
```

- `amount`: MANA amount in human units (e.g. 500).
- `token_decimals`: **18** for MANA (so the backend converts 500 → wei correctly for the swap).
- Same `chain_id` and `token` as onramp.

Replace `0xYourWalletAddress` with the real wallet, and `GH`/GHS with the country/currency you want for fiat (e.g. `NG` for NGN). If MANA on your Polygon deployment uses a different contract, replace the `token` value with that address.



/inventory-lot
/supported-tokens
/transaction-pnl
/inventory-assets