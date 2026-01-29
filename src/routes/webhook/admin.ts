import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { sendToAdminDashboard } from "../../services/admin-dashboard.service.js";
import { errorEnvelope } from "../../lib/api-helpers.js";

const AdminWebhookSchema = z.object({
  event: z.string().min(1),
  data: z.record(z.unknown()).default({}),
});

export async function adminWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: unknown }>("/webhook/admin", async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
    const parse = AdminWebhookSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({
        success: false,
        error: "Validation failed",
        details: parse.error.flatten(),
      });
    }
    try {
      await sendToAdminDashboard({
        event: parse.data.event,
        data: parse.data.data as Record<string, unknown>,
      });
      return reply.status(202).send({
        success: true,
        data: { accepted: true, event: parse.data.event },
      });
    } catch (err) {
      req.log.error({ err }, "POST /webhook/admin");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });
}
