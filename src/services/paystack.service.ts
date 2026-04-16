/**
 * Paystack service: banks list, resolve account, validate account (SA), mobile money providers.
 * Payment initialization, webhook verification, transfers (payouts).
 */

import { createHmac } from "node:crypto";
import { getEnv } from "../config/env.js";

const PAYSTACK_BASE = "https://api.paystack.co";

function getSecretKey(): string | null {
  const key = getEnv().PAYSTACK_SECRET_KEY;
  return key && key.length > 0 ? key : null;
}

async function paystackGet<T>(path: string, query?: Record<string, string>): Promise<T> {
  const key = getSecretKey();
  if (!key) throw new Error("PAYSTACK_SECRET_KEY is not configured");
  const url = new URL(path, PAYSTACK_BASE);
  if (query) {
    Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  });
  const data = (await res.json()) as { status?: boolean; message?: string; data?: unknown; meta?: unknown };
  if (!res.ok || data.status === false) {
    const msg = data.message ?? `Paystack API error: ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export type PaystackError = Error & { paystackResponse?: unknown };

/** Channels accepted by `initialize` when passed as `channels[]` (Paystack checkout). */
export const PAYSTACK_CHECKOUT_CHANNELS = [
  "card",
  "bank",
  "apple_pay",
  "ussd",
  "qr",
  "mobile_money",
  "bank_transfer",
  "eft",
  "payattitude",
] as const;

const PAYSTACK_ALLOWED_CHANNELS: Set<string> = new Set(PAYSTACK_CHECKOUT_CHANNELS);

async function paystackPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const key = getSecretKey();
  if (!key) throw new Error("PAYSTACK_SECRET_KEY is not configured");
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { status?: boolean; message?: string; data?: unknown; errors?: unknown };
  if (!res.ok || data.status === false) {
    const msg = data.message ?? `Paystack API error: ${res.status}`;
    const err = new Error(msg) as PaystackError;
    err.paystackResponse = { status: data.status, message: data.message, data: data.data, errors: data.errors };
    throw err;
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Raw Paystack response types
// ---------------------------------------------------------------------------

type PaystackBankRow = {
  id: number;
  name: string;
  slug: string;
  code: string;
  longcode?: string;
  gateway?: string | null;
  pay_with_bank?: boolean;
  active?: boolean;
  is_deleted?: boolean;
  country: string;
  currency: string;
  type: string;
  createdAt?: string;
  updatedAt?: string;
};

type ListBanksResponse = {
  status: boolean;
  message: string;
  data: PaystackBankRow[];
  meta?: { next?: string; previous?: string; perPage?: number };
};

type ResolveAccountResponse = {
  status: boolean;
  message: string;
  data: { account_number: string; account_name: string };
};

type ValidateAccountResponse = {
  status: boolean;
  message: string;
  data: {
    accountAcceptsDebits?: boolean;
    accountAcceptsCredits?: boolean;
    accountHolderMatch?: boolean;
    accountOpenForMoreThanThreeMonths?: boolean;
    accountOpen?: boolean;
    verified?: boolean;
    verificationMessage?: string;
  };
};

// ---------------------------------------------------------------------------
// Our simplified / relevant output types
// ---------------------------------------------------------------------------

export type BankListItem = {
  id: number;
  name: string;
  code: string;
  slug: string;
  country: string;
  currency: string;
  type: string;
};

export type ResolveAccountResult = {
  account_number: string;
  account_name: string;
};

export type ValidateAccountResult = {
  verified: boolean;
  verificationMessage?: string;
  accountHolderMatch?: boolean;
  accountAcceptsDebits?: boolean;
  accountAcceptsCredits?: boolean;
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * List supported banks (or mobile money providers when type=mobile_money and currency set).
 * Country: ghana, kenya, nigeria, south africa.
 */
export async function listBanks(params: {
  country?: string;
  currency?: string;
  type?: string;
  perPage?: number;
  page?: number;
  use_cursor?: boolean;
  next?: string;
}): Promise<{ data: BankListItem[]; meta?: { next?: string; previous?: string; perPage?: number } }> {
  const query: Record<string, string> = {};
  if (params.country) query.country = params.country;
  if (params.currency) query.currency = params.currency;
  if (params.type) query.type = params.type;
  if (params.perPage != null) query.perPage = String(params.perPage);
  if (params.page != null) query.page = String(params.page);
  if (params.use_cursor) query.use_cursor = "true";
  if (params.next) query.next = params.next;

  const raw = await paystackGet<ListBanksResponse>("/bank", query);
  const data = (raw.data ?? []).map((row: PaystackBankRow) => ({
    id: row.id,
    name: row.name,
    code: row.code,
    slug: row.slug,
    country: row.country,
    currency: row.currency,
    type: row.type,
  }));
  return { data, meta: (raw as ListBanksResponse).meta };
}

const LIST_BANKS_MAX_PAGES = 80;

/**
 * Page through GET /bank until a short page or max pages (Paystack lists can be large).
 */
export async function listAllBanksPages(params: {
  country?: string;
  currency?: string;
  type?: string;
  perPage?: number;
  maxPages?: number;
}): Promise<BankListItem[]> {
  const perPage = params.perPage ?? 100;
  const maxPages = params.maxPages ?? LIST_BANKS_MAX_PAGES;
  const out: BankListItem[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const { data } = await listBanks({
      country: params.country,
      currency: params.currency,
      type: params.type,
      perPage,
      page,
    });
    out.push(...data);
    if (data.length === 0 || data.length < perPage) break;
  }
  return out;
}

/**
 * Resolve bank account number (NGN/GHS). Returns account name.
 */
export async function resolveBankAccount(account_number: string, bank_code: string): Promise<ResolveAccountResult> {
  const raw = await paystackGet<ResolveAccountResponse>("/bank/resolve", {
    account_number: account_number.trim(),
    bank_code: bank_code.trim(),
  });
  return raw.data ?? { account_number: "", account_name: "" };
}

/**
 * Validate bank account (South Africa). Requires account details and document_type/document_number.
 */
export async function validateBankAccount(params: {
  bank_code: string;
  country_code: string;
  account_number: string;
  account_name: string;
  account_type: "personal" | "business";
  document_type: "identityNumber" | "passportNumber" | "businessRegistrationNumber";
  document_number: string;
}): Promise<ValidateAccountResult> {
  const raw = await paystackPost<ValidateAccountResponse>("/bank/validate", {
    bank_code: params.bank_code.trim(),
    country_code: params.country_code.trim(),
    account_number: params.account_number.trim(),
    account_name: params.account_name.trim(),
    account_type: params.account_type,
    document_type: params.document_type,
    document_number: params.document_number.trim(),
  });
  const d = raw.data;
  return {
    verified: d?.verified ?? false,
    verificationMessage: d?.verificationMessage,
    accountHolderMatch: d?.accountHolderMatch,
    accountAcceptsDebits: d?.accountAcceptsDebits,
    accountAcceptsCredits: d?.accountAcceptsCredits,
  };
}

/**
 * List mobile money providers (telcos) for a currency. Use currency=GHS or currency=KES.
 */
export async function listMobileMoneyProviders(params: {
  currency: string;
  perPage?: number;
}): Promise<{ data: BankListItem[]; meta?: { next?: string; previous?: string; perPage?: number } }> {
  return listBanks({
    currency: params.currency,
    type: "mobile_money",
    perPage: params.perPage,
  });
}

export function isPaystackConfigured(): boolean {
  return getSecretKey() != null;
}

// ---------------------------------------------------------------------------
// Payment initialization (onramp)
// ---------------------------------------------------------------------------

export type InitializePaymentParams = {
  email: string;
  amount: number; // in subunits (kobo for NGN, pesewas for GHS, etc.)
  currency?: string;
  callback_url?: string;
  reference?: string;
  channels?: string[];
  metadata?: Record<string, string | number>;
};

export type InitializePaymentResult = {
  authorization_url: string;
  access_code: string;
  reference: string;
};

type InitializeResponse = {
  status: boolean;
  message: string;
  data: { authorization_url: string; access_code: string; reference: string };
};

/**
 * Initialize a Paystack transaction. Returns authorization_url for frontend redirect.
 */
export async function initializePayment(params: InitializePaymentParams): Promise<InitializePaymentResult> {
  const normalizedCurrency = (params.currency ?? "NGN").trim().toUpperCase();
  const amountSubunits = Math.round(params.amount);
  const normalizedChannels = [...new Set((params.channels ?? []).map((channel) => channel.trim().toLowerCase()))]
    .filter((channel) => channel.length > 0)
    .filter((channel) => PAYSTACK_ALLOWED_CHANNELS.has(channel));
  const callbackUrl = params.callback_url?.trim();
  const hasValidCallbackUrl = (() => {
    if (!callbackUrl) return false;
    try {
      const parsed = new URL(callbackUrl);
      return parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch {
      return false;
    }
  })();

  const body: Record<string, unknown> = {
    email: params.email.trim(),
    amount: String(amountSubunits),
    currency: normalizedCurrency,
    metadata: params.metadata ?? {},
  };
  if (hasValidCallbackUrl && callbackUrl) body.callback_url = callbackUrl;
  if (params.reference) body.reference = params.reference;
  if (normalizedChannels.length > 0) body.channels = normalizedChannels;

  const raw = await paystackPost<InitializeResponse>("/transaction/initialize", body);
  const d = raw.data;
  if (!d?.authorization_url || !d?.reference) throw new Error("Invalid Paystack initialize response");
  return {
    authorization_url: d.authorization_url,
    access_code: d.access_code,
    reference: d.reference,
  };
}

/** Paystack verify/fetch transaction response (relevant fields for "after payment completed"). */
export type PaystackTransactionData = {
  id: number;
  status: string;
  reference: string;
  amount: number;
  currency: string;
  paid_at: string | null;
  created_at: string;
  channel: string;
  gateway_response: string | null;
  message: string | null;
  metadata?: Record<string, unknown>;
  customer?: { id: number; email: string; customer_code: string; first_name?: string; last_name?: string; phone?: string };
  authorization?: {
    authorization_code: string;
    last4: string;
    exp_month: string;
    exp_year: string;
    channel: string;
    card_type: string;
    bank: string;
    country_code: string;
    brand: string;
    reusable: boolean;
  };
};

/** Safe authorization subset for API and storage (no card/account identifiers). */
export type PaystackAuthorizationSafe = {
  channel: string;
  card_type: string;
  bank: string;
  country_code: string;
  reusable: boolean;
};

/** Sanitized transaction data: authorization stripped to safe fields only (no authorization_code, last4, exp_*, brand). */
export type PaystackTransactionDataSanitized = Omit<PaystackTransactionData, "authorization"> & {
  authorization?: PaystackAuthorizationSafe;
};

/**
 * Sanitize Paystack transaction data for API response and storage.
 * Removes sensitive bank/card fields: authorization_code, last4, exp_month, exp_year, brand.
 * Keeps only: channel, card_type, bank, country_code, reusable.
 */
export function sanitizeTransactionData(data: PaystackTransactionData): PaystackTransactionDataSanitized {
  const out: PaystackTransactionDataSanitized = { ...data };
  if (data.authorization) {
    out.authorization = {
      channel: data.authorization.channel,
      card_type: data.authorization.card_type,
      bank: data.authorization.bank,
      country_code: data.authorization.country_code,
      reusable: data.authorization.reusable,
    };
  }
  return out;
}

/**
 * Verify a transaction by reference (e.g. after redirect or for polling). Returns full Paystack verify payload.
 */
export async function verifyTransaction(reference: string): Promise<PaystackTransactionData> {
  const raw = await paystackGet<{ status: boolean; message: string; data: PaystackTransactionData }>(
    `/transaction/verify/${encodeURIComponent(reference)}`
  );
  const d = raw.data;
  if (!d) throw new Error("Invalid verify response");
  return d;
}

/**
 * Fetch a single transaction by Paystack transaction ID (integer).
 */
export async function getTransactionById(id: number): Promise<PaystackTransactionData> {
  const raw = await paystackGet<{ status: boolean; message: string; data: PaystackTransactionData }>(
    `/transaction/${id}`
  );
  const d = raw.data;
  if (!d) throw new Error("Invalid transaction response");
  return d;
}

export type ListTransactionsParams = {
  perPage?: number;
  page?: number;
  status?: "failed" | "success" | "abandoned";
  customer?: number;
  from?: string;
  to?: string;
  amount?: number;
};

export type ListTransactionsResult = {
  data: PaystackTransactionData[];
  meta: { total: number; perPage: number; page: number; next?: string; previous?: string };
};

/**
 * List transactions on your Paystack integration (admin-style). Uses your PAYSTACK_SECRET_KEY.
 */
export async function listTransactions(params: ListTransactionsParams): Promise<ListTransactionsResult> {
  const query: Record<string, string> = {};
  if (params.perPage != null) query.perPage = String(params.perPage);
  if (params.page != null) query.page = String(params.page);
  if (params.status) query.status = params.status;
  if (params.customer != null) query.customer = String(params.customer);
  if (params.from) query.from = params.from;
  if (params.to) query.to = params.to;
  if (params.amount != null) query.amount = String(params.amount);

  const raw = await paystackGet<{
    status: boolean;
    message: string;
    data: PaystackTransactionData[];
    meta: { total: number; perPage: number; page: number; next?: string; previous?: string };
  }>("/transaction", query);
  const list = raw.data ?? [];
  const meta = (raw as { meta?: ListTransactionsResult["meta"] }).meta ?? {
    total: list.length,
    perPage: 50,
    page: 1,
  };
  return { data: list, meta };
}

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

/**
 * Verify Paystack webhook signature (HMAC SHA512 of raw body with secret key).
 */
export function verifyPaystackWebhookSignature(rawBody: string, signature: string): boolean {
  const key = getSecretKey();
  if (!key) return false;
  const hash = createHmac("sha512", key).update(rawBody).digest("hex");
  return hash === signature;
}

// ---------------------------------------------------------------------------
// Transfers (payouts / offramp)
// ---------------------------------------------------------------------------

export type CreateTransferRecipientParams = {
  type: "nuban" | "mobile_money" | "mobile_money_business";
  name: string;
  account_number: string;
  bank_code?: string; // required for nuban; for mobile_money this is provider code (e.g. MTN)
  currency: string;
  description?: string;
};

type CreateRecipientResponse = {
  status: boolean;
  message: string;
  data: { recipient_code: string; id: number };
};

/**
 * Create a transfer recipient (bank or mobile money). Returns recipient_code for initiateTransfer.
 */
export async function createTransferRecipient(params: CreateTransferRecipientParams): Promise<{ recipient_code: string }> {
  const body: Record<string, unknown> = {
    type: params.type,
    name: params.name.trim(),
    account_number: params.account_number.trim(),
    currency: params.currency,
  };
  if (params.bank_code) body.bank_code = params.bank_code;
  if (params.description) body.description = params.description;

  const raw = await paystackPost<CreateRecipientResponse>("/transferrecipient", body);
  const d = raw.data;
  if (!d?.recipient_code) throw new Error("Invalid create recipient response");
  return { recipient_code: d.recipient_code };
}

export type InitiateTransferParams = {
  source: "balance";
  amount: number; // subunits (kobo/pesewas)
  recipient: string; // recipient_code
  reference: string; // unique, 16–50 chars, [a-z0-9_.-]
  reason?: string;
  currency?: string;
};

type InitiateTransferResponse = {
  status: boolean;
  message: string;
  data: { transfer_code: string; status: string; reference: string };
};

/**
 * Initiate a transfer to a recipient. Returns transfer_code; status may be pending or success.
 */
export async function initiateTransfer(params: InitiateTransferParams): Promise<{
  transfer_code: string;
  status: string;
  reference: string;
}> {
  const body: Record<string, unknown> = {
    source: params.source,
    amount: params.amount,
    recipient: params.recipient,
    reference: params.reference,
  };
  if (params.reason) body.reason = params.reason;
  if (params.currency) body.currency = params.currency;

  const raw = await paystackPost<InitiateTransferResponse>("/transfer", body);
  const d = raw.data;
  if (!d?.transfer_code) throw new Error("Invalid initiate transfer response");
  return {
    transfer_code: d.transfer_code,
    status: d.status,
    reference: d.reference,
  };
}

/** Paystack transfer verify response (relevant fields for payout status). */
export type PaystackTransferVerifyData = {
  id: number;
  reference: string;
  transfer_code: string;
  amount: number;
  currency: string;
  status: string; // success | pending | failed | reversed | otp
  reason: string | null;
  created_at: string;
  updated_at: string;
};

type PaystackTransferVerifyRaw = {
  id: number;
  reference: string;
  transfer_code: string;
  amount: number;
  currency: string;
  status: string;
  reason?: string | null;
  createdAt?: string;
  updatedAt?: string;
  created_at?: string;
  updated_at?: string;
};

/**
 * Verify a transfer by reference. Use the reference returned from initiateTransfer (or execute payout).
 * Returns transfer status so you can confirm payout success.
 */
export async function verifyTransfer(reference: string): Promise<PaystackTransferVerifyData> {
  const raw = await paystackGet<{ status: boolean; message: string; data: PaystackTransferVerifyRaw }>(
    `/transfer/verify/${encodeURIComponent(reference)}`
  );
  const d = raw.data;
  if (!d) throw new Error("Invalid verify transfer response");
  const createdAt = d.created_at ?? d.createdAt ?? "";
  const updatedAt = d.updated_at ?? d.updatedAt ?? "";
  return {
    id: d.id,
    reference: d.reference,
    transfer_code: d.transfer_code,
    amount: d.amount,
    currency: d.currency,
    status: d.status,
    reason: d.reason ?? null,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

// ---------------------------------------------------------------------------
// List transfers (admin / dashboard)
// ---------------------------------------------------------------------------

export type ListTransfersParams = {
  perPage?: number;
  page?: number;
  customer?: number;
  from?: string;
  to?: string;
};

export type PaystackTransferListItem = {
  id: number;
  reference: string;
  transfer_code: string;
  amount: number;
  currency: string;
  status: string;
  reason: string | null;
  created_at: string;
  updated_at: string;
};

export type ListTransfersResult = {
  data: PaystackTransferListItem[];
  meta: { total: number; skipped: number; perPage: number; page: number; pageCount: number };
};

type ListTransfersRawItem = PaystackTransferListItem & { createdAt?: string; updatedAt?: string };

/**
 * List transfers from Paystack (admin dashboard). Uses PAYSTACK_SECRET_KEY.
 */
export async function listTransfers(params: ListTransfersParams): Promise<ListTransfersResult> {
  const query: Record<string, string> = {};
  if (params.perPage != null) query.perPage = String(params.perPage);
  if (params.page != null) query.page = String(params.page);
  if (params.customer != null) query.customer = String(params.customer);
  if (params.from) query.from = params.from;
  if (params.to) query.to = params.to;

  const raw = await paystackGet<{
    status: boolean;
    message: string;
    data: ListTransfersRawItem[];
    meta: { total: number; skipped: number; perPage: number; page: number; pageCount: number };
  }>("/transfer", query);
  const list = raw.data ?? [];
  const meta = (raw as { meta?: ListTransfersResult["meta"] }).meta ?? {
    total: list.length,
    skipped: 0,
    perPage: 50,
    page: 1,
    pageCount: 1,
  };
  const normalized = list.map((transfer) => ({
    id: transfer.id,
    reference: transfer.reference,
    transfer_code: transfer.transfer_code,
    amount: transfer.amount,
    currency: transfer.currency,
    status: transfer.status,
    reason: transfer.reason ?? null,
    created_at: transfer.created_at ?? transfer.createdAt ?? "",
    updated_at: transfer.updated_at ?? transfer.updatedAt ?? "",
  }));
  return { data: normalized, meta };
}
