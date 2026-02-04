# Transaction Price API — Frontend Change Report

**Date:** 2025-02-03  
**Breaking change:** Transaction-related API responses no longer include `f_price` or `t_price`. Use the new USD price fields instead.

---

## 1. Summary of change

| Before                                                                     | After                                                                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `f_price`, `t_price` (ambiguous: sometimes exchange rate, sometimes price) | **Removed** from transaction payloads                                                            |
| —                                                                          | `exchangeRate`, `f_tokenPriceUsd`, `t_tokenPriceUsd`, `feeInUsd` (clear, absolute USD semantics) |

**Reason:** The backend now stores and returns **absolute USD prices** only. `f_price` / `t_price` were removed to avoid confusion and wrong analytics (e.g. treating 1 GHS as $1).

---

## 2. New transaction price fields (in API responses)

When a **transaction** object is returned (e.g. in claims, requests, transactions list/detail), it now includes only these price-related fields:

| Field             | Type             | Meaning                                                                                         |
| ----------------- | ---------------- | ----------------------------------------------------------------------------------------------- |
| `exchangeRate`    | `string \| null` | Effective rate for the trade: `t_amount / f_amount` (units of to-token per unit of from-token). |
| `f_tokenPriceUsd` | `string \| null` | Price of **1 unit of the FROM token** in USD (e.g. `"1"` for USDC, `"0.064"` for GHS).          |
| `t_tokenPriceUsd` | `string \| null` | Price of **1 unit of the TO token** in USD (e.g. `"1"` for USDC, `"0.064"` for GHS).            |
| `feeInUsd`        | `string \| null` | Fee value in USD at completion (set when transaction is completed).                             |

**No longer present:** `f_price`, `t_price`.

---

## 3. Affected endpoints

These endpoints return transaction objects (or nested `transaction` on request/claim). Update any code that reads `f_price` or `t_price` from the **transaction** payload.

| Endpoint                        | Change                                                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `GET /api/transactions`         | Each item: use `exchangeRate`, `f_tokenPriceUsd`, `t_tokenPriceUsd`, `feeInUsd` instead of `f_price`, `t_price`. |
| `GET /api/transactions/:id`     | Same as above for the single transaction.                                                                        |
| `GET /api/requests`             | Each item has `transaction`; use the new fields on `transaction`.                                                |
| `GET /api/requests/:id`         | `request.transaction` uses the new fields only.                                                                  |
| `GET /api/claims`               | Each item has `request.transaction`; use the new fields.                                                         |
| `GET /api/claims/:id`           | `claim.request.transaction` uses the new fields only.                                                            |
| `GET /api/claims/by-code/:code` | Same as above.                                                                                                   |

---

## 4. Frontend migration

### 4.1 Replace `f_price` / `t_price` usage

- **Display “price of from token”:** use `f_tokenPriceUsd` (parse as number for calculations).  
  Example: “1 USDC = $1.00” → `f_tokenPriceUsd === "1"`.
- **Display “price of to token”:** use `t_tokenPriceUsd`.  
  Example: “1 GHS ≈ $0.064” → `t_tokenPriceUsd === "0.064"`.
- **Display “rate” or “exchange rate”:** use `exchangeRate` (to-token per from-token).  
  Example: “1 GHS = 0.075 USDC” → `exchangeRate === "0.075"` for a GHS→USDC trade.
- **Display “fee in USD”:** use `feeInUsd` when present (completed transactions).  
  Do not derive fee USD from `fee * t_price` or similar; use `feeInUsd` directly.

### 4.2 TypeScript / types

Remove `f_price` and `t_price` from any transaction type or interface used for these APIs, and add (or keep):

```ts
interface TransactionPriceFields {
  exchangeRate: string | null;
  f_tokenPriceUsd: string | null;
  t_tokenPriceUsd: string | null;
  feeInUsd: string | null;
}
```

### 4.3 Nullability

All four fields can be `null` for older transactions (created before the backend migration). Guard before use:

- For display: show “—” or “N/A” when `null`.
- For calculations: skip or use a fallback when any required value is `null`.

---

## 5. Example response (after change)

**GET /api/transactions/:id** (excerpt):

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "type": "BUY",
    "status": "COMPLETED",
    "f_amount": "100",
    "t_amount": "1.5",
    "exchangeRate": "0.015",
    "f_tokenPriceUsd": "0.064",
    "t_tokenPriceUsd": "1",
    "feeInUsd": "0.24",
    "fee": "3.75",
    "f_token": "GHS",
    "t_token": "USDC",
    ...
  }
}
```

**Removed from this object:** `f_price`, `t_price`.

---

## 6. Checklist for frontend

- [ ] Remove all reads of `transaction.f_price` and `transaction.t_price` from API response handling.
- [ ] Use `f_tokenPriceUsd` / `t_tokenPriceUsd` for “price per token in USD” and `exchangeRate` for trade rate.
- [ ] Use `feeInUsd` for fee in USD (do not derive from `fee * t_price`).
- [ ] Update TypeScript types/interfaces to drop `f_price`/`t_price` and include the new fields.
- [ ] Handle `null` for the new fields (e.g. old transactions).
