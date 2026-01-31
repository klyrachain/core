# Countries API

Supported countries for onramp/offramp quotes and payouts (Fonbnk, Paystack). Used to know which countries and currencies are supported and by which provider.

**Base path:** `/api`  
**Auth:** No `x-api-key` required (public).

---

## GET /api/countries

Returns supported countries with country code, name, currency, and provider flags (Fonbnk, Paystack).

**Query**

| Parameter  | Type   | Required | Description |
|------------|--------|----------|-------------|
| supported  | string | No       | Filter by provider: `fonbnk`, `paystack`, or `any` |

- **No query** — Returns all countries in the database.
- **`?supported=fonbnk`** — Only countries where Fonbnk supports onramp/offramp (e.g. Ghana, Nigeria, Kenya).
- **`?supported=paystack`** — Only countries where Paystack is live (e.g. Nigeria, Ghana, South Africa, Kenya).
- **`?supported=any`** — Countries supported by at least one of Fonbnk or Paystack.

**Examples**

- All countries: `GET /api/countries`
- Fonbnk only: `GET /api/countries?supported=fonbnk`
- Paystack only: `GET /api/countries?supported=paystack`
- Any provider: `GET /api/countries?supported=any`

**Response 200**

```json
{
  "success": true,
  "data": {
    "countries": [
      {
        "id": "uuid",
        "code": "GH",
        "name": "Ghana",
        "currency": "GHS",
        "supportedFonbnk": true,
        "supportedPaystack": true
      },
      {
        "id": "uuid",
        "code": "NG",
        "name": "Nigeria",
        "currency": "NGN",
        "supportedFonbnk": true,
        "supportedPaystack": true
      }
    ]
  }
}
```

| Field             | Type    | Description |
|-------------------|---------|-------------|
| id                | string  | Country record UUID |
| code              | string  | ISO 3166-1 alpha-2 country code (e.g. GH, NG, KE) |
| name              | string  | Country name (e.g. Ghana, Nigeria) |
| currency          | string  | ISO 4217 currency code (e.g. GHS, NGN, KES) |
| supportedFonbnk   | boolean | Whether Fonbnk supports onramp/offramp for this country |
| supportedPaystack | boolean | Whether Paystack is live in this country |

---

## Usage

- **Onramp/offramp quotes:** Use `country` (e.g. `GH`, `NG`) in `POST /api/quote/onramp`; the backend maps country to currency (e.g. GHS, NGN) for Fonbnk. Use this endpoint to show users which countries are supported before they request a quote.
- **Payouts:** When initiating a payout (e.g. offramp), use `code` and `currency` from a country where `supportedPaystack` is true for Paystack transfers, or `supportedFonbnk` for Fonbnk flows.
- **International conversions:** For countries not in this list, use the [fiat conversion API](rates-api.md) to convert their currency to a supported one (e.g. GBP → GHS) before calling Fonbnk or Paystack.

Data is seeded from Fonbnk’s [supported countries](https://docs.fonbnk.com/supported-countries-and-cryptocurrencies) and Paystack’s live markets; admins can extend the seed or add countries via the database.
