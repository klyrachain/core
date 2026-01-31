# Provider % Routing API — Frontend Integration Report

**Purpose:** Reference for the frontend integrating with the **Provider Routing** endpoints on the Core service. Use these for the dashboard provider % routing UI: list providers, show status/operational/enabled/API key (masked)/priority/fee, and update key.

**Base:** Same base URL as Core (e.g. `NEXT_PUBLIC_CORE_URL` or `VITE_CORE_URL`). Default dev port: `4000`.

**Auth:** All provider routing endpoints require **platform admin** (API key with no `businessId`). Use `x-api-key` header. Returns 401 if missing/invalid key, 403 if merchant key.

---

## 1. Response envelope

- **Success:** `{ "success": true, "data": <payload> }`
- **Error:** `{ "success": false, "error": "<message>" }` with HTTP status 400, 401, 403, 404, 500.

---

## 2. Endpoints summary

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/providers` | List all providers (for routing table). Ordered by priority desc, then code. |
| `GET` | `/api/providers/:id` | Get one provider by ID. |
| `PATCH` | `/api/providers/:id` | Update status, operational, enabled, priority, fee, name. |
| `POST` | `/api/providers/:id/rotate-key` | Update API key (body: `apiKey`). Key is stored hashed; only masked value returned. |

---

## 3. Provider table (UI columns)

The API returns data suitable for a provider routing table with these columns:

| Column | API field | Type | Description |
|--------|-----------|------|-------------|
| **Status** | `status` | `"ACTIVE"` \| `"INACTIVE"` \| `"MAINTENANCE"` | Display status (e.g. Active, Inactive, Maintenance). |
| **Operational** | `operational` | `boolean` | Provider health: currently working. Toggle via PATCH. |
| **Enabled** | `enabled` | `boolean` | Include in routing. Toggle via PATCH. |
| **API key** | `apiKeyMasked` | `string \| null` | Masked key (e.g. `"sk_live..."`). Never full key. |
| **Update key** | — | action | Call `POST /api/providers/:id/rotate-key` with body `{ "apiKey": "<new_key>" }`. |
| **Priority** | `priority` | `number` | Higher = prefer in routing (e.g. 1 = first choice). |
| **Fee** | `fee` | `number \| null` | Provider fee (e.g. 0.5 for 0.5%). Set later via PATCH. |

Additional fields: `id`, `code` (e.g. SQUID, LIFI, ZERO_X, PAYSTACK), `name` (display name), `createdAt`, `updatedAt`.

---

## 4. List providers

**GET /api/providers**

**Response:** `data` is an array of provider objects.

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "code": "SQUID",
      "name": "SQUID",
      "status": "ACTIVE",
      "operational": true,
      "enabled": true,
      "apiKeyMasked": "sk_live...",
      "priority": 1,
      "fee": null,
      "createdAt": "2025-01-31T20:00:00.000Z",
      "updatedAt": "2025-01-31T20:00:00.000Z"
    }
  ]
}
```

- `apiKeyMasked` is `null` if no key has been set.
- Order: by `priority` descending, then `code` ascending.

---

## 5. Get one provider

**GET /api/providers/:id**

**Params:** `id` — provider UUID.

**Response:** Single provider object (same shape as list items).  
**Errors:** 404 if provider not found.

---

## 6. Update provider (status, operational, enabled, priority, fee)

**PATCH /api/providers/:id**

**Params:** `id` — provider UUID.

**Body (all optional):**

| Field | Type | Description |
|-------|------|-------------|
| `status` | `"ACTIVE"` \| `"INACTIVE"` \| `"MAINTENANCE"` | Status. |
| `operational` | `boolean` | Operational flag. |
| `enabled` | `boolean` | Enabled in routing. |
| `priority` | `number` (integer) | Routing priority (higher = preferred). |
| `fee` | `number \| null` | Provider fee (e.g. 0.5 for 0.5%). Set to `null` to clear. |
| `name` | `string \| null` | Display name. |

**Response:** Updated provider object (same shape as GET).  
**Errors:** 400 if `priority` is not an integer; 404 if provider not found.

**Example:**

```json
PATCH /api/providers/550e8400-e29b-41d4-a716-446655440000
Content-Type: application/json

{
  "enabled": true,
  "priority": 1,
  "fee": 0.5,
  "operational": true
}
```

---

## 7. Update key (rotate API key)

**POST /api/providers/:id/rotate-key**

**Params:** `id` — provider UUID.

**Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `apiKey` | `string` | Yes | New API key (raw). Stored hashed; never returned. |

**Response:** Updated provider object; `apiKeyMasked` shows the new key prefix (e.g. `"sk_live..."`).  
**Errors:** 400 if `apiKey` missing or empty; 404 if provider not found.

**Example:**

```json
POST /api/providers/550e8400-e29b-41d4-a716-446655440000/rotate-key
Content-Type: application/json

{
  "apiKey": "sk_live_abc123..."
}
```

**Security:** The raw key is never returned. Only the masked value (`apiKeyMasked`) is in responses. Store the new key securely (e.g. in env) when the user sets it; the server only stores the hash.

---

## 8. Error handling

| Status | Meaning |
|--------|--------|
| 400 | Bad request (e.g. missing `apiKey` for rotate-key, invalid `priority`). |
| 401 | Not authenticated (missing or invalid `x-api-key`). |
| 403 | Forbidden (merchant key; platform admin only). |
| 404 | Provider not found (invalid `id`). |
| 500 | Server error. |

---

## 9. Seeded providers

After running `pn db:seed`, the following providers exist (by `code`): **SQUID**, **LIFI**, **ZERO_X**, **PAYSTACK**. Each has `status: ACTIVE`, `operational: true`, `enabled: true`, `priority` 1–4, `fee: null`, and no API key until set via rotate-key.
