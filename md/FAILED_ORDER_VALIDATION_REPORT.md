# Failed Order Validation — API Report for Frontend

This document describes the API for **Failed Order Validation** data, used to power dashboards and debugging views in the frontend.

---

## Overview

When an order fails validation (e.g. price out of tolerance, insufficient funds, quote expired), it is stored in:

- **DB**: `FailedOrderValidation` (persistent, paginated)
- **Redis**: a short list of recent failures (fast, no DB)

All endpoints below require a **platform admin API key** (no `businessId`). Use header: `x-api-key: <platform-key>`.

---

## Endpoints

### 1. GET `/api/validation/failed` — List (paginated)

Returns failed validations from the database with pagination.

**Query**

| Param  | Type   | Default | Description                    |
|--------|--------|--------|--------------------------------|
| `page` | number | 1      | Page number (1-based).         |
| `limit`| number | 20     | Items per page (max 100).      |
| `code` | string | -      | Filter by error code.          |

**Response**

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "createdAt": "2026-02-01T12:00:00.000Z",
      "reason": "Order t_price (1) is outside allowed range for onramp (expected ~12.28, ±2%)",
      "code": "PRICE_OUT_OF_TOLERANCE",
      "payload": {
        "action": "buy",
        "f_chain": "MOMO",
        "t_chain": "BASE",
        "f_token": "GHS",
        "t_token": "USDC",
        "f_amount": 100,
        "t_amount": 8.14,
        "f_provider": "PAYSTACK",
        "t_provider": "KLYRA"
      },
      "requestId": "uuid-or-null"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 42
  }
}
```

**Use case:** Table/list of failed validations with filters and pagination.

---

### 2. GET `/api/validation/failed/recent` — Last N (Redis)

Returns the most recent failures from Redis (no DB). Good for a “live” feed.

**Query**

| Param  | Type   | Default | Description        |
|--------|--------|--------|--------------------|
| `limit`| number | 50     | Max items (max 200). |

**Response**

```json
{
  "success": true,
  "data": [
    {
      "at": "2026-02-01T12:00:00.000Z",
      "code": "PRICE_OUT_OF_TOLERANCE",
      "error": "Order t_price (1) is outside allowed range...",
      "payload": { "action": "buy", "f_chain": "MOMO", ... }
    }
  ]
}
```

**Use case:** Recent-failures widget or live log.

---

### 3. GET `/api/validation/failed/report` — Aggregated report (dashboard)

Returns aggregated stats for charts and summary cards.

**Query**

| Param | Type   | Default | Description                          |
|-------|--------|--------|--------------------------------------|
| `days`| number | 7      | Report window for `byCode` and `daily` (1–90). |

**Response**

```json
{
  "success": true,
  "data": {
    "total": 1234,
    "last24h": 45,
    "last7d": 312,
    "byCode": {
      "RATE_UNAVAILABLE": 120,
      "PRICE_OUT_OF_TOLERANCE": 89,
      "AMOUNT_OUT_OF_TOLERANCE": 42,
      "QUOTE_EXPIRED": 31,
      "INSUFFICIENT_FUNDS": 18,
      "UNSUPPORTED_F_TOKEN": 12
    },
    "daily": [
      { "date": "2026-01-26", "count": 38 },
      { "date": "2026-01-27", "count": 52 },
      { "date": "2026-01-28", "count": 41 }
    ],
    "since": "2026-01-26T00:00:00.000Z",
    "generatedAt": "2026-02-01T12:00:00.000Z"
  }
}
```

**Fields**

| Field         | Type   | Description |
|---------------|--------|-------------|
| `total`       | number | All-time count in DB. |
| `last24h`     | number | Failures in the last 24 hours. |
| `last7d`      | number | Failures in the last 7 days. |
| `byCode`      | object | Count per error code in the `days` window. |
| `daily`       | array  | Count per day in the `days` window (for charts). |
| `since`       | string | Start of the report window (ISO). |
| `generatedAt` | string | Report generation time (ISO). |

**Use case:** Dashboard KPIs (total, last 24h, last 7d), pie/bar chart by `code`, line chart from `daily`.

---

## Error codes (examples)

| Code                     | Meaning |
|--------------------------|--------|
| `RATE_UNAVAILABLE`       | Quote/provider rate not available (e.g. Fonbnk 502). |
| `PRICE_OUT_OF_TOLERANCE` | Order price outside ±2% of quote. |
| `AMOUNT_OUT_OF_TOLERANCE`| Order amount outside ±2% of quote. |
| `QUOTE_EXPIRED`          | Stored quote expired or not found. |
| `QUOTE_INVALID`          | Quote response invalid. |
| `INSUFFICIENT_FUNDS`     | KLYRA balance too low. |
| `UNSUPPORTED_F_TOKEN` / `UNSUPPORTED_T_TOKEN` | Token not supported on chain. |
| `INVALID_F_PROVIDER` / `INVALID_T_PROVIDER`   | Unknown or disabled provider. |
| `CACHE_NOT_READY`        | Validation cache not loaded. |
| `FEE_UNAVAILABLE`        | Platform fee not available. |

---

## Frontend usage summary

1. **Dashboard**
   - Call `GET /api/validation/failed/report?days=7`.
   - Use `total`, `last24h`, `last7d` for KPI cards.
   - Use `byCode` for a pie or bar chart (failure reason breakdown).
   - Use `daily` for a line chart (failures over time).

2. **Recent failures**
   - Call `GET /api/validation/failed/recent?limit=50` for a live-style list.

3. **Full list with filters**
   - Call `GET /api/validation/failed?page=1&limit=20&code=RATE_UNAVAILABLE` for a table and optional filter by `code`.

All requests must include a valid platform API key in `x-api-key`.
