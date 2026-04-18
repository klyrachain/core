# Backend Integration Guide — Core API (Proxy Integration)

**Purpose:** This is the **single document** to give to the **other backend** team. That backend will sit in front of Core as a **proxy**: the **frontend** talks only to your backend; your backend calls **Core** with an API key. Core holds live systems (quotes with pricing engine, liquidity pool, Paystack, request/claim). Once your backend integrates with Core using this guide, you can expose your own API to the frontend and link the two.

**Audience:** Backend developers integrating with Core (Central Point).  
**See also:** `live-systems-liquidity-and-flows.md` (flows), `quote-api.md` (v1 quotes), `core-api.integration.md` (full endpoint list), `onramp-offramp-integration.md` (flows in detail).

---

## 1. Architecture

```
[Frontend]  ←→  [Your Backend (Proxy)]  ←→  [Core]
                       ↑
                 x-api-key
                 (never expose to frontend)
```

- **Core** = central service: quotes (with pricing engine), transactions, liquidity pool, Paystack, request/claim, webhooks.
- **Your backend** = proxy. It must:
  - Authenticate your users/session.
  - Call Core with a **platform API key** (`x-api-key`).
  - Never expose the Core API key to the frontend.
- **Frontend** talks only to your backend. Your backend translates requests into Core calls and returns what the frontend needs.

---

## 2. Base URL and auth

| Item | Value |
|------|--------|
| **Base URL** | e.g. `https://core.example.com` or `http://localhost:4000` (configurable; ask for the environment URL). |
| **Auth** | **All Core API endpoints** (except health/ready and Paystack webhook) require **either** an API key **or** an admin session. |
| **Header** | `x-api-key: <PLATFORM_API_KEY>`. Your backend must send this on every request to Core. |
| **Public (no key)** | `GET /api/health`, `GET /api/ready`. Paystack webhook: `POST /webhook/paystack` (secured by Core with `x-paystack-signature`; Paystack servers do not send `x-api-key`). |

**Important:** The API key is a **platform** key (no `businessId`). Store it in your backend env (e.g. `CORE_API_KEY`) and never send it to the browser.

---

## 3. What Core gives you (live system)

- **Quotes with pricing engine** — Not raw provider quotes. Use `POST /api/v1/quotes` for ONRAMP, OFFRAMP, and SWAP. Core applies the pricing engine and returns a single rate and fee breakdown.
- **Onramp** — User buys crypto with fiat. Flow: get quote → create order → initialize Paystack → user pays → Core receives Paystack webhook → Core sends crypto from liquidity pool to user’s wallet.
- **Offramp** — User sells crypto for fiat. Flow: get quote → create SELL order → get calldata (where to send crypto) → user sends tx → confirm with tx_hash → request/execute Paystack payout.
- **Request & Claim** — Request: someone requests payment; fulfiller pays; Core settles. Claim: sender sends funds; recipient verifies OTP and 6-char code, then claims (crypto or fiat payout).

---

## 4. Endpoints your backend must call (by flow)

### 4.1 Health

| Method | Core path | Use |
|--------|-----------|-----|
| GET | `/api/health` | Liveness. |
| GET | `/api/ready` | Readiness (DB + Redis). |

### 4.2 Quotes (always use v1 — pricing engine)

| Method | Core path | Body (JSON) | Use |
|--------|-----------|-------------|-----|
| POST | `/api/v1/quotes` | `action`, `inputAmount`, `inputCurrency`, `outputCurrency`, `chain`, optional `inputSide` | Get a **single quote** for ONRAMP / OFFRAMP / SWAP. Response includes `quoteId`, `exchangeRate`, `basePrice`, `input`, `output`, `fees`. Store `quoteId` if you need to link the order to this quote. |

- **action:** `"ONRAMP"` \| `"OFFRAMP"` \| `"SWAP"`.
- **inputAmount:** string, e.g. `"100"`.
- **inputCurrency / outputCurrency:** symbol (e.g. `GHS`, `USDC`) or token address for SWAP.
- **chain:** e.g. `base`, `ethereum` (required).
- **inputSide:** `"from"` = amount is what user pays; `"to"` = amount is what user wants to receive.

Response: `data.quoteId`, `data.output.amount`, `data.exchangeRate`, `data.fees.platformFee`, etc. Use this to show the user one price and to create the order with the same amounts/rates.

### 4.3 Onramp (buy crypto with fiat)

1. **Quote** — `POST /api/v1/quotes` with `action: "ONRAMP"`, fiat as `inputCurrency`, crypto as `outputCurrency`, `chain`.
2. **Create order** — `POST /webhook/order` with `action: "buy"`, amounts and prices from the quote, `f_provider: "PAYSTACK"`, `t_provider: "KLYRA"`, `toIdentifier` = user’s **wallet address**, `fromIdentifier` = user email (or phone). Include `quoteId` if you have it. Core returns `data.id` (transaction id).
3. **Initialize Paystack** — `POST /api/paystack/payments/initialize` with `email`, `amount` (subunits or major), `currency`, optional `transaction_id` (the one from step 2), optional `callback_url`. Core returns Paystack auth URL; redirect the user there.
4. **Payment** — User pays on Paystack. Paystack sends `charge.success` to **Core** (`POST /webhook/paystack`). Core updates the transaction to COMPLETED and **sends crypto from the liquidity pool** to `toIdentifier`. Your backend can poll `GET /api/transactions/:id` to see `status: "COMPLETED"` and optional `cryptoSendTxHash`, or rely on Pusher if configured.

**Note:** Paystack must send webhooks to **Core’s** URL (or your backend forwards to Core with the same body and `x-paystack-signature`). Core verifies the signature; it does not require `x-api-key` for the webhook.

### 4.4 Offramp (sell crypto for fiat)

1. **Quote** — `POST /api/v1/quotes` with `action: "OFFRAMP"`, crypto as `inputCurrency`, fiat as `outputCurrency`, `chain`.
2. **Create order** — `POST /webhook/order` with `action: "sell"`, amounts/prices from quote, `fromIdentifier` = user’s wallet address, `toIdentifier` = user email (or where they want fiat). Core returns transaction `id`.
3. **Get calldata** — `GET /api/offramp/calldata?transaction_id=<id>`. Core returns `toAddress` (liquidity pool), `chainId`, `token`, `tokenAddress`, `amount`, `decimals`. Your frontend uses this to build and sign the transfer from the user’s wallet to `toAddress`.
4. **User sends tx** — User signs and submits the tx; frontend gets `tx_hash` and sends it to your backend.
5. **Confirm** — Your backend calls `POST /api/offramp/confirm` with body `{ "transaction_id": "<id>", "tx_hash": "<hash>" }`. Core credits the liquidity pool and sets the transaction to COMPLETED.
6. **Payout** — Your backend calls `POST /api/paystack/payouts/request` with `{ "transaction_id": "<id>" }`. Core returns a `code`. Then user (or you) provides bank/mobile details and you call `POST /api/paystack/payouts/execute` with that `code` and recipient details (amount, currency, recipient_type, name, account_number, bank_code if nuban, etc.). Core performs the Paystack transfer from the fiat liquidity pool (Paystack balance).

### 4.5 Request & Claim

- **Request:** Create via `POST /webhook/order` with `action: "request"` (and appropriate identifiers). List/get: `GET /api/requests`, `GET /api/requests/:id`.
- **Claim:**  
  - **Get by code (recipient):** `GET /api/claims/by-code/:code` — returns claim details and whether OTP is verified.  
  - **Verify OTP:** `POST /api/claims/verify-otp` — body `{ "claim_id" or "code", "otp" }`. Core sets `otpVerifiedAt`.  
  - **Claim:** `POST /api/claims/claim` — body `{ "code", "payout_type": "crypto" | "fiat", "payout_target" }`. Core allows this only if OTP was verified; then marks claim CLAIMED and transaction COMPLETED.

When **creating** a claim (e.g. from your backend or when sending funds to email/phone), you must generate an OTP, send it to the recipient (email/SMS), and store it in Core (or Core stores it when you create the claim — see Core’s claim-creation flow). The recipient then calls verify-otp and claim from your frontend; your backend proxies to Core.

### 4.6 Order webhook (create transaction in Core)

Your backend should create orders/transactions in Core so that Core can run validations, fees, and liquidity-pool logic.

| Method | Core path | Body (JSON) |
|--------|-----------|-------------|
| POST | `/webhook/order` | `action` (`buy` \| `sell` \| `request` \| `claim`), `fromIdentifier`, `fromType`, `toIdentifier`, `toType`, `f_amount`, `t_amount`, `f_price`, `t_price`, `f_chain`, `t_chain`, `f_token`, `t_token`, `f_provider`, `t_provider`, optional `providerSessionId`, `requestId`, `quoteId`, `providerPrice`. |

Core returns `201` with `data.id` (transaction id). Use this id for Paystack initialize, offramp calldata/confirm, and payout request.

**Validation:** Core validates provider and identifiers. If validation fails, you get `400` with `code` (e.g. `SAME_TOKEN_SAME_CHAIN`, `MISSING_TO_IDENTIFIER`). See `core-api.integration.md` for full body and validation rules.

### 4.7 Transactions and status

| Method | Core path | Use |
|--------|-----------|-----|
| GET | `/api/transactions/:id` | Poll transaction status (e.g. after Paystack redirect). |
| GET | `/api/transactions/:id/balance-snapshots` | Balance before/after per asset for this transaction (audit). |
| GET | `/api/transactions/:id/pnl` | PnL rows if this was a sell. |

### 4.8 Supporting data (for your frontend)

Your backend can proxy these so the frontend can show chains, tokens, countries, etc.:

| Method | Core path | Use |
|--------|-----------|-----|
| GET | `/api/chains` | List supported chains. |
| GET | `/api/tokens` | List supported tokens (by chain). |
| GET | `/api/countries` | Countries/currencies for onramp/offramp. |

All require `x-api-key`.

---

## 5. Webhooks

| Webhook | Direction | Who calls | Auth |
|---------|-----------|-----------|------|
| **Order** | Your backend → Core | You call `POST /webhook/order` with the API key in `x-api-key`. | `x-api-key` |
| **Paystack** | Paystack → Core | Paystack must POST to Core’s URL (e.g. `https://core.example.com/webhook/paystack`) with `x-paystack-signature`. Core verifies the signature; no API key. | Signature only |

If Paystack is configured to send webhooks to **your** backend, your backend must forward the **raw body** and `x-paystack-signature` to Core’s `/webhook/paystack` (e.g. proxy POST). Do not re-sign; Core will verify using its own `PAYSTACK_SECRET_KEY`.

---

## 6. Response envelope and errors

- **Success:** `{ "success": true, "data": { ... } }`. List endpoints also return `meta`: `{ "page", "limit", "total" }`.
- **Error:** `{ "success": false, "error": "message" }` and optional `details`, `code`. Typical status: `400` validation, `404` not found, `503` provider not configured.

---

## 7. Quick reference — endpoints to integrate

| Flow | Endpoints to call (in order) |
|------|-----------------------------|
| **Onramp** | 1) `POST /api/v1/quotes` (ONRAMP) 2) `POST /webhook/order` (buy) 3) `POST /api/paystack/payments/initialize` 4) Redirect user to Paystack 5) Poll `GET /api/transactions/:id` or use webhooks |
| **Offramp** | 1) `POST /api/v1/quotes` (OFFRAMP) 2) `POST /webhook/order` (sell) 3) `GET /api/offramp/calldata?transaction_id=` 4) User sends tx 5) `POST /api/offramp/confirm` 6) `POST /api/paystack/payouts/request` 7) `POST /api/paystack/payouts/execute` |
| **Request** | `POST /webhook/order` (request); `GET /api/requests`, `GET /api/requests/:id` |
| **Claim** | `GET /api/claims/by-code/:code`; `POST /api/claims/verify-otp`; `POST /api/claims/claim` |
| **Swap only** | `POST /api/v1/quotes` (SWAP); then execute swap on your side or via Core as needed |

---

## 8. Payment instructions (multi-chain calldata)

`GET /api/offramp/calldata`, `POST /api/app-transfer/intent`, and `GET /api/requests/calldata` return a **discriminated** payload on `data` (and intent nests it under `calldata`):

| `kind` | Meaning |
|--------|---------|
| `evm_erc20_transfer` | Same as legacy: `toAddress`, `chainId`, `tokenAddress`, `amount`, `decimals`. Only this kind supports automatic `POST /api/offramp/confirm` / `confirm-crypto` today. |
| `solana_spl_transfer` | `recipientAddress`, `mint`, `amountAtomic`, `decimals`. Confirm returns **501** until a Solana verifier exists. |
| `stellar_payment` | `destination`, `amount`, `assetType`, optional `assetCode` / `assetIssuer`. Confirm **501**. |
| `bitcoin_utxo` | `address`, `amountBtc`, `amountSats`. Confirm **501**. |
| `unsupported` | `unsupportedReason` explains missing `PlatformPoolDestination` or config. |

**Platform pool routing:** Configure rows via `GET/POST/PATCH/DELETE /api/platform-pool-destinations` (platform admin). Optional `infisicalSecretName` + `infisicalSecretPath` resolve the receive address from Infisical at runtime (Core env: `INFISICAL_SERVICE_TOKEN`, `INFISICAL_PROJECT_ID`, `INFISICAL_ENVIRONMENT_SLUG`, `INFISICAL_SITE_URL`).

---

## 9. Security checklist (your backend)

- [ ] Store Core base URL and API key in server-side env only.
- [ ] Never send `x-api-key` or Core URL to the frontend.
- [ ] Authenticate your users before proxying to Core; map your user/session to the identifiers you send in `fromIdentifier` / `toIdentifier`.
- [ ] If you forward Paystack webhooks to Core, forward the raw body and `x-paystack-signature` unchanged.

---

**This file is the handoff document for the backend team.** For more detail on flows and fields, use `live-systems-liquidity-and-flows.md`, `quote-api.md`, and `core-api.integration.md`.
