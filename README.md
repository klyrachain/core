# Core — Central Point (Webhook + Redis)

Backend service for the Crypto Payment System. This is the **brain**: it receives webhook events from the client-facing Backend, processes orders, updates the database, and manages state in Redis. It does not serve client HTTP traffic directly.

## Tech Stack

- **Runtime:** Node.js 20+
- **Language:** TypeScript
- **Framework:** Fastify
- **Database:** PostgreSQL (Supabase) via Prisma
- **Cache/Queue:** Redis (ioredis + BullMQ)
- **Realtime:** Pusher (stub)
- **Env:** dotenv; **Crypto:** Node `crypto` for WalletManager

## Project Structure

```
core/
├── prisma/
│   └── schema.prisma      # DB schema (inventory, transactions, wallets, etc.)
├── src/
│   ├── config/
│   │   └── env.ts         # Env validation (Zod), load on startup
│   ├── lib/
│   │   ├── prisma.ts      # Singleton Prisma client
│   │   ├── redis.ts       # Redis client, balance keys balance:{chain}:{token}
│   │   └── queue.ts       # BullMQ "Poll" queue for transaction jobs
│   ├── routes/
│   │   └── webhook/
│   │       └── order.ts   # POST /webhook/order (buy, sell, request, claim)
│   ├── services/
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
   - `npm run db:generate` — generate Prisma client
   - `npm run db:push` or `npm run db:migrate` — apply schema

3. **Run**
   - `npm run dev` — development (tsx watch)
   - `npm run build && npm run start` — production

## Endpoints

| Method | Path           | Description                          |
|--------|----------------|-------------------------------------|
| GET    | /health        | Liveness (process up)                |
| GET    | /ready         | Readiness (DB + Redis connected)     |
| POST   | /webhook/order | Ingest order (buy/sell/request/claim)|

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

## Conventions

See `md/rules/` for API strategy, DB rules, security, and performance (singleton DB/Redis, validation, no sensitive logs, health/ready).
# core
# core
