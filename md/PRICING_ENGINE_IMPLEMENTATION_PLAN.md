# Merchant Pricing Engine — Live System Implementation Plan

This document is a detailed implementation plan for a **live production system** that uses the Merchant Pricing Engine for on-ramp and off-ramp crypto/fiat pricing. It captures all calculations, edge cases, and operational aspects so that implementation produces a **robust, production-ready engine**.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture](#2-system-architecture)
3. [Core Concepts & Terminology](#3-core-concepts--terminology)
4. [Calculations Reference](#4-calculations-reference)
5. [Edge Cases & Boundaries](#5-edge-cases--boundaries)
6. [Provider Quote Management](#6-provider-quote-management)
7. [Base Profit Modes](#7-base-profit-modes)
8. [Volatility Handling](#8-volatility-handling)
9. [Inventory & Fiat Pressure](#9-inventory--fiat-pressure)
10. [Input Validation & Sanitization](#10-input-validation--sanitization)
11. [Error Handling & Resilience](#11-error-handling--resilience)
12. [Security Considerations](#12-security-considerations)
13. [Testing Strategy](#13-testing-strategy)
14. [Deployment & Operations](#14-deployment--operations)
15. [Appendix: Formula Quick Reference](#15-appendix-formula-quick-reference)

---

## 1. Executive Summary

The Merchant Pricing Engine:

- **On-ramp:** Sells crypto (e.g. USDC) to users at a price **above** the provider buy rate, with a floor at the merchant’s **cost basis** (purchase price) so they never sell below cost.
- **Off-ramp:** Buys crypto from users at a price **below** the provider sell rate, with a cap at the **provider sell rate** so the platform never pays users more than it receives from the provider.

The live system must:

1. Ingest or simulate **provider buy** and **provider sell** quotes (separate for on-ramp vs off-ramp).
2. Compute **base profit** (manual fixed % or auto from inventory, velocity, volatility).
3. Apply **volatility premium**, **inventory risk** (on-ramp), and **fiat risk** (off-ramp).
4. Enforce **floor** (on-ramp: never below cost) and **cap** (off-ramp: never above provider sell).
5. Expose a **quote API** and optional **manual override** for testing when live quotes are unavailable.

---

## 2. System Architecture

### 2.1 Components

| Component | Responsibility |
|-----------|----------------|
| **Pricing Engine** (pure TS) | All formulas: `quoteOnRamp`, `quoteOffRamp`, `inventoryBaseProfitFromRatio`, `volatilityToPremium`, `calculateBaseProfit`, etc. No I/O. |
| **Provider Quote Service** | Source of truth for provider buy/sell rates and volatility. May be: live API, cache, or manual override. |
| **Quote API** | GET current provider state; POST to update or simulate. Used by UI and/or other services. |
| **Merchant / UI** | Collects: mode (on/off-ramp), amount, purchase price (on-ramp), base profit mode, inventory/velocity/volatility/fiat utilization, manual provider quotes (testing). Calls engine and displays result. |

### 2.2 Data Flow (High Level)

```
Provider Quote Service  →  providerBuyPrice, providerSellPrice, volatility
                                    ↓
Merchant inputs (amount, avgBuyPrice, baseProfit or auto params, fiatUtilization)
                                    ↓
Pricing Engine  →  quoteOnRamp() or quoteOffRamp()
                                    ↓
Final pricePerToken, breakdown, profit, profit margin
```

### 2.3 Modes

- **Pricing mode:** `onramp` (sell crypto to user) vs `offramp` (buy crypto from user).
- **Base profit mode:** `manual` (fixed %: 1%, 1.5%, 2%, …, 5%) vs `auto` (inventory + velocity + volatility).
- **Provider quotes:** `live` (from API/cache) vs `manual` (user-entered for testing).

---

## 3. Core Concepts & Terminology

| Term | Meaning |
|------|--------|
| **Provider buy price** | Rate at which the platform buys crypto from the provider (used for **on-ramp**). |
| **Provider sell price** | Rate at which the platform sells crypto to the provider (used for **off-ramp**). Typically **lower** than buy (e.g. ~5% spread). |
| **Cost basis / purchase price** | Price the merchant paid per token (incl. fees). On-ramp **floor**: never sell below this. |
| **Base selling price** | Same as cost basis in current design; displayed as “floor” under purchase price and amount. |
| **Inventory ratio** | 0 = empty (no crypto), 1 = full. 0.5 = balanced. Used in auto base profit (1%–2.5%). |
| **Fiat utilization** | 0 = plenty of fiat, 1 = no fiat. Off-ramp only; increases discount (we pay less when fiat is scarce). |
| **Volatility** | Market movement measure; drives **volatility premium** (quote) and **volatility adjustment to base** (auto mode). |

---

## 4. Calculations Reference

### 4.1 Volatility → Premium (Quote)

Used in both on-ramp and off-ramp to add a premium/discount for market risk.

| Volatility (decimal) | Volatility (approx %) | Premium (decimal) |
|----------------------|------------------------|-------------------|
| &lt; 0.005 | &lt; 0.5% | 0 |
| &lt; 0.015 | &lt; 1.5% | 0.005 (0.5%) |
| &lt; 0.03 | &lt; 3% | 0.015 (1.5%) |
| ≥ 0.03 | ≥ 3% | 0.03 (3%) |

**Function:** `volatilityToPremium(volatility: number): number`

**Edge cases:** Negative volatility should be treated as 0 (or sanitized to 0 before call).

---

### 4.2 Inventory → Base Profit (Auto Mode)

**1% min when balanced, 2.5% max when skewed** (more crypto or more fiat).

- `deviation = |inventoryRatio - targetInventory|` with `targetInventory = 0.5`.
- `normalized = min(deviation * 2, 1)` so that at 0 or 1 we get 1.
- `inventoryBaseProfit = minPct + (maxPct - minPct) * normalized` with `minPct = 0.01`, `maxPct = 0.025`.

**Function:** `inventoryBaseProfitFromRatio({ inventoryRatio, targetInventory?, minPct?, maxPct? }): number`

**Values:**

- inventoryRatio = 0.5 → 1%
- inventoryRatio = 0 or 1 → 2.5%
- Linear between.

**Edge cases:** Clamp `inventoryRatio` to [0, 1] before calling.

---

### 4.3 Velocity → Adjustment (Auto Mode)

| Trades/hour | Adjustment (decimal) |
|-------------|----------------------|
| &gt; 30 | -0.005 (-0.5%) |
| &gt; 15 | -0.002 (-0.2%) |
| &lt; 5 | +0.005 (+0.5%) |
| 5–15 | 0 |

**Function:** `velocityAdjustment(tradesPerHour: number): number`

**Edge cases:** Negative `tradesPerHour` → treat as 0 (or sanitize).

---

### 4.4 Volatility → Base Adjustment (Auto Mode)

Adds to base profit in auto mode when volatility is high.

| Volatility (decimal) | Adjustment (decimal) |
|----------------------|----------------------|
| &lt; 0.005 | 0 |
| &lt; 0.015 | 0.005 |
| &lt; 0.03 | 0.01 |
| ≥ 0.03 | 0.015 |

**Function:** `volatilityAdjustmentToBase(volatility: number): number`

---

### 4.5 Effective Base Profit (Auto Mode)

- `baseFromInventory = inventoryBaseProfitFromRatio({ inventoryRatio })` (1%–2.5%).
- `velocityAdj = velocityAdjustment(tradesPerHour)`.
- `volAdj = volatilityAdjustmentToBase(volatility)` if volatility provided.
- **Effective base profit** = clamp(`baseFromInventory + velocityAdj + volAdj`, **0.01**, **0.045**).

**Function:** `calculateBaseProfit({ inventoryRatio, tradesPerHour, volatility? }): number`

**Edge cases:** Result is always in [1%, 4.5%]. Manual base profit options (1%–5%) are independent and not clamped by this in manual mode.

---

### 4.6 On-Ramp Quote

**Inputs:** `providerPrice` (buy), `avgBuyPrice` (cost basis), `baseProfit`, `volatility`, optional `minSellingPrice` (floor).

**Steps:**

1. **Inventory risk** (only if avgBuyPrice &gt; providerPrice):  
   `inventoryRisk = max(0, (avgBuyPrice - providerPrice) / providerPrice)`  
   - **Edge case:** If `providerPrice <= 0`, abort or return error; do not divide by zero.

2. **Volatility premium:**  
   `volatilityPremium = volatilityToPremium(volatility)`.

3. **Total premium:**  
   `totalPremium = min(baseProfit + inventoryRisk + volatilityPremium, 0.06)` (cap 6%).

4. **Market price (no floor):**  
   `marketPricePerToken = providerPrice * (1 + totalPremium)`.

5. **Apply floor:**  
   If `minSellingPrice` is set and `marketPricePerToken < minSellingPrice`:  
   - `pricePerToken = minSellingPrice`  
   - `atFloor = true`  
   - `lossPerTokenIfSoldAtMarket = minSellingPrice - marketPricePerToken`  
   Else:  
   - `pricePerToken = marketPricePerToken`  
   - `atFloor = false`.

**Output:** `pricePerToken`, `totalPremium`, `breakdown` (baseProfit, inventoryRisk, volatilityPremium), `marketPricePerToken`, `atFloor`, optional `lossPerTokenIfSoldAtMarket`.

**Edge cases:**

- `providerPrice <= 0` → invalid; do not call or return error.
- `minSellingPrice <= 0` → ignore floor (do not apply).
- `avgBuyPrice < 0` → treat as 0 for inventory risk (or reject input).

---

### 4.7 Off-Ramp Quote

**Inputs:** `providerPrice` (sell), `baseProfit`, `volatility`, `fiatUtilization`, optional `maxBuyPrice` (cap).

**Steps:**

1. **Volatility premium:**  
   `volatilityPremium = volatilityToPremium(volatility)`.

2. **Fiat risk:**  
   `fiatRiskPremium = fiatUtilization * 0.02` (max 2% when utilization = 1).

3. **Total discount:**  
   `totalDiscount = min(baseProfit + volatilityPremium + fiatRiskPremium, 0.06)` (cap 6%).

4. **Buy price before cap:**  
   `buyPricePerToken = providerPrice * (1 - totalDiscount)`.

5. **Apply cap:**  
   If `maxBuyPrice` is set and &gt; 0:  
   `buyPricePerToken = min(buyPricePerToken, maxBuyPrice)`.

**Output:** `pricePerToken`, `totalDiscount`, `breakdown` (baseProfit, volatilityPremium, fiatRiskPremium).

**Edge cases:**

- `providerPrice <= 0` → invalid.
- `fiatUtilization` outside [0, 1] → clamp to [0, 1] before use.
- `maxBuyPrice <= 0` → do not apply cap.

---

### 4.8 Profit & Margin (UI / Reporting)

**On-ramp:**

- `totalFiat = pricePerToken * amount`
- `cost = avgBuyPrice * amount`
- `profit = totalFiat - cost`
- `profitMargin = (pricePerToken - avgBuyPrice) / avgBuyPrice` (as decimal; * 100 for %).  
  **Edge case:** If `avgBuyPrice === 0`, do not divide; show N/A or 0.

**Off-ramp:**

- `totalFiat = pricePerToken * amount` (what we pay users)
- `marketValue = providerSellPrice * amount` (what we get from provider)
- `profit = marketValue - totalFiat`
- `profitMargin = (providerSellPrice - pricePerToken) / providerSellPrice`  
  **Edge case:** If `providerSellPrice === 0`, do not divide.

---

## 5. Edge Cases & Boundaries

### 5.1 Input Bounds (Recommended for Live System)

| Input | Min | Max | Default | Action if out of range |
|-------|-----|-----|---------|------------------------|
| providerBuyPrice | &gt; 0 | configurable | — | Reject or clamp |
| providerSellPrice | &gt; 0 | ≤ providerBuyPrice (recommended) | — | Reject or clamp |
| avgBuyPrice | ≥ 0 | — | — | Reject if negative |
| amount | &gt; 0 | configurable max | — | Reject or clamp |
| baseProfit (manual) | 0.01 | 0.05 | 0.03 | Clamp to [1%, 5%] |
| inventoryRatio | 0 | 1 | 0.5 | Clamp |
| tradesPerHour | ≥ 0 | — | — | Treat negative as 0 |
| volatility | ≥ 0 | — | — | Treat negative as 0 |
| fiatUtilization | 0 | 1 | 0 | Clamp |

### 5.2 Division by Zero

- **On-ramp:** `providerPrice` and `avgBuyPrice` must be &gt; 0 where used as divisors.
- **Off-ramp:** `providerPrice` (sell) must be &gt; 0.
- **Profit margin:** Check `avgBuyPrice` (on-ramp) and `providerSellPrice` (off-ramp) before dividing.

### 5.3 Cap and Floor Semantics

- **On-ramp floor:** `minSellingPrice` is the merchant’s cost basis. If market price is below it, we still **display** and **use** the floor so the merchant never sells below cost. Optionally surface “market below cost” and loss if sold at market.
- **Off-ramp cap:** `maxBuyPrice` is the provider sell rate. Our buy-from-user price must never exceed it so we never pay users more than we receive from the provider.

### 5.4 Numeric Stability

- Prefer **decimal-aware** handling if using currency (e.g. round to 2 or 4 decimals for display and storage).
- Avoid floating-point comparison for equality; use small epsilon or integer cents/smallest unit where possible.

---

## 6. Provider Quote Management

### 6.1 Two Prices

- **Provider buy price:** Used for **on-ramp** (we buy from provider, sell to user at a higher price).
- **Provider sell price:** Used for **off-ramp** (we buy from user at a lower price, sell to provider).  
  In live systems, these come from the same provider but different endpoints or legs; sell is typically lower than buy.

### 6.2 API Contract (Current Pattern)

- **GET /api/pricing/quote**  
  Returns: `providerBuyPrice`, `providerSellPrice`, `previousBuyPrice`, `previousSellPrice`, `volatility`, `updatedAt`.

- **POST /api/pricing/quote**  
  Body: optional `providerBuyPrice`, `providerSellPrice`, or `simulate: true`.  
  - If `simulate: true`, run `simulateProviderQuotes()` and update state.  
  - If numeric fields provided, update and clamp (e.g. buy 12–13, sell 11–13).  
  Returns: same shape as GET.

### 6.3 Live vs Manual Override

- **Live:** Client (or backend job) polls GET and/or POST with `simulate: true` at an interval; UI uses returned prices and volatility.
- **Manual (testing):** User disables “live” and enters provider buy and provider sell in inputs; engine uses these values until live is re-enabled.  
  Ensure manual values are validated (positive, sane min/max) before passing to the engine.

### 6.4 Simulation (Optional)

- `simulateProviderPriceChange(currentPrice, minPrice, maxPrice)` returns `nextPrice`, `volatility`.
- `simulateProviderQuotes(currentBuyPrice, currentSellPrice, buyRange)` returns `nextBuyPrice`, `nextSellPrice`, `volatility`; sell is kept below buy (e.g. ~5% spread).  
  Use for demos, staging, or when live feed is down; replace with real provider API in production.

---

## 7. Base Profit Modes

### 7.1 Manual Mode

- User selects a fixed base profit: **1%, 1.5%, 2%, 2.5%, 3%, 3.5%, 4%, 4.5%, 5%** (do not remove these).
- This value is passed directly as `baseProfit` to `quoteOnRamp` or `quoteOffRamp`.
- No inventory/velocity/volatility contribution to base profit.

### 7.2 Auto Mode

- **From inventory:** `inventoryBaseProfitFromRatio({ inventoryRatio })` → 1%–2.5% (symmetric around 0.5).
- **From velocity:** `velocityAdjustment(tradesPerHour)` → -0.5% to +0.5%.
- **From volatility:** `volatilityAdjustmentToBase(volatility)` → 0% to 1.5%.
- **Effective base profit** = clamp(sum of above, **1%**, **4.5%**).

Auto mode should receive **live** (or manual) volatility and provider quotes so that the displayed price “fluctuates” with market and inventory when combined with quote refresh.

### 7.3 Optional: Inventory Simulation (“Automate”)

- Button toggles **inventory auto-simulation**: inventory ratio cycles through e.g. [0.3, 0.5, 0.7, 0.5] every 2 seconds.
- Use only in auto mode; when on, inventory input can be read-only.  
  This demonstrates how “From Inventory” moves between 1% and 2.5% without requiring live inventory data.

---

## 8. Volatility Handling

### 8.1 Sources

- **Live:** From provider quote API or derived from price series (e.g. standard deviation of returns).
- **Manual/testing:** User sets volatility via preset buttons (e.g. Calm, Normal, Active, Extreme) mapping to fixed decimals (e.g. 0.003, 0.012, 0.022, 0.035).

### 8.2 Usage

- **In quote:** `volatilityToPremium(volatility)` → added to total premium (on-ramp) or total discount (off-ramp).
- **In auto base profit:** `volatilityAdjustmentToBase(volatility)` → added to effective base profit.

### 8.3 Edge Cases

- Negative or NaN volatility → treat as 0.
- Very large volatility → capped by `volatilityToPremium` (max 3%) and `volatilityAdjustmentToBase` (max 1.5%).

---

## 9. Inventory & Fiat Pressure

### 9.1 Inventory Ratio

- 0 = no crypto (empty), 1 = full, 0.5 = target/balanced.
- **Auto base profit:** 1% at 0.5, up to 2.5% at 0 or 1 (symmetric).
- In production, this should be derived from real balances (crypto vs target) and updated periodically.

### 9.2 Fiat Utilization (Off-Ramp Only)

- 0 = plenty of fiat, 1 = no fiat.
- **Fiat risk premium** = `fiatUtilization * 0.02` (max 2%).
- Increases total discount (we pay users less when fiat is scarce).  
  Clamp to [0, 1] before use.

---

## 10. Input Validation & Sanitization

Before calling the engine:

1. **Type checks:** All numeric inputs are numbers (not string or undefined where required).
2. **Ranges:** Clamp or reject using the bounds in §5.1.
3. **Provider prices:** Strictly positive; optionally enforce `providerSellPrice < providerBuyPrice`.
4. **Amount:** Positive; optional max to prevent overflow or abuse.
5. **Decimals:** Round monetary outputs to a fixed precision (e.g. 2 or 4) for display and storage.

Recommended: a small validation layer (e.g. `validateOnRampInputs`, `validateOffRampInputs`) that returns sanitized values or validation errors before calling `quoteOnRamp` / `quoteOffRamp`.

---

## 11. Error Handling & Resilience

### 11.1 Engine

- Engine functions are pure; they do not throw for invalid input in the current implementation. **Caller must validate.** If invalid input is passed (e.g. negative provider price), document behavior (e.g. NaN, or extend engine to return `Result<Quote, Error>`).

### 11.2 Provider Quote Service

- **Timeout:** If live provider API is slow, use a short timeout and fall back to last known quote or manual override.
- **Failure:** Retry with backoff; after N failures, switch to cached/manual and alert.
- **Stale data:** Use `updatedAt`; if older than threshold (e.g. 60s), show “stale” and optionally block large trades until refreshed.

### 11.3 API

- **POST** invalid body → 400 with clear message.
- **Rate limiting:** Consider rate limits on POST to prevent abuse of simulate or manual updates.

---

## 12. Security Considerations

- **Authorization:** Only authorized services or users should POST provider quotes or override manual quotes.
- **Audit:** Log quote updates (source, old/new buy/sell, timestamp) for compliance and debugging.
- **No PII in engine:** Engine only deals with numbers; ensure no user identifiers are logged inside the core formulas.
- **Idempotency:** For POST, optional idempotency key to avoid duplicate updates.

---

## 13. Testing Strategy

### 13.1 Unit Tests (Pricing Engine)

- **volatilityToPremium:** 0, 0.005, 0.015, 0.03, 0.05 → expected premiums.
- **inventoryBaseProfitFromRatio:** 0, 0.25, 0.5, 0.75, 1 → 2.5%, …, 1%, …, 2.5%.
- **velocityAdjustment:** 0, 5, 15, 30, 100 → expected adjustments.
- **quoteOnRamp:**  
  - With floor: market below cost → price = floor, atFloor true, lossPerToken set.  
  - Without floor: price = market.  
  - providerPrice = 0 or negative → expect error or defined behavior.
- **quoteOffRamp:** With cap: result ≤ maxBuyPrice. providerPrice = 0 → error or defined behavior.
- **calculateBaseProfit:** Auto mode sum and clamp 1%–4.5%.

### 13.2 Edge Cases

- Division by zero (provider price 0, avgBuyPrice 0).
- Negative inputs (volatility, amount, etc.).
- Extreme values (very large amount, volatility 1, inventory 2).
- Cap/floor boundary: market price exactly equal to floor or cap.

### 13.3 Integration

- API GET returns structure matching contract; POST with simulate updates state and GET reflects it.
- End-to-end: set manual provider quotes, set mode and amount, assert computed price and profit match expected formulas.

---

## 14. Deployment & Operations

### 14.1 Configuration

- Provider API base URL, timeouts, retry count.
- Min/max provider price clamps (e.g. 12–13 for buy, 11–13 for sell) per environment.
- Quote refresh interval (e.g. 12s auto, 30s manual).
- Feature flags: live quotes on/off, manual override enabled (e.g. only in staging).

### 14.2 Monitoring

- Quote latency (time to get provider prices).
- Quote failure rate and fallback to cache/manual.
- Alerts when volatility or provider spread exceeds thresholds.

### 14.3 Storage (If Persisting Quotes)

- Store provider buy/sell, volatility, `updatedAt` per merchant or global; use for audit and “last known” fallback.
- Do not store PII in the same table as quote data unless required; keep engine inputs/outputs numeric.

---

## 15. Appendix: Formula Quick Reference

### On-Ramp

```
inventoryRisk     = max(0, (avgBuyPrice - providerPrice) / providerPrice)
volatilityPremium = volatilityToPremium(volatility)
totalPremium      = min(baseProfit + inventoryRisk + volatilityPremium, 0.06)
marketPrice       = providerPrice * (1 + totalPremium)
pricePerToken     = max(marketPrice, minSellingPrice)  // if minSellingPrice set
```

### Off-Ramp

```
volatilityPremium = volatilityToPremium(volatility)
fiatRiskPremium   = fiatUtilization * 0.02
totalDiscount     = min(baseProfit + volatilityPremium + fiatRiskPremium, 0.06)
buyPrice          = providerPrice * (1 - totalDiscount)
pricePerToken     = min(buyPrice, maxBuyPrice)  // if maxBuyPrice set
```

### Auto Base Profit

```
inventoryPart = inventoryBaseProfitFromRatio({ inventoryRatio })  // 1%–2.5%
velocityAdj   = velocityAdjustment(tradesPerHour)                // -0.5% to +0.5%
volAdj        = volatilityAdjustmentToBase(volatility)            // 0% to 1.5%
effectiveBase = clamp(inventoryPart + velocityAdj + volAdj, 0.01, 0.045)
```

### Constants (Configurable in Production)

| Constant | Current | Description |
|----------|---------|-------------|
| Total premium cap | 0.06 | Max 6% premium (on-ramp) |
| Total discount cap | 0.06 | Max 6% discount (off-ramp) |
| Inventory base min | 0.01 | 1% when balanced |
| Inventory base max | 0.025 | 2.5% when skewed |
| Auto base profit min | 0.01 | 1% |
| Auto base profit max | 0.045 | 4.5% |
| Fiat risk factor | 0.02 | 2% at full utilization |
| Off-ramp spread (sim) | 0.05 | ~5% sell below buy in simulation |

---

*Document version: 1.0. Covers the Merchant Pricing Engine as implemented in the balance-tester app and intended for use in a live system.*
