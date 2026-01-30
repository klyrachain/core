# Onramp Quote API

This document describes the **onramp quote** endpoint: fiat↔crypto for **buy** (onramp). It uses **Fonbnk** for fiat↔crypto rates. When the requested token is **not** in the platform’s liquidity pool (Base/Ethereum USDC or ETH), the backend chains a Fonbnk quote (fiat↔pool token) with a **swap quote** (pool token→requested token) and returns the combined result.

**Base path:** `/api/quote`  
**Auth:** Quote endpoints are excluded from `x-api-key`; no header required.

---

## Pool tokens

The platform’s liquidity pool currently holds:

- **Base** (chain ID `8453`): USDC, ETH  
- **Ethereum** (chain ID `1`): USDC, ETH  

Fonbnk supports these as payout/deposit assets (e.g. `BASE_USDC`, `BASE_ETH`, `ETHEREUM_USDC`, `ETHEREUM_ETH`). For any other token (e.g. MANA, Polygon USDC), the backend uses an **intermediate pool token** (same-chain USDC preferred, else same-chain ETH, else Base USDC), gets a Fonbnk quote for fiat↔that pool token, then a swap quote pool→requested token, and combines them.

---

## Onramp quote

### POST /api/quote/onramp

Returns a quote for **buying** crypto with fiat (onramp). Supports:

- **amount_in `fiat`** – “I pay this much fiat; how much crypto do I get?”
- **amount_in `crypto`** – “I want this much crypto; how much fiat do I pay?”

If the requested token is a **pool token** (Base/Ethereum USDC or ETH), the response is a direct Fonbnk quote. If the requested token is **not** in the pool, the response includes a **swap** step (pool token → requested token) and the fiat/crypto amounts reflect the chained Fonbnk + swap flow.

**Body (JSON):**

| Field            | Type   | Description |
|------------------|--------|-------------|
| `country`        | string | **Required.** Country code (e.g. `GH`, `NG`). Used for fiat currency and Fonbnk. |
| `chain_id`       | number | **Required.** Chain ID for the requested token (e.g. `8453` Base, `1` Ethereum). |
| `token`          | string | **Required.** Requested token: **symbol** (e.g. `USDC`, `ETH`) or **contract address**. For pool tokens use symbol or address; for others use contract address. |
| `amount`         | number | **Required.** Positive number. Meaning depends on `amount_in`: fiat amount (e.g. 100 GHS) or crypto amount in **human** units (e.g. 1.5 ETH, 100 MANA). |
| `amount_in`      | string | **Required.** `"fiat"` or `"crypto"`. |
| `from_address`   | string | Optional. Wallet address used for swap routing when the requested token is not a pool token. If omitted, a zero address is used (may limit some routes). |
| `token_decimals` | number | Optional. Decimals for the requested token when it is **not** a pool token and `amount_in` is `"crypto"`. Used to convert `amount` to wei for the swap. Default `18`. |

**Response (200) – pool token (direct Fonbnk):**

```json
{
  "success": true,
  "data": {
    "country": "GH",
    "currency": "GHS",
    "chain_id": 8453,
    "token": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "token_symbol": "USDC",
    "amount": 100,
    "amount_in": "fiat",
    "rate": 12.5,
    "fee": 1.2,
    "total_crypto": "7.92",
    "total_fiat": 100
  }
}
```

**Response (200) – non‑pool token (Fonbnk + swap):**

```json
{
  "success": true,
  "data": {
    "country": "GH",
    "currency": "GHS",
    "chain_id": 8453,
    "token": "0x...",
    "amount": 100,
    "amount_in": "fiat",
    "rate": 12.5,
    "fee": 1.2,
    "total_crypto": "1234567890000000000",
    "total_fiat": 100,
    "swap": {
      "from_chain_id": 8453,
      "from_token": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "to_chain_id": 8453,
      "to_token": "0x...",
      "from_amount": "7920000",
      "to_amount": "1234567890000000000",
      "provider": "0x"
    }
  }
}
```

**Fields:**

- **`country`**, **`currency`** – Country and fiat currency (e.g. GHS for Ghana).
- **`chain_id`**, **`token`**, **`token_symbol`** – Requested chain and token (symbol only for pool tokens).
- **`amount`**, **`amount_in`** – Input amount and whether it is fiat or crypto.
- **`rate`**, **`fee`** – From Fonbnk (fiat↔pool token).
- **`total_crypto`** – For `amount_in: "fiat"`: crypto the user receives (requested token). For pool token in human units; for non‑pool in **smallest unit** (string). For `amount_in: "crypto"` it is the requested token amount in smallest unit when a swap is used.
- **`total_fiat`** – Fiat the user pays (`amount_in: "fiat"`) or receives (`amount_in: "crypto"`).
- **`swap`** – Present only when the requested token is **not** in the pool. Describes the pool token → requested token step (chain, tokens, amounts, provider).

**Errors:**

- **400** – Validation failed (missing/invalid body fields).
- **404** – No Fonbnk quote for the request (e.g. unsupported country/token).
- **502** – Swap quote failed (no route, provider error).
- **503** – Fonbnk not configured (`FONBNK_CLIENT_ID` / `FONBNK_CLIENT_SECRET` missing).

---

## Environment

| Variable           | Description |
|--------------------|-------------|
| `FONBNK_API_URL`   | Optional. Default `https://api.fonbnk.com`. |
| `FONBNK_CLIENT_ID` | Required for onramp quotes. |
| `FONBNK_CLIENT_SECRET` | Required for onramp quotes. |
| `FONBNK_TIMEOUT_MS` | Optional. Request timeout in ms; default 10000. |

Swap providers (0x, Squid, LiFi) are used when the requested token is not a pool token; see [quote-api.md](./quote-api.md) for their configuration.
