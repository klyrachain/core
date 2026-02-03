# Auth API — Frontend Integration Report

**Base path:** `/api/auth`  
**Auth:** No `x-api-key` required for auth routes. Use `Authorization: Bearer <sessionToken>` for protected routes.

---

## 1. Response envelope

- **Success:** `{ success: true, data: T }`
- **Error:** `{ success: false, error: string, code?: string }` (HTTP status 4xx/5xx)

Use `data` when `success === true`; use `error` and optional `code` when `success === false`.

---

## 2. Signup (invited users only)

### 2.1 Load invite (signup page)

User lands on signup with `?token=...` (from invite link).

```http
GET /api/auth/invite/:token
```

**Response (200):**

```json
{
  "success": true,
  "data": {
    "email": "admin@example.com",
    "role": "support",
    "expiresAt": "2025-02-09T12:00:00.000Z",
    "message": "You have been invited as support."
  }
}
```

**Errors:** `404` — `INVALID_INVITE` (invalid or expired token). Show “Invalid or expired invite link.”

---

### 2.2 Create account (set password)

After user sets password on signup page.

```http
POST /api/auth/setup
Content-Type: application/json

{
  "inviteToken": "<token from URL>",
  "password": "<min 8 chars>"
}
```

**Response (200):**

```json
{
  "success": true,
  "data": {
    "adminId": "uuid",
    "email": "admin@example.com",
    "role": "support",
    "totpSecret": "JBSWY3DPEHPK3PXP",
    "totpUri": "otpauth://totp/Klyra%20Admin:admin%40example.com?secret=...",
    "message": "Account created. Add the TOTP to your authenticator app..."
  }
}
```

**Frontend:** Show QR code from `totpUri` (e.g. with a QR library) and/or display `totpSecret` for manual entry. Then show “Enter 6-digit code” and call confirm-totp.

**Errors:** `400` — `SETUP_FAILED` (e.g. invalid/used/expired token, or email already exists).

---

### 2.3 Confirm TOTP (enable 2FA)

After user enters the 6-digit code from their authenticator app.

```http
POST /api/auth/setup/confirm-totp
Content-Type: application/json

{
  "adminId": "<from setup response>",
  "code": "123456"
}
```

**Response (200):**

```json
{
  "success": true,
  "data": {
    "message": "Two-factor authentication enabled. You can now log in."
  }
}
```

**Frontend:** Redirect to login. Optionally offer “Add passkey” after first login.

**Errors:** `400` — `INVALID_CODE`.

---

## 3. Login

### 3.1 Login with password + TOTP

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "admin@example.com",
  "password": "...",
  "code": "123456",
  "sessionTtlMinutes": 15
}
```

`sessionTtlMinutes` is optional; allowed values: `15` (default) or `30`.

**Response (200):**

```json
{
  "success": true,
  "data": {
    "token": "<opaque session token>",
    "expiresAt": "2025-01-31T13:15:00.000Z",
    "sessionTtlMinutes": 15,
    "admin": {
      "id": "uuid",
      "email": "admin@example.com",
      "name": null,
      "role": "support"
    }
  }
}
```

**Frontend:** Store `data.token` (e.g. in memory or httpOnly cookie). Send it on every request as `Authorization: Bearer <token>`. Use `data.admin` and `data.expiresAt` for UI and session refresh logic.

**Errors:** `401` — `LOGIN_FAILED` (wrong email/password/code).

---

### 3.2 Login with passkey

**Step 1 — Get options:**

```http
POST /api/auth/login/passkey/options
Content-Type: application/json

{
  "email": "admin@example.com"
}
```

**Response (200):**

```json
{
  "success": true,
  "data": {
    "options": {
      "challenge": "<base64url>",
      "allowCredentials": [...],
      "rpId": "localhost",
      "timeout": 60000,
      "userVerification": "preferred"
    }
  }
}
```

**Frontend:** Use `@simplewebauthn/browser` (or native `navigator.credentials.get`) with `data.options`. Pass the resulting credential to verify.

**Step 2 — Verify and get session:**

```http
POST /api/auth/login/passkey/verify
Content-Type: application/json

{
  "email": "admin@example.com",
  "response": { ... }
}
```

`response` is the object returned by the browser WebAuthn API (e.g. from `startAuthentication()`). Optional: `sessionTtlMinutes` (15 or 30).

**Response (200):** Same shape as password login: `{ success: true, data: { token, expiresAt, sessionTtlMinutes, admin } }`.

**Errors:** `400` — `NO_PASSKEY` (no passkey for this email), `CHALLENGE_EXPIRED`. `401` — `VERIFY_FAILED`.

---

## 4. Session (authenticated)

Send on every request:

```http
Authorization: Bearer <sessionToken>
```

### 4.1 Current user

```http
GET /api/auth/me
Authorization: Bearer <token>
```

**Response (200):**

```json
{
  "success": true,
  "data": {
    "adminId": "uuid",
    "email": "admin@example.com",
    "name": null,
    "role": "support",
    "expiresAt": "2025-01-31T13:15:00.000Z"
  }
}
```

**Errors:** `401` — missing or invalid/expired token.

---

### 4.2 Logout

```http
POST /api/auth/logout
Authorization: Bearer <token>
```

**Response (200):** `{ success: true, data: { message: "Logged out." } }`.

**Frontend:** Clear stored token and redirect to login.

---

## 5. Add passkey (after login)

### 5.1 Get registration options

```http
GET /api/auth/passkey/options
Authorization: Bearer <token>
```

**Response (200):**

```json
{
  "success": true,
  "data": {
    "options": {
      "challenge": "<base64url>",
      "rp": { "name": "Klyra Admin", "id": "localhost" },
      "user": { "id": "...", "name": "admin@example.com", "displayName": "..." },
      "pubKeyCredParams": [...],
      "timeout": 60000
    }
  }
}
```

**Frontend:** Use WebAuthn `navigator.credentials.create(data.options)` (or `@simplewebauthn/browser` `startRegistration()`).

### 5.2 Verify and save passkey

```http
POST /api/auth/passkey/verify
Authorization: Bearer <token>
Content-Type: application/json

{
  "response": { ... },
  "name": "MacBook"
}
```

`response` = credential response from the browser. `name` is optional (device label).

**Response (200):** `{ success: true, data: { message: "Passkey added." } }`.

**Errors:** `400` — `CHALLENGE_EXPIRED`, `VERIFY_FAILED`.

**Passkey origin:** The backend verifies the WebAuthn response against the **dashboard** origin (the page where `navigator.credentials.create` runs). The server uses the request `Origin` header if it is in the backend allowlist (`ADMIN_ALLOWED_ORIGINS`). Set `ADMIN_ALLOWED_ORIGINS` to your dashboard URL(s), e.g. `http://localhost:3000`, so that "Unexpected registration response origin" does not occur.

---

## 6. Invite (super_admin only)

Used from dashboard to invite new admins. Requires either:

- Platform API key with super_admin (e.g. `*` or `ADMIN_INVITE`) in `x-api-key`, or
- Session of a logged-in super_admin (`Authorization: Bearer <token>`).

```http
POST /api/auth/invite
Content-Type: application/json
Authorization: Bearer <token>
# OR
x-api-key: <platform key>

{
  "email": "newadmin@example.com",
  "role": "support"
}
```

**Roles:** `super_admin` | `support` | `developer` | `viewer`.

**Response (200):**

```json
{
  "success": true,
  "data": {
    "inviteId": "uuid",
    "expiresAt": "2025-02-09T12:00:00.000Z",
    "inviteLink": "/signup?token=<long token>",
    "message": "Invite created. Send the invite link to the user."
  }
}
```

**Frontend:** Copy `data.inviteLink` (or full URL) and send to the invitee (email, Slack, etc.).

**Errors:** `403` — not super_admin. `400` — `INVITE_FAILED` (e.g. email already admin, or pending invite exists).

---

## 7. Error codes (reference)

| Code              | Typical HTTP | Meaning                             |
| ----------------- | ------------ | ----------------------------------- |
| INVALID_INVITE    | 404          | Invite token invalid/expired/used   |
| FORBIDDEN         | 403          | Not allowed (e.g. not super_admin)  |
| VALIDATION_ERROR  | 400          | Body validation failed              |
| INVITE_FAILED     | 400          | Invite creation failed              |
| SETUP_FAILED      | 400          | Account setup failed                |
| INVALID_CODE      | 400          | Wrong TOTP code                     |
| LOGIN_FAILED      | 401          | Bad email/password/code             |
| NO_PASSKEY        | 400          | No passkey for this email           |
| CHALLENGE_EXPIRED | 400          | WebAuthn challenge expired          |
| VERIFY_FAILED     | 400/401      | Passkey verification failed         |
| OPTIONS_FAILED    | 500          | Failed to generate WebAuthn options |

---

## 8. Suggested frontend flow

1. **Signup (invited):**  
   Open `/signup?token=...` → GET `/api/auth/invite/:token` → show “You have been invited as {role}”, email, set password → POST `/api/auth/setup` → show QR/code for TOTP → POST `/api/auth/setup/confirm-totp` → redirect to login.

2. **Login:**  
   Email + password + 6-digit code → POST `/api/auth/login` → store `data.token`, use `data.admin` and `data.expiresAt`.  
   Or: enter email → POST `/api/auth/login/passkey/options` → WebAuthn get → POST `/api/auth/login/passkey/verify` → same token handling.

3. **Authenticated app:**  
   Send `Authorization: Bearer <token>` on all API calls. Use GET `/api/auth/me` for current user and role. For dashboard APIs (`/api/settings`, `/api/providers`, `/api/platform`, `/api/validation`, `/api/access`) the same Bearer token is accepted instead of `x-api-key`; the server enforces role-based access (see **Role permissions** below). Optionally refresh token before `expiresAt` (re-login) or show “Session expired”.

4. **Add passkey (settings):**  
   GET `/api/auth/passkey/options` → WebAuthn create → POST `/api/auth/passkey/verify` with optional name.

5. **Invite (super_admin):**  
   POST `/api/auth/invite` with email and role → show/copy `data.inviteLink`.

---

## 9. Role permissions (session-based admins)

When calling dashboard APIs with **session** (`Authorization: Bearer <token>`), the server checks the admin's role:

| Role            | Read (GET)                                  | Write (PATCH/POST)                | Invite (POST team/invite, POST /api/auth/invite) |
| --------------- | ------------------------------------------- | --------------------------------- | ------------------------------------------------ |
| **viewer**      | ✓ settings, providers, platform, validation | ✗                                 | ✗                                                |
| **support**     | ✓ same as viewer                            | ✗                                 | ✗                                                |
| **developer**   | ✓ same                                      | ✓ settings, providers, validation | ✗                                                |
| **super_admin** | ✓ all                                       | ✓ all                             | ✓ only super_admin can invite                    |

- **Platform API key** (`x-api-key` with no business): full access (no role check).
- **403 FORBIDDEN_ROLE**: "Your role does not allow this action." — hide or disable the action in the UI for that role.

---

## 10. GET /api/access with session

When the dashboard calls `GET /api/access` with `Authorization: Bearer <sessionToken>` (no `x-api-key`), the response is:

```json
{
  "success": true,
  "data": {
    "type": "platform",
    "admin": {
      "adminId": "uuid",
      "email": "admin@example.com",
      "name": null,
      "role": "support"
    }
  }
}
```

Use `data.admin` to show the current user and `data.admin.role` to drive UI (e.g. hide invite button for non–super_admin).

---

## 11. TypeScript types (optional)

```ts
type Role = "super_admin" | "support" | "developer" | "viewer";

type AccessContext =
  | {
      type: "platform";
      admin: {
        adminId: string;
        email: string;
        name: string | null;
        role: string;
      };
    }
  | {
      type: "platform";
      key: { id: string; name: string; permissions: string[] };
    }
  | {
      type: "merchant";
      key: { id: string; name: string; permissions: string[] };
      business?: { id: string; name: string; slug: string };
    };

type AuthAdmin = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
};

type LoginData = {
  token: string;
  expiresAt: string;
  sessionTtlMinutes: 15 | 30;
  admin: AuthAdmin;
};

type InviteData = {
  email: string;
  role: Role;
  expiresAt: string;
  message: string;
};

type SetupData = {
  adminId: string;
  email: string;
  role: Role;
  totpSecret: string;
  totpUri: string;
  message: string;
};
```

---

**Document version:** 1.0  
**API base:** `/api/auth`
