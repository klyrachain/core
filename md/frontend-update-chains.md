# Frontend Update: f_chain, t_chain & supportedChains

**Purpose:** Report of API and data model changes for cross-chain support. Use this to update your frontend (and Backend that calls Core).

---

## 1. Summary

- **Transaction** now has `f_chain` and `t_chain`. This enables cross-chain flows (e.g. transfer USDC on BASE → USDT on ETHEREUM); inventory is updated per chain.
- **Wallet** now has `supportedChains` in addition to `supportedTokens`. Each wallet can list which chains it supports (e.g. `["ETHEREUM", "BASE"]`).
- **Order webhook** and **quote API** accept optional `f_chain` and `t_chain` (default `"ETHEREUM"`).
- **Admin / Poll** events include `f_chain` and `t_chain` where relevant.

---

## 2. Transaction model

| Field     | Type   | Description |
|----------|--------|-------------|
| `f_chain` | string | Source chain (e.g. `"ETHEREUM"`, `"BASE"`). |
| `t_chain` | string | Target chain. Enables cross-chain: e.g. USDC on BASE → USDT on ETHEREUM. |

- **GET /api/transactions** and **GET /api/transactions/:id** responses now include `f_chain` and `t_chain` on each transaction.
- Existing rows are backfilled with `f_chain: "ETHEREUM"`, `t_chain: "ETHEREUM"` by migration.

---

## 3. Wallet model

| Field              | Type     | Description |
|--------------------|----------|-------------|
| `supportedChains`  | string[] | Chains the wallet supports (e.g. `["ETHEREUM", "BASE"]`). |
| `supportedTokens`  | string[] | Unchanged (e.g. `["ETH", "USDC"]`). |

- **GET /api/wallets** and **GET /api/wallets/:id** responses now include `supportedChains`.
- Existing rows get `supportedChains: []` by migration; backfill or set via your app as needed.

---

## 4. Order webhook (POST /webhook/order)

**Request body — new optional fields:**

| Field    | Type   | Required | Default     | Description |
|----------|--------|----------|-------------|-------------|
| `f_chain` | string | No       | `"ETHEREUM"` | Source chain for f_token. |
| `t_chain` | string | No       | `"ETHEREUM"` | Target chain for t_token. |

**Example (cross-chain):**

```json
{
  "action": "buy",
  "f_chain": "BASE",
  "t_chain": "ETHEREUM",
  "f_token": "USDC",
  "t_token": "ETH",
  "f_amount": 100,
  "t_amount": 0.033,
  "f_price": 1,
  "t_price": 3000,
  "fromIdentifier": "user@example.com",
  "fromType": "EMAIL",
  "toIdentifier": "0x...",
  "toType": "ADDRESS"
}
```

- Core deducts **t_token on t_chain** from inventory (e.g. ETH on ETHEREUM) and adds **f_token on f_chain** (e.g. USDC on BASE). Same-chain and cross-chain are both supported.

---

## 5. Quote API (GET /api/quote)

**Query params — new optional:**

| Param    | Type   | Description |
|----------|--------|-------------|
| `f_chain` | string | Source chain (optional). |
| `t_chain` | string | Target chain (optional). |

Example: `GET /api/quote?action=buy&f_amount=100&t_amount=0.033&f_price=1&t_price=3000&f_chain=BASE&t_chain=ETHEREUM&f_token=USDC&t_token=ETH`

- Response shape is unchanged; chains are for consistency and future fee-per-chain logic.

---

## 6. Admin dashboard / webhook events

- **order.created** `data` now includes `f_chain` and `t_chain`.
- **order.completed** and **order.failed** `data` now include `f_chain` and `t_chain`.

---

## 7. Inventory & cache

- **Inventory** is already per chain (`InventoryAsset.chain`). Poll worker now uses `tx.f_chain` and `tx.t_chain` to deduct/add the correct chain+token (e.g. USDC on BASE → USDT on ETHEREUM updates BASE USDC and ETHEREUM USDT).
- **GET /api/inventory** still supports `?chain=` filter.
- **GET /api/cache/balances/:chain/:token** unchanged.

---

## 8. Frontend checklist

- [ ] **Transactions list/detail:** Display or filter by `f_chain` and `t_chain`; show “From chain” / “To chain” (e.g. BASE → ETHEREUM).
- [ ] **Wallets:** Display and edit `supportedChains`; ensure create/update sends `supportedChains` when your Backend supports it.
- [ ] **Order flow:** When calling Backend to create an order, send `f_chain` and `t_chain` when the user selects chains (default `"ETHEREUM"` if not selected).
- [ ] **Quote flow:** Pass `f_chain` and `t_chain` to the quote endpoint when doing cross-chain quotes.
- [ ] **Admin / webhooks:** If you consume `order.created` / `order.completed` / `order.failed`, handle `f_chain` and `t_chain` in the payload.

---

## 9. Migration (Backend / DB)

- Run Core migrations so `Transaction` has `f_chain`/`t_chain` and `Wallet` has `supportedChains`.
- Re-run seed if you use it (seed now sets `f_chain`/`t_chain` on transactions and `supportedChains` on wallets).
