import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { PaymentProvider, IdentityType, TransactionType } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { addPollJob } from "../../lib/queue.js";

const OrderWebhookSchema = z.object({
  action: z.enum(["buy", "sell", "request", "claim"]),
  fromIdentifier: z.string().optional().nullable(),
  fromType: z.nativeEnum(IdentityType).optional().nullable(),
  fromUserId: z.string().uuid().optional().nullable(),
  toIdentifier: z.string().optional().nullable(),
  toType: z.nativeEnum(IdentityType).optional().nullable(),
  toUserId: z.string().uuid().optional().nullable(),
  f_amount: z.coerce.number().positive(),
  t_amount: z.coerce.number().positive(),
  f_price: z.coerce.number().nonnegative(),
  t_price: z.coerce.number().nonnegative(),
  f_token: z.string().min(1),
  t_token: z.string().min(1),
  f_provider: z.nativeEnum(PaymentProvider).optional().default(PaymentProvider.NONE),
  t_provider: z.nativeEnum(PaymentProvider).optional().default(PaymentProvider.NONE),
  requestId: z.string().uuid().optional().nullable(),
});

type OrderWebhookBody = z.infer<typeof OrderWebhookSchema>;

const actionToType: Record<OrderWebhookBody["action"], TransactionType> = {
  buy: TransactionType.BUY,
  sell: TransactionType.SELL,
  request: TransactionType.REQUEST,
  claim: TransactionType.CLAIM,
};

export async function orderWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: unknown }>("/webhook/order", async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
    const parse = OrderWebhookSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({
        success: false,
        error: "Validation failed",
        details: parse.error.flatten(),
      });
    }

    const body = parse.data;
    const type = actionToType[body.action];

    try {
      const transaction = await prisma.transaction.create({
        data: {
          type,
          status: "PENDING",
          fromIdentifier: body.fromIdentifier ?? null,
          fromType: body.fromType ?? null,
          fromUserId: body.fromUserId ?? null,
          toIdentifier: body.toIdentifier ?? null,
          toType: body.toType ?? null,
          toUserId: body.toUserId ?? null,
          f_amount: body.f_amount,
          t_amount: body.t_amount,
          f_price: body.f_price,
          t_price: body.t_price,
          f_token: body.f_token,
          t_token: body.t_token,
          f_provider: body.f_provider,
          t_provider: body.t_provider,
          requestId: body.requestId ?? null,
        },
      });

      await addPollJob(transaction.id);

      return reply.status(201).send({
        success: true,
        data: {
          id: transaction.id,
          status: transaction.status,
          type: transaction.type,
        },
      });
    } catch (err) {
      req.log.error({ err }, "Webhook order create failed");
      return reply.status(500).send({
        success: false,
        error: "Something went wrong.",
      });
    }
  });
}
