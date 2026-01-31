# Platform Settings API — Frontend Integration Report

**Purpose:** Reference for the frontend integrating with the **Platform Settings** endpoints on the Core service. Use these for the dashboard `/settings/*` tabs: general, financials, providers, risk, team, api.

**Base:** Same base URL as Core (e.g. `NEXT_PUBLIC_CORE_URL` or `VITE_CORE_URL`). Default dev port: `4000`.

**Auth:** All settings endpoints require **platform admin** (API key with no `businessId`). Use `x-api-key` header. Returns 401 if missing/invalid key, 403 if merchant key.

---

## 1. Response envelope

- **Success:** `{ "success": true, "data": <payload> }`
- **Error:** `{ "success": false, "error": "<message>" }` with HTTP status 400, 401, 403, 409, 500.

---

## 2. Endpoints summary

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/settings/general` | Get general settings (name, email, currency, timezone, maintenance). |
| `PATCH` | `/api/settings/general` | Update general settings. |
| `GET` | `/api/settings/financials` | Get fee schedule, limits, low-balance alert. |
| `PATCH` | `/api/settings/financials` | Update financials. |
| `GET` | `/api/settings/providers` | Get max slippage + provider list (keys masked). |
| `PATCH` | `/api/settings/providers` | Update maxSlippagePercent, providers (enabled, priority). |
| `PATCH` | `/api/settings/providers/:id` | Set provider API key or update enabled/priority. |
| `GET` | `/api/settings/risk` | Get KYC flags and blacklist. |
| `PATCH` | `/api/settings/risk` | Update risk settings (blacklist as array or newline string). |
| `GET` | `/api/settings/team/admins` | List platform admins (name, email, role, 2FA). |
| `POST` | `/api/settings/team/invite` | Invite admin (email, role). |
| `GET` | `/api/settings/api` | Get webhook secret (masked), Slack URL, alert emails. |
| `PATCH` | `/api/settings/api` | Update Slack URL, alert emails. |
| `POST` | `/api/settings/api/rotate-webhook-secret` | Rotate webhook signing secret. |

---

## 3. General (`/settings/general`)

**GET /api/settings/general** — Response: `publicName`, `supportEmail`, `supportPhone`, `defaultCurrency`, `timezone`, `maintenanceMode`.

**PATCH /api/settings/general** — Body (all optional): `publicName`, `supportEmail`, `supportPhone`, `defaultCurrency`, `timezone`, `maintenanceMode`. Validation: publicName max 100 chars.

---

## 4. Financials (`/settings/financials`)

**GET /api/settings/financials** — Response: `baseFeePercent`, `fixedFee`, `minTransactionSize`, `maxTransactionSize`, `lowBalanceAlert`.

**PATCH /api/settings/financials** — Body (all optional): same fields. baseFeePercent clamped 0–100; sizes and alert ≥ 0.

---

## 5. Providers (`/settings/providers`)

**GET /api/settings/providers** — Response: `maxSlippagePercent`, `providers: [{ id, enabled, priority, apiKeyMasked, status?, latencyMs? }]`. Provider ids: `SQUID`, `LIFI`, `0X`, `PAYSTACK`. Keys never returned in full.

**PATCH /api/settings/providers** — Body: `maxSlippagePercent?`, `providers?: [{ id, enabled?, priority? }]`. No raw API keys in PATCH.

**PATCH /api/settings/providers/:id** — Body: `apiKey?`, `enabled?`, `priority?`. Use this to set or rotate provider API key. Response returns provider with `apiKeyMasked` only.

---

## 6. Risk (`/settings/risk`)

**GET /api/settings/risk** — Response: `enforceKycOver1000`, `blockHighRiskIp`, `blacklist: string[]`.

**PATCH /api/settings/risk** — Body: `enforceKycOver1000?`, `blockHighRiskIp?`, `blacklist?: string[]` (or newline-separated string; normalized to array).

---

## 7. Team (`/settings/team`)

**GET /api/settings/team/admins** — Response: `data: [{ id, name, email, role, twoFaEnabled }]`. Roles: `super_admin`, `support`, `developer`, `viewer`.

**POST /api/settings/team/invite** — Body: `email` (required), `role` (default `viewer`). Response: `{ invited: true, email }`. 409 if email already exists.

---

## 8. API & Webhooks (`/settings/api`)

**GET /api/settings/api** — Response: `webhookSigningSecretMasked`, `slackWebhookUrl`, `alertEmails`. Secret never returned in full.

**PATCH /api/settings/api** — Body: `slackWebhookUrl?`, `alertEmails?`. No raw secret in PATCH.

**POST /api/settings/api/rotate-webhook-secret** — No body. Generates new secret; response: `{ webhookSigningSecretMasked }`. Old secret invalidated; merchants must update verification.

---

## 9. Error summary

| Status | Meaning |
|--------|--------|
| `400` | Validation failed (e.g. invalid role, missing email). |
| `401` | Missing or invalid API key. |
| `403` | Merchant key (platform only). |
| `409` | Conflict (e.g. admin email already exists). |
| `500` | Server error. |

---

## 10. UI flow

- **On load:** Call GET for each settings tab (or batch) to hydrate form state.
- **Save:** Call PATCH with changed fields only (or full object). Use PATCH /api/settings/providers/:id to set provider API key in a dedicated flow.
- **Rotate secret:** Call POST /api/settings/api/rotate-webhook-secret; show masked value and warn merchants to update.
- **Invite:** POST /api/settings/team/invite with email and role; then refresh GET /api/settings/team/admins.

Secrets (provider API keys, webhook signing secret) are never returned in full; use masked values for display only.
