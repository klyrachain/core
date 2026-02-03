# Admin Auth API

Admin dashboard authentication: invite-only signup, password + TOTP (authenticator app), passkey (WebAuthn), and session (15 or 30 minutes).

## Flow

1. **Invite** (super_admin only, from dashboard or platform API key): `POST /api/auth/invite` with `{ email, role }`. Returns `inviteLink` (e.g. `/signup?token=...`).
2. **Signup page**: User opens link; `GET /api/auth/invite/:token` returns `{ email, role, message: "You have been invited as ..." }`. Verify email is implied by valid token.
3. **Setup account**: `POST /api/auth/setup` with `{ inviteToken, password }`. Creates admin, returns `totpSecret`, `totpUri` (for QR in authenticator app).
4. **Confirm TOTP**: User adds app, enters code. `POST /api/auth/setup/confirm-totp` with `{ adminId, code }`. Enables 2FA.
5. **Login** (either):
   - **Password + TOTP**: `POST /api/auth/login` with `{ email, password, code, sessionTtlMinutes?: 15 | 30 }`. Returns `{ token, expiresAt, admin }`. Default session TTL 15 min.
   - **Passkey**: `POST /api/auth/login/passkey/options` with `{ email }` → get options; then `POST /api/auth/login/passkey/verify` with `{ email, response }`. Returns same session payload.
6. **Add passkey** (after login): `GET /api/auth/passkey/options` (with session) → options; `POST /api/auth/passkey/verify` with `{ response, name? }`.
7. **Session**: Send `Authorization: Bearer <token>` (or cookie `admin_session`) for `GET /api/auth/me`, `POST /api/auth/logout`, and passkey add.

## Endpoints

| Method | Path                            | Auth                                                | Description                                                                      |
| ------ | ------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------- |
| GET    | /api/auth/invite/:token         | none                                                | Get invite details for signup page                                               |
| POST   | /api/auth/invite                | platform key (super_admin) or session (super_admin) | Create invite; body `{ email, role }`                                            |
| POST   | /api/auth/setup                 | none                                                | Create account; body `{ inviteToken, password }`                                 |
| POST   | /api/auth/setup/confirm-totp    | none                                                | Confirm TOTP; body `{ adminId, code }`                                           |
| POST   | /api/auth/login                 | none                                                | Login with password + TOTP; body `{ email, password, code, sessionTtlMinutes? }` |
| POST   | /api/auth/login/passkey/options | none                                                | Get WebAuthn options for passkey login; body `{ email }`                         |
| POST   | /api/auth/login/passkey/verify  | none                                                | Verify passkey; body `{ email, response, sessionTtlMinutes? }`                   |
| GET    | /api/auth/me                    | session                                             | Current admin                                                                    |
| POST   | /api/auth/logout                | optional                                            | Invalidate session                                                               |
| GET    | /api/auth/passkey/options       | session                                             | Get WebAuthn options to add passkey                                              |
| POST   | /api/auth/passkey/verify        | session                                             | Add passkey; body `{ response, name? }`                                          |

## Roles

- `super_admin`: Can invite users; full access.
- `support`, `developer`, `viewer`: Assigned via invite; used for dashboard RBAC (implement in frontend).

## Environment

- `ADMIN_RP_ID`: WebAuthn relying party ID (default `localhost` for dev).
- `ADMIN_ORIGIN`: Fallback WebAuthn origin when request Origin is not in allowlist (default `http://localhost:PORT`).
- `ADMIN_ALLOWED_ORIGINS`: Comma-separated allowed origins for WebAuthn (admin dashboard URL(s)). Set to the dashboard origin(s) where passkey runs, e.g. `http://localhost:3000` or `http://localhost:3000,https://admin.example.com`. If the request sends an `Origin` header in this list, that origin is used for verification; otherwise `ADMIN_ORIGIN` is used.

## Errors

Responses include `success: false`, `error`, and often `code` (e.g. `INVALID_INVITE`, `LOGIN_FAILED`, `CHALLENGE_EXPIRED`).
