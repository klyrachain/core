# API Contract & Endpoint Definitions

## 1. Global API Standards

- **Base URL:** `/api/v1`
- **Protocol:** HTTPS (TLS 1.2+)
- **Content-Type:** `application/json`
- **Date Format:** ISO 8601 UTC (e.g., `2024-03-15T14:30:00Z`)
- **Authentication:**
  - Header: `Authorization: Bearer <access_token>`
  - Refresh Token: Stored in `HttpOnly` Cookie.

## 2. Response Standard (The Envelope)

Every API response (Success or Error) must strictly follow this JSON structure. Frontend clients should use a single interceptor to handle this envelope.

### A. Success Response (2xx)

```json
{
  "success": true,
  "data": {
    // The actual resource or array of resources
    "id": "user_123",
    "email": "jane@example.com"
  },
  "meta": {
    // Optional: Only present for list endpoints
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```
