# Inventory USD Cost Basis — Frontend Change Report

**Date:** 2025-02-03  
**Breaking change:** Inventory and PnL APIs now use **USD-only** cost basis and a new **ledger** model. Old fields have been removed or renamed.

---

## 1. Summary of change

| Area           | Before                                                                                         | After                                                                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Lots**       | `quantity`, `costPerToken` (ambiguous: often exchange rate, not USD)                           | `originalQuantity`, `remainingQuantity`, `costPerTokenUsd`, `totalCostUsd`, `status` (`OPEN` \| `DEPLETED`)                                                                           |
| **History**    | `InventoryHistory`: `type`, `amount`, `quantity`, `initialPurchasePrice`, `providerQuotePrice` | **Renamed to Ledger:** `InventoryLedger` with `type` (`ACQUIRED` \| `DISPOSED` \| `REBALANCE`), `quantity` (+/−), `pricePerTokenUsd`, `totalValueUsd`, `referenceId`, `counterparty?` |
| **Cost basis** | `averageCostPerToken` (could be non-USD)                                                       | `averageCostPerTokenUsd` (always USD)                                                                                                                                                 |
| **PnL**        | `costPerToken`, `providerPrice`, `sellingPrice`, `feeAmount`, `profitLoss`                     | **Removed.** Use `costPerTokenUsd`, `feeAmountUsd`, `profitLossUsd` only                                                                                                              |

**Reason:** The backend now enforces a **USD standard** for inventory valuation and PnL. Storing exchange rates (e.g. `1.00`) as cost basis inflated valuations; all cost and value fields are now explicit USD.

---

## 2. Affected endpoints and new response shapes

### 2.1 GET /api/inventory/history

**Before (InventoryHistory):**

- `type`: string (e.g. `"PURCHASE"`, `"SALE"`)
- `amount`, `quantity`: decimal strings
- `initialPurchasePrice`, `providerQuotePrice`: decimal strings

**After (InventoryLedger):**

| Field              | Type                                          | Meaning                                       |
| ------------------ | --------------------------------------------- | --------------------------------------------- |
| `id`               | string                                        | Ledger entry id                               |
| `createdAt`        | string (ISO)                                  | When the movement occurred                    |
| `assetId`          | string                                        | Inventory asset id                            |
| `type`             | `"ACQUIRED"` \| `"DISPOSED"` \| `"REBALANCE"` | In, out, or internal move                     |
| `quantity`         | string                                        | Signed decimal: positive = in, negative = out |
| `pricePerTokenUsd` | string                                        | USD price per token at time of event          |
| `totalValueUsd`    | string                                        | \|quantity\| × pricePerTokenUsd (USD)         |
| `referenceId`      | string                                        | Transaction or order id                       |
| `counterparty`     | string \| null                                | Optional                                      |

**No longer present:** `amount`, `initialPurchasePrice`, `providerQuotePrice`.

---

### 2.2 GET /api/inventory/:id/history

Same item shape as above (ledger entries for that asset). Pagination and meta unchanged.

---

### 2.3 GET /api/lots

**Before (InventoryLot):**

- `quantity`: remaining amount in lot
- `costPerToken`: price per token (ambiguous unit)

**After:**

| Field                 | Type                     | Meaning                                                           |
| --------------------- | ------------------------ | ----------------------------------------------------------------- |
| `id`                  | string                   | Lot id                                                            |
| `assetId`             | string                   | Asset id                                                          |
| `originalQuantity`    | string                   | Amount originally acquired in this lot                            |
| `remainingQuantity`   | string                   | Amount still in the lot (FIFO deduction)                          |
| `costPerTokenUsd`     | string                   | **USD** cost per token at acquisition                             |
| `totalCostUsd`        | string                   | originalQuantity × costPerTokenUsd (USD)                          |
| `status`              | `"OPEN"` \| `"DEPLETED"` | OPEN = has remaining qty; DEPLETED = empty                        |
| `acquiredAt`          | string (ISO)             | When the lot was created                                          |
| `sourceType`          | string \| null           | e.g. PURCHASE, REBALANCE                                          |
| `sourceTransactionId` | string \| null           | Transaction that created this lot                                 |
| `asset`               | object                   | Inlined asset (id, chain, chainId, symbol, tokenAddress, address) |

**No longer present:** `quantity`, `costPerToken`.

**Query:** `onlyAvailable=true` filters to lots with `status: "OPEN"` and `remainingQuantity > 0`.

---

### 2.4 GET /api/inventory/:id/lots

Same lot shape as above (lots for that asset only). FIFO order (oldest first).

---

### 2.5 GET /api/inventory/:id/cost-basis

**Before:** `averageCostPerToken` (decimal string).

**After:**

| Field                    | Type           | Meaning                                                                   |
| ------------------------ | -------------- | ------------------------------------------------------------------------- |
| `assetId`                | string         | Same as `:id`                                                             |
| `averageCostPerTokenUsd` | string \| null | Volume-weighted average USD cost of **remaining** lots; `null` if no lots |

**No longer present:** `averageCostPerToken`.

---

### 2.6 GET /api/transactions/:id/pnl

**Before (TransactionPnL):**

- `costPerToken`, `providerPrice`, `sellingPrice`, `feeAmount`, `profitLoss`
- `lot` included `quantity`, `costPerToken`

**After:**

| Field             | Type           | Meaning                                                                                         |
| ----------------- | -------------- | ----------------------------------------------------------------------------------------------- |
| `id`              | string         | PnL row id                                                                                      |
| `transactionId`   | string         | Transaction id                                                                                  |
| `lotId`           | string \| null | Lot used (FIFO)                                                                                 |
| `quantity`        | string         | Tokens sold from this lot                                                                       |
| `costPerTokenUsd` | string         | Lot cost basis in **USD** per token                                                             |
| `feeAmountUsd`    | string         | (Selling − provider) × qty in **USD**                                                           |
| `profitLossUsd`   | string         | (Selling − cost) × qty in **USD**                                                               |
| `lot`             | object \| null | `id`, `remainingQuantity`, `costPerTokenUsd`, `acquiredAt`, `assetId` (all decimals as strings) |

**No longer present:** `costPerToken`, `providerPrice`, `sellingPrice`, `feeAmount`, `profitLoss`.

---

### 2.7 GET /api/pnl

List of PnL rows (with pagination). Each item has the same shape as above, plus `transaction` (id, type, status, f_chain, t_chain, f_token, t_token) and `lot` with `remainingQuantity`, `costPerTokenUsd`.

---

## 3. Frontend migration

### 3.1 Inventory history → Ledger

- **URLs unchanged:** `GET /api/inventory/history`, `GET /api/inventory/:id/history`.
- **Rename types:** e.g. `InventoryHistory` → `InventoryLedger`.
- **Field mapping:**
  - `type`: map old `"PURCHASE"` → `"ACQUIRED"`, `"SALE"` → `"DISPOSED"`; others → `"REBALANCE"`.
  - Use `quantity` (signed) instead of `amount`/`quantity`; use `pricePerTokenUsd` and `totalValueUsd` for display (always USD).
- **Remove:** any reads of `initialPurchasePrice`, `providerQuotePrice` from history payloads.

### 3.2 Lots

- **Display “cost per token”:** use `costPerTokenUsd` (parse as number for USD).
- **Display “remaining” / “original”:** use `remainingQuantity` and `originalQuantity`.
- **Filter “available” lots:** use `status === "OPEN"` or request with `onlyAvailable=true`.
- **Remove:** `quantity`, `costPerToken` from lot types and UI.

### 3.3 Cost basis

- **Single asset:** `GET /api/inventory/:id/cost-basis` → use `averageCostPerTokenUsd` (null if no lots).
- **Remove:** `averageCostPerToken`.

### 3.4 PnL

- **Display “cost basis”:** use `costPerTokenUsd`.
- **Display “fee in USD” / “profit or loss in USD”:** use `feeAmountUsd`, `profitLossUsd`.
- **Remove:** `costPerToken`, `providerPrice`, `sellingPrice`, `feeAmount`, `profitLoss` from PnL types and UI.

### 3.5 TypeScript types (example)

```ts
// Ledger (replaces History)
interface InventoryLedgerEntry {
  id: string;
  createdAt: string;
  assetId: string;
  type: "ACQUIRED" | "DISPOSED" | "REBALANCE";
  quantity: string;
  pricePerTokenUsd: string;
  totalValueUsd: string;
  referenceId: string;
  counterparty: string | null;
}

// Lot
interface InventoryLotRow {
  id: string;
  assetId: string;
  originalQuantity: string;
  remainingQuantity: string;
  costPerTokenUsd: string;
  totalCostUsd: string;
  status: "OPEN" | "DEPLETED";
  acquiredAt: string;
  sourceType: string | null;
  sourceTransactionId: string | null;
  asset?: {
    id: string;
    chain: string;
    chainId: number;
    symbol: string;
    tokenAddress?: string;
    address?: string;
  };
}

// Cost basis
interface CostBasisResponse {
  assetId: string;
  averageCostPerTokenUsd: string | null;
}

// PnL
interface TransactionPnLRow {
  id: string;
  transactionId: string;
  lotId: string | null;
  quantity: string;
  costPerTokenUsd: string;
  feeAmountUsd: string;
  profitLossUsd: string;
  lot: {
    id: string;
    remainingQuantity: string;
    costPerTokenUsd: string;
    acquiredAt: string;
    assetId: string;
  } | null;
}
```

---

## 4. Example responses (after change)

### GET /api/inventory/:id/lots (single item)

```json
{
  "success": true,
  "data": [
    {
      "id": "lot-uuid",
      "assetId": "asset-uuid",
      "originalQuantity": "35.32",
      "remainingQuantity": "35.32",
      "costPerTokenUsd": "0.064",
      "totalCostUsd": "2.26048",
      "status": "OPEN",
      "acquiredAt": "2025-02-01T12:00:00.000Z",
      "sourceType": "PURCHASE",
      "sourceTransactionId": "tx-uuid"
    }
  ]
}
```

### GET /api/inventory/history (single ledger item)

```json
{
  "success": true,
  "data": [
    {
      "id": "ledger-uuid",
      "createdAt": "2025-02-01T12:00:00.000Z",
      "assetId": "asset-uuid",
      "type": "ACQUIRED",
      "quantity": "35.32",
      "pricePerTokenUsd": "0.064",
      "totalValueUsd": "2.26048",
      "referenceId": "tx-uuid",
      "counterparty": null
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1 }
}
```

### GET /api/inventory/:id/cost-basis

```json
{
  "success": true,
  "data": {
    "assetId": "asset-uuid",
    "averageCostPerTokenUsd": "0.064"
  }
}
```

### GET /api/transactions/:id/pnl (single PnL row)

```json
{
  "success": true,
  "data": [
    {
      "id": "pnl-uuid",
      "transactionId": "tx-uuid",
      "lotId": "lot-uuid",
      "quantity": "10",
      "costPerTokenUsd": "0.064",
      "feeAmountUsd": "0.12",
      "profitLossUsd": "0.05",
      "lot": {
        "id": "lot-uuid",
        "remainingQuantity": "25.32",
        "costPerTokenUsd": "0.064",
        "acquiredAt": "2025-02-01T12:00:00.000Z",
        "assetId": "asset-uuid"
      }
    }
  ]
}
```

---

## 5. Checklist for frontend

- [ ] Replace `InventoryHistory` with `InventoryLedger`; use `type` (`ACQUIRED`/`DISPOSED`/`REBALANCE`), `quantity`, `pricePerTokenUsd`, `totalValueUsd`; remove `initialPurchasePrice`, `providerQuotePrice`, `amount`.
- [ ] For lots: use `originalQuantity`, `remainingQuantity`, `costPerTokenUsd`, `totalCostUsd`, `status`; remove `quantity`, `costPerToken`.
- [ ] Cost basis: use `averageCostPerTokenUsd`; remove `averageCostPerToken`.
- [ ] PnL: use `costPerTokenUsd`, `feeAmountUsd`, `profitLossUsd`; remove `costPerToken`, `providerPrice`, `sellingPrice`, `feeAmount`, `profitLoss`.
- [ ] Update TypeScript types/interfaces for inventory history, lots, cost-basis, and PnL responses.
- [ ] Treat all new decimal fields as strings; parse for display/calculations. Handle `null` for `averageCostPerTokenUsd` and optional `lot` on PnL.
