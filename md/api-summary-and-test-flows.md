# API Summary and Test Flows

**Purpose:** Cross-reference of Core API docs (payment-api, quote-api, onramp-offramp-integration, onramp-quote-api, crypto-transactions-api, core-api.integration) and real-world test flows for `pnpm test:live`.

---

## 1. Doc summary

| Doc | Scope |
|-----|--------|
| **core-api.integration.md** | Health, ready, fetch API (users, transactions, requests, claims, wallets, inventory, cache, queue, logs), POST /webhook/order, POST /webhook/admin, enums, Pusher. |
| **payment-api.md** | Paystack: banks (list, resolve, validate), mobile providers, payments/initialize, transactions (verify, list, by id), transfers list, payouts (request, get by code, execute, verify, history). |
| **quote-api.md** | Swap: POST /api/quote/swap, POST /api/quote/best; fee: GET /api/quote. Auth: quote endpoints excluded from x-api-key. |
| **onramp-quote-api.md** | POST /api/quote/onramp (fiat↔crypto via Fonbnk; chains swap when token not in pool). |
| **onramp-offramp-integration.md** | Onramp/offramp flows, receivers (wallet vs email/phone), request/claim, Paystack linking, CryptoTransaction linking. |
| **crypto-transactions-api.md** | POST/PATCH/GET /api/crypto-transactions, by-hash, :id/status. Record swap executions (0x, Squid, LiFi). |

---

## 2. Validation rules (currencies vs tokens; same token same chain)

- **Currencies vs tokens:** Fiat currencies (GHS, USD, NGN, KES, ZAR) are **not** on-chain tokens. When `f_provider` or `t_provider` is **KLYRA**, the corresponding token (`f_token` or `t_token`) must **not** be a fiat currency — use on-chain symbols (e.g. USDC, ETH). Rejected with `400` and code `FIAT_NOT_ALLOWED_AS_TOKEN`.
- **Same token, same chain:** If from and to are the same token on the same chain, the request is rejected (no-op swap). Applies to: `POST /webhook/order`, `GET /api/quote`, `POST /api/quote/swap`, `POST /api/quote/best`, `POST /api/crypto-transactions`. Rejected with `400` and code `SAME_TOKEN_SAME_CHAIN`.

## 3. Discrepancies (code vs docs)

- **Order webhook (`POST /webhook/order`):**  
  In **code**, `f_provider` and `t_provider` are **required** (no default).  
  **core-api.integration.md** now states they are required.

- **PaymentProvider enum:**  
  **core-api.integration.md** includes **`KLYRA`**.

---

## 4. Endpoints used by test:live (by doc)

- **core-api:** GET /health, GET /api/users, /api/transactions, /api/requests, /api/claims, /api/wallets, /api/inventory, /api/inventory/history, /api/cache/balances, /api/queue/poll, GET /api/quote (fee), POST /webhook/order, POST /webhook/admin.
- **payment-api:** GET /api/paystack/banks, /api/paystack/banks/resolve, /api/paystack/mobile/providers, /api/paystack/transactions, /api/paystack/transfers, /api/paystack/payouts/history; POST /api/paystack/payments/initialize (real-world flow).
- **quote-api:** GET /api/quote (fee), POST /api/quote/swap, POST /api/quote/best.
- **onramp-quote-api:** POST /api/quote/onramp.
- **crypto-transactions-api:** POST /api/crypto-transactions, GET /api/crypto-transactions, PATCH /api/crypto-transactions/:id.

---

## 5. Real-world test flows (simulate production)

These flows use **dynamic data** and **multi-step sequences** where applicable.

1. **Order → Paystack initialize**  
   POST /webhook/order (buy, f_provider/t_provider set) → get `transaction_id` → POST /api/paystack/payments/initialize with that `transaction_id`, email, amount (subunits), currency. Simulates “user proceeds to pay with fiat”.

2. **Fee quote → order**  
   GET /api/quote?action=buy&… (and other params) → use quote for display → POST /webhook/order with same params + f_provider/t_provider. Simulates “get quote then create order”.

3. **Banks list → resolve**  
   GET /api/paystack/banks?country=nigeria (or ghana) → use a returned `bank_code` (or doc example 063) → GET /api/paystack/banks/resolve?account_number=…&bank_code=…. Simulates “populate banks then verify account name”. (Resolve may 502 if account invalid; that’s acceptable in test.)

4. **Swap quote → record crypto transaction**  
   POST /api/quote/swap (or /api/quote/best) with provider, chains, tokens, amount, from_address → POST /api/crypto-transactions with provider, from_chain_id, to_chain_id, from_token, to_token, from_amount, to_amount (from quote). Simulates “user picks quote and we record the swap”.

5. **Onramp quote**  
   POST /api/quote/onramp with country (e.g. GH, NG), chain_id (1 or 8453), token (USDC or address), amount, amount_in (fiat or crypto). Simulates “get fiat↔crypto quote before payment”. (503 if Fonbnk not configured.)

6. **Transactions list with filters**  
   GET /api/transactions?status=COMPLETED&limit=5, GET /api/transactions?type=BUY&limit=5. Matches core-api query params for dashboards.

7. **Payout request (when a completed tx exists)**  
   GET /api/transactions?status=COMPLETED&limit=1 → take first id → POST /api/paystack/payouts/request with that transaction_id. Simulates “user requests payout after completed sell”. (400 if no COMPLETED tx or Paystack not configured.)

8. **Crypto transaction list and status**  
   GET /api/crypto-transactions?limit=5; GET /api/crypto-transactions/:id; GET /api/crypto-transactions/:id/status (optional ?update=1). Simulates dashboard and status checks.

9. **Inventory history**  
   GET /api/inventory/history?perPage=5 (and optional ?assetId=, ?chain=). Matches inventory API for audit.

---

## 6. Test categories (test:live -f / -t)

- **paystack** – Paystack GET (banks, resolve, mobile, transactions, transfers, payouts/history) and POST payments/initialize.
- **order** / **klyra** – POST /webhook/order (buy/sell/request/claim) with f_provider/t_provider.
- **quote** – GET /api/quote (fee), POST /api/quote/swap, POST /api/quote/best, POST /api/quote/onramp.
- **fetch** – GET users, transactions (with optional status/type), requests, claims, wallets, inventory, inventory/history, cache/balances, queue/poll, crypto-transactions.
- **admin** – POST /webhook/admin.
- **crypto** (optional) – POST /api/crypto-transactions, GET /api/crypto-transactions, PATCH /api/crypto-transactions/:id.

Use `pnpm test:live -f paystack -t klyra` (etc.) to restrict to these categories; flows above use endpoints from the referenced docs so tests simulate real-world transactions instead of static data only.
