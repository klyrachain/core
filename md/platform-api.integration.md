# Platform API — Frontend Integration Report

**Purpose:** Reference for the frontend integrating with the **Platform** overview endpoint on the Core service. Use this for the **platform dashboard** that shows **all** fees and metrics across the entire platform (all transactions). This is distinct from the **Connect (B2B)** dashboard, which shows metrics and fees only for **business/partner** transactions.

**Base:** Same base URL as Core (e.g. `NEXT_PUBLIC_CORE_URL` or `VITE_CORE_URL`). Default dev port: `4000`.

**Auth:** Platform endpoints require the `x-api-key` header with a **platform key** (no businessId). Merchant keys receive 403.

---

## 1. Response envelope

- **Success:** `{ "success": true, "data": <payload> }`.
- **Error:** `{ "success": false, "error": "<message>" }` with HTTP status 401, 403, or 500.

---

## 2. Endpoints summary

| Method | Path | Purpose | Platform | Merchant |
|--------|------|---------|----------|----------|
| `GET` | `/api/platform/overview` | Platform-wide dashboard: all fees and counts | ✅ | ❌ 403 |

---

## 3. Platform Overview (`/api/platform/overview`)

**Route:** `GET /api/platform/overview`  
**Access:** Platform key only (403 if merchant key).

Returns platform-wide metrics: **all** fees accumulated from **all** completed transactions (no business filter). Use this for the platform admin dashboard. The platform decides what % of fees businesses can earn; the Connect dashboard (`/api/connect/overview`) shows only fees collected on transactions that belong to businesses (partners).

### 3.1 Response shape

| Field | Type | Description |
|-------|------|-------------|
| `feesByCurrency` | `object` | Accumulated fee totals by token/currency from **all** completed transactions. Keys = token symbol (e.g. `GHS`, `USDC`); values = sum of `Transaction.fee` for that `f_token`. |
| `totalConverted` | `number` | Sum of (fee × rate) per transaction in scope: SELL/REQUEST/CLAIM use `f_price`, BUY uses `t_price`. Single aggregate in quote units. |
| `completedTransactionCount` | `number` | Total count of transactions with status `COMPLETED`. |
| `completedWithFeeCount` | `number` | Count of completed transactions that have a non-null `fee`. |

### 3.2 Frontend use

- **Platform fee container:** Use `feesByCurrency` to display accumulated fees **per currency/token** (e.g. one card or row per token: GHS, USDC, etc.). This is the platform-wide total, not limited to partner transactions.
- **Summary:** Use `totalConverted` for a single aggregate value (in quote price units). Use `completedTransactionCount` and `completedWithFeeCount` for KPI cards or tables.

### 3.3 Connect vs Platform overview

| Aspect | Connect overview (`/api/connect/overview`) | Platform overview (`/api/platform/overview`) |
|--------|------------------------------------------|---------------------------------------------|
| Scope | **Business/partner** transactions only (`businessId != null`) | **All** transactions |
| Fees | Fees collected on transactions that belong to businesses | All fees collected platform-wide |
| Use | B2B Connect dashboard (partners, volume by partner, take rate) | Platform admin dashboard (total fees, counts) |
| Platform % | Platform still decides what % of fees businesses can earn; Connect shows business-scoped fee totals | Platform sees full accumulated fees |

---

## 4. Changelog

- **Initial:** `GET /api/platform/overview` with `feesByCurrency`, `totalConverted`, `completedTransactionCount`, `completedWithFeeCount`.
