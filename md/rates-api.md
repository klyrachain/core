# Fiat Conversion (Rates) API

Fiat-to-fiat exchange rates for international conversions. Used to convert between user currency and Fonbnk-supported currencies (e.g. GHS, NGN) when the user’s country is not in [Fonbnk’s list](https://docs.fonbnk.com/supported-countries-and-cryptocurrencies). Uses [ExchangeRate-API](https://www.exchangerate-api.com/) (v6); USD is the recommended pivot for conversions.

**Base path:** `/api`  
**Auth:** No `x-api-key` required (public).  
**Requires:** `EXCHANGERATE_API_KEY` in environment; if missing, endpoints return 503.

---

## POST /api/rates/fiat

Get a fiat-to-fiat rate and optionally the converted amount. Direct pair (e.g. USD→GHS, GBP→NGN). Without `amount` returns the rate only; with `amount` returns the conversion for that amount.

**Request**

```json
{
  "from": "USD",
  "to": "GHS"
}
```

With amount:

```json
{
  "from": "USD",
  "to": "GHS",
  "amount": 100
}
```

| Field  | Type   | Required | Description |
|--------|--------|----------|-------------|
| from   | string | Yes      | Source currency code (e.g. USD, GHS, GBP) |
| to     | string | Yes      | Target currency code (e.g. GHS, NGN, USD) |
| amount | number | No       | Amount in source currency; if omitted, returns rate only |

**Response 200 (rate only)**

```json
{
  "success": true,
  "data": {
    "from": "USD",
    "to": "GHS",
    "rate": 15.5,
    "timeLastUpdateUtc": "Fri, 27 Mar 2020 00:00:00 +0000"
  }
}
```

**Response 200 (with amount)**

```json
{
  "success": true,
  "data": {
    "from": "USD",
    "to": "GHS",
    "rate": 15.5,
    "amount": 100,
    "convertedAmount": 1550,
    "timeLastUpdateUtc": "Fri, 27 Mar 2020 00:00:00 +0000"
  }
}
```

| Field              | Type   | Description |
|--------------------|--------|-------------|
| from               | string | Source currency |
| to                 | string | Target currency |
| rate               | number | 1 unit of `from` = `rate` units of `to` |
| amount             | number | Present when request included `amount` |
| convertedAmount    | number | Result in `to` currency when `amount` was sent |
| timeLastUpdateUtc  | string | Optional; rate timestamp from provider |

**Response 400**

```json
{
  "success": false,
  "error": "Validation failed",
  "details": { ... }
}
```

**Response 500**

```json
{
  "success": false,
  "error": "ExchangeRate API error: ..."
}
```

**Response 503**

```json
{
  "success": false,
  "error": "Fiat rates unavailable. EXCHANGERATE_API_KEY is not set."
}
```

---

## POST /api/rates/fiat/via-usd

Convert an amount from one currency to another **via USD** (e.g. GBP → USD → GHS). Use when you want a single pivot for all conversions (recommended for consistency with Fonbnk, which is USD-based).

**Request**

```json
{
  "from": "GBP",
  "to": "GHS",
  "amount": 50
}
```

| Field  | Type   | Required | Description |
|--------|--------|----------|-------------|
| from   | string | Yes      | Source currency code |
| to     | string | Yes      | Target currency code |
| amount | number | Yes      | Amount in source currency (positive) |

**Response 200**

```json
{
  "success": true,
  "data": {
    "amount": 975.5,
    "rate": 19.51,
    "from": "GBP",
    "to": "GHS"
  }
}
```

| Field   | Type   | Description |
|---------|--------|-------------|
| amount  | number | Converted amount in `to` currency |
| rate    | number | Effective rate (result / input amount) |
| from    | string | Source currency |
| to      | string | Target currency |

**Response 400** — Validation failed.  
**Response 500** — Conversion failed.  
**Response 503** — EXCHANGERATE_API_KEY not set.

---

## Usage

- **Non–Fonbnk countries:** User in UK (GBP) wants an onramp quote. Fonbnk only supports GHS, NGN, etc. Call `POST /api/rates/fiat` with `from: "GBP"`, `to: "GHS"`, `amount: 100` to get 100 GBP in GHS; then use that GHS amount (or the rate) with your Fonbnk flow, or convert the quote result back to GBP for display.
- **Single pivot (USD):** For consistent conversions across many currencies, use `POST /api/rates/fiat/via-usd` so every conversion goes through USD (e.g. EUR → USD → NGN).
- **Countries API:** Use [GET /api/countries](countries-api.md) to see which countries/currencies are supported by Fonbnk and Paystack; use this rates API for currencies not in that list.

**Environment:** Set `EXCHANGERATE_API_KEY` (from [exchangerate-api.com](https://www.exchangerate-api.com/)) for these endpoints to work.
