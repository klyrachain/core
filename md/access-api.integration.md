# Access API — Frontend Integration Report

**Purpose:** Reference for the frontend (or any client) integrating with the **Access** endpoint on the Core service. Use it to determine the current API key’s scope (platform admin vs merchant) and to drive UI (e.g. “Acting as Business X”, dashboard layout, navigation).

**Base:** Same base URL as Core (e.g. `NEXT_PUBLIC_CORE_URL` or `VITE_CORE_URL`). Default dev port: `4000`.

**Auth:** All access endpoints require the `x-api-key` header. The response describes what that key can access.

---

## 1. Response envelope

- **Success:** `{ "success": true, "data": <AccessContext> }`
- **Error:** `{ "success": false, "error": "<message>" }` with HTTP status 401 or 500.

---

## 2. Types

### 2.1 Access context (response)

Returned by `GET /api/access`. Describes the authenticated API key and its scope.

| Field     | Type     | Description |
|----------|----------|-------------|
| `type`   | `"platform"` \| `"merchant"` | `"platform"`: key has no business (platform admin). `"merchant"`: key is scoped to a business. |
| `key`    | object   | Key metadata (see below). |
| `business` | object \| `undefined` | Present when `type === "merchant"` and the business exists. Omitted for platform keys. |

### 2.2 Key (nested in `data.key`)

| Field         | Type     | Description |
|---------------|----------|-------------|
| `id`          | `string` | API key UUID. |
| `name`       | `string` | Key name (e.g. "Backend Server", "Partner X"). |
| `permissions` | `string[]` | Scopes (e.g. `["READ_ONLY", "ADMIN"]`). `"*"` means super admin (all permissions). |

### 2.3 Business (nested in `data.business`, merchant only)

| Field   | Type     | Description |
|--------|----------|-------------|
| `id`   | `string` | Business UUID. |
| `name` | `string` | Display name (e.g. "Amazon Inc"). |
| `slug` | `string` | URL-safe identifier (e.g. "amazon") for public payment links or routing. |

---

## 3. Endpoint

### 3.1 Get access context

| Method | Path           | Description |
|--------|----------------|-------------|
| `GET`  | `/api/access`  | Returns the access context for the API key in the `x-api-key` header. |

**Headers**

| Name        | Type     | Required | Description |
|-------------|----------|----------|-------------|
| `x-api-key` | `string` | Yes      | API key. Determines platform vs merchant and permissions. |

**Success response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "type": "platform",
    "key": {
      "id": "uuid",
      "name": "Platform Admin Key",
      "permissions": ["*"]
    }
  }
}
```

**Merchant key example:**

```json
{
  "success": true,
  "data": {
    "type": "merchant",
    "key": {
      "id": "uuid",
      "name": "Merchant Backend",
      "permissions": ["READ_ONLY", "ADMIN"]
    },
    "business": {
      "id": "uuid",
      "name": "Acme Inc",
      "slug": "acme"
    }
  }
}
```

**Error responses**

| Status | Meaning |
|--------|--------|
| `401`  | Missing or invalid API key (e.g. wrong key, inactive, expired, origin not allowed). |
| `500`  | Server error. |

---

## 4. Frontend usage

1. **On load or after login:** Call `GET /api/access` with the current API key (e.g. from env or auth store).
2. **Branch on `data.type`:**
   - `"platform"`: Show platform admin dashboard; all businesses and platform-wide data.
   - `"merchant"`: Show merchant dashboard; scope all data and actions to `data.business.id` (or slug). Display “Acting as &lt;business.name&gt;” (and optionally use `business.slug` in URLs).
3. **Permissions:** Use `data.key.permissions` to show/hide features (e.g. only show “Settlements” if `"*"` or `"ADMIN"` is present).
4. **Caching:** Cache the access context until the key changes or the user explicitly switches context; avoid calling on every request.

---

## 5. Quick reference

| Method | Path          | Purpose |
|--------|---------------|---------|
| `GET`  | `/api/access` | Get current API key’s access context (platform vs merchant, key info, business when merchant). |
