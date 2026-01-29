# Performance & Observability Rules

## Overview

Performance is a feature. Slow applications lose users. Observability is our eyes and ears; without it, we are flying blind. We adhere to strict budgets for latency and resource usage.

## 1. Core Web Vitals (Frontend Performance)

- **Thresholds (Mobile & Desktop):**
  - **LCP (Largest Contentful Paint):** Must occur within **2.5 seconds**.
  - **INP (Interaction to Next Paint):** Must be under **200ms**.
  - **CLS (Cumulative Layout Shift):** Must be less than **0.1**.
- **Image Optimization:**
  - **NEVER** serve raw, unoptimized images.
  - Use Next.js `<Image>` component strictly.
  - Formats: WebP or AVIF priority.
  - Sizing: `sizes` attribute must be defined to serve the correct resolution per device.
- **Font Loading:**
  - Use `next/font` to eliminate layout shift (CLS).
  - Preload critical fonts; swap non-critical fonts (`display: swap`).

## 2. Resource Budgets (Bundle Size)

- **JavaScript:**
  - Initial Load JS: < **100KB** (gzipped).
  - Route-specific JS: < **60KB** (gzipped).
- **Code Splitting:**
  - Use `dynamic()` imports for heavy components (Charts, Maps, Rich Text Editors) that are not immediately visible.
- **Depedency Check:**
  - **Forbidden:** Large libraries like `moment.js` (Use `date-fns` or `dayjs`) or full `lodash` (import individual functions).

## 3. Backend Latency & Throughput

- **API Response Time:**
  - **P95 Latency:** 95% of requests must complete in under **200ms**.
  - **P99 Latency:** 99% of requests must complete in under **500ms**.
- **N+1 Problem:**
  - Strictly monitored. If an endpoint makes a DB call inside a loop, the PR will be rejected. Use `.populate()` or batching (Dataloader).
- **Compression:**
  - Gzip or Brotli compression must be enabled on the Express server/Reverse Proxy (Nginx).

## 4. Caching Strategy

- **HTTP Caching:**
  - Static assets (images, fonts, JS) must have `Cache-Control: public, max-age=31536000, immutable`.
- **Server-Side Caching (Redis):**
  - Expensive DB queries (e.g., "Get Top 10 Markets") MUST be cached.
  - **TTL (Time To Live):** Define strict expiration times (e.g., 60 seconds).
  - **Invalidation:** Cache must be cleared when underlying data changes (e.g., when a new Market is created).
- **Client-Side Caching:**
  - Use RTK Query or SWR/TanStack Query with `stale-while-revalidate` strategies. Do not re-fetch immutable data on every component mount.

## 5. Logging Standards

- **Format:**
  - All logs must be structured **JSON**.
  - _Bad:_ `console.log("User logged in " + user.id)`
  - _Good:_ `logger.info({ event: "user_login", userId: user.id, ip: req.ip })`
- **Levels:**
  - `DEBUG`: Detailed dev info (disabled in Prod).
  - `INFO`: High-level business events (e.g., Order Placed).
  - `WARN`: Recoverable issues (e.g., API retry, deprecated usage).
  - `ERROR`: Critical failures requiring attention (e.g., DB connection lost).
- **Correlation IDs:**
  - Every HTTP request must generate a unique `X-Request-ID`. This ID must be passed to all internal services and logs to trace a request across the entire stack.

## 6. Health Checks & Monitoring

- **Liveness Probe:** `/health` endpoint returns `200 OK` if the server process is running.
- **Readiness Probe:** `/ready` endpoint returns `200 OK` only if Database AND Redis connections are established.
- **Alerting:**
  - Alerts must be set for:
    - Error Rate > 1%.
    - CPU/Memory usage > 80%.
    - Disk Space < 10% free.
