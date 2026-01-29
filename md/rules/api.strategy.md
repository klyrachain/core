# API Strategy & Integration Rules

## Overview

Our API is a product in itself. It must be predictable, self-documenting, and robust. We strictly follow **RESTful** principles and prioritize a standardized Developer Experience (DX).

## 1. URI & Resource Naming

- **Nouns, Not Verbs:** URIs represent resources.
  - _Bad:_ `/api/getAllUsers`, `/api/createUser`
  - _Good:_ `GET /api/users`, `POST /api/users`
- **Pluralization:** Always use plural nouns for collections.
  - _Rule:_ `/api/markets`, `/api/products` (never `/api/market`).
- **Hierarchy:** Use nesting to show relationships, but limit depth to 2 levels.
  - _Good:_ `/api/markets/:marketId/products` (Products belonging to a market).
  - _Bad:_ `/api/regions/africa/countries/ghana/cities/accra/markets` (Too deep; use query params or flat IDs).
- **Case:** Use `kebab-case` for URLs.
  - _Example:_ `/api/user-profiles` (not `userProfiles` or `user_profiles`).

## 2. HTTP Methods & Status Codes

Use the correct HTTP verb for the action. DO NOT tunnel everything through POST.

- **GET:** Retrieve data. (200 OK).
- **POST:** Create new resource. (201 Created).
- **PUT:** Full replacement of resource. (200 OK).
- **PATCH:** Partial update of resource. (200 OK).
- **DELETE:** Remove resource. (204 No Content).

**Critical Status Codes:**

- `400 Bad Request`: Validation failure.
- `401 Unauthorized`: Missing/Invalid token.
- `403 Forbidden`: Valid token, but not allowed (RBAC).
- `404 Not Found`: ID does not exist.
- `429 Too Many Requests`: Rate limit hit.
- `500 Internal Server Error`: Unhandled exception (Alert Developers).

## 3. Response Standardization (The Envelope)

Every API response must follow a strict JSON envelope. This allows the frontend to have a single, global response handler.

**Success Response:**

```json
{
  "success": true,
  "data": { ... }, // Object or Array
  "meta": {        // Optional: Pagination info
    "page": 1,
    "limit": 20,
    "total": 150
  }
}
```
