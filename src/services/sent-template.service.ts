/**
 * Sent.dm template management: create, list, get by id, delete.
 * Uses SENT_DM_API_KEY and SENT_DM_SENDER_ID. Used by admin API and push script.
 */

import { getEnv } from "../config/env.js";

const SENT_API_BASE = "https://api.sent.dm";

function getAuthHeaders(): Record<string, string> | null {
  const env = getEnv();
  if (!env.SENT_DM_API_KEY || !env.SENT_DM_SENDER_ID) return null;
  return {
    "Content-Type": "application/json",
    "x-api-key": env.SENT_DM_API_KEY,
    "x-sender-id": env.SENT_DM_SENDER_ID,
  };
}

/** Sent API template definition (body for create). */
export type SentTemplateDefinition = {
  header?: { type: string; template: string; variables: unknown[] } | null;
  body: {
    multiChannel: { type: string | null; template: string; variables: unknown[] };
    sms?: unknown;
    whatsapp?: unknown;
  };
  footer?: { type: string; template: string; variables: unknown } | null;
  buttons?: unknown;
  definitionVersion?: string;
  authenticationConfig?: unknown;
};

/** Payload for POST /v2/templates */
export type CreateTemplatePayload = {
  category?: string | null;
  language?: string | null;
  definition: SentTemplateDefinition;
  submitForReview?: boolean;
};

/** Template as returned by Sent API (list/get). */
export type SentTemplate = {
  id: string;
  displayName?: string;
  category?: string;
  language?: string;
  definition?: SentTemplateDefinition;
  status?: string;
  isPublished?: boolean;
  whatsappTemplateId?: string;
  whatsappTemplateName?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type ListTemplatesParams = {
  page?: number;
  pageSize?: number;
  search?: string | null;
  status?: string | null;
  category?: string | null;
};

export type ListTemplatesResult =
  | { ok: true; items: SentTemplate[]; totalCount: number; page: number; pageSize: number; totalPages: number }
  | { ok: false; error: string };

export type GetTemplateResult = { ok: true; template: SentTemplate } | { ok: false; error: string };

export type CreateTemplateResult = { ok: true; template: SentTemplate } | { ok: false; error: string };

export type DeleteTemplateResult = { ok: true } | { ok: false; error: string };

async function parseError(res: Response, text: string): Promise<string> {
  try {
    const json = JSON.parse(text) as { message?: string; error?: string };
    return json.message ?? json.error ?? `Sent.dm API ${res.status}`;
  } catch {
    return text || `Sent.dm API ${res.status}`;
  }
}

/** List templates with optional filters and pagination. */
export async function listSentTemplates(params: ListTemplatesParams = {}): Promise<ListTemplatesResult> {
  const headers = getAuthHeaders();
  if (!headers) return { ok: false, error: "Sent.dm not configured (SENT_DM_API_KEY or SENT_DM_SENDER_ID missing)" };

  const page = params.page ?? 0;
  const pageSize = Math.min(Math.max(params.pageSize ?? 100, 1), 1000);
  const search = new URLSearchParams();
  search.set("page", String(page));
  search.set("pageSize", String(pageSize));
  if (params.search != null && params.search !== "") search.set("search", params.search);
  if (params.status != null && params.status !== "") search.set("status", params.status);
  if (params.category != null && params.category !== "") search.set("category", params.category);

  const res = await fetch(`${SENT_API_BASE}/v2/templates?${search.toString()}`, { headers });
  const text = await res.text();
  if (!res.ok) return { ok: false, error: await parseError(res, text) };

  try {
    const data = JSON.parse(text) as {
      items?: SentTemplate[];
      totalCount?: number;
      page?: number;
      pageSize?: number;
      totalPages?: number;
    };
    return {
      ok: true,
      items: data.items ?? [],
      totalCount: data.totalCount ?? 0,
      page: data.page ?? page,
      pageSize: data.pageSize ?? pageSize,
      totalPages: data.totalPages ?? 0,
    };
  } catch {
    return { ok: false, error: "Invalid response from Sent.dm" };
  }
}

/** Get a single template by id. */
export async function getSentTemplateById(id: string): Promise<GetTemplateResult> {
  const headers = getAuthHeaders();
  if (!headers) return { ok: false, error: "Sent.dm not configured" };

  const res = await fetch(`${SENT_API_BASE}/v2/templates/${encodeURIComponent(id)}`, { headers });
  const text = await res.text();
  if (!res.ok) return { ok: false, error: await parseError(res, text) };

  try {
    const template = JSON.parse(text) as SentTemplate;
    return { ok: true, template };
  } catch {
    return { ok: false, error: "Invalid response from Sent.dm" };
  }
}

/** Create a template. */
export async function createSentTemplate(payload: CreateTemplatePayload): Promise<CreateTemplateResult> {
  const headers = getAuthHeaders();
  if (!headers) return { ok: false, error: "Sent.dm not configured" };

  const body = {
    category: payload.category ?? null,
    language: payload.language ?? null,
    definition: payload.definition,
    submitForReview: payload.submitForReview ?? false,
  };

  const res = await fetch(`${SENT_API_BASE}/v2/templates`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, error: await parseError(res, text) };

  try {
    const template = JSON.parse(text) as SentTemplate;
    return { ok: true, template };
  } catch {
    return { ok: false, error: "Invalid response from Sent.dm" };
  }
}

/** Delete a template by id. Returns 204 on success. */
export async function deleteSentTemplate(id: string): Promise<DeleteTemplateResult> {
  const headers = getAuthHeaders();
  if (!headers) return { ok: false, error: "Sent.dm not configured" };

  const res = await fetch(`${SENT_API_BASE}/v2/templates/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers,
  });
  if (res.status === 204) return { ok: true };
  const text = await res.text();
  return { ok: false, error: await parseError(res, text) };
}
