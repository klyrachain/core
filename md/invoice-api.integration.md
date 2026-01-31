# Invoice API — Frontend Integration Report

**Purpose:** Reference for the frontend (or any client) integrating with the **Invoice** endpoints on the Core service.  
**Update this file** when invoice routes, request/response shapes, or validation rules change.

**Base:** Same base URL as Core (e.g. `NEXT_PUBLIC_CORE_URL` or `VITE_CORE_URL`). Default dev port: `4000`.  
**Content-Type:** `application/json` for request bodies.

---

## 1. Response envelope

All invoice endpoints use the same envelope pattern:

- **Success:** `{ "success": true, "data": <payload> }`  
  List endpoints add `meta`: `{ "success": true, "data": [...], "meta": { "page", "limit", "total" } }`.
- **Error:** `{ "success": false, "error": "<message>" }`  
  HTTP status is set (400, 404, 409, 500, 501).

---

## 2. Types (for request/response)

### 2.1 Invoice status

One of: `"Paid"` | `"Pending"` | `"Overdue"` | `"Draft"` | `"Cancelled"`.

### 2.2 Line item (request/response)

| Field        | Type     | Description                          |
|-------------|----------|--------------------------------------|
| `id`        | `string` | Optional on create; generated if omitted. |
| `productName` | `string` | Product/description.                 |
| `qty`       | `number` | Quantity.                            |
| `unitPrice` | `number` | Price per unit.                      |
| `amount`    | `number` | Line total; if omitted, `qty * unitPrice`. |

### 2.3 Log entry (response only)

| Field         | Type     | Description        |
|--------------|----------|--------------------|
| `id`         | `string` | Log entry ID.      |
| `description`| `string` | Human-readable log. |
| `date`       | `string` | ISO 8601 date.    |

### 2.4 Full invoice (response)

Returned by: `GET /api/invoices/:id`, `POST /api/invoices`, `PATCH`, `POST mark-paid`, `POST cancel`, `POST duplicate`.

| Field                 | Type              | Description |
|-----------------------|-------------------|-------------|
| `id`                  | `string`          | Invoice UUID. |
| `invoiceNumber`       | `string`          | Unique (e.g. `INV-xxx-xxxx`). |
| `status`              | `InvoiceStatus`   | Paid, Pending, Overdue, Draft, Cancelled. |
| `amount`              | `number`          | Total amount. |
| `currency`            | `string`          | e.g. `"USD"`. |
| `currencyLabel`       | `string` \| `undefined` | Optional label. |
| `paidAt`              | `string` \| `null` | ISO date when paid; `null` if not paid. |
| `batchTitle`          | `string`          | Batch title. |
| `billedTo`            | `string`          | Customer name/identifier. |
| `billingDetails`      | `string` \| `undefined` | Optional billing details. |
| `subject`             | `string`          | Invoice subject. |
| `issued`              | `string`          | ISO date issued. |
| `dueDate`             | `string`          | ISO due date. |
| `notes`               | `string` \| `undefined` | Optional notes. |
| `lineItems`           | `LineItem[]`      | Line items. |
| `subtotal`            | `number`          | Sum of line amounts. |
| `discountPercent`     | `number`          | 0–100. |
| `discountAmount`      | `number`          | Computed from subtotal and percent. |
| `total`               | `number`          | Subtotal minus discount. |
| `amountDue`           | `number`          | Remaining due (0 when paid/cancelled). |
| `termsAndConditions`  | `string`         | Terms text. |
| `notesContent`        | `string`         | Notes content. |
| `log`                 | `LogEntry[]`     | Audit log. |

### 2.5 List item (response)

Returned by: `GET /api/invoices`.

| Field           | Type              | Description |
|-----------------|-------------------|-------------|
| `id`            | `string`          | Invoice UUID. |
| `invoiceNumber` | `string`          | Unique number. |
| `status`        | `InvoiceStatus`   | Status. |
| `amount`        | `number`          | Total amount. |
| `currency`      | `string`          | e.g. `"USD"`. |
| `customer`      | `string`          | Same as `billedTo`. |
| `issued`        | `string`          | ISO date. |
| `dueDate`       | `string`          | ISO date. |
| `paidAt`        | `string` \| `null` | ISO date or `null`. |

---

## 3. Endpoints

### 3.1 List invoices

| Method | Path             | Description |
|--------|------------------|-------------|
| `GET`  | `/api/invoices`  | Paginated list of invoices. |

**Query**

| Name   | Type     | Description |
|--------|----------|-------------|
| `page` | `string` | Page number (default `1`). |
| `limit`| `string` | Page size (default from server; max typically 100). |
| `status`| `string` | Filter by status: one of `Paid`, `Pending`, `Overdue`, `Draft`, `Cancelled`. Optional. |

**Response:** `200` — `{ success: true, data: ListItem[], meta: { page, limit, total } }`.

---

### 3.2 Get invoice by ID

| Method | Path                  | Description |
|--------|-----------------------|-------------|
| `GET`  | `/api/invoices/:id`   | Full invoice. |

**Response:** `200` — `{ success: true, data: FullInvoice }`.  
**Error:** `404` — Invoice not found.

---

### 3.3 Create invoice

| Method | Path             | Description |
|--------|------------------|-------------|
| `POST` | `/api/invoices`  | Create a new invoice (Draft). Optionally “send” and add log. |

**Body (JSON)**

| Field              | Type     | Required | Description |
|--------------------|----------|----------|-------------|
| `billedTo`         | `string` | Yes      | Customer name/identifier. |
| `billingDetails`   | `string` | No       | Billing details. |
| `subject`          | `string` | Yes      | Invoice subject. |
| `dueDate`          | `string` | Yes      | Due date (parseable, e.g. ISO). |
| `lineItems`        | `array`  | Yes      | At least one line item; see §2.2. |
| `discountPercent`  | `number` | No       | 0–100; default 0. |
| `termsAndConditions` | `string` | No    | Terms text. |
| `notesContent`     | `string` | No       | Notes. |
| `sendNow`          | `boolean`| No       | If `true`, adds a “sent” log entry after create. |

**Validation**

- `billedTo`, `subject`, `dueDate` required.
- `dueDate` must parse to a valid date.
- At least one line item required; each item needs `productName`, `qty`, `unitPrice` (or `amount`).

**Response:** `201` — `{ success: true, data: FullInvoice }`.  
**Error:** `400` — Missing/invalid field (e.g. invalid `dueDate`, no line items).

---

### 3.4 Update invoice (PATCH)

| Method | Path                  | Description |
|--------|-----------------------|-------------|
| `PATCH`| `/api/invoices/:id`   | Partial update. Not allowed if status is Paid or Cancelled. |

**Body (JSON)** — all optional.

| Field                | Type     | Description |
|----------------------|----------|-------------|
| `subject`            | `string` | Subject. |
| `dueDate`            | `string` | Due date (parseable). |
| `notes`              | `string` \| `null` | Notes. |
| `notesContent`       | `string` | Notes content. |
| `billedTo`           | `string` | Billed-to. |
| `billingDetails`     | `string` | Billing details. |
| `termsAndConditions` | `string` | Terms. |
| `lineItems`          | `array`  | Replace line items; must have at least one. Recomputes subtotal, discount, total, amountDue, amount. |

**Response:** `200` — `{ success: true, data: FullInvoice }`.  
**Error:** `404` — Not found. `409` — Invoice is Paid or Cancelled. `400` — Invalid `dueDate` or empty `lineItems`.

---

### 3.5 Send invoice

| Method | Path                        | Description |
|--------|-----------------------------|-------------|
| `POST` | `/api/invoices/:id/send`    | Mark as sent; adds log entry. Optional override recipient. |

**Body (JSON)**

| Field    | Type     | Required | Description |
|----------|----------|----------|-------------|
| `toEmail`| `string` | No       | Recipient; if omitted, uses invoice `billedTo`. |

**Response:** `200` — `{ success: true, data: { sent: true, to: "<email or billedTo>" } }`.  
**Error:** `404` — Not found. `400` — Cancelled invoice or no recipient.

---

### 3.6 Duplicate invoice

| Method | Path                          | Description |
|--------|--------------------------------|-------------|
| `POST` | `/api/invoices/:id/duplicate`  | Create a new Draft copy (new ID and invoice number). |

**Response:** `201` — `{ success: true, data: FullInvoice }` (the new invoice).  
**Error:** `404` — Not found.

---

### 3.7 Mark as paid

| Method | Path                            | Description |
|--------|----------------------------------|-------------|
| `POST` | `/api/invoices/:id/mark-paid`    | Set status to Paid, set `paidAt`, `amountDue` to 0, add log. |

**Response:** `200` — `{ success: true, data: FullInvoice }`.  
**Error:** `404` — Not found. `400` — Already paid or cancelled.

---

### 3.8 Cancel invoice

| Method | Path                        | Description |
|--------|-----------------------------|-------------|
| `POST` | `/api/invoices/:id/cancel`  | Set status to Cancelled, `amountDue` to 0, add log. |

**Response:** `200` — `{ success: true, data: FullInvoice }`.  
**Error:** `404` — Not found. `400` — Already paid or already cancelled.

---

### 3.9 Export invoice

| Method | Path                          | Description |
|--------|--------------------------------|-------------|
| `GET`  | `/api/invoices/:id/export`     | Export as CSV or request PDF (PDF returns 501). |

**Query**

| Name     | Type     | Description |
|----------|----------|-------------|
| `format` | `string` | `csv` (default) or `pdf`. |

**Response**

- **CSV:** `200` — body is CSV; `Content-Type: text/csv; charset=utf-8`; `Content-Disposition: attachment; filename="invoice-<safeNumber>.csv"`.
- **PDF:** `501` — Not implemented; error body suggests using `format=csv`.
- **Other:** `400` — Invalid format.

**Error:** `404` — Invoice not found.

---

## 4. Error summary

| Status | Meaning |
|--------|---------|
| `400`  | Bad request: missing/invalid fields, invalid dates, no line items, or business rule (e.g. send/cancel/mark-paid not allowed). |
| `404`  | Invoice not found. |
| `409`  | Conflict: cannot edit (invoice is Paid or Cancelled). |
| `500`  | Server error (e.g. DB/log). |
| `501`  | Not implemented (e.g. PDF export). |

---

## 5. Quick reference table

| Method | Path                             | Purpose |
|--------|----------------------------------|---------|
| `GET`  | `/api/invoices`                  | List (paginated, optional `status`) |
| `GET`  | `/api/invoices/:id`              | Get full invoice |
| `POST` | `/api/invoices`                  | Create (Draft; optional `sendNow`) |
| `PATCH`| `/api/invoices/:id`              | Update (not if Paid/Cancelled) |
| `POST` | `/api/invoices/:id/send`         | Mark sent, optional `toEmail` |
| `POST` | `/api/invoices/:id/duplicate`    | Duplicate as new Draft |
| `POST` | `/api/invoices/:id/mark-paid`   | Mark paid |
| `POST` | `/api/invoices/:id/cancel`      | Cancel |
| `GET`  | `/api/invoices/:id/export`      | Export CSV (or request PDF → 501) |
