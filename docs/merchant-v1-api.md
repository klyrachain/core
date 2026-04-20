# Merchant API v1 — dashboard integration guide

Base path: **`/api/v1/merchant`** (mounted on Core, e.g. `https://api.example.com/api/v1/merchant`).

This namespace is **tenant-only**: every query is scoped to a single **`businessId`**. It is **not** the platform `/api/connect/*` surface (super-admin / global aggregates).

---

## 1. Authentication

Every request under `/api/v1/merchant/*` must satisfy **one** of the following.

### A. Business portal (dashboard user)

| Header | Value |
|--------|--------|
| `Authorization` | `Bearer <accessToken>` — portal JWT from `POST /api/business-auth/login` (or register / magic-link consume / passkey verify). |
| `X-Business-Id` | UUID of the business. The JWT `sub` (user id) must be an **active** `BusinessMember` of that business. |

Obtain candidate business ids from **`GET /api/business-auth/session`** (`data.businesses[].id`). The dashboard should persist the user’s chosen business (e.g. localStorage + header on each request).

### B. Merchant API key

| Header | Value |
|--------|--------|
| `x-api-key` | A key created for that business (`sk_live_...`). |

Optional: **`X-Business-Id`** — if sent, it **must** equal the key’s `businessId` or the request returns **403** `BUSINESS_ID_MISMATCH`.

**Merchant keys and permissions:** Keys scoped to a business are treated as having **full implicit tenant permissions** (read/write business, transactions, payouts, team, etc.). **Role-based restrictions** (see §2.1) apply only to **portal JWT** users, not to merchant API keys.

### Rejected contexts

- **Platform admin session** (cookie / Bearer admin token) **without** a merchant `x-api-key` → **403** `MERCHANT_CONTEXT_REQUIRED`.
- Missing both valid portal JWT + membership **and** merchant key → **401** / **403** with codes such as `MERCHANT_UNAUTHORIZED`, `MISSING_BUSINESS_ID`, `BUSINESS_ACCESS_DENIED`.

**CORS:** If the dashboard is on another origin, Core must allow that origin for `Authorization` and `X-Business-Id` preflight.

---

## 2. Test mode vs live mode (`x-merchant-environment`)

Tenant data is partitioned by **`MerchantEnvironment`**: **`TEST`** or **`LIVE`**.

| Header | Value |
|--------|--------|
| `x-merchant-environment` | Optional. `TEST` or `LIVE` (case-insensitive). **Default if omitted:** `LIVE`. |

**What it affects:** Summary KPIs, transactions, settlements (payouts), products, pay pages (payment links), payment requests, derived customers, CRM records, webhook endpoints, webhook delivery logs, refunds, and API key listing — all scoped to the resolved environment.

**Merchant API keys may be pinned:** When creating a key (`POST /api-keys`), you can set `environment` to `TEST` or `LIVE`. If set, that key **always** operates in that environment; the header cannot switch it. If the client sends a conflicting header, the API returns **400** with code **`ENVIRONMENT_KEY_MISMATCH`**.

**Dashboard UX:** Implement a global “Test mode” toggle that sets `x-merchant-environment: TEST` on every merchant API call so the UI only shows test data (similar to Stripe).

---

## 2.1 Portal role-based access (RBAC)

For **Bearer + `X-Business-Id`** requests, some mutating routes require a **BusinessMember** role. **Merchant `x-api-key` requests skip these checks** (full access within environment).

Roles: `OWNER`, `ADMIN`, `DEVELOPER`, `FINANCE`, `SUPPORT`.

| Capability | Allowed roles (portal) |
|------------|-------------------------|
| `PATCH /business` (incl. branding) | `OWNER`, `ADMIN` |
| `POST /api-keys`, `PATCH /api-keys/:id` (deactivate) | `OWNER`, `ADMIN`, `DEVELOPER` |
| `POST` / `PATCH` payout methods | `OWNER`, `ADMIN`, `FINANCE` |
| `GET /exports/*.csv` (accounting exports) | `OWNER`, `ADMIN`, `FINANCE` |
| `POST /webhooks/endpoints`, `PATCH /webhooks/endpoints/:id`, `DELETE /webhooks/endpoints/:id`, `POST /webhooks/endpoints/:id/reveal-secret`, `POST /webhooks/deliveries/:id/retry` | `OWNER`, `ADMIN`, `DEVELOPER` |
| `GET` webhooks (endpoints + deliveries) | all active members |
| CRM `GET` / `POST` / `PATCH /crm/customers` | all active members |
| `POST /transactions/:id/refunds` | `OWNER`, `ADMIN`, `FINANCE` |

On denial: **403** with code **`FORBIDDEN_MERCHANT_ROLE`**.

**Permission strings** (for portal JWT via `requirePermission`): routes still use platform-style checks such as `transactions:read`, `business:write`, etc. Merchant keys receive **implicit** tenant permissions — see codebase `MERCHANT_IMPLICIT_PERMISSIONS`.

---

## 3. Response envelope

Successful reads/lists:

```json
{ "success": true, "data": ... }
```

Lists with pagination:

```json
{ "success": true, "data": [ ... ], "meta": { "page": 1, "limit": 20, "total": 42 } }
```

Errors:

```json
{ "success": false, "error": "Human message", "code": "OPTIONAL_CODE" }
```

Permission denied:

```json
{ "success": false, "error": "Your role or key does not allow this action.", "code": "FORBIDDEN_PERMISSION" }
```

CSV export endpoints return **`text/csv`** with `Content-Disposition: attachment` (not the JSON envelope).

---

## 4. Pagination

Query params (where applicable):

| Param | Default | Max |
|-------|---------|-----|
| `page` | `1` | — |
| `limit` | `20` | `100` |

---

## 5. Endpoints (quick reference)

All paths are relative to **`/api/v1/merchant`**. Send **`x-merchant-environment`** as needed (§2).

| Method | Path | Notes |
|--------|------|--------|
| GET | `/summary` | KPIs / charts |
| GET | `/transactions` | List |
| GET | `/transactions/:id` | Detail |
| POST | `/transactions/:id/refunds` | Create refund request (RBAC finance) |
| GET | `/exports/transactions.csv` | CSV (RBAC finance) |
| GET | `/exports/settlements.csv` | CSV (RBAC finance) |
| GET | `/settlements` | Payout list |
| GET | `/settlements/:id` | Payout detail |
| GET | `/business` | Profile + branding |
| PATCH | `/business` | Profile + branding (RBAC owner/admin) |
| GET | `/api-keys` | List keys (includes `environment`) |
| POST | `/api-keys` | Create key; optional `environment` (RBAC dev+) |
| PATCH | `/api-keys/:id` | `{ "action": "deactivate" }` (RBAC dev+) |
| GET | `/products` | Catalog |
| POST | `/products` | Create product |
| PATCH | `/products/:id` | Update product |
| GET | `/pay-pages` | Payment links |
| POST | `/pay-pages` | Create payment link |
| PATCH | `/pay-pages/:id` | Update payment link |
| GET | `/payment-requests` | Legacy REQUEST txs |
| POST | `/payment-requests` | Create payment request |
| GET | `/payment-requests/:id` | Single request |
| GET | `/customers` | Distinct payers from transactions |
| GET | `/crm/customers` | Merchant CRM records |
| POST | `/crm/customers` | Create CRM row |
| PATCH | `/crm/customers/:id` | Update CRM row |
| GET | `/team/members` | |
| GET | `/team/invites` | |
| POST | `/team/invites` | |
| DELETE | `/team/invites/:id` | |
| PATCH | `/team/members/:id` | |
| GET | `/payout-methods` | |
| POST | `/payout-methods` | RBAC finance+ |
| PATCH | `/payout-methods/:id` | RBAC finance+ |
| GET | `/logs` | In-memory dev logs |
| GET | `/webhooks/endpoints` | |
| POST | `/webhooks/endpoints` | RBAC dev+ |
| PATCH | `/webhooks/endpoints/:id` | RBAC dev+ |
| DELETE | `/webhooks/endpoints/:id` | RBAC dev+ |
| GET | `/webhooks/endpoints/:id/summary` | `from` / `to` (optional; default last 30d) |
| POST | `/webhooks/endpoints/:id/reveal-secret` | Returns signing `secret` (RBAC dev+) |
| GET | `/webhooks/deliveries` | Optional `endpointId`, `from`, `to` |
| POST | `/webhooks/deliveries/:id/retry` | Queue retry stub (RBAC dev+) |

---

## 6. Endpoint details

### 6.0 Summary (dashboard KPIs)

**`GET /summary`**

Pre-aggregated tenant metrics (scoped to **`businessId` + resolved environment**). Uses **`transactions:read`**.

**Query**

| Param | Default | Max | Description |
|-------|---------|-----|-------------|
| `days` | `30` | `365` | Rolling window for “in period” counts, volume, fees, status breakdowns. |
| `seriesDays` | `7` | `90` | UTC calendar days for daily time series. |

**Response `data`**

- `periodDays`, `seriesDays`, `periodFrom`, `periodTo` (ISO)
- `business`: `id`, `name`, `slug`, `kybStatus`
- `transactions`: `volumeUsdInPeriod` / headline counts (`inPeriod`, `totalAllTime`, rolling windows) are **COMPLETED** checkouts; `byStatus*` includes all statuses — **only** rows matching the current environment
- `fees`, `settlements`, `series` — same environment scope

---

### 6.1 Transactions

**`GET /transactions`**

- Query: `page`, `limit`, optional `status`, `type`, `from` / `to` (ISO range on `createdAt`), `q` (search identifiers or UUID), `sort` (`asc` | `desc`, default `desc`).
- Returns rows where **`businessId`** and **`environment`** match the tenant + header.
- `data[]`: transaction fields with decimals as strings; `fromUser` / `toUser` summaries; may include `environment`, `productId`, `paymentLinkId`, `lineItems` when set.

**`GET /transactions/:id`**

- **404** if missing, wrong business, or wrong environment.

**`POST /transactions/:id/refunds`** (RBAC: owner / admin / finance)

- Body: `{ "amount": number > 0, "currency": string, "reason"?: string }`
- Creates a **`Refund`** in **`PENDING`** for **completed** transactions only; otherwise **400** `INVALID_TX_STATUS`.
- Execution of on-chain refund is **asynchronous** (integrate with your settlement/crypto layer).

---

### 6.2 Accounting exports (CSV)

**`GET /exports/transactions.csv`** (RBAC: owner / admin / finance)

- Query: optional `from`, `to`, `status`, `type` (same semantics as list filters).
- Response: CSV attachment (`transactions.csv`). Columns include id, timestamps, environment, status, type, chains/tokens, amounts, fees, identifiers.

**`GET /exports/settlements.csv`** (RBAC: owner / admin / finance)

- Query: optional `from`, `to`, `status` (`all` to skip filter).
- Response: CSV of **`Payout`** rows for this business + environment (method id/type included).

---

### 6.3 Commerce: products & pay pages (payment links)

Stored as **`Product`** and **`PaymentLink`** with **`businessId`** and **`environment`**. Isolated per test/live.

**`GET /products`**

- Query: `page`, `limit`, optional `q`, optional `includeArchived` (`true` / `1`).

**`POST /products`**

- Body: `name`, `price` (≥ 0), optional `description`, `type` (`DIGITAL` | `PHYSICAL` | `SERVICE`), `currency` (default `USD`), `imageUrl`, `isActive`.
- Creates row in the **current** environment.

**`PATCH /products/:id`**

- Partial update; scoped to business + environment.

**`GET /pay-pages`**

- Lists **`PaymentLink`** (checkout URLs by **`slug`**). Query: `page`, `limit`, optional `q`.

**`POST /pay-pages`**

- Body: `title`, **`slug`** (globally unique; lowercase `a-z`, `0-9`, hyphens), optional `description`, `type`, `productId` (must be same business **and environment**), `amount` / `currency`, `isActive`.
- **409** `SLUG_TAKEN` on conflict.

**`PATCH /pay-pages/:id`**

- Partial update; **409** if **`slug`** collides.

---

### 6.4 Payment requests (legacy `REQUEST` flow)

**`GET /payment-requests`**

- Lists **`REQUEST`** **transactions** for tenant + environment. Query: `page`, `limit`, optional `status`.

**`POST /payment-requests`**

- Same body as **`POST /api/requests`** (platform): payer email/phone, channels, amounts, chains/tokens, `toIdentifier`, `receiveSummary`, optional `payoutTarget` / `payoutFiat`, optional crypto `f_*`, optional `skipPaymentRequestNotification`.
- Sets **`transaction.businessId`**, **`Request.businessId`**, and **`environment`** on both from the resolved header/key.

**`GET /payment-requests/:id`**

- **`Request.id`**, scoped via `transaction.businessId` + `transaction.environment`.

---

### 6.5 Customers (derived) vs CRM

**`GET /customers`** — **derived analytics**

- Distinct **`fromIdentifier`** / **`fromType`** from **`Transaction`** for this business + **environment**.
- Query: `page`, `limit`, optional `q` (ILIKE on identifier).
- `data[]`: `identifier`, `identityType`, `transactionCount`, `lastActivityAt`.

**`GET /crm/customers`** — **MerchantCustomer** records

- First-class CRM rows (notes, LTV fields, `userId` link, metadata). Filtered by business + environment.

**`POST /crm/customers`**

- Body: at least one of `email`, `phone`, or `userId`; optional `displayName`, `externalId`, `notes`, `metadata` (object).

**`PATCH /crm/customers/:id`**

- Partial update for the same business + environment.

---

### 6.6 Team & invites

**`GET /team/members`** — `email`, `displayName`, `role`, `joinedAt`.

**`GET /team/invites`** — pending invites.

**`POST /team/invites`** — `{ "email", "role" }` with `role` ∈ `ADMIN` | `DEVELOPER` | `FINANCE` | `SUPPORT` (not `OWNER`; owner is assigned separately at onboarding). Owner/admin portal users (or merchant API key) can invite.

**`DELETE /team/invites/:id`**

**`PATCH /team/members/:id`** — `{ "role" }`. Owner cannot be demoted via this API.

**Accept invite (portal):** `POST /api/business-auth/team/accept-invite` with Bearer + `{ "token" }`.

---

### 6.7 Payout methods

**`GET /payout-methods`**

**`POST /payout-methods`** (RBAC: owner / admin / finance) — `{ "type", "currency", "details": { }, "isPrimary"? }`

**`PATCH /payout-methods/:id`** (RBAC: owner / admin / finance)

> Payout **methods** are not split by TEST/LIVE in the current API (business-level). **Settlement (`Payout`)** rows **are** environment-scoped for reporting.

---

### 6.8 Developer logs

**`GET /logs`**

- In-memory request logs tagged with tenant `businessId` when the merchant API ran. Query: `limit`, `offset`, optional `path`, `method`.
- Best-effort debugging only.

---

### 6.9 Settlements (payouts)

**`GET /settlements`**

- Query: `page`, `limit`, optional `status` (`SCHEDULED` | `PROCESSING` | `PAID` | `FAILED` | `REVERSED` or `all`).
- Scoped to **`businessId` + `environment`**.

**`GET /settlements/:id`**

- Single payout; **404** if wrong business or environment.

---

### 6.10 Business profile & checkout branding

**`GET /business`**

- Returns: `id`, `name`, `slug`, `logoUrl`, `website`, `supportEmail`, `kybStatus`, `riskScore`, `webhookUrl`, `country`, `createdAt`, and branding:
  - `brandColor`, `buttonColor`, `supportUrl`, `termsOfServiceUrl`, `returnPolicyUrl` (optional strings).

**`PATCH /business`** (RBAC: **owner** or **admin** only)

- Optional fields (send at least one):
  - `name` (1–200 chars)
  - `logoUrl`, `website`, `webhookUrl`, `supportEmail` — URL/email or `null`
  - **Branding:** `brandColor`, `buttonColor`, `supportUrl`, `termsOfServiceUrl`, `returnPolicyUrl` — strings or `null` (URLs where applicable)

Invalid body → **400** with Zod `details`.

---

### 6.11 API keys (merchant keys)

**`GET /api-keys`**

- `id`, `name`, `domains`, `keyPrefix`, `isActive`, `lastUsedAt`, `expiresAt`, **`environment`** (`TEST` | `LIVE` | `null` for legacy keys treated as unrestricted + header).

**`POST /api-keys`** (RBAC: owner / admin / developer)

- Body: `{ "name": string, "domains"?: string[], "environment"?: "TEST" | "LIVE" }`  
  - `domains` defaults to `["*"]`.
- Response: `{ "rawKey": "sk_live_...", "message": "..." }` — **shown once**.

**`PATCH /api-keys/:id`** (RBAC: owner / admin / developer)

- Body: `{ "action": "deactivate" }`.

---

### 6.12 Webhooks (endpoints & delivery log)

**`GET /webhooks/endpoints`**

- Lists endpoints for business + environment: `id`, **`displayName`**, **`protocolVersion`** (e.g. `v1`), `url`, `events[]`, `isActive`, `hasSecret`, `createdAt`, `updatedAt`.

**`POST /webhooks/endpoints`** (RBAC: owner / admin / developer)

- Body:
  - **`displayName`** (1–120 chars) — label in the dashboard.
  - **`url`** — HTTPS (or HTTP) callback URL, max 2048 chars.
  - **`events`** — non-empty array; each entry must be one of the **allowed event ids** below.
  - **`secret`** (optional, 8–256 chars) — override signing secret; if omitted, the server generates a unique secret per destination (`whsec_…`).
  - **`isActive`** (optional, default `true`).
  - **`protocolVersion`** (optional, default **`v1`**) — payload schema version for future revisions.

**`PATCH /webhooks/endpoints/:id`** (RBAC: owner / admin / developer)

- Partial update of any of the `POST` fields (omit fields you do not change).
- If the endpoint currently has **no** stored secret and the body does not include **`secret`**, the server generates and stores one (same format as create).

**`DELETE /webhooks/endpoints/:id`** (RBAC: owner / admin / developer)

- Deletes the endpoint for the current business + environment. Related **`WebhookDeliveryLog`** rows are removed by database cascade.

**Allowed `events` values (v1)**

- `transaction.created`
- `transaction.status_updated`
- `invoice.created`
- `invoice.paid`
- `payout.status_updated`
- `payment_link.paid`

**`GET /webhooks/endpoints/:id/summary`** (all active members)

- Query: optional **`from`**, **`to`** (ISO date or datetime). If both omitted, defaults to **last 30 days**. Range span must not exceed **90 days**.
- Response: `totalDeliveries`, `failedDeliveries`, `errorRatePct` (0–100), `lastDeliveryAt`, `avgLatencyMs` (null until deliveries record **`durationMs`**), `buckets` (daily `{ date, successCount, failureCount }`), `latencyByDay` (daily min/avg/max ms, or `null` if no `durationMs` data).

**`POST /webhooks/endpoints/:id/reveal-secret`** (RBAC: owner / admin / developer)

- Returns `{ "secret": string }` when a secret is stored. **400** if none configured (set via `PATCH` / edit flow). Intended for dashboard “reveal signing secret” only; treat as sensitive.

**`GET /webhooks/deliveries`**

- Query: `page`, `limit`, optional **`endpointId`**, optional **`from`**, **`to`** (filter `createdAt`, same max span as summary when both set).
- Returns delivery rows: `eventType`, `status`, `httpStatus`, **`durationMs`** (nullable), `payload`, `responseBodyPreview`, `attemptCount`, `transactionId`, etc.

**`POST /webhooks/deliveries/:id/retry`** (RBAC: owner / admin / developer)

- Marks delivery for retry (worker integration may still be required for actual HTTP replay).

Legacy field **`Business.webhookUrl`** may still exist; prefer **`WebhookEndpoint`** for multiple URLs and event lists.

---

## 7. Invoices (platform API vs tenant data model)

The **Invoice** table supports **`businessId`** and **`environment`** for future or custom tenant invoicing.

The HTTP API **`/api/invoices`** (see `src/routes/api/invoices.ts`) is currently guarded by **platform** permissions (`invoices:read` / `invoices:write`) for the **admin dashboard**, not mounted under `/api/v1/merchant`.

**For merchant dashboards:** until dedicated **`/api/v1/merchant/invoices`** routes exist, do not assume tenant JWT can call `/api/invoices`. Plan either platform-only invoice tools or a new merchant-scoped module that filters `Invoice.businessId` + `environment`.

---

## 8. TypeScript-friendly fetch example

```ts
const CORE = process.env.NEXT_PUBLIC_CORE_URL!; // no trailing slash

type MerchantEnv = "TEST" | "LIVE";

async function merchantFetch<T>(
  path: string,
  opts: RequestInit & {
    token: string;
    businessId: string;
    /** Omit or "LIVE" for production data */
    merchantEnvironment?: MerchantEnv;
  }
): Promise<T> {
  const env = opts.merchantEnvironment ?? "LIVE";
  const res = await fetch(`${CORE}/api/v1/merchant${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.token}`,
      "X-Business-Id": opts.businessId,
      "x-merchant-environment": env,
      ...opts.headers,
    },
  });
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/csv")) {
    const blob = await res.blob();
    if (!res.ok) throw new Error(res.statusText);
    return blob as unknown as T; // or save with file-saver
  }
  const json = (await res.json()) as { success?: boolean; error?: string; data?: T };
  if (!res.ok || json.success === false) {
    throw new Error(json.error ?? res.statusText);
  }
  return json.data as T;
}

// Example: list LIVE transactions
const rows = await merchantFetch<unknown[]>("/transactions?page=1&limit=20", {
  method: "GET",
  token: portalAccessToken,
  businessId: selectedBusinessId,
  merchantEnvironment: "LIVE",
});
```

**Merchant API key example:** use `x-api-key` instead of `Authorization` / `X-Business-Id` (optional `X-Business-Id` must match key).

---

## 9. What stays outside this namespace

- **`/api/connect/*`** — platform B2B aggregates (tenant keys get **403** `TENANT_FORBIDDEN`).
- **Global** inventory, providers, platform settings.
- **`/api/invoices`** — current implementation is **platform**-permissioned (§7).
- **Centralized observability** — `/logs` is in-process only.
- **Webhook HTTP delivery worker** — ensure background jobs pick up `WebhookDeliveryLog` / retry queue.

---

## 10. Related docs

- **`docs/business-portal-auth.md`** — login, signup, `accessToken`, `X-Business-Id`.

---

## 11. Dashboard checklist

1. User logs in → store **`accessToken`**.
2. **`GET /api/business-auth/session`** → store selected **`businessId`**.
3. Implement a **Test / Live** toggle → set **`x-merchant-environment`** on every `/api/v1/merchant/*` call (and label UI clearly).
4. Merchant home / analytics: **`GET /summary`** with `days` / `seriesDays`.
5. **Settings → Branding:** **`GET/PATCH /business`** for colors and policy URLs; hosted checkout should read these fields.
6. **Developers:** **`GET/POST /api-keys`** with optional pinned **`environment`**; **`/webhooks/*`** for endpoints and delivery debugging.
7. **Finance:** **`/exports/*.csv`**, **`/settlements`**, **`POST /transactions/:id/refunds`** (subject to RBAC).
8. **CRM:** **`/crm/customers`** for notes/LTV; **`/customers`** for quick derived payer stats.
9. Do **not** use **`/api/connect/*`** for tenant-only views.
