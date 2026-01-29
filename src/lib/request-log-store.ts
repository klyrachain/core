/**
 * In-memory store for request logs (monitoring). Intercepted requests are pushed here.
 * GET /api/logs reads from this store with optional filters.
 */

const MAX_ENTRIES = 2000;

export type RequestLogEntry = {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string>;
  body: unknown;
  /** Set by onResponse hook */
  statusCode?: number;
  responseTimeMs?: number;
};

const store: RequestLogEntry[] = [];
let storeIndex = 0;

function nextId(): string {
  return `req_${Date.now()}_${(storeIndex++).toString(36)}`;
}

const REDACT_HEADERS = new Set([
  "authorization",
  "cookie",
  "x-api-key",
  "x-auth-token",
  "proxy-authorization",
]);

function sanitizeHeaders(headers: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue;
    const lower = k.toLowerCase();
    out[k] = REDACT_HEADERS.has(lower) ? "[REDACTED]" : v;
  }
  return out;
}

export function addRequestLog(entry: Omit<RequestLogEntry, "id" | "timestamp">): string {
  const id = nextId();
  const log: RequestLogEntry = {
    ...entry,
    id,
    timestamp: new Date().toISOString(),
  };
  store.push(log);
  if (store.length > MAX_ENTRIES) {
    store.shift();
  }
  return id;
}

export function updateRequestLog(
  id: string,
  update: { statusCode?: number; responseTimeMs?: number }
): void {
  const entry = store.find((e) => e.id === id);
  if (entry) {
    if (update.statusCode !== undefined) entry.statusCode = update.statusCode;
    if (update.responseTimeMs !== undefined) entry.responseTimeMs = update.responseTimeMs;
  }
}

export function getRequestLogs(filters: {
  method?: string;
  path?: string;
  since?: string;
  limit?: number;
  offset?: number;
}): { entries: RequestLogEntry[]; total: number } {
  let list = [...store].reverse(); // newest first

  if (filters.method) {
    const m = filters.method.toUpperCase();
    list = list.filter((e) => e.method === m);
  }
  if (filters.path) {
    const p = filters.path.toLowerCase();
    list = list.filter((e) => e.path.toLowerCase().includes(p));
  }
  if (filters.since) {
    const sinceMs = new Date(filters.since).getTime();
    if (!Number.isNaN(sinceMs)) {
      list = list.filter((e) => new Date(e.timestamp).getTime() >= sinceMs);
    }
  }

  const total = list.length;
  const offset = Math.max(0, filters.offset ?? 0);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 50));
  const entries = list.slice(offset, offset + limit);

  return { entries, total };
}

export function captureFromRequest(req: {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
}): string {
  const raw = req.url || "";
  const path = raw.split("?")[0] || "/";
  const query = (req.query as Record<string, string | string[] | undefined>) ?? {};
  return addRequestLog({
    method: req.method,
    path,
    query,
    headers: sanitizeHeaders(req.headers as Record<string, string | undefined>),
    body: req.body ?? null,
  });
}
