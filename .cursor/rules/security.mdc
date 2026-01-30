# Security & Compliance Rules

## Overview

Security is not an afterthought; it is a fundamental architectural requirement. These rules prevent unauthorized access, data leaks, and common web vulnerabilities.

## 1. Authentication & Identity

- **Protocol:** Use standard, proven authentication flows (e.g., OAuth 2.0 or secure Session-based auth). **DO NOT** roll your own crypto or auth logic.
- **Password Policy:**
  - Minimum 12 characters.
  - Must be hashed using strong algorithms (e.g., Argon2 or bcrypt with a work factor >= 10).
  - **NEVER** store plain-text passwords.
- **Token Management:**
  - **Access Tokens:** Short-lived (e.g., 15 minutes).
  - **Refresh Tokens:** Long-lived, stored securely (HttpOnly cookies), and capable of being revoked (blacklisted) in the database.
  - **Storage:** NEVER store sensitive tokens (JWTs) in `localStorage` or `sessionStorage` where they are vulnerable to XSS. Use `HttpOnly`, `Secure`, `SameSite` cookies.

## 2. Authorization (RBAC)

- **Principle of Least Privilege:** Users and API keys should only have the permissions strictly necessary for their role.
- **Middleware Enforcement:**
  - Every private route must have an authorization middleware.
  - **Pattern:** `router.get('/admin/stats', requireAuth, requireRole('admin'), controller.getStats)`
- **Resource Ownership:**
  - Verify ownership at the database level.
  - _Bad:_ `Find Post by ID` (User A can edit User B's post if they guess the ID).
  - _Good:_ `Find Post by ID AND OwnerID`.

## 3. Data Protection & Validation

- **Input Validation (Sanitization):**
  - Trust no input. All incoming data (body, params, query) must be validated against a strict schema (using Zod, Joi, or Yup) _before_ reaching the controller logic.
  - Strip HTML tags from string inputs to prevent XSS (Cross-Site Scripting).
- **Output Encoding:** Encode data before rendering it in the UI to prevent injection attacks.
- **Sensitive Data (PII):**
  - Personally Identifiable Information (emails, phone numbers) must be encrypted at rest if required by regional laws (GDPR/CCPA).
  - **NEVER** log sensitive data (passwords, tokens, credit card numbers) in server logs or error traces.

## 4. Network & API Security

- **HTTPS/TLS:** Mandatory for all environments (Production, Staging). Redirect HTTP to HTTPS.
- **Headers:** Implement security headers using libraries like `helmet`.
  - `Content-Security-Policy` (CSP)
  - `X-Frame-Options` (Prevent Clickjacking)
  - `X-Content-Type-Options: nosniff`
- **CORS (Cross-Origin Resource Sharing):**
  - Whitelist specific domains only.
  - **NEVER** use `Access-Control-Allow-Origin: *` in production.
- **Rate Limiting:**
  - Apply strict rate limits to sensitive endpoints (Login, Register, Password Reset) to prevent Brute Force and DDoS.
  - _Example:_ 5 login attempts per minute per IP.

## 5. Error Handling & Leakage

- **Generic Error Messages:**
  - Frontend users should see "Invalid credentials" or "Something went wrong."
  - **NEVER** reveal backend stack traces, SQL syntax errors, or specific reasons for auth failure (e.g., "User not found" allows enumeration) to the client.
- **Safe Logging:** Logs should contain error codes and context, but be scrubbed of user data.

## 6. Dependency Management

- **Audit:** Run `npm audit` or equivalent regularly.
- **Lockfile:** Commit `package-lock.json` or `yarn.lock` to ensure consistent dependency versions.
- **Vulnerabilities:** Zero-tolerance policy for High/Critical vulnerabilities in production dependencies.
