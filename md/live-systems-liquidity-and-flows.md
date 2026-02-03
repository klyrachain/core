# Live Systems: Liquidity Pool, Wallet Management & Transaction Flows

This document captures the live-systems design: **unified wallet management** (including liquidity pool and fee-collection roles), how the **liquidity pool** is used for all crypto movements, and the **three transaction flows** (onramp, offramp, request & claim). It is the single source of truth for implementation and for the later **integration MD** (backend-as-proxy).

---

## 1. Understanding Summary

- **Two liquidity pools:**
  1. **Crypto liquidity pool** – A wallet (with private key) from which we **send** crypto (onramp, request/claim crypto payouts) and **receive** crypto (offramp, claim deposits). All live crypto flows go through this wallet.
  2. **Fiat liquidity pool** – Paystack balance. Fiat payouts (bank, mobile money) are done via Paystack transfers using `source: "balance"`; our Paystack balance is the fiat liquidity pool.
- **Wallet management** (for crypto only) should be **unified**: one CRUD for wallets. Each wallet can be marked as:
  - **Crypto liquidity pool** (exactly one per platform, or one per chain—see design choice below).
  - **Fee collection** (optional; where integrator/swap fees are sent; can be same or different wallet).
- **Private key** for the crypto liquidity pool is stored **encrypted** (existing `Wallet.encryptedKey` + `WalletManager`). Only the core backend ever decrypts it to sign outbound transfers; it is never exposed via API.
- **Three flows**:
  1. **Onramp** – User buys crypto: quote → Paystack payment → validations → **send crypto from liquidity pool** to user’s provided wallet address.
  2. **Offramp** – User sells crypto: we **generate calldata** for user to transfer from their wallet **to our liquidity pool** → we confirm receipt (tx hash from frontend + liquidity pool balance/events) → validations → **payout** (e.g. Paystack) to user’s bank/mobile.
  3. **Request & Claim** – Request: someone creates a request to be paid (crypto or fiat); fulfiller pays; we settle (cross-chain supported). Claim: sender sends funds; recipient must **verify email/phone (OTP)** and **enter 6-alphanumeric claim code** before claiming; we block bypass (no claim without verification). Both support **cross-chain settlement** (payer’s token ≠ recipient’s requested token; we handle via existing quote/swap logic).

---

## 2. Wallet Unification (Single CRUD)

There is **no separate “fee collection wallet” CRUD**. Everything lives under **Wallet Management**.

### 2.1 Schema (Wallet)

- **Existing:** `id`, `address`, `encryptedKey`, `supportedChains`, `supportedTokens`, `inventoryAssets`.
- **Add:**
  - `role` or flags:
    - Option A: `isLiquidityPool Boolean @default(false)` and `collectFees Boolean @default(false)`.
    - Option B: `role WalletRole @default(STANDARD)` with enum `STANDARD | LIQUIDITY_POOL | FEE_COLLECTION` (and optionally allow one wallet to be both via two booleans).
  - **Recommendation:** `isLiquidityPool Boolean @default(false)`, `collectFees Boolean @default(false)`. Enforce in app logic: **only one** wallet with `isLiquidityPool = true` globally (or one per chain if we scope liquidity pool per chain later).

### 2.2 Wallet Endpoints (Unified)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/wallets` | List wallets (paginated). Response includes `isLiquidityPool`, `collectFees`; `encryptedKey` always masked. |
| GET | `/api/wallets/:id` | Get one wallet (same masking). |
| POST | `/api/wallets` | Create wallet. Body: `address`, `privateKey` (plaintext, stored encrypted), `supportedChains`, `supportedTokens`, optional `isLiquidityPool`, `collectFees`. Admin-only. If `isLiquidityPool: true`, ensure no other wallet is already liquidity pool. |
| PATCH | `/api/wallets/:id` | Update wallet (supportedChains, supportedTokens, isLiquidityPool, collectFees). Cannot replace `encryptedKey` via PATCH (use dedicated rotate endpoint if needed). Admin-only. |

- **Liquidity pool resolution:** Internal service helper: `getLiquidityPoolWallet(chain?: string)` returns the wallet marked `isLiquidityPool`. Used by onramp send, offramp receive checks, and request/claim settlement.

### 2.3 Fiat liquidity (Paystack)

- Fiat payouts use **Paystack balance** as the fiat liquidity pool. Flow: create transfer recipient → initiate transfer with `source: "balance"`, amount (subunits), recipient_code, reference, currency.
- **Paystack handling (current):** Create recipient (`/transferrecipient`), initiate transfer (`/transfer` with source `"balance"`), verify transfer (`/transfer/verify/:reference`), list transfers for dashboard. This matches Paystack docs.
- **Optional:** When Paystack account has OTP enabled, initiate may return `status: "otp"`; then call `POST /transfer/finalize_transfer` with `transfer_code` and `otp` to complete. Can add `POST /api/paystack/payouts/finalize` (body: code, otp) when needed.
- **Optional:** On webhook `transfer.success` / `transfer.failed`, update `PayoutRequest` status by matching `reference` for audit consistency.

---

## 3. Transaction Flows & Endpoints

### 3.1 Onramp (Buy Crypto)

1. User gets **quote** (e.g. `POST /api/v1/quotes` with action BUY, fiat → crypto).
2. User proceeds → **Paystack** is triggered (e.g. `POST /api/paystack/payments/initialize` linked to a Transaction).
3. User pays; **Paystack webhook** `charge.success` fires → core updates Transaction to `COMPLETED`, computes fee, notifies.
4. **New step:** After Transaction is COMPLETED and type is BUY, core **sends crypto from the liquidity pool** to the user’s `toIdentifier` (wallet address).
   - Resolve liquidity pool wallet for `t_chain` / `t_token` (must have private key and support that chain/token).
   - Build transfer tx (native or ERC-20) and sign with decrypted key; submit; store tx hash on Transaction or linked record.
   - Idempotent: if crypto send already done for this Transaction, skip.
5. Optional: **Endpoint** for “execute onramp send” (e.g. `POST /api/transactions/:id/execute-onramp`) so that either:
   - Webhook handler calls an internal `executeOnrampSend(transactionId)`, or
   - A cron/queue job picks up COMPLETED BUY transactions without a `cryptoSendTxHash` and runs the send.  
   Either way, the **API contract** for the integrating backend can be: “After Paystack success, core will send crypto to the user’s wallet; poll transaction status or use webhooks.”

**Endpoints (existing + new):**

- `POST /api/v1/quotes` – get quote (BUY).
- `POST /api/paystack/payments/initialize` – start Paystack (linked to Transaction).
- Paystack webhook `POST /webhook/paystack` – charge.success → COMPLETED + **trigger send from liquidity pool** (internal).
- Optional: `POST /api/transactions/:id/execute-onramp` – idempotent “send crypto for this BUY” (admin or system).

---

### 3.2 Offramp (Sell Crypto → Fiat)

1. User gets **quote** (e.g. `POST /api/v1/quotes` with action SELL, crypto → fiat).
2. Core creates a Transaction (SELL, PENDING) and returns **calldata** (or builder params) for the user to **transfer crypto from their wallet to our liquidity pool** (amount, token, chain, our liquidity pool address).
3. User signs and submits the tx on the frontend; frontend sends back **transaction hash**.
4. **Confirmation:**  
   - Core receives `transaction_id` + `tx_hash` (e.g. `POST /api/offramp/confirm` or `PATCH /api/transactions/:id/confirm-offramp`).  
   - Core verifies on-chain: either by **listening for events** (incoming transfer to liquidity pool) or by **checking liquidity pool balance** before/after (or both).  
   - Only after confirmation that the liquidity pool received the funds: update Transaction to COMPLETED, then allow payout.
5. **Payout:** Existing flow: e.g. `POST /api/paystack/payouts/request` (with `transaction_id`) → user gets payout link → `POST /api/paystack/payouts/execute` with recipient details → Paystack transfer to bank/mobile.

**Endpoints:**

- `POST /api/v1/quotes` – quote for SELL.
- `POST /api/offramp/calldata` (or similar) – input: transaction_id (or quote + amount). Output: `toAddress` (liquidity pool), `chainId`, `token`, `amount` (wei), optional `calldata` / `data` for a standard transfer so the frontend can build the tx.  
  Alternatively, this can be part of “create SELL order” response (e.g. order webhook response or a dedicated “create offramp order” endpoint).
- `POST /api/offramp/confirm` – body: `transaction_id`, `tx_hash`. Core: verify tx on chain (sender, recipient, amount), verify recipient is our liquidity pool, then mark Transaction COMPLETED and enable payout. If verification fails, return 400 with reason.
- Existing: `POST /api/paystack/payouts/request`, `POST /api/paystack/payouts/execute`, etc.

**Security / monitoring:**  
- Use a **secure** mechanism to confirm receipt: either indexer/backend listening for Transfer/Deposit events to the liquidity pool address, or balance-delta checks with idempotency. Avoid trusting only the frontend tx hash without verifying recipient and amount on-chain.

---

### 3.3 Request & Claim

**Request:**

- **Create request:** Someone (requestor) wants to receive X (crypto or fiat). Creates a request (e.g. `POST /api/requests` with amount, asset, receiving identifier). Backend creates Request + Transaction (REQUEST, PENDING).
- **Fulfill:** Payer fulfills (pays crypto or fiat as per request). Can be cross-chain: payer’s token ≠ requestor’s requested token; we use quote/swap to get equivalent amount.
- **Settle:** Once payment is confirmed (crypto received in liquidity pool or fiat received via Paystack), we **settle** the requestor: if they asked for crypto, send from liquidity pool to their address; if fiat, trigger Paystack payout. Same cross-chain logic: we may swap on our side if we hold different token.

**Claim:**

- **Create claim:** Sender creates a claim (e.g. “I want to send funds to this person”; recipient identified by email or phone). Backend creates Claim + Request + Transaction; generates **6-alphanumeric code** and sends **OTP** to recipient’s email/phone.
- **Recipient verification:** Recipient must **verify email/phone (OTP)** before they can claim. No bypass: if they hit “claim” without verifying, we block.
- **Claim step:** Recipient enters **6-alphanumeric code** and completes claim. Backend verifies code, then:
  - If recipient wants **crypto:** we send from liquidity pool to their wallet (cross-chain if needed).
  - If recipient wants **fiat:** we trigger Paystack payout to their bank/mobile.
- **Sender side:** Sender sends crypto to our liquidity pool (or pays fiat via Paystack). We confirm receipt (same as offramp: tx hash + liquidity pool confirmation). Only after that is the claim “funded” and the recipient can receive their chosen asset.

**Endpoints (to be standardized):**

- Request: `POST /api/requests` (create), `GET /api/requests/:id`, optional `POST /api/requests/:id/fulfill` (or fulfill is part of order/quote flow), `POST /api/requests/:id/settle` (internal or admin after confirmation).
- Claim: `POST /api/claims` (create claim; sends OTP to recipient), `POST /api/claims/verify-otp` (recipient verifies email/phone), `GET /api/claims/:code` (by 6-char code; for recipient to see claim details), `POST /api/claims/:code/claim` (body: 6-char code, recipient’s chosen payout: wallet address or bank/mobile).  
  Enforce: `claim` succeeds only if OTP was verified for that email/phone and code matches.

**Cross-chain:**  
- Handled by existing quote/swap and liquidity pool: we receive token A, need to send token B → use internal swap or existing swap provider; then send from liquidity pool to recipient.

### 3.4 Settlement: inventory check and fiat path

- **Before any crypto settlement (request/claim):** Check that we **have the receiving token** in inventory (liquidity pool) for the chain/token the recipient will receive. If we do not have enough of that token, do **not** attempt cross-chain swap until we have it, or settle via **fiat path**: pay the user in fiat (Paystack) instead of sending unsupported or missing crypto.
- **Cross-chain or unsupported token:** If the recipient requested a token we don’t hold or is not supported, we must either (a) use original provider quotes to swap via our liquidity pool and then send, or (b) settle in fiat. Track which path was used for P&L.

### 3.5 Request & Claim: pricing engine vs settlement quotes

- **What users see / pay:** **Pricing engine** affects the quotes presented to endpoint callers and what users pay (margins, fees).
- **What we use for settlement:** For **request and claim**, swaps are done via **our liquidity pool** using **original provider quotes** (Fonbnk, swap providers). We do **not** use pricing-engine-adjusted quotes for the actual settlement execution.
- **Quote tracking:** When someone creates a request, we store the quote they see (e.g. “you will receive X token”). When the payer fulfills later, provider quotes may have changed (we gain or lose). We must **track quotes** at both creation and fulfillment: store `providerPrice` / `settlementQuoteSnapshot` on the Transaction so we can measure P&L and ensure we try to deliver the promised amount.

### 3.6 Transaction balance snapshots

- For **each transaction**, record **balance before** and **balance after** for each affected inventory asset (liquidity pool). This gives an audit trail when many transactions run concurrently (one that started later can complete first); when viewing transaction data we can check that the balance at that point in time makes sense.
- Implemented via **TransactionBalanceSnapshot** (transactionId, assetId, balanceBefore, balanceAfter). Recorded when deducting or adding inventory with `sourceTransactionId` set.

---

## 4. Endpoint Summary Table

| Area | Method | Path | Purpose |
|------|--------|------|---------|
| Wallets | GET | `/api/wallets` | List wallets (paginated) |
| Wallets | GET | `/api/wallets/:id` | Get wallet (key masked) |
| Wallets | POST | `/api/wallets` | Create wallet (incl. liquidity pool / fee role) |
| Wallets | PATCH | `/api/wallets/:id` | Update wallet (incl. roles) |
| Onramp | POST | `/api/v1/quotes` | Quote (BUY) |
| Onramp | POST | `/api/paystack/payments/initialize` | Start Paystack |
| Onramp | (internal) | Paystack webhook → send crypto | After charge.success, send from liquidity pool |
| Onramp | POST | `/api/transactions/:id/execute-onramp` | Optional idempotent “send crypto” |
| Offramp | POST | `/api/v1/quotes` | Quote (SELL) |
| Offramp | GET | `/api/offramp/calldata?transaction_id=` | Get liquidity pool address + params for user transfer |
| Offramp | POST | `/api/offramp/confirm` | Confirm tx_hash + liquidity pool receipt → COMPLETED |
| Offramp | POST | `/api/paystack/payouts/request` | Request payout link |
| Offramp | POST | `/api/paystack/payouts/execute` | Execute payout (bank/mobile) |
| Request | POST | `/api/requests` | Create request |
| Request | GET | `/api/requests/:id` | Get request |
| Request | (internal) | Fulfill + settle | After payment confirmed |
| Claim | POST | `/api/claims` | Create claim (sends OTP) |
| Claim | POST | `/api/claims/verify-otp` | Recipient verify email/phone (body: claim_id or code, otp) |
| Claim | GET | `/api/claims/by-code/:code` | Get claim by 6-char code (for recipient) |
| Claim | POST | `/api/claims/claim` | Claim with 6-char code + payout_type + payout_target (block if no OTP) |

---

## 5. Implementation Plan (Order of Work)

1. **Wallet schema + CRUD**  
   Add `isLiquidityPool`, `collectFees` to Wallet. Implement POST and PATCH in `/api/wallets`. Add internal `getLiquidityPoolWallet(chain?)`.

2. **Onramp: send from liquidity pool**  
   After Paystack `charge.success` and Transaction COMPLETED (BUY), call internal service that: resolves liquidity pool, decrypts key, builds and submits transfer to `toIdentifier`. Store `cryptoSendTxHash` on Transaction (or linked table). Optional: `POST /api/transactions/:id/execute-onramp` for idempotent retry.

3. **Offramp: calldata + confirm**  
   Add `POST /api/offramp/calldata` (return liquidity pool address, chainId, token, amount, calldata). Add `POST /api/offramp/confirm` (tx_hash + transaction_id; verify on-chain; set COMPLETED). Implement verification (event listener or balance check).

4. **Request & Claim**  
   Implement OTP send/verify for claims; enforce 6-alphanumeric code and “no claim without OTP”. Implement request fulfill + settle (crypto/fiat, cross-chain via quote/swap). Implement claim create → verify-otp → claim (with payout choice).

5. **Tests**  
   Unit tests for wallet role resolution, onramp send (mocked signer), offramp confirm (mocked chain), request/claim flows (OTP and code validation).

6. **Integration MD**  
   Once the above is implemented and tested, create the **bundled integration MD** that instructs how a **backend-as-proxy** integrates with this core (quotes with pricing engine, transfers, request/claim, webhooks).

---

## 6. Security Notes

- **Private key:** Only ever decrypted inside the core backend for signing; never returned in any API response. Wallet list/detail always mask `encryptedKey`.
- **Liquidity pool:** Only one wallet (or one per chain) marked as liquidity pool; enforced on POST/PATCH.
- **Offramp confirm:** Always verify on-chain that the tx actually sent funds to our liquidity pool; do not rely only on client-supplied tx_hash without recipient/amount check.
- **Claim:** Block claim until OTP is verified for the same email/phone; require 6-alphanumeric code; no bypass.

---

*This document is the reference for implementing live systems and for writing the later integration guide (backend-as-proxy).*
