# Paystack API (core backend)

This document describes Paystack-related endpoints: **account verification** (banks, mobile), **payment initialization** (onramp), **webhook** (charge events), and **payouts** (offramp).

All API endpoints require the **`x-api-key`** header except `/health`, `/ready`, and **`/webhook/paystack`** (webhook is verified by Paystack signature).  
If `PAYSTACK_SECRET_KEY` is not set, Paystack API routes return **503**.

---

## Payment initialization (onramp)

### Initialize payment

`POST /api/paystack/payments/initialize`

Creates a Paystack transaction and returns an **authorization URL** for the frontend to redirect the user to complete payment. Optionally links to an existing Transaction or creates a new PENDING one.

**Body (JSON):**

| Field            | Type   | Description |
|-----------------|--------|-------------|
| `email`         | string | Customer email (required) |
| `amount`        | number | Amount: if &lt; 100 treated as major units (e.g. 10.50 → 1050 subunits); if ≥ 100 and integer, treated as subunits (kobo/pesewas) |
| `currency`      | string | Optional, default `NGN` |
| `callback_url`  | string | Optional; Paystack redirects here after payment |
| `channels`      | string[] | Optional; e.g. `["card","bank","mobile_money"]` |
| `transaction_id`| string | Optional; UUID of an existing Transaction to link (must exist) |
| `metadata`      | object | Optional; merged with `transaction_id` sent to Paystack |

**Response (201):**

```json
{
  "success": true,
  "data": {
    "authorization_url": "https://checkout.paystack.com/...",
    "access_code": "...",
    "reference": "...",
    "transaction_id": "uuid-of-our-transaction"
  }
}
```

Frontend should redirect the user to `authorization_url`. After payment, Paystack sends **charge.success** or **charge.failed** to your **webhook URL**; the backend updates the Transaction status and notifies the admin/frontend.

---

## Verify transaction

### Verify transaction by reference

`GET /api/paystack/transactions/verify/:reference`

Verifies a Paystack transaction by its **reference** (e.g. after the user returns from Paystack checkout). Calls Paystack’s verify API and returns the full transaction payload. The backend also **persists** the Paystack response into `PaystackPaymentRecord` for cross-checks and disputes (linked to your Transaction when `metadata.transaction_id` was sent on initialize).

**Path:**

| Parameter   | Type   | Description |
|------------|--------|-------------|
| `reference`| string | Paystack transaction reference (e.g. from initialize response or callback) |

**Example request:**

```http
GET /api/paystack/transactions/verify/abc123xyz
x-api-key: YOUR_API_KEY
```

**Response (200):**

```json
{
  "success": true,
  "data": {
    "id": 123456789,
    "status": "success",
    "reference": "abc123xyz",
    "amount": 10500,
    "currency": "NGN",
    "paid_at": "2025-01-30T12:00:00.000Z",
    "created_at": "2025-01-30T11:58:00.000Z",
    "channel": "card",
    "gateway_response": "Approved",
    "message": null,
    "metadata": { "transaction_id": "uuid-of-your-transaction" },
    "customer": {
      "id": 12345,
      "email": "customer@example.com",
      "customer_code": "CUS_xxx",
      "first_name": null,
      "last_name": null,
      "phone": null
    },
    "authorization": {
      "channel": "card",
      "card_type": "visa",
      "bank": "TEST BANK",
      "country_code": "NG",
      "reusable": true
    }
  }
}
```

- **`id`** – Paystack transaction ID (numeric).  
- **`status`** – Paystack status, e.g. `success`, `failed`, `abandoned`.  
- **`amount`** – In subunits (kobo/pesewas).  
- **`paid_at`** – When payment was completed; `null` if not paid.  
- **`metadata.transaction_id`** – Your Transaction UUID if provided on initialize.  
- **`authorization`** – Only **safe** fields are returned and stored: `channel`, `card_type`, `bank`, `country_code`, `reusable`. Sensitive bank/card data (`authorization_code`, `last4`, `exp_month`, `exp_year`, `brand`) is **never** exposed in the API or persisted in `PaystackPaymentRecord`.

**Errors:** 400 if `reference` missing; 502 if Paystack verification fails; 503 if Paystack is not configured.

---

## Webhook

### Paystack webhook

`POST /webhook/paystack`

**No `x-api-key`.** Paystack calls this URL with payment and transfer events. The backend verifies the **`x-paystack-signature`** header (HMAC SHA512 of raw body with your secret key) before processing.

**Configure this URL in the Paystack Dashboard** (Settings → API Keys & Webhooks).

**Handled events:**

- **charge.success** – Payment succeeded. Backend finds the Transaction by `metadata.transaction_id`, sets status to `COMPLETED`, notifies admin and Pusher.
- **charge.failed** – Payment failed. Backend sets Transaction status to `FAILED`, notifies admin and Pusher.
- **transfer.success / transfer.failed / transfer.reversed** – Forwarded to admin dashboard only.

Always returns **200** with `{ "ok": true }` so Paystack does not retry. Process work asynchronously if needed.

---

## Payouts (offramp)

Flow: (1) Confirm the prior **crypto** transaction is recorded and COMPLETED. (2) **Request payout** with that transaction id → backend returns a **code**. (3) User confirms receiving account (using account verification endpoints). (4) **Execute payout** with code + amount + recipient details → backend creates Paystack recipient and initiates transfer.

### Request payout (get code)

`POST /api/paystack/payouts/request`

**Body (JSON):**

| Field             | Type   | Description |
|-------------------|--------|-------------|
| `transaction_id`  | string | UUID of the **completed** crypto Transaction (required) |
| `transaction_hash`| string | Optional; reserved for extra verification |

**Validation:** Transaction must exist and `status === "COMPLETED"`.

**Response (201):**

```json
{
  "success": true,
  "data": {
    "code": "short-url-safe-code",
    "payout_request_id": "uuid",
    "transaction_id": "uuid",
    "message": "Use this code with POST /api/paystack/payouts/execute to complete payout."
  }
}
```

Use `code` in the next steps (e.g. build a link or pass to frontend for the “Confirm and pay” step).

### Get payout request

`GET /api/paystack/payouts/:code`

Returns the payout request and linked transaction summary. After a payout is executed, `transfer_code` and `transfer_reference` are included; use `transfer_reference` with **GET /api/paystack/payouts/verify/:reference** to confirm success.

**Response (200):** `{ "success": true, "data": { "code", "payout_request_id", "status", "amount", "currency", "transfer_code", "transfer_reference", "recipient": { "name", "type" }, "transaction_id", "transaction": { ... } } }`  
After execute, **`recipient`** (name and type) is included for display and review.

### Execute payout

`POST /api/paystack/payouts/execute`

**Body (JSON):**

| Field             | Type   | Description |
|-------------------|--------|-------------|
| `code`            | string | From payout request (required) |
| `amount`          | number | In **subunits** (kobo/pesewas) (required) |
| `currency`        | string | e.g. `NGN`, `GHS` (required) |
| `recipient_type`  | string | `nuban` or `mobile_money` (required) |
| `name`            | string | Recipient name (required) |
| `account_number`  | string | Bank account or phone (required) |
| `bank_code`       | string | Bank code (nuban) or provider code e.g. MTN (mobile_money) (required) |
| `reason`          | string | Optional; appears in customer notification |

**Response (200):**

```json
{
  "success": true,
  "data": {
    "success": true,
    "status": "success",
    "transfer_code": "TRF_xxx",
    "reference": "payout_uuid_timestamp",
    "payout_request_id": "uuid",
    "recipient": { "name": "John Doe", "type": "nuban" },
    "message": "Transfer completed. Use GET /api/paystack/payouts/verify/:reference to confirm."
  }
}
```

- **`data.success`** – `true` when Paystack reports transfer as completed; `false` when queued (e.g. `status` is `pending` or `otp`).
- **`data.status`** – Paystack transfer status: `success`, `pending`, `otp`, `failed`, `reversed`.
- **`data.reference`** – Use this with **GET /api/paystack/payouts/verify/:reference** to confirm payout success.
- **`data.transfer_code`** – Paystack transfer code for tracking.
- **`data.recipient`** – Recipient info: `name`, `type` (`nuban` or `mobile_money`). Stored in DB for review.

If Paystack returns success immediately, `status` is `"success"` and `data.success` is `true`. Otherwise transfer is queued; poll **GET /api/paystack/payouts/verify/:reference** or wait for **transfer.success** / **transfer.failed** webhook.

### Verify payout

`GET /api/paystack/payouts/verify/:reference`

Verifies that a payout (transfer) was successful. Use the **reference** returned from **POST /api/paystack/payouts/execute** (or from **GET /api/paystack/payouts/:code** as `transfer_reference`).

**Path:**

| Parameter   | Type   | Description |
|------------|--------|-------------|
| `reference`| string | Transfer reference from execute or payout request |

**Example request:**

```http
GET /api/paystack/payouts/verify/payout_uuid_1234567890
x-api-key: YOUR_API_KEY
```

**Response (200):**

```json
{
  "success": true,
  "data": {
    "id": 476948,
    "reference": "payout_uuid_1234567890",
    "transfer_code": "TRF_kjati32r73poyt5",
    "amount": 50000,
    "currency": "NGN",
    "status": "success",
    "reason": "Payout",
    "created_at": "2018-07-22T10:29:33.000Z",
    "updated_at": "2018-07-22T10:30:33.000Z",
    "success": true
  }
}
```

- **`data.status`** – Paystack transfer status: `success`, `pending`, `failed`, `reversed`, `otp`.
- **`data.success`** – `true` when `status === "success"`; use this to confirm payout completed.

**Errors:** 400 if `reference` missing; 502 if Paystack verification fails; 503 if Paystack is not configured.

### Payout history (from DB)

`GET /api/paystack/payouts/history`

Returns **payout requests** stored in the DB (dashboard). Paginated; optional status filter. Use to review all payouts initiated through the app.

**Query (all optional):**

| Parameter | Type   | Description |
|-----------|--------|-------------|
| `perPage` | number | 1–100, default 20 |
| `page`    | number | Page number |
| `status`  | string | `pending`, `completed`, or `failed` |

**Response (200):** `{ "success": true, "data": { "payouts": [ { "id", "code", "status", "amount", "currency", "recipient_name", "recipient_type", "transfer_code", "transfer_reference", "transaction_id", "transaction": { ... }, "created_at" } ], "meta": { "total", "perPage", "page", "pageCount" } } }`

---

## Dashboard / admin (transaction and transfer history)

All Paystack-related **payments** and **transfers** are stored in the DB for review. Use these endpoints for dashboards and reporting.

**Stored in DB:**

- **Payments:** `PaystackPaymentRecord` – created on verify and on webhook (charge.success/charge.failed). Links to your `Transaction`; stores reference, amount, status, channel, customer email, sanitized raw response.
- **Payouts:** `PayoutRequest` + `PaystackTransferRecord` – when you execute a payout, the request is updated with amount, currency, recipient name/type, transfer code/reference, and a **PaystackTransferRecord** is created with the transfer details for audit.

### List Paystack transactions (from Paystack API)

`GET /api/paystack/transactions`

Lists **payment transactions** from Paystack (live data). Use for admin dashboard.

**Query (all optional):** `perPage`, `page`, `status` (`failed`|`success`|`abandoned`), `customer`, `from`, `to`, `amount`.

**Response (200):** `{ "success": true, "data": { "transactions": [ ... ], "meta": { "total", "perPage", "page", "next", "previous" } } }`  
Each transaction is sanitized (no sensitive card/bank fields in `authorization`).

### Fetch Paystack transaction by ID

`GET /api/paystack/transactions/:id`

Fetches a single Paystack transaction by Paystack’s numeric **id**. Returns sanitized data.

### List Paystack transfers (from Paystack API)

`GET /api/paystack/transfers`

Lists **transfers** (payouts) from Paystack (live data). Use for admin dashboard.

**Query (all optional):** `perPage`, `page`, `customer`, `from`, `to`.

**Response (200):** `{ "success": true, "data": { "transfers": [ { "id", "reference", "transfer_code", "amount", "currency", "status", "reason", "created_at", "updated_at" } ], "meta": { "total", "skipped", "perPage", "page", "pageCount" } } }`

---

## Banks

### List banks

`GET /api/paystack/banks`

Returns a list of supported banks (or channels) for the given filters. Use this to populate bank/telco dropdowns.

**Query (all optional):**

| Parameter   | Type   | Description |
|------------|--------|-------------|
| `country`  | string | One of: `ghana`, `kenya`, `nigeria`, `south_africa` (or `south africa`) |
| `currency` | string | e.g. `NGN`, `GHS`, `KES`, `ZAR` |
| `type`     | string | e.g. `nuban`, `mobile_money`, `ghipss` |
| `perPage`  | number | 1–100, default 50 |
| `use_cursor` | boolean | Enable cursor pagination |
| `next`     | string | Cursor for next page (from previous `meta.next`) |

**Example:**

```http
GET /api/paystack/banks?country=nigeria&perPage=20
x-api-key: YOUR_API_KEY
```

**Response (200):**

```json
{
  "success": true,
  "data": {
    "banks": [
      {
        "id": 174,
        "name": "Abbey Mortgage Bank",
        "code": "801",
        "slug": "abbey-mortgage-bank",
        "country": "Nigeria",
        "currency": "NGN",
        "type": "nuban"
      }
    ],
    "meta": {
      "next": "YmFuazoxNjk=",
      "previous": null,
      "perPage": 50
    }
  }
}
```

Only the fields above are returned; internal Paystack fields are omitted.

---

### Resolve bank account (NGN / GHS)

`GET /api/paystack/banks/resolve`

Resolves a bank account number to the account holder name. Use before showing “Confirm payment to: **Account Name**” or when creating transfer recipients.

**Query (required):**

| Parameter        | Type   | Description |
|-----------------|--------|-------------|
| `account_number` | string | Customer’s account number |
| `bank_code`     | string | Bank code from List banks |

**Example:**

```http
GET /api/paystack/banks/resolve?account_number=0022728151&bank_code=063
x-api-key: YOUR_API_KEY
```

**Response (200):**

```json
{
  "success": true,
  "data": {
    "account_number": "0022728151",
    "account_name": "WES GIBBONS"
  }
}
```

**Errors:** 400 if query invalid; 502 if Paystack request fails.

---

### Validate bank account (South Africa)

`POST /api/paystack/banks/validate`

Validates a South African bank account (BASA). Requires account details and document type/number. Use for ZAR before creating transfer recipients.

**Body (JSON):**

| Field            | Type   | Description |
|-----------------|--------|-------------|
| `bank_code`     | string | Bank code from List banks (e.g. South Africa) |
| `country_code`  | string | Two-letter ISO, e.g. `ZA` |
| `account_number`| string | Customer’s account number |
| `account_name`  | string | Name on the account |
| `account_type`  | string | `personal` or `business` |
| `document_type` | string | `identityNumber`, `passportNumber`, or `businessRegistrationNumber` |
| `document_number` | string | ID/passport/registration number |

**Example:**

```http
POST /api/paystack/banks/validate
Content-Type: application/json
x-api-key: YOUR_API_KEY

{
  "bank_code": "632005",
  "country_code": "ZA",
  "account_number": "0123456789",
  "account_name": "Ann Bron",
  "account_type": "personal",
  "document_type": "identityNumber",
  "document_number": "1234567890123"
}
```

**Response (200):**

```json
{
  "success": true,
  "data": {
    "verified": true,
    "verificationMessage": "Account is verified successfully",
    "accountHolderMatch": true,
    "accountAcceptsDebits": true,
    "accountAcceptsCredits": true
  }
}
```

Only the fields above are returned. 400 if body invalid; 502 if Paystack fails.

---

## Mobile money (telcos)

### List mobile money providers

`GET /api/paystack/mobile/providers`

Returns supported mobile money providers (telcos) for the given currency. Use to let the user pick provider (e.g. MTN, Vodafone) and enter phone number for payments or payouts.

**Query (required):**

| Parameter  | Type   | Description |
|-----------|--------|-------------|
| `currency`| string | `GHS` (Ghana) or `KES` (Kenya) |
| `perPage` | number | Optional, 1–100 |

**Example:**

```http
GET /api/paystack/mobile/providers?currency=GHS
x-api-key: YOUR_API_KEY
```

**Response (200):**

```json
{
  "success": true,
  "data": {
    "providers": [
      {
        "id": 1,
        "name": "MTN",
        "code": "MTN",
        "slug": "mtn",
        "country": "Ghana",
        "currency": "GHS",
        "type": "mobile_money"
      }
    ],
    "meta": { "perPage": 50 }
  }
}
```

**Errors:** 400 if `currency` missing or not `GHS`/`KES`; 503 if Paystack not configured; 502 if Paystack fails.

---

## Typical flows

1. **Onramp (buy with fiat)**  
   - Backend: `POST /api/paystack/payments/initialize` with email, amount, optional `transaction_id`, optional `callback_url`.  
   - Frontend: Redirect user to `data.authorization_url`.  
   - Paystack sends **charge.success** or **charge.failed** to `POST /webhook/paystack`; backend updates Transaction and notifies admin/Pusher.

2. **Before “Make payment” (account verification)**  
   - **Banks (NGN/GHS):** `GET /api/paystack/banks/resolve?account_number=...&bank_code=...` → show `account_name`.  
   - **Banks (ZAR):** `POST /api/paystack/banks/validate` with account + document details → show `verified` and `verificationMessage`.  
   - **Mobile (GHS/KES):** `GET /api/paystack/mobile/providers?currency=GHS` → user picks provider; use provider `code` as `bank_code` and phone as `account_number` when creating recipients or charges.

3. **Populate bank/telco dropdowns**  
   - Banks: `GET /api/paystack/banks?country=nigeria` (or `ghana`, `kenya`, `south_africa`).  
   - Telcos: `GET /api/paystack/mobile/providers?currency=GHS` or `?currency=KES`.

4. **Offramp (payout)**  
   - Confirm the crypto Transaction is COMPLETED (e.g. by transaction id).  
   - `POST /api/paystack/payouts/request` with `transaction_id` → get `code`.  
   - User confirms receiving account (resolve/validate or mobile providers).  
   - `GET /api/paystack/payouts/:code` to show summary.  
   - `POST /api/paystack/payouts/execute` with `code`, amount (subunits), currency, recipient_type, name, account_number, bank_code → transfer is created; response includes `success`, `status`, `reference`.  
   - Confirm payout: **GET /api/paystack/payouts/verify/:reference** (use `reference` from execute) → `data.success === true` when transfer completed.

---

## Environment

- **`PAYSTACK_SECRET_KEY`** – Paystack secret key. Required for Paystack API routes and webhook signature verification. If unset, Paystack routes return 503.
