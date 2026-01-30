# Onramp / Offramp Integration Guide

This guide describes how the backend supports **onramp** (fiat → crypto) and **offramp** (crypto → fiat) flows, how they link to **Paystack**, and how **receivers** (wallet vs email/phone) and **claims** work. It maps flows to existing entities: `Transaction`, `Request`, `Claim`, `PayoutRequest`, `PaystackPaymentRecord`, and `CryptoTransaction`.

---

## 1. Onramp flow (buy crypto with fiat)

1. **Quote** – User gets an onramp quote (POST `/api/quote/onramp`). If the requested token is in the pool (Base/Ethereum USDC or ETH), the quote is direct from Fonbnk; otherwise it chains Fonbnk + swap quote.
2. **Proceed** – User is satisfied and proceeds to purchase.
3. **Identity / source of income** – User fills a form: verify identity and source of income; verify **name on the paying account** (the account they will use to pay).
4. **Paystack** – User is redirected to Paystack to make the fiat payment (mobile money, card, etc.).
5. **Verification** – When Paystack confirms the payment (webhook or verify), the backend records it (`PaystackPaymentRecord`) and can link to a business `Transaction`.
6. **Token release** – After payment is verified, a **request** is placed for the token to be released. If the recipient is a **wallet address**, settlement can be direct (platform sends crypto to that address after checks). If the recipient is **email or phone**, the flow uses a **payment request on behalf of the receiver** and a **claim** (see Receivers below).

**Entities:** `Transaction` (type BUY), `PaystackPaymentRecord` (reference, paystackId, transactionId), optional `CryptoTransaction` when a swap is involved (linked via `transactionId`).

---

## 2. Offramp flow (sell crypto for fiat)

1. **Quote** – User gets sell rates (Fonbnk sell: crypto → fiat). Same logic as onramp: direct for pool tokens; for other tokens, swap quote (requested → pool) then Fonbnk sell quote.
2. **Proceed** – User is satisfied and proceeds to sell.
3. **Verification** – User’s crypto side is verified (e.g. swap/transfer recorded in `CryptoTransaction` or business `Transaction`).
4. **Paystack payout** – Backend creates a `PayoutRequest` (with code for the frontend). User (or support) triggers payout; backend calls Paystack transfer; result is stored in `PaystackTransferRecord`.
5. **Fiat received** – User receives fiat per Paystack (bank, mobile money, etc.).

**Entities:** `Transaction` (type SELL), `PayoutRequest` (transactionId, code, status, recipientCode, transferCode), `PaystackTransferRecord`.

---

## 3. Receivers: wallet vs email/phone

### 3.1 Recipient is a **wallet address**

- The address belongs to the user or they control it.
- After checks and verifications (payment confirmed, etc.), settlement is **direct**: platform sends crypto to that address (no claim flow).
- No payment request “on behalf of” the receiver; the business `Transaction` has `toIdentifier` = address, `toType` = ADDRESS.

### 3.2 Recipient is **email or phone**

- User doing the onramp does **not** send to their own wallet; they specify an **email** or **phone** for the recipient.
- **Flow:**
  1. Backend sends the recipient an **alphanumeric code** (e.g. by email or SMS).
  2. Sender sees the same code (or a link) and shares it with the recipient.
  3. Recipient **accepts** (e.g. clicks link, enters code); backend records acceptance.
  4. Because the recipient has no “receiving channel” yet, we create a **payment request on behalf of the receiver**. That request does not have a pre-set receiving channel; the **recipient** will decide where to receive (fiat or crypto, and which wallet/bank).
  5. This also creates a **claim**: the person **claiming** is the recipient. The claim is tied to the request.
- **Why payment request on behalf of receiver?** So we have a request that has no receiving channel yet; the recipient will later choose (e.g. fiat payout via Paystack or crypto to a wallet). Frontend uses the same “payment request” UX: link/code, verification, then claim with channel selection.

**Entities:** `Request` (code, linkId, transactionId), `Claim` (requestId, status, value, token, payerIdentifier, toIdentifier, code). The business `Transaction` has `toIdentifier` = email/number, `toType` = EMAIL | NUMBER.

---

## 4. Payment request (normal) vs onramp receiver request

### 4.1 Normal payment request

- Someone (A) **requests payment** from someone else (B). We create a `Transaction` (type REQUEST) and a `Request` (code, linkId). A shares the link with B. B pays (e.g. via Paystack). When payment is verified, A is notified and can **claim** (e.g. receive crypto or fiat). Typical use: A has crypto and wants to settle in fiat; B pays fiat; A claims.

### 4.2 Onramp with email/phone recipient

- **Sender** is doing the onramp (paying fiat to buy crypto for someone else). We **file the payment request on behalf of the receiver**. So the “requester” in the system is the receiver; the **payer** is the sender. After Paystack payment is verified, the **receiver** is notified and can **claim**. When claiming, if the receiving channel was **already set** (e.g. wallet or bank), we use it; if **not set**, the recipient chooses on the frontend (fiat payout or crypto to a wallet). Verifications/codes/links are used before executing fiat payout or crypto payout.

---

## 5. Claim and receiving channel

- **Claim** = the act of the recipient/requester claiming the payment (receive fiat or crypto).
- If the **receiving channel was set** (intended request): use that channel (e.g. Paystack recipient for fiat, or wallet for crypto). Core backend can set the recipient wallet for crypto for security; Paystack handles fiat; frontend integrates with both.
- If the **receiving channel was not set** (e.g. onramp to email/phone): recipient **picks** on the frontend (fiat or crypto, and destination). Backend then executes:
  - **Fiat payout** – Paystack transfer (create recipient if needed, then transfer); record in `PayoutRequest` / `PaystackTransferRecord`.
  - **Crypto payout** – Send to provided wallet (same chain, other token same chain, or other chain via swap if needed). Optionally record in `CryptoTransaction` if a swap is used.
- Recipients can choose to receive **on-chain** in different ways: same token, another token on the same chain, or another token on another chain (swap/bridge). That may require a swap step (recorded in `CryptoTransaction`).

---

## 6. Linking swap (CryptoTransaction) to fiat (Transaction / Paystack)

- When an onramp or offramp involves a **swap** (requested token not in pool), we record the swap in **CryptoTransaction** (provider, chains, tokens, amounts, tx_hash, status).
- When a business **Transaction** already exists (e.g. BUY/SELL created when the user initiates onramp/offramp), we pass that `Transaction.id` as **transaction_id** when creating the **CryptoTransaction**. That links the swap to the fiat flow for audit and support.
- **Paystack** links via `PaystackPaymentRecord.transactionId` (onramp) and `PayoutRequest.transactionId` (offramp). So: Paystack payment ↔ Transaction ↔ (optional) CryptoTransaction.

---

## 7. Summary table

| Flow | Main entities | Paystack | Receiver |
|------|----------------|----------|----------|
| Onramp, wallet recipient | Transaction (BUY), PaystackPaymentRecord, optional CryptoTransaction | Charge / verify | Direct settlement to address |
| Onramp, email/phone recipient | Transaction (BUY), Request, Claim, PaystackPaymentRecord | Charge / verify | Payment request on behalf of receiver; recipient claims and picks channel |
| Offramp | Transaction (SELL), PayoutRequest, PaystackTransferRecord, optional CryptoTransaction | Transfer | Fiat to Paystack recipient |
| Normal payment request | Transaction (REQUEST), Request, Claim | Payer pays; requester claims | Requester claims (channel set or chosen) |

This guide is for integration and product; implementation of identity verification, email/SMS codes, and claim UX is done in the backend and frontend step by step.
