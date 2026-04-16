# Business portal: sign-up, sign-in, JWT, and merchant API

This document describes how **business (merchant) users** authenticate against **Klyra Core**, what they receive after each step, and how the **dashboard** should call merchant-scoped APIs.

---

## Principles

1. **Primary flow (recommended):** After any successful sign-in, the client holds a **portal JWT** (`accessToken`) from the JSON body. No redirect with `login_code` is required for same-app or API-first clients.
2. **Merchant API** (`/api/v1/merchant/*`) needs **`Authorization: Bearer <accessToken>`** plus **`X-Business-Id: <uuid>`** (active membership required), **or** a merchant **`x-api-key`** scoped to that business.
3. **Magic links** use **`BUSINESS_SIGNUP_LANDING_URL`** when set (e.g. `http://localhost:3001/business/signup?magic=...`). That page must **`POST`** to Core **`/api/business-auth/magic-link/consume`** with the Core base URL (CORS). If **`BUSINESS_SIGNUP_LANDING_URL`** is unset, magic links target Core **`/signup/business?magic=...`** (or **`BUSINESS_MAGIC_LINK_BASE_URL`** + `/signup/business`).

---

## JWT (portal session)

- **Issued by:** `signBusinessPortalToken(userId)` after password login, register, magic-link consume, passkey verify, Google OAuth, onboarding complete.
- **Transport:** Returned as **`accessToken`** in JSON (typical) or, for Google only today, briefly as `?portal_token=` on redirect (prefer moving Google to the same JSON pattern on a client page).
- **Verify:** `verifyBusinessPortalToken` — HS256-style HMAC, `typ: business_portal`, ~7-day expiry.
- **Use:** Send as `Authorization: Bearer <accessToken>` for protected routes (`/api/business-auth/session`, onboarding, profile, passkeys, etc.).

---

## Sign-up (new business user)

| Step | Method | Endpoint | Body / query | Response (success) |
|------|--------|----------|--------------|-------------------|
| Check email | GET/POST | `/api/business-auth/email/check` | `email` | `{ available, registered, hasPassword }` |
| Register + password | POST | `/api/business-auth/register` | `{ email, password }` (min 10 chars) | `{ userId, accessToken }` |
| Session snapshot | GET | `/api/business-auth/session` | Header: `Authorization: Bearer <accessToken>` | User, onboarding, **businesses[]** |
| Company step | POST | `/api/business-auth/onboarding/entity` | Bearer + `{ companyName, website? }` | `{ ok: true }` |
| Create business | POST | `/api/business-auth/onboarding/complete` | Bearer + `{ signupRole, primaryGoal }` | `{ businessId, slug, accessToken, ... }` |
| Profile (optional) | POST | `/api/business-auth/profile/setup` | Bearer + `{ displayName, password? }` | `{ ok: true }` |

After onboarding, **`GET /session`** lists **`businesses`**. Pick one **`id`** as **`X-Business-Id`** for `/api/v1/merchant/*`.

---

## Sign-in (existing user)

### Email + password (normal means)

| Step | Method | Endpoint | Body | Response |
|------|--------|----------|------|----------|
| Login | POST | `/api/business-auth/login` | `{ email, password }` | `{ userId, accessToken }` |

Dashboard: store **`accessToken`** (memory, `sessionStorage`, or secure cookie your app sets). Then:

1. `GET /api/business-auth/session` with Bearer → read **`businesses`** → set **`X-Business-Id`** for merchant calls.

### Magic link

| Step | Method | Endpoint | Notes |
|------|--------|----------|------|
| Request link | POST | `/api/business-auth/magic-link/request` | `{ email }` — email contains link to **Core** `.../signup/business?magic=<token>` |
| Consume | POST | `/api/business-auth/magic-link/consume` | `{ token }` or `{ magic }` (or query params) | `{ userId, accessToken }` |

**Dashboard-only magic flow:** If the user must land on the dashboard first, implement a dashboard route that reads `?magic=` from the URL and **server-side or client-side** `POST` to Core **`/api/business-auth/magic-link/consume`** with the Core base URL, then store **`accessToken`** locally. Do not expect the magic query on the dashboard to work without that consume call.

### Passkey

1. `POST /api/business-auth/login/passkey/options` — `{ email }` → `{ options }`
2. WebAuthn in browser  
3. `POST /api/business-auth/login/passkey/verify` — `{ email, response }` → `{ userId, accessToken }`

### Google OAuth

1. `GET /api/business-auth/google/start` → Google  
2. `GET /api/business-auth/google/callback` → redirect to landing with **`?portal_token=`** (token in URL). Prefer copying token into app storage and stripping the query string.

---

## Optional: cross-domain handoff (`login_code`)

For a **separate dashboard origin** that should not receive the JWT in the URL:

1. After login on Core, `POST /api/business-auth/login/code` with `{ accessToken, redirectUrl? }` → `{ code, ttlSeconds }`.
2. Redirect: `https://dashboard/app?login_code=<code>`.
3. Dashboard `POST /api/business-auth/login/code/consume` with `{ code }` → `{ accessToken }`.

This is **optional**. The **normal** path is: **`POST /login` → `{ accessToken }` directly**.

---

## Merchant API (`/api/v1/merchant/*`)

All routes require **either**:

- **`Authorization: Bearer <portal accessToken>`** + **`X-Business-Id: <business uuid>`** (user must be an active **BusinessMember**), or  
- **`x-api-key`** for a key whose **`businessId`** matches (optional header `X-Business-Id` must match if sent).

Examples:

- `GET /api/v1/merchant/transactions`
- `GET /api/v1/merchant/settlements`
- `GET|PATCH /api/v1/merchant/business`
- `GET|POST /api/v1/merchant/api-keys`

Platform admin session **without** a merchant context cannot use these routes (403).

---

## Environment variables (auth-related)

| Variable | Role |
|----------|------|
| `BUSINESS_PORTAL_JWT_SECRET` | Signs portal JWT (fallback: `ENCRYPTION_KEY`) |
| `BUSINESS_SIGNUP_LANDING_URL` | After Google OAuth: browser opens this URL with `?portal_token=`. Example: `http://localhost:3001/business/signup`. In **development**, Core defaults to that URL if unset. |
| `BUSINESS_MAGIC_LINK_BASE_URL` | Public Core base URL for magic links (e.g. `http://127.0.0.1:4003`) when landing is not Core |
| `GOOGLE_OAUTH_*` | Google sign-in |
| `BUSINESS_WEBAUTHN_*` | Passkey RP ID / origins |

---

## Failure modes

| Symptom | Likely cause |
|---------|----------------|
| `503` + `DATABASE_UNAVAILABLE` | `DATABASE_URL` wrong or DB unreachable |
| `401` on `/session` | Missing/expired Bearer token |
| Magic link “could not verify” / session errors | Dashboard page must **`POST`** consume to Core with `?magic=` token; or link expired |
| `403` on `/api/v1/merchant/*` | Missing **`X-Business-Id`**, not a member, or admin-only session without merchant key |

---

## Quick reference: dashboard happy path

1. `POST /api/business-auth/login` → save **`data.accessToken`**.  
2. `GET /api/business-auth/session` with Bearer → pick **`data.businesses[0].id`** (or user selection).  
3. Call merchant APIs with **`Authorization: Bearer <token>`** and **`X-Business-Id: <id>`**.

No `login_code` required unless you deliberately split login and dashboard across untrusted URL boundaries.
