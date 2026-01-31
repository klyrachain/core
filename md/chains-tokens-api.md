# Chains & Tokens API

Supported chains and tokens are stored in the database and used for onramp/offramp quotes (pool tokens, Fonbnk intermediate) and for future direct transfers. Other backends and admins can list supported chains/tokens and manage them via admin endpoints.

**Base path:** `/api`  
**Public endpoints:** `GET /api/chains`, `GET /api/tokens` — no `x-api-key` required.  
**Admin endpoints:** Require `x-api-key` with **ADMIN** or **\*** permission.

---

## GET /api/chains

Returns all supported chains (chainId, name, icon). Used by other systems to know which chains are supported for quotes and transfers.

**Response 200**

```json
{
  "success": true,
  "data": {
    "chains": [
      {
        "id": "uuid",
        "chainId": 8453,
        "name": "Base",
        "chainIconURI": "https://..."
      },
      {
        "id": "uuid",
        "chainId": 1,
        "name": "Ethereum",
        "chainIconURI": null
      }
    ]
  }
}
```

- `chainId`: Chain ID (e.g. 8453 Base, 1 Ethereum).
- `chainIconURI`: Optional chain icon URL; may be `undefined`.

---

## GET /api/tokens

Returns supported tokens with chain info. Optional filter by chain.

**Query**

| Parameter  | Type   | Required | Description                    |
|------------|--------|----------|--------------------------------|
| chain_id   | number | No       | Limit to tokens on this chain |

**Examples**

- All tokens: `GET /api/tokens`
- Base only: `GET /api/tokens?chain_id=8453`

**Response 200**

```json
{
  "success": true,
  "data": {
    "tokens": [
      {
        "id": "uuid",
        "chainId": 8453,
        "networkName": "Base",
        "chainIconURI": null,
        "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "symbol": "USDC",
        "decimals": 6,
        "name": "USD Coin",
        "logoURI": null,
        "fonbnkCode": "BASE_USDC"
      }
    ]
  }
}
```

- `address`: Token contract address or native sentinel.
- `fonbnkCode`: Fonbnk NETWORK_ASSET (e.g. BASE_USDC, ETHEREUM_NATIVE); only set when token is used for Fonbnk quotes.
- `logoURI`: Optional token icon URL.

---

## Admin: Chains

All admin chain endpoints require `x-api-key` with **ADMIN** or **\*** permission.

### GET /api/admin/chains

List all supported chains (same shape as public list plus timestamps). Used for admin UI.

**Response 200**

```json
{
  "success": true,
  "data": {
    "chains": [
      {
        "id": "uuid",
        "chainId": 8453,
        "name": "Base",
        "iconUri": null,
        "createdAt": "...",
        "updatedAt": "..."
      }
    ]
  }
}
```

### POST /api/admin/chains

Create a supported chain.

**Request**

```json
{
  "chain_id": 137,
  "name": "Polygon",
  "icon_uri": "https://..."
}
```

| Field     | Type   | Required | Description        |
|-----------|--------|----------|--------------------|
| chain_id  | number | Yes      | Chain ID (unique)  |
| name      | string | Yes      | Display name       |
| icon_uri  | string | No       | Chain icon URL     |

**Response 201**

```json
{
  "success": true,
  "data": {
    "chain": {
      "id": "uuid",
      "chainId": 137,
      "name": "Polygon",
      "iconUri": "https://..."
    }
  }
}
```

**Response 400** — Validation failed or chain_id already exists.

### PATCH /api/admin/chains/:id

Update a chain. `:id` is the chain UUID (not chainId).

**Request**

```json
{
  "name": "Polygon PoS",
  "icon_uri": "https://..."
}
```

**Response 200** — Updated chain. **Response 404** — Chain not found.

### DELETE /api/admin/chains/:id

Delete a chain and all its tokens. `:id` is the chain UUID.

**Response 200**

```json
{
  "success": true,
  "data": { "deleted": true }
}
```

**Response 404** — Chain not found.

---

## Admin: Tokens

All admin token endpoints require `x-api-key` with **ADMIN** or **\*** permission.

### GET /api/admin/tokens

List all supported tokens (admin shape with timestamps).

**Response 200**

```json
{
  "success": true,
  "data": {
    "tokens": [
      {
        "id": "uuid",
        "chainId": 8453,
        "tokenAddress": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "symbol": "USDC",
        "decimals": 6,
        "name": "USD Coin",
        "logoUri": null,
        "fonbnkCode": "BASE_USDC",
        "createdAt": "...",
        "updatedAt": "..."
      }
    ]
  }
}
```

### POST /api/admin/tokens

Add a supported token.

**Request**

```json
{
  "chain_id": 8453,
  "token_address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "symbol": "USDC",
  "decimals": 6,
  "name": "USD Coin",
  "logo_uri": "https://...",
  "fonbnk_code": "BASE_USDC"
}
```

| Field         | Type   | Required | Description                                  |
|---------------|--------|----------|----------------------------------------------|
| chain_id      | number | Yes      | Chain ID (must exist in supported chains)    |
| token_address | string | Yes      | Contract address or native sentinel          |
| symbol        | string | Yes      | Token symbol (e.g. USDC, ETH)                |
| decimals      | number | No       | Default 18                                   |
| name          | string | No       | Full name                                    |
| logo_uri      | string | No       | Token icon URL                               |
| fonbnk_code   | string | No       | Fonbnk NETWORK_ASSET (e.g. BASE_USDC)        |

**Response 201** — Created token. **Response 400** — Validation failed or (chain_id, token_address) already exists.

### PATCH /api/admin/tokens/:id

Update a token. `:id` is the token UUID.

**Request**

```json
{
  "symbol": "USDC",
  "decimals": 6,
  "name": "USD Coin",
  "logo_uri": "https://...",
  "fonbnk_code": "BASE_USDC"
}
```

**Response 200** — Updated token. **Response 404** — Token not found.

### DELETE /api/admin/tokens/:id

Remove a supported token. `:id` is the token UUID.

**Response 200**

```json
{
  "success": true,
  "data": { "deleted": true }
}
```

**Response 404** — Token not found.

---

## Usage notes

- **Pool tokens:** Onramp/offramp quote logic uses supported tokens as pool tokens (direct Fonbnk when `fonbnkCode` is in Fonbnk’s list, otherwise intermediate + swap). Adding a chain/token here expands quote support without code changes.
- **Fonbnk:** Set `fonbnk_code` only for tokens that match Fonbnk’s NETWORK_ASSET list (e.g. BASE_USDC, ETHEREUM_NATIVE). See [Fonbnk supported cryptocurrencies](https://docs.fonbnk.com/supported-countries-and-cryptocurrencies).
- **Other backends:** They can call `GET /api/chains` and `GET /api/tokens` (no auth) to get the same list your core uses for quotes and future transfers.
