/**
 * Admin API: Sent.dm template management (list, get by id, create, delete).
 * For use by dashboard to manage SMS/WhatsApp templates.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { successEnvelope } from "../../lib/api-helpers.js";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import { PERMISSION_SETTINGS_READ, PERMISSION_SETTINGS_WRITE } from "../../lib/permissions.js";
import {
  listSentTemplates,
  getSentTemplateById,
  createSentTemplate,
  deleteSentTemplate,
  type CreateTemplatePayload,
  type SentTemplateDefinition,
} from "../../services/sent-template.service.js";

const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(0).optional().default(0),
  pageSize: z.coerce.number().int().min(1).max(1000).optional().default(100),
  search: z.string().optional(),
  status: z.string().optional(),
  category: z.string().optional(),
});

const CreateBodySchema = z.object({
  category: z.string().optional().nullable(),
  language: z.string().optional().nullable(),
  definition: z.unknown(),
  submitForReview: z.boolean().optional(),
});

export async function adminSentTemplatesRoutes(app: FastifyInstance): Promise<void> {
  /** GET /api/admin/sent/templates — list Sent.dm templates (paginated, optional filters). */
  app.get(
    "/api/admin/sent/templates",
    async (req: FastifyRequest<{ Querystring: { page?: string; pageSize?: string; search?: string; status?: string; category?: string } }>, reply) => {
      if (!requirePermission(req, reply, PERMISSION_SETTINGS_READ)) return;
      const parse = ListQuerySchema.safeParse({
        page: req.query.page,
        pageSize: req.query.pageSize,
        search: req.query.search,
        status: req.query.status,
        category: req.query.category,
      });
      if (!parse.success) {
        return reply.status(400).send({ success: false, error: "Invalid query", details: parse.error.flatten() });
      }
      const result = await listSentTemplates(parse.data);
      if (!result.ok) {
        return reply.status(503).send({ success: false, error: result.error });
      }
      return successEnvelope(reply, {
        items: result.items,
        totalCount: result.totalCount,
        page: result.page,
        pageSize: result.pageSize,
        totalPages: result.totalPages,
      });
    }
  );

  /** GET /api/admin/sent/templates/:id — get one template by id. */
  app.get("/api/admin/sent/templates/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    if (!requirePermission(req, reply, PERMISSION_SETTINGS_READ)) return;
    const result = await getSentTemplateById(req.params.id);
    if (!result.ok) {
      return reply.status(result.error.includes("not configured") ? 503 : 404).send({ success: false, error: result.error });
    }
    return successEnvelope(reply, result.template);
  });

  /** POST /api/admin/sent/templates — create a template (body: Sent create payload or our JSON file shape). */
  app.post<{ Body: unknown }>("/api/admin/sent/templates", async (req: FastifyRequest<{ Body: unknown }>, reply) => {
    if (!requirePermission(req, reply, PERMISSION_SETTINGS_WRITE)) return;
    const parse = CreateBodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ success: false, error: "Validation failed", details: parse.error.flatten() });
    }
    const body = parse.data;
    const payload: CreateTemplatePayload = {
      category: body.category ?? undefined,
      language: body.language ?? undefined,
      definition: body.definition as SentTemplateDefinition,
      submitForReview: body.submitForReview,
    };
    const result = await createSentTemplate(payload);
    if (!result.ok) {
      return reply.status(503).send({ success: false, error: result.error });
    }
    return successEnvelope(reply, result.template, 201);
  });

  /** DELETE /api/admin/sent/templates/:id — delete a template. */
  app.delete("/api/admin/sent/templates/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    if (!requirePermission(req, reply, PERMISSION_SETTINGS_WRITE)) return;
    const result = await deleteSentTemplate(req.params.id);
    if (!result.ok) {
      return reply.status(result.error.includes("not configured") ? 503 : 400).send({ success: false, error: result.error });
    }
    return successEnvelope(reply, { deleted: true });
  });
}
