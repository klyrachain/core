# Core API — Frontend Integration Report

**Purpose:** Single source of truth for the frontend (or any client) to integrate with the **Core** service (Central Point: Webhook + Redis).  
**Update this file** whenever Core API, webhook contract, or realtime events change.

**See also:** `md/frontend-update-chains.md` for the **f_chain / t_chain / supportedChains** update (cross-chain transactions and wallet chains).

---

## 1. Service overview

- **Role:** Core is the backend “brain.” It receives webhook events (e.g. from your API gateway or Backend service), creates transactions, enqueues jobs, updates DB and Redis, and emits realtime events. It does **not** serve end-user HTTP traffic directly.
- **Frontend use case:** Your frontend typically talks to a **Backend** API; that Backend calls Core (e.g. `POST /webhook/order`). The frontend may also subscribe to **Pusher** for transaction status updates.

---

## 2. Base URL and environment

| Env (example) | Description |
|---------------|-------------|
| `NEXT_PUBLIC_CORE_URL` or `VITE_CORE_URL` | Base URL of the Core service (e.g. `https://core.example.com` or `http://localhost:4000`) |

- **Protocol:** HTTPS in production.
- **Default port (dev):** `4000`.
- **Content-Type:** `application/json` for request bodies.

---

## 3. Endpoints

### 3.1 Health and readiness

| Method | Path | Description | Response |
|--------|------|-------------|----------|
| `GET` | `/health` | Liveness (process up). | `200` → `{ "ok": true }` |
| `GET` | `/ready` | Readiness (DB + Redis connected). | `200` → `{ "ok": true }` or `503` → `{ "ok": false, "error": "Database or Redis unavailable" }` |

### 3.2 Fetch API (database, Redis, queue — for admin/dashboard)

All list endpoints support `?page=1&limit=20` (default limit 20, max 100). Responses use envelope `{ success: true, data, meta?: { page, limit, total } }`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/users` | List users (paginated). |
| `GET` | `/api/users/:id` | Get user by ID. |
| `GET` | `/api/transactions` | List transactions (paginated). Query: `?status=&type=` optional. |
| `GET` | `/api/transactions/:id` | Get transaction by ID (with fromUser, toUser, request). |
| `GET` | `/api/requests` | List requests (paginated). |
| `GET` | `/api/requests/:id` | Get request by ID (with transaction, claim). |
| `GET` | `/api/claims` | List claims (paginated). Query: `?status=` optional. |
| `GET` | `/api/claims/:id` | Get claim by ID (with request, transaction). |
| `GET` | `/api/wallets` | List wallets (paginated). Returns `supportedChains`, `supportedTokens`; `encryptedKey` is masked. |
| `GET` | `/api/wallets/:id` | Get wallet by ID (`supportedChains`, `supportedTokens`; `encryptedKey` masked). |
| `GET` | `/api/inventory` | List inventory assets (paginated). Query: `?page=&limit=&chain=&chainId=&address=` optional. |
| `POST` | `/api/inventory` | Create inventory asset. Body: `chain`, `chainId`, `tokenAddress`, `symbol`, `address`; optional: `currentBalance`, `walletId`. Unique: `(chainId, tokenAddress, address)`. |
| `GET` | `/api/inventory/:id` | Get inventory asset by ID. |
| `GET` | `/api/inventory/:id/lots` | List lots for asset (FIFO order). Query: `?onlyAvailable=true` to exclude fully consumed lots. Used for order-book style fulfillment. |
| `GET` | `/api/inventory/:id/cost-basis` | Volume-weighted average cost per token for available lots. Use as **minSellingPrice** (floor) in pricing engine on-ramp so the platform never sells below cost. |
| `PATCH` | `/api/inventory/:id` | Update inventory asset. Body: any of `chain`, `chainId`, `tokenAddress`, `symbol` (or `token`), `address`, `currentBalance` (or `balance`), `walletId` (all optional). |
| `DELETE` | `/api/inventory/:id` | Delete inventory asset (and its history and lots). |
| `GET` | `/api/inventory/:id/history` | List inventory history for asset (paginated). |
| `GET` | `/api/cache/balances` | List Redis balance keys (query: `?limit=50`). |
| `GET` | `/api/cache/balances/:chain/:token` | Get Redis balance for chain/token. |
| `GET` | `/api/queue/poll` | Poll queue stats (counts, recent waiting/active jobs). Query: `?limit=20`. |
| `GET` | `/api/quote` | Prefetch fee and quote for an order. Query: `action`, `f_amount`, `t_amount`, `f_price`, `t_price`, `f_chain` (optional), `t_chain` (optional), `f_token`, `t_token`. Returns `{ feeAmount, feePercent, totalCost, totalReceived, rate, grossValue, profit }`. |
| `GET` | `/api/logs` | Request logs for monitoring. All GET/POST/etc. requests are intercepted; each log has `id`, `timestamp`, `method`, `path`, `query`, `headers` (sensitive headers redacted), `body`, `statusCode`, `responseTimeMs`. Query: `method`, `path`, `since` (ISO), `page`, `limit`. **Sends webhook to admin dashboard** with event `logs.viewed` and full data: `success`, `data` (log entries), `meta`, `filters`, `requestLogId`. |

**Inventory lots and pricing engine**

- Each **inventory asset** has **lots**: each acquisition (e.g. from a completed BUY/SELL) is stored as a lot with `quantity`, `costPerToken`, and `acquiredAt`. Sell orders are fulfilled **FIFO** (oldest lots first); lot quantities are reduced when inventory is deducted.
- **GET /api/inventory/:id/cost-basis** returns the volume-weighted average cost per token of available lots. Use this value as **minSellingPrice** (floor) in the Merchant Pricing Engine’s **on-ramp** quote so the platform never sells below cost. See `md/PRICING_ENGINE_IMPLEMENTATION_PLAN.md` for formulas.
- **GET /api/inventory/:id/lots** returns lots in FIFO order for reporting or order-book style UIs. Query `?onlyAvailable=true` to list only lots with remaining quantity.
- **Validation pricing quote (platform key):** GET `/api/validation/pricing-quote` with optional `?chain=&token=` returns a per-token quote: **buy price = cost price** from inventory lots (volume-weighted average), plus providerSellPrice and volatility. Cost basis is loaded from inventory into Redis on cache load and refreshed when the poll worker updates inventory (add/deduct). This ensures on-ramp/offramp validation uses the correct cost price per token and conversion + fee.

### 3.3 Order webhook (used by Backend → Core)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhook/order` | Create an order/transaction and enqueue it for processing. Called by your Backend, not directly by the browser. |

**Request body (JSON):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | `"buy"` \| `"sell"` \| `"request"` \| `"claim"` | Yes | Order type. |
| `fromIdentifier` | `string` \| `null` | No | Sender identifier (email, address, or phone). |
| `fromType` | `IdentityType` \| `null` | No | One of: `ADDRESS`, `EMAIL`, `NUMBER`. |
| `fromUserId` | `string` (UUID) \| `null` | No | Sender user ID. |
| `toIdentifier` | `string` \| `null` | No | Recipient identifier. |
| `toType` | `IdentityType` \| `null` | No | One of: `ADDRESS`, `EMAIL`, `NUMBER`. |
| `toUserId` | `string` (UUID) \| `null` | No | Recipient user ID. |
| `f_amount` | `number` (positive) | Yes | From-amount (e.g. fiat or source token amount). |
| `t_amount` | `number` (positive) | Yes | To-amount (e.g. crypto or target token amount). |
| `f_price` | `number` (≥ 0) | Yes | From-price (rate). |
| `t_price` | `number` (≥ 0) | Yes | To-price (rate). |
| `f_chain` | `string` (non-empty) | No | Source chain (e.g. `ETHEREUM`, `BASE`). Default: `ETHEREUM`. |
| `t_chain` | `string` (non-empty) | No | Target chain. Default: `ETHEREUM`. Enables cross-chain (e.g. USDC on BASE → ETH on ETHEREUM). |
| `f_token` | `string` (non-empty) | Yes | From-asset symbol (e.g. `USDC`, `ETH`). When provider is KLYRA, must be an **on-chain token**, not a fiat currency (see validation below). |
| `t_token` | `string` (non-empty) | Yes | To-asset symbol (e.g. `ETH`, `USDC`). When provider is KLYRA, must be an **on-chain token**, not a fiat currency. |
| `f_provider` | `PaymentProvider` | Yes | See §4. |
| `t_provider` | `PaymentProvider` | Yes | See §4. |
| `requestId` | `string` (UUID) \| `null` | No | Optional link to a request. |

**Validation rules:**

- **Currencies vs tokens:** Fiat currencies (e.g. `GHS`, `USD`, `NGN`, `KES`, `ZAR`) are **not** on-chain tokens. When `f_provider` or `t_provider` is **KLYRA**, the corresponding token (`f_token` or `t_token`) must **not** be a fiat currency — use on-chain symbols (e.g. `USDC`, `ETH`). Rejected with `400` and code `FIAT_NOT_ALLOWED_AS_TOKEN`.
- **Same token, same chain:** If `f_chain === t_chain` and `f_token === t_token` (case-insensitive), the order is rejected — no same-token same-chain “swap”. Rejected with `400` and code `SAME_TOKEN_SAME_CHAIN`.

**Success response:** `201 Created`

```json
{
  "success": true,
  "data": {
    "id": "<transaction-uuid>",
    "status": "PENDING",
    "type": "BUY"
  }
}
```

**Error responses:**

- `400 Bad Request` — Validation failed (e.g. invalid `action`, missing required fields, wrong types). May include `code`: `FIAT_NOT_ALLOWED_AS_TOKEN` (KLYRA with fiat as token), `SAME_TOKEN_SAME_CHAIN` (same token on same chain), or provider/identifier codes from §4.

```json
{
  "success": false,
  "error": "Validation failed",
  "details": { "fieldErrors": { ... }, "formErrors": [] }
}
```

- `500 Internal Server Error` — Server-side failure (e.g. DB error). Client receives a generic message.

```json
{
  "success": false,
  "error": "Something went wrong."
}
```

---

## 4. Enums and types (for frontend)

Use these when building request bodies or handling responses/realtime payloads.

- **IdentityType:** `ADDRESS` \| `EMAIL` \| `NUMBER`
- **PaymentProvider:** `NONE` \| `ANY` \| `SQUID` \| `LIFI` \| `PAYSTACK` \| `KLYRA`
- **TransactionType:** `BUY` \| `SELL` \| `TRANSFER` \| `REQUEST` \| `CLAIM`
- **TransactionStatus:** `ACTIVE` \| `PENDING` \| `COMPLETED` \| `CANCELLED` \| `FAILED`
- **ClaimStatus:** `ACTIVE` \| `CLAIMED` \| `CANCELLED` \| `FAIL`
- **SupportedChain:** `ETHEREUM` \| `BNB` \| `BASE` \| `SOLANA`

---

## 5. Admin dashboard & live tracking

**Endpoint:** `POST /webhook/admin` — Manual admin event (same as before).

**Live tracking (automatic):** Core sends events to the admin dashboard for every incoming order and for logs:

| Event | When | Data (includes) |
|-------|------|------------------|
| `order.created` | After `POST /webhook/order` creates a transaction | `transactionId`, `action`, `type`, `status`, `fromIdentifier`, `toIdentifier`, `fromUserId`, `toUserId`, `requestId`, `f_chain`, `t_chain`, `f_amount`, `t_amount`, `f_price`, `t_price`, `f_token`, `t_token`, `feeAmount`, `feePercent`, `totalCost`, `profit` |
| `order.rejected` | When `POST /webhook/order` returns 400 (validation) or 500 (server error) | `reason` (`validation_failed` or `server_error`), `error`, `details` (if validation), `body` (if validation), or `action`, `f_token`, `t_token`, `f_amount`, `t_amount` (if server error) |
| `order.completed` | When poll worker sets transaction to COMPLETED | Same + `status: "COMPLETED"` |
| `order.failed` | When poll worker sets transaction to FAILED | `transactionId`, `status`, `type`, `f_token`, `t_token`, `error` |
| `logs.viewed` | When `GET /api/logs` is called | Full response data: `success`, `data` (log entries, same as API), `meta` (page, limit, total), `filters` (method, path, since, page, limit), `requestLogId` |

If `ADMIN_WEBHOOK_URL` is set, Core POSTs each payload to that URL; it also triggers Pusher channel `admin-dashboard` with event `admin-event`. Payload shape: `{ event, data, timestamp }`.

---

## 6. Realtime (Pusher)

When a transaction’s status changes (e.g. to `COMPLETED` or `FAILED`), Core emits Pusher events. Frontend can subscribe to receive live updates.

**Channels (stub / global):**

- `notifications`
- `email`
- `number`

**Event name:** `transaction-status`

**Payload:**

```ts
{
  transactionId: string;   // UUID
  status: TransactionStatus;
  type?: TransactionStatus; // optional; transaction type (e.g. "BUY", "SELL")
}
```

**User-specific channels (optional):** Core can trigger to a custom channel via `triggerToChannel(channel, event, data)`. Channel naming (e.g. `private-user-<userId>`) is defined by your Backend/Core usage; frontend should subscribe to the channel name your Backend documents.

---

## 7. Frontend integration checklist

- [ ] Backend calls Core `POST /webhook/order` with the payload above; frontend does not call this URL directly from the browser (expose via your own API).
- [ ] Frontend uses Backend API to “create order” or “initiate buy/sell/request/claim”; Backend returns the transaction `id` and optionally `status: "PENDING"`.
- [ ] Frontend subscribes to Pusher channel(s) and event `transaction-status` to show status updates (`PENDING` → `COMPLETED` or `FAILED`).
- [ ] Use enums in §4 for dropdowns, filters, and type-safe request/response handling.
- [ ] Handle `success: false` and `error` / `details` for 400 and 500 responses from any Backend endpoint that proxies Core.

---

## 8. Prompt for AI / developers

Use the following when asking an AI or a developer to implement frontend integration with Core:

---

**Prompt: Frontend integration with Core (Central Point) API**

We have a backend service called **Core** that handles order/transaction processing and realtime updates. Use this spec to integrate the frontend.

1. **Base URL**  
   Use the env variable for the Core service base URL (e.g. `NEXT_PUBLIC_CORE_URL` or `VITE_CORE_URL`). Default dev: `http://localhost:4000`.

2. **Endpoints**  
   - `GET /health` → liveness; `GET /ready` → readiness (DB + Redis).  
   - `POST /webhook/order` → create order (called by our Backend, not by the browser). Request body must include: `action` (`"buy"` \| `"sell"` \| `"request"` \| `"claim"`), `f_amount`, `t_amount`, `f_price`, `t_price`, `f_token`, `t_token`, `f_provider`, `t_provider`; optional: `fromIdentifier`, `fromType`, `fromUserId`, `toIdentifier`, `toType`, `toUserId`, `requestId`.  
   - Success: `201` with `{ success: true, data: { id, status, type } }`.  
   - Errors: `400` with `{ success: false, error: "Validation failed", details }` or `500` with `{ success: false, error: "Something went wrong." }`.

3. **Enums**  
   Use for request/response and UI: IdentityType (`ADDRESS` \| `EMAIL` \| `NUMBER`), PaymentProvider (`NONE` \| `ANY` \| `SQUID` \| `LIFI` \| `PAYSTACK` \| `KLYRA`), TransactionType (`BUY` \| `SELL` \| `TRANSFER` \| `REQUEST` \| `CLAIM`), TransactionStatus (`ACTIVE` \| `PENDING` \| `COMPLETED` \| `CANCELLED` \| `FAILED`).

4. **Realtime**  
   Subscribe to Pusher channels `notifications`, `email`, `number` (or the channel our Backend documents) and event `transaction-status`. Payload: `{ transactionId, status, type? }`.

5. **Flow**  
   Frontend calls our Backend to create an order; Backend calls Core `/webhook/order` and returns the transaction `id`. Frontend then shows status and subscribes to Pusher for `transaction-status` updates.

---

## 9. Changelog

| Date | Change |
|------|--------|
| 2025-01-30 | Validation: **currencies vs tokens** — KLYRA cannot use fiat (GHS, USD, NGN, KES, ZAR) as `f_token`/`t_token`; **same token same chain** rejected (order, quote, crypto-transactions). Codes: `FIAT_NOT_ALLOWED_AS_TOKEN`, `SAME_TOKEN_SAME_CHAIN`. |
| 2025-01-30 | Order webhook: `f_provider` and `t_provider` are **required**. PaymentProvider enum includes `KLYRA`. |
| (update) | Added fetch API (users, transactions, requests, claims, wallets, inventory, cache/balances, queue/poll) and POST /webhook/admin for admin dashboard. |
| (initial) | Document created: health, ready, POST /webhook/order, enums, Pusher channels and event, integration checklist, and prompt. |

**When updating:** Add a new row above with the date and a short description of the API/realtime change.
