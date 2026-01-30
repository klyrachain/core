import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma.js";
import {
  parsePagination,
  successEnvelope,
  successEnvelopeWithMeta,
  errorEnvelope,
} from "../../lib/api-helpers.js";
import type { InvoiceStatus } from "../../../prisma/generated/prisma/enums.js";

// --- Types (spec §2) ---

const VALID_STATUSES: InvoiceStatus[] = ["Paid", "Pending", "Overdue", "Draft", "Cancelled"];

export type LineItem = {
  id: string;
  productName: string;
  qty: number;
  unitPrice: number;
  amount: number;
};

export type LogEntry = {
  id: string;
  description: string;
  date: string;
};

type InvoiceRow = Awaited<
  ReturnType<typeof prisma.invoice.findUniqueOrThrow>
>;

function toNum(v: { toString(): string } | number): number {
  if (typeof v === "number") return v;
  return parseFloat(v.toString());
}

function toIso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

/** Serialize DB invoice to full API invoice (§2.4) */
function toFullInvoice(row: InvoiceRow) {
  const lineItems = (row.lineItems as LineItem[]) ?? [];
  const log = (row.log as LogEntry[]) ?? [];
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    status: row.status,
    amount: toNum(row.amount),
    currency: row.currency,
    currencyLabel: row.currencyLabel ?? undefined,
    paidAt: toIso(row.paidAt),
    batchTitle: row.batchTitle,
    billedTo: row.billedTo,
    billingDetails: row.billingDetails ?? undefined,
    subject: row.subject,
    issued: row.issued.toISOString(),
    dueDate: row.dueDate.toISOString(),
    notes: row.notes ?? undefined,
    lineItems,
    subtotal: toNum(row.subtotal),
    discountPercent: toNum(row.discountPercent),
    discountAmount: toNum(row.discountAmount),
    total: toNum(row.total),
    amountDue: toNum(row.amountDue),
    termsAndConditions: row.termsAndConditions,
    notesContent: row.notesContent,
    log,
  };
}

/** Serialize to list item (§2.5) */
function toListItem(row: InvoiceRow) {
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    status: row.status,
    amount: toNum(row.amount),
    currency: row.currency,
    customer: row.billedTo,
    issued: row.issued.toISOString(),
    dueDate: row.dueDate.toISOString(),
    paidAt: toIso(row.paidAt),
  };
}

function nextInvoiceNumber(): string {
  const t = Date.now().toString(36).toUpperCase();
  const r = randomUUID().slice(0, 4);
  return `INV-${t}-${r}`;
}

function computeTotals(
  lineItems: LineItem[],
  discountPercent: number
): { subtotal: number; discountAmount: number; total: number } {
  const subtotal = lineItems.reduce((s, i) => s + i.amount, 0);
  const discountAmount = (subtotal * Math.min(100, Math.max(0, discountPercent))) / 100;
  const total = subtotal - discountAmount;
  return { subtotal, discountAmount, total };
}

function normalizeLineItems(items: unknown): LineItem[] {
  if (!Array.isArray(items) || items.length === 0) return [];
  return items.map((i: Record<string, unknown>) => {
    const id = typeof i.id === "string" ? i.id : randomUUID();
    const productName = String(i.productName ?? "");
    const qty = Number(i.qty) || 0;
    const unitPrice = Number(i.unitPrice) || 0;
    const amount = Number(i.amount) ?? qty * unitPrice;
    return { id, productName, qty, unitPrice, amount };
  });
}

function addLogEntry(log: LogEntry[], description: string): LogEntry[] {
  const entry: LogEntry = {
    id: randomUUID(),
    description,
    date: new Date().toISOString(),
  };
  return [entry, ...log];
}

export async function invoicesApiRoutes(app: FastifyInstance): Promise<void> {
  // --- GET /api/invoices ---
  app.get(
    "/api/invoices",
    async (
      req: FastifyRequest<{
        Querystring: { page?: string; limit?: string; status?: string };
      }>,
      reply
    ) => {
      try {
        const { page, limit, skip } = parsePagination(req.query);
        const status = req.query.status;
        const where =
          status && VALID_STATUSES.includes(status as InvoiceStatus)
            ? { status: status as InvoiceStatus }
            : {};
        const [items, total] = await Promise.all([
          prisma.invoice.findMany({
            where,
            skip,
            take: limit,
            orderBy: { issued: "desc" },
          }),
          prisma.invoice.count({ where }),
        ]);
        const data = items.map(toListItem);
        return successEnvelopeWithMeta(reply, data, { page, limit, total });
      } catch (err) {
        req.log.error({ err }, "GET /api/invoices");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  // --- GET /api/invoices/:id ---
  app.get(
    "/api/invoices/:id",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      try {
        const row = await prisma.invoice.findUnique({
          where: { id: req.params.id },
        });
        if (!row) return errorEnvelope(reply, "Invoice not found", 404);
        return successEnvelope(reply, toFullInvoice(row));
      } catch (err) {
        req.log.error({ err }, "GET /api/invoices/:id");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  // --- POST /api/invoices ---
  app.post(
    "/api/invoices",
    async (
      req: FastifyRequest<{
        Body: {
          billedTo?: string;
          billingDetails?: string;
          subject?: string;
          dueDate?: string;
          lineItems?: unknown;
          discountPercent?: number;
          termsAndConditions?: string;
          notesContent?: string;
          sendNow?: boolean;
        };
      }>,
      reply
    ) => {
      try {
        const body = req.body ?? {};
        const billedTo = body.billedTo?.trim();
        const subject = body.subject?.trim();
        const dueDateStr = body.dueDate?.trim();
        const lineItems = normalizeLineItems(body.lineItems ?? []);

        if (!billedTo)
          return errorEnvelope(reply, "billedTo is required", 400);
        if (!subject)
          return errorEnvelope(reply, "subject is required", 400);
        if (!dueDateStr)
          return errorEnvelope(reply, "dueDate is required", 400);
        if (lineItems.length === 0)
          return errorEnvelope(reply, "At least one line item is required", 400);

        const dueDate = new Date(dueDateStr);
        if (Number.isNaN(dueDate.getTime()))
          return errorEnvelope(reply, "Invalid dueDate", 400);

        const discountPercent = Math.min(
          100,
          Math.max(0, Number(body.discountPercent) || 0)
        );
        const { subtotal, discountAmount, total } = computeTotals(
          lineItems,
          discountPercent
        );
        const issued = new Date();
        const log: LogEntry[] = [
          { id: randomUUID(), description: "Invoice was created.", date: issued.toISOString() },
        ];

        let invoiceNumber: string;
        do {
          invoiceNumber = nextInvoiceNumber();
        } while (
          (await prisma.invoice.findUnique({ where: { invoiceNumber } })) != null
        );

        const row = await prisma.invoice.create({
          data: {
            invoiceNumber,
            status: "Draft",
            amount: total,
            currency: "USD",
            batchTitle: "",
            billedTo,
            billingDetails: body.billingDetails?.trim() ?? null,
            subject,
            issued,
            dueDate,
            notes: null,
            lineItems: lineItems as object,
            subtotal,
            discountPercent,
            discountAmount,
            total,
            amountDue: total,
            termsAndConditions: body.termsAndConditions?.trim() ?? "",
            notesContent: body.notesContent?.trim() ?? "",
            log: log as object,
          },
        });

        if (body.sendNow === true) {
          const logUpdated = addLogEntry(
            row.log as LogEntry[],
            `Invoice was sent to ${row.billedTo}.`
          );
          await prisma.invoice.update({
            where: { id: row.id },
            data: { log: logUpdated as object },
          });
          (row as { log: unknown }).log = logUpdated;
        }

        return successEnvelope(reply, toFullInvoice(row), 201);
      } catch (err) {
        req.log.error({ err }, "POST /api/invoices");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  // --- PATCH /api/invoices/:id ---
  app.patch(
    "/api/invoices/:id",
    async (
      req: FastifyRequest<{
        Params: { id: string };
        Body: {
          subject?: string;
          dueDate?: string;
          notes?: string | null;
          notesContent?: string;
          billedTo?: string;
          billingDetails?: string;
          termsAndConditions?: string;
          lineItems?: unknown;
        };
      }>,
      reply
    ) => {
      try {
        const row = await prisma.invoice.findUnique({
          where: { id: req.params.id },
        });
        if (!row) return errorEnvelope(reply, "Invoice not found", 404);
        if (row.status === "Paid" || row.status === "Cancelled")
          return errorEnvelope(
            reply,
            "Invoice cannot be edited (Paid or Cancelled)",
            409
          );

        const body = req.body ?? {};
        const updates: Record<string, unknown> = {};

        if (body.subject !== undefined) updates.subject = body.subject;
        if (body.dueDate !== undefined) {
          const d = new Date(body.dueDate);
          if (Number.isNaN(d.getTime()))
            return errorEnvelope(reply, "Invalid dueDate", 400);
          updates.dueDate = d;
        }
        if (body.notes !== undefined) updates.notes = body.notes;
        if (body.notesContent !== undefined) updates.notesContent = body.notesContent;
        if (body.billedTo !== undefined) updates.billedTo = body.billedTo;
        if (body.billingDetails !== undefined)
          updates.billingDetails = body.billingDetails;
        if (body.termsAndConditions !== undefined)
          updates.termsAndConditions = body.termsAndConditions;

        if (body.lineItems !== undefined) {
          const lineItems = normalizeLineItems(body.lineItems);
          if (lineItems.length === 0)
            return errorEnvelope(reply, "At least one line item is required", 400);
          const discountPercent = toNum(row.discountPercent);
          const { subtotal, discountAmount, total } = computeTotals(
            lineItems,
            discountPercent
          );
          updates.lineItems = lineItems;
          updates.subtotal = subtotal;
          updates.discountAmount = discountAmount;
          updates.total = total;
          updates.amountDue = total;
          updates.amount = total;
        }

        const updated = await prisma.invoice.update({
          where: { id: req.params.id },
          data: updates as object,
        });
        return successEnvelope(reply, toFullInvoice(updated));
      } catch (err) {
        req.log.error({ err }, "PATCH /api/invoices/:id");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  // --- POST /api/invoices/:id/send ---
  app.post(
    "/api/invoices/:id/send",
    async (
      req: FastifyRequest<{
        Params: { id: string };
        Body: { toEmail?: string };
      }>,
      reply
    ) => {
      try {
        const row = await prisma.invoice.findUnique({
          where: { id: req.params.id },
        });
        if (!row) return errorEnvelope(reply, "Invoice not found", 404);
        if (row.status === "Cancelled")
          return errorEnvelope(reply, "Cannot send a cancelled invoice", 400);

        const toEmail = (req.body?.toEmail ?? row.billedTo)?.trim();
        if (!toEmail)
          return errorEnvelope(reply, "No recipient email", 400);

        const log = addLogEntry(
          row.log as LogEntry[],
          `Invoice was sent to ${toEmail}.`
        );
        await prisma.invoice.update({
          where: { id: req.params.id },
          data: { log: log as object },
        });
        return successEnvelope(reply, { sent: true, to: toEmail });
      } catch (err) {
        req.log.error({ err }, "POST /api/invoices/:id/send");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  // --- POST /api/invoices/:id/duplicate ---
  app.post(
    "/api/invoices/:id/duplicate",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      try {
        const row = await prisma.invoice.findUnique({
          where: { id: req.params.id },
        });
        if (!row) return errorEnvelope(reply, "Invoice not found", 404);

        let invoiceNumber: string;
        do {
          invoiceNumber = nextInvoiceNumber();
        } while (
          (await prisma.invoice.findUnique({ where: { invoiceNumber } })) != null
        );

        const issued = new Date();
        const log: LogEntry[] = [
          {
            id: randomUUID(),
            description: "Invoice was created (duplicate).",
            date: issued.toISOString(),
          },
        ];

        const lineItems = (row.lineItems as LineItem[]).map((i) => ({
          ...i,
          id: randomUUID(),
        }));

        const newRow = await prisma.invoice.create({
          data: {
            invoiceNumber,
            status: "Draft",
            amount: row.amount,
            currency: row.currency,
            currencyLabel: row.currencyLabel,
            paidAt: null,
            batchTitle: row.batchTitle,
            billedTo: row.billedTo,
            billingDetails: row.billingDetails,
            subject: row.subject,
            issued,
            dueDate: row.dueDate,
            notes: row.notes,
            lineItems: lineItems as object,
            subtotal: row.subtotal,
            discountPercent: row.discountPercent,
            discountAmount: row.discountAmount,
            total: row.total,
            amountDue: row.amountDue,
            termsAndConditions: row.termsAndConditions,
            notesContent: row.notesContent,
            log: log as object,
          },
        });
        return successEnvelope(reply, toFullInvoice(newRow), 201);
      } catch (err) {
        req.log.error({ err }, "POST /api/invoices/:id/duplicate");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  // --- POST /api/invoices/:id/mark-paid ---
  app.post(
    "/api/invoices/:id/mark-paid",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      try {
        const row = await prisma.invoice.findUnique({
          where: { id: req.params.id },
        });
        if (!row) return errorEnvelope(reply, "Invoice not found", 404);
        if (row.status === "Paid")
          return errorEnvelope(reply, "Invoice is already paid", 400);
        if (row.status === "Cancelled")
          return errorEnvelope(reply, "Cannot mark a cancelled invoice as paid", 400);

        const paidAt = new Date();
        const log = addLogEntry(
          row.log as LogEntry[],
          "Invoice was marked as paid."
        );
        const updated = await prisma.invoice.update({
          where: { id: req.params.id },
          data: { status: "Paid", paidAt, amountDue: 0, log: log as object },
        });
        return successEnvelope(reply, toFullInvoice(updated));
      } catch (err) {
        req.log.error({ err }, "POST /api/invoices/:id/mark-paid");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  // --- POST /api/invoices/:id/cancel ---
  app.post(
    "/api/invoices/:id/cancel",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      try {
        const row = await prisma.invoice.findUnique({
          where: { id: req.params.id },
        });
        if (!row) return errorEnvelope(reply, "Invoice not found", 404);
        if (row.status === "Paid")
          return errorEnvelope(reply, "Cannot cancel a paid invoice", 400);
        if (row.status === "Cancelled")
          return errorEnvelope(reply, "Invoice is already cancelled", 400);

        const log = addLogEntry(
          row.log as LogEntry[],
          "Invoice was cancelled."
        );
        const updated = await prisma.invoice.update({
          where: { id: req.params.id },
          data: { status: "Cancelled", amountDue: 0, log: log as object },
        });
        return successEnvelope(reply, toFullInvoice(updated));
      } catch (err) {
        req.log.error({ err }, "POST /api/invoices/:id/cancel");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  // --- GET /api/invoices/:id/export ---
  app.get(
    "/api/invoices/:id/export",
    async (
      req: FastifyRequest<{
        Params: { id: string };
        Querystring: { format?: string };
      }>,
      reply
    ) => {
      try {
        const row = await prisma.invoice.findUnique({
          where: { id: req.params.id },
        });
        if (!row) return errorEnvelope(reply, "Invoice not found", 404);

        const format = (req.query.format ?? "csv").toLowerCase();
        const safeNumber = row.invoiceNumber.replace(/[^a-zA-Z0-9-]/g, "-");
        const filename = `invoice-${safeNumber}`;

        if (format === "csv") {
          const lineItems = (row.lineItems as LineItem[]) ?? [];
          const headers = [
            "Invoice",
            "Subject",
            "Status",
            "Amount",
            "Currency",
            "Issued",
            "Due",
            "Billed To",
            "Product",
            "Qty",
            "Unit Price",
            "Line Amount",
          ];
          const rows: string[][] = [headers];
          lineItems.forEach((item, i) => {
            rows.push([
              i === 0 ? row.invoiceNumber : "",
              i === 0 ? row.subject : "",
              i === 0 ? row.status : "",
              i === 0 ? String(toNum(row.amount)) : "",
              i === 0 ? row.currency : "",
              i === 0 ? row.issued.toISOString() : "",
              i === 0 ? row.dueDate.toISOString() : "",
              i === 0 ? row.billedTo : "",
              item.productName,
              String(item.qty),
              String(item.unitPrice),
              String(item.amount),
            ]);
          });
          const csv =
            rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n") +
            "\n";
          return reply
            .status(200)
            .header("Content-Type", "text/csv; charset=utf-8")
            .header(
              "Content-Disposition",
              `attachment; filename="${filename}.csv"`
            )
            .send(csv);
        }

        if (format === "pdf") {
          return errorEnvelope(
            reply,
            "PDF export not implemented; use format=csv",
            501
          );
        }

        return errorEnvelope(reply, "Invalid format; use csv or pdf", 400);
      } catch (err) {
        req.log.error({ err }, "GET /api/invoices/:id/export");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );
}
