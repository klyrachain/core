# Core — Central Point (Webhook + Redis)

Backend service for the Crypto Payment System. This is the **brain**: it receives webhook events from the client-facing Backend, processes orders, updates the database, and manages state in Redis. It does not serve client HTTP traffic directly.

## Tech Stack

- **Runtime:** Node.js 20+
- **Language:** TypeScript
- **Framework:** Fastify
- **Database:** PostgreSQL (Supabase) via Prisma 7 (driver adapter `@prisma/adapter-pg`)
- **Cache/Queue:** Redis (ioredis + BullMQ)
- **Realtime:** Pusher (stub)
- **Env:** dotenv; **Crypto:** Node `crypto` for WalletManager

## Project Structure

```
core/
├── prisma/
│   └── schema.prisma      # DB schema (inventory, transactions, wallets, etc.)
├── prisma.config.ts       # Prisma 7 CLI config (schema, migrations, seed, datasource url)
├── generated/prisma/      # Prisma 7 generated client (run db:generate)
├── src/
│   ├── config/
│   │   └── env.ts         # Env validation (Zod), load on startup
│   ├── lib/
│   │   ├── auth.guard.ts  # requireApiKey preHandler (x-api-key, domains, isActive, lastUsedAt)
│   │   ├── prisma.ts      # Singleton Prisma client
│   │   ├── redis.ts       # Redis client, balance keys balance:{chain}:{token}
│   │   └── queue.ts       # BullMQ "Poll" queue for transaction jobs
│   ├── routes/
│   │   └── webhook/
│   │       └── order.ts   # POST /webhook/order (buy, sell, request, claim)
│   ├── services/
│   │   ├── api-key.service.ts    # generateKey, hashApiKey, findApiKeyByRawKey (SHA-256, never store raw)
│   │   ├── inventory.service.ts  # Deduct inventory on BUY, Redis cache
│   │   └── pusher.service.ts     # Stub: trigger on transaction status change
│   ├── utils/
│   │   └── wallet-manager.ts     # Decrypt Wallet.encryptedKey via ENCRYPTION_KEY
│   ├── workers/
│   │   └── poll.worker.ts        # Process Poll queue jobs (TX → COMPLETED/FAILED)
│   └── server.ts                 # Entry: Fastify, health/ready, webhook, worker
├── md/rules/                     # Conventions (api, db, security, performance)
├── .env.example
├── package.json
└── tsconfig.json
```

## Setup

1. **Env**
   - Copy `.env.example` to `.env` and set:
     - `DATABASE_URL`, `DIRECT_URL` (Supabase/PostgreSQL)
     - `REDIS_URL`
     - `ENCRYPTION_KEY` (min 32 chars; 32-byte hex for AES-256)
     - Optional: `PUSHER_*` for realtime

2. **DB**
   - `pnpm db:generate` — generate Prisma 7 client to `generated/prisma`
   - `pnpm db:push` or `pnpm db:migrate` — apply schema (uses `prisma.config.ts`; migrations use `DIRECT_URL`)
   - **After pulling changes that add peer-ramp columns**, run `pnpm exec prisma migrate deploy` from `core` (or `db:migrate` in dev) so migrations such as `20260408120000_peer_ramp_accept_escrow` apply (`PeerRampOrder.escrowTxHash`, acceptance fields on fills). Without this, `POST /api/peer-ramp/orders/*` can return **500** for unknown columns.
   - `pnpm db:seed` — seed DB (no longer auto-runs after migrate in v7)

3. **API Key (optional, for authenticating Backend / partners)**
   - After migrating, run `pnpm key:generate` to create a master key named "Backend Server Primary" (permissions `["*"]`, domains `["*"]`). Copy the printed key into `.env` as `CORE_API_KEY=sk_live_...`.
   - Use the `requireApiKey` preHandler from `src/lib/auth.guard.ts` on routes that must require the `x-api-key` header; the guard validates the key, checks `isActive`/`expiresAt`/domains (Origin), updates `lastUsedAt`, and attaches `request.apiKey`.

4. **Run**
   - `npm run dev` — development (tsx watch)
   - `npm run build && npm run start` — production

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Liveness (process up) |
| GET | /ready | Readiness (DB + Redis connected) |
| GET | /api/users | List users (paginated) |
| GET | /api/users/:id | Get user |
| GET | /api/transactions | List transactions (optional ?status=&type=) |
| GET | /api/transactions/:id | Get transaction |
| GET | /api/requests | List requests |
| GET | /api/requests/:id | Get request |
| GET | /api/claims | List claims (optional ?status=) |
| GET | /api/claims/:id | Get claim |
| GET | /api/wallets | List wallets (encryptedKey masked) |
| GET | /api/wallets/:id | Get wallet |
| GET | /api/inventory | List inventory assets (optional ?chain=) |
| GET | /api/inventory/:id | Get inventory asset |
| GET | /api/inventory/:id/history | List inventory history |
| GET | /api/cache/balances | List Redis balance keys |
| GET | /api/cache/balances/:chain/:token | Get Redis balance |
| GET | /api/queue/poll | Poll queue stats and recent jobs |
| GET | /api/quote | Prefetch fee/quote (query: action, f_amount, t_amount, f_price, t_price, f_token, t_token) |
| GET | /api/logs | Request logs for monitoring (query: method, path, since, page, limit). All requests intercepted and logged; sends webhook to admin dashboard with event `logs.viewed` and full response data. |
| POST | /webhook/order | Ingest order (buy/sell/request/claim); sends order.created to admin |
| POST | /webhook/admin | Send event/data to admin dashboard (ADMIN_WEBHOOK_URL + Pusher) |

## Webhook Payload

`POST /webhook/order` body (JSON):

- `action`: `"buy"` \| `"sell"` \| `"request"` \| `"claim"`
- `fromIdentifier`, `fromType`, `fromUserId`, `toIdentifier`, `toType`, `toUserId`
- `f_amount`, `t_amount`, `f_price`, `t_price`, `f_token`, `t_token`
- `f_provider`, `t_provider` (optional, default `NONE`)
- `requestId` (optional)

On success: creates a `Transaction` with `status: PENDING`, enqueues a job to the **Poll** queue, returns `201` with `{ success: true, data: { id, status, type } }`.

## Redis

- **Account balances:** Hash `balance:{chain}:{token}` → `{ amount, status, updatedAt }` (TTL 60s).
- **Polls:** BullMQ queue `poll`; jobs carry `transactionId`.

## Frontend integration

**See `md/core-api.integration.md`** for the full report: endpoints, webhook contract, enums, Pusher events, integration checklist, and a prompt for AI/developers. Update that file whenever Core API or realtime contract changes (see `md/rules/core-integration.md`).

## Live test script (development)

Run `pnpm test:live` to simulate user actions against a running Core server. The script runs until you press Ctrl+C and, after random intervals (default 3s–1min), performs:

- **Orders:** `POST /webhook/order` with `buy`, `sell`, `request`, or `claim` (random payloads).
- **Fetch API:** `GET /api/transactions`, `/api/users`, `/api/inventory`, `/api/queue/poll`, `/api/cache/balances`, `/api/requests`, `/api/claims`, `/api/wallets`.
- **Admin:** `POST /webhook/admin` with test events.

Env (optional): `CORE_URL` (default `http://localhost:4000`), `INTERVAL_MIN_MS`, `INTERVAL_MAX_MS`. Start the server with `pnpm dev` in another terminal first.

## Conventions

See `md/rules/` for API strategy, DB rules, security, and performance (singleton DB/Redis, validation, no sensitive logs, health/ready).
