# Connect (B2B) API — Frontend Integration Report

**Purpose:** Reference for the frontend integrating with the **Connect** (B2B) endpoints on the Core service. Use these for the Connect section: Overview (`/connect`), Merchants (`/connect/merchants`), and Settlements (`/connect/settlements`). Connect overview displays only metrics and fees for **business/partner** transactions; for platform-wide fees use **Platform API** — see `md/platform-api.integration.md`.

**Base:** Same base URL as Core (e.g. `NEXT_PUBLIC_CORE_URL` or `VITE_CORE_URL`). Default dev port: `4000`.

**Auth:** All Connect endpoints require the `x-api-key` header. **Platform keys** (no business) can access overview and all merchants; **merchant keys** see only their own business and their own settlements.

---

## 1. Response envelope

- **Success:** `{ "success": true, "data": <payload> }`. List endpoints add `meta`: `{ "success": true, "data": [...], "meta": { "page", "limit", "total" } }`.
- **Error:** `{ "success": false, "error": "<message>" }` with HTTP status 401, 403, 404, or 500.

---

## 2. Endpoints summary

| Method | Path | Purpose | Platform | Merchant |
|--------|------|---------|----------|----------|
| `GET` | `/api/connect/overview` | B2B dashboard metrics | ✅ | ❌ 403 |
| `GET` | `/api/connect/fees/report` | Accumulated fees by currency (completed txns; optional `days`, `businessId`) | ✅ | ❌ 403 |
| `GET` | `/api/connect/merchants` | List merchants (partners) | ✅ | ❌ 403 |
| `GET` | `/api/connect/merchants/:id` | Merchant detail + API keys, webhook, volume | ✅ | ✅ own only |
| `GET` | `/api/connect/settlements` | List payouts (batches) | ✅ all | ✅ own only |
| `GET` | `/api/connect/settlements/:id` | Payout detail + timeline | ✅ | ✅ own only |

---

## 3. Connect Overview (`/connect`)

**Route:** `GET /api/connect/overview`  
**Access:** Platform key only (403 if merchant key).

Returns high-level B2B metrics for the Connect dashboard. **Scope:** partner (business) transactions only. Fees and volume are limited to transactions that have a `businessId` (partner). The platform still decides what % of fees businesses can earn.

### 3.1 Response shape

| Field | Type | Description |
|-------|------|-------------|
| `totalPlatformVolume` | `number` | Sum of transaction volume (partner txns only, completed). Approximate gross value. |
| `netRevenueFees` | `number` | Sum of `platformFee` from partner transactions. |
| `activeMerchants` | `number` | Count of distinct businesses with ≥1 completed transaction in the last 24 hours. |
| `volumeByPartner` | `array` | Top 5 partners by volume + optional "Others" entry. |
| `takeRate` | `number` | `netRevenueFees / totalPlatformVolume` (0 if no volume). |
| `recentOnboarding` | `array` | Latest businesses that have at least one API key (for "Recent Onboarding" list). |
| `feesByCurrency` | `object` | Accumulated fee totals by token/currency **from partner transactions only** (transactions with a business). Keys = token symbol (e.g. `GHS`, `USDC`); values = sum of `Transaction.fee` for that `f_token`. Use for the Connect dashboard fee container (one card or row per currency). For **all** platform fees use `GET /api/platform/overview` — see `md/platform-api.integration.md`. |

### 3.2 volumeByPartner item

| Field | Type | Description |
|-------|------|-------------|
| `businessId` | `string` | Business UUID or `"_others"` for the Others bucket. |
| `businessName` | `string` | Display name. |
| `volume` | `number` | Gross volume for that partner. |

### 3.3 recentOnboarding item

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Business UUID. |
| `name` | `string` | Business name. |
| `slug` | `string` | Slug (e.g. for links). |
| `createdAt` | `string` | ISO date. |

### 3.4 Frontend use

- **Row 1:** Use `totalPlatformVolume`, `netRevenueFees`, `activeMerchants` for the three metric cards.
- **Row 2:** Use `volumeByPartner` for the stacked bar (Top 5 vs Others); use `takeRate` for the take-rate gauge (e.g. `(takeRate * 100).toFixed(1) + '%'`).
- **Row 3:** Use `recentOnboarding` for the "Recent Onboarding" list.
- **Dashboard fee container:** Use `feesByCurrency` to show accumulated fees **per currency/token**. Structure: `{ "GHS": "123.45", "USDC": "67.89", ... }`. Render one block (card or row) per key; label = token symbol, value = string amount. Fees come from `Transaction.fee` (set when status = COMPLETED); each transaction’s fee is in its `f_token`, and the backend sums by `f_token`. For a time range or per-partner breakdown, use `GET /api/connect/fees/report` (see below).

### 3.5 Fees report: `GET /api/connect/fees/report`

**Purpose:** Accumulated fees by currency with optional time window and optional partner filter. Use for dashboard fee container when you need a dedicated fees view or filters.

**Query:**

| Name | Type | Description |
|------|------|-------------|
| `days` | `string` | Optional. Last N days (0 = all time). Clamped 0–365. |
| `businessId` | `string` | Optional. Filter to transactions for this business UUID. |

**Response (in `data`):**

| Field | Type | Description |
|-------|------|-------------|
| `byCurrency` | `object` | Same as overview `feesByCurrency`: `{ "GHS": "123.45", "USDC": "67.89", ... }`. |
| `totalConverted` | `number` | Sum of (fee × rate) per transaction: SELL/REQUEST/CLAIM use `f_price`, BUY uses `t_price`. Single aggregate in quote units (for comparison across tokens). |
| `days` | `number` \| `null` | Query `days` used (or `null` if all time). |
| `businessId` | `string` \| `null` | Query `businessId` used (or `null` if platform-wide). |

---

## 4. Merchants (`/connect/merchants`)

**Route:** `GET /api/connect/merchants`  
**Access:** Platform key only (403 if merchant key).

### 4.1 Query

| Name | Type | Description |
|------|------|-------------|
| `page` | `string` | Page number (default `1`). |
| `limit` | `string` | Page size (default from server; max typically 100). |
| `status` | `string` | Filter by KYB status: `NOT_STARTED`, `PENDING`, `APPROVED`, `REJECTED`, `RESTRICTED`, or `all`. |
| `riskLevel` | `string` | `high` (riskScore ≥ 50), `low` (≤ 49), or `all`. |

### 4.2 Response (list item)

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Business UUID. |
| `accountId` | `string` | Display ID, e.g. `acct_<slug>`. |
| `name` | `string` | Business name. |
| `slug` | `string` | Slug. |
| `logoUrl` | `string` \| `undefined` | Logo URL. |
| `kybStatus` | `string` | NOT_STARTED \| PENDING \| APPROVED \| REJECTED \| RESTRICTED. |
| `riskScore` | `number` | 0–100. |
| `balance` | `number` | Currently `0` (reserved for future computed balance). |
| `feeTier` | `object` | `{ percentage, flat, max? }`. |
| `createdAt` | `string` | ISO date. |

### 4.3 Merchant detail: `GET /api/connect/merchants/:id`

**Access:** Platform sees any merchant; merchant key only their own `id` (403 otherwise).

**Response:** Single merchant with:

| Field | Type | Description |
|-------|------|-------------|
| `id`, `accountId`, `name`, `slug`, `logoUrl`, `website`, `supportEmail` | — | Identity. |
| `kybStatus`, `riskScore` | — | Compliance/risk. |
| `webhookUrl` | `string` \| `undefined` | Main webhook URL. |
| `createdAt` | `string` | ISO date. |
| `apiKeys` | `array` | List of `{ id, keyPrefix, name, lastUsedAt, isActive }` (keys never exposed in full). |
| `transactionCount` | `number` | Total transaction count for this business. |
| `volume30d` | `number` | Gross volume (completed txns) in the last 30 days. |

Use this for the merchant row drawer: API keys (masked), webhook, mini volume graph (e.g. from `volume30d` or future time-series).

---

## 5. Settlements (`/connect/settlements`)

**Route:** `GET /api/connect/settlements`  
**Access:** Platform sees all payouts; merchant key sees only payouts for their business.

### 5.1 Query

| Name | Type | Description |
|------|------|-------------|
| `page` | `string` | Page number. |
| `limit` | `string` | Page size. |
| `status` | `string` | Filter: `SCHEDULED`, `PROCESSING`, `PAID`, `FAILED`, `REVERSED`, or `all`. |

### 5.2 Response (list item)

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Payout UUID. |
| `batchId` | `string` | Batch id or same as `id` if no batch. |
| `businessId`, `businessName`, `businessSlug` | — | Business info. |
| `amount` | `number` | Net payout amount. |
| `fee` | `number` | Payout fee (e.g. wire cost). |
| `currency` | `string` | e.g. `USD`, `USDC`, `GHS`. |
| `status` | `string` | SCHEDULED \| PROCESSING \| PAID \| FAILED \| REVERSED. |
| `reference` | `string` \| `undefined` | External reference (e.g. wire ref, tx hash). |
| `createdAt`, `updatedAt` | `string` | ISO dates. |

Use for the left column: "Batch #…" (e.g. last 8 of `batchId`), "To: &lt;businessName&gt;", "Amount: &lt;amount&gt; &lt;currency&gt;", "Status: &lt;status&gt;".

### 5.3 Settlement detail: `GET /api/connect/settlements/:id`

**Access:** Platform sees any; merchant key only if payout belongs to their business (403 otherwise).

**Response:** Single payout with:

| Field | Type | Description |
|-------|------|-------------|
| `id`, `batchId`, `business`, `method` | — | Identity and payout method. |
| `amount`, `fee`, `gross`, `currency` | — | Financials (`gross` = amount + fee). |
| `status`, `reference` | — | Status and external reference. |
| `createdAt`, `updatedAt` | — | ISO dates. |
| `timeline` | `array` | Steps: e.g. `{ step, at, done }` (Created, Processed/Processing). |
| `sourceTransactions` | `array` | Reserved for future; currently `[]`. |

Use for the right column: summary (Gross, Platform Fees, Net Payout), timeline, and (when available) source transactions table.

---

## 6. Error summary

| Status | Meaning |
|--------|--------|
| `401` | Missing or invalid API key. |
| `403` | Not allowed (e.g. merchant key calling overview or another merchant’s data). |
| `404` | Merchant or settlement not found. |
| `500` | Server error. |

---

## 7. Quick reference

| Page | Route | Backend endpoint |
|------|--------|------------------|
| Connect Overview | `/connect` | `GET /api/connect/overview` |
| Merchants | `/connect/merchants` | `GET /api/connect/merchants` |
| Merchant detail (drawer) | — | `GET /api/connect/merchants/:id` |
| Settlements | `/connect/settlements` | `GET /api/connect/settlements` |
| Settlement detail | — | `GET /api/connect/settlements/:id` |

All requests require header: `x-api-key: <key>`.
