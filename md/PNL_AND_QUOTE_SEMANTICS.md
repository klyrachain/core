# Profit & Loss and Quote Semantics

**Purpose:** Defines how fee, profit, and P&L are computed for on-ramp (and how the dashboard/API exposes them). Aligns with the `TransactionPnL` table and v1 quote debug fields.

---

## 1. Definitions

| Term | Meaning |
|------|--------|
| **Initial buy price (cost basis)** | Price we paid per token when we acquired inventory (e.g. from a prior BUY). From `InventoryLot.costPerToken` (FIFO). |
| **Provider price** | Current provider quote (e.g. Fonbnk buy price). Stored at order time as `Transaction.providerPrice` for on-ramp. |
| **Selling price** | Price we show/sell to the user (e.g. `exchangeRate` in v1 quote, `Transaction.t_price` on completion). |

- **Fee (per unit)** = selling price − provider price  
- **Profit (per unit)** = selling price − initial buy price  

So: fee is the spread above the provider; profit is the margin over our cost.

**Example:**  
Initial buy: 10.89, provider: 10.95, selling: 12.10  
→ fee = 12.10 − 10.95 = 1.15  
→ profit = 12.10 − 10.89 = 1.21  

---

## 2. Quote API (v1) — debug fields (ONRAMP)

When `includeDebug` is true (e.g. platform key), the quote response includes:

| Field | Meaning |
|-------|--------|
| `costBasis` | Avg buy price from inventory (cost basis). |
| `providerPrice` | Provider quote (same as `basePrice`). |
| `sellingPrice` | Price we sell to user (= `exchangeRate`). |
| `feePerUnit` | sellingPrice − providerPrice. |
| `profitPerUnit` | sellingPrice − costBasis. |

So from a single quote you can see fee and profit per unit. For total fee/profit on a given amount, multiply by (input amount / selling price) for token quantity, then by feePerUnit / profitPerUnit.

---

## 3. Transaction P&L table (`TransactionPnL`)

On **BUY (on-ramp)** completion, we deduct inventory FIFO. For each lot used we create a **TransactionPnL** row:

| Column | Meaning |
|--------|--------|
| `transactionId` | The completed transaction. |
| `lotId` | Inventory lot that was drawn from (optional). |
| `quantity` | Tokens sold from this lot. |
| `costPerToken` | Initial buy price (cost basis) for this lot. |
| `providerPrice` | Provider quote at time of sale (from `Transaction.providerPrice` or fallback). |
| `sellingPrice` | Price we sold to user (`Transaction.t_price`). |
| `feeAmount` | (sellingPrice − providerPrice) × quantity. |
| `profitLoss` | (sellingPrice − costPerToken) × quantity. |

So we account for **multi-lot FIFO P&L**: e.g. 1000 GHS at 11.85 and 1000 at 12.53, user buys 2000 at 12.30 → two rows, one with profit, one with loss; total P&L is the sum of `profitLoss`.

**Provider price at order time:** When creating a transaction via the order webhook, the caller can send `providerPrice` (e.g. from the quote’s `basePrice`). That value is stored on `Transaction.providerPrice` and used when creating `TransactionPnL` rows so fee and profit are correct per lot.

---

## 4. Fee vs profit (summary)

- **Fee** = what we charge above the provider (selling − provider). Stored per lot in `TransactionPnL.feeAmount`; can be aggregated for reporting.
- **Profit** = what we make over our cost (selling − cost basis). Stored per lot in `TransactionPnL.profitLoss`; can be negative (loss) when we sell below cost on that lot.

The **dashboard fee container** and **platform/connect fee reports** use `Transaction.fee` (total fee collected) and/or aggregated `TransactionPnL` for breakdowns by currency and P&L by transaction/lot.
