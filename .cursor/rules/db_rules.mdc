# Database & Data Architecture Rules

## Overview

These rules govern how data is modeled, stored, accessed, and maintained. The goal is to ensure data consistency, prevent "spaghetti relations," and maximize query performance.

## 1. Schema & Naming Conventions

- **Format:** All database fields must use `camelCase` (e.g., `isVerified`, `createdAt`) to match the JavaScript/TypeScript application layer. Collection/Table names should be singular (e.g., `User`, `Market`, not `Users`).
- **Explicit Types:** Never use "Mixed" or "Any" types for critical data. Every field must have a defined Strict Schema.
- **Timestamps:** Every model/table MUST have automatic `createdAt` and `updatedAt` timestamps.
- **Foreign Keys:** Fields referencing other collections must clearly indicate the relationship in the name (e.g., `ownerId` referencing the `User` ID).

## 2. Data Integrity & Safety

- **Soft Deletes:**
  - **NEVER** hard delete primary records (Users, Transactions, Products) from the database.
  - **USE** a `deletedAt` (nullable date) or `isDeleted` (boolean) field.
  - _Reason:_ Allows for data recovery and audit trails.
- **Transaction Atomicity:**
  - Any operation that affects multiple documents/tables (e.g., "Buying a Product" updates both the `UserBalance` and `ProductInventory`) MUST run within a Database Transaction.
  - If one part fails, the entire transaction must abort (rollback).
- **No Circular Dependencies:** Avoid schemas that reference each other in a loop (e.g., A references B, B references A) unless strictly managed, as this breaks populate/join logic.

## 3. Performance & Indexing

- **Index Strategy:**
  - Any field used in a `filter`, `sort`, or `search` query MUST be indexed.
  - Use **Compound Indexes** for queries that filter by multiple fields often (e.g., querying `status` AND `date`).
- **Field Selection (Projections):**
  - **NEVER** return the entire document if only specific fields are needed.
  - _Rule:_ Always explicitly select fields in the controller (e.g., `.select('name email')`) to reduce payload size and memory usage.
- **Pagination:**
  - All "Get All" or "List" endpoints MUST implement cursor-based or offset-based pagination.
  - _Limit:_ Default limit should be 20 items. Max limit 100 items.

## 4. Connection & Configuration

- **Singleton Pattern:** The database connection must be initialized **ONCE** at server start. Prevent opening a new connection for every API call.
- **Environment Variables:** Connection strings (URIs) must strictly come from `.env` files. Never hardcode credentials.
- **Timeout Handling:** Set strict connection timeouts (e.g., 5000ms). If the DB doesn't respond, the app should fail gracefully, not hang indefinitely.

## 5. Migration & Versioning

- **Scripted Migrations:**
  - Changes to the schema (adding fields, changing types) must be done via migration scripts, not manual GUI edits.
  - Migration files must be versioned by timestamp (e.g., `20240125-add-role-to-user.ts`).
- **Backward Compatibility:**
  - When renaming a field, support both the old and new field name in the API response for at least one release cycle to prevent breaking frontend clients.

## 6. Documentation

- **ER Diagram:** A visual Entity-Relationship diagram must be updated in the `md/` folder whenever a relationship changes.
- **Types Source of Truth:** The Database Schema is the source of truth. TypeScript interfaces must be generated from or strictly aligned with the DB schema.
