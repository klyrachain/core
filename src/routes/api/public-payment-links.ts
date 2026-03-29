import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "../../lib/prisma.js";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";
import { paymentLinkAmountIsOpen } from "../../lib/payment-link-amount-open.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function commercePublicPayload(row: {
  id: string;
  title: string;
  description: string | null;
  slug: string;
  publicCode: string;
  amount: Decimal | null;
  currency: string;
  chargeKind: string;
  business: { name: string };
}) {
  const amt = row.amount;
  const open = paymentLinkAmountIsOpen(amt);

  return {
    id: row.id,
    publicCode: row.publicCode,
    title: row.title,
    amount: open ? null : amt?.toString() ?? null,
    currency: row.currency,
    businessName: row.business.name,
    slug: row.slug,
    description: row.description ?? null,
    type: open ? ("open" as const) : ("fixed" as const),
    linkKind: "commerce" as const,
    chargeKind: row.chargeKind,
  };
}

async function findActiveCommerceByLookup(lookup: string) {
  const trimmed = lookup.trim();
  if (!trimmed) return null;
  return prisma.paymentLink.findFirst({
    where: {
      isActive: true,
      OR: [{ slug: trimmed }, { publicCode: trimmed }],
    },
    include: { business: { select: { name: true } } },
  });
}

export async function publicPaymentLinksApiRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/public/payment-links/by-id/:id",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      try {
        const id = (req.params.id ?? "").trim();
        if (!id || !UUID_RE.test(id)) {
          return errorEnvelope(reply, "Invalid id.", 400);
        }

        const row = await prisma.paymentLink.findFirst({
          where: { id, isActive: true },
          include: { business: { select: { name: true } } },
        });

        if (!row) {
          return errorEnvelope(reply, "Not found.", 404);
        }

        void prisma.paymentLink
          .update({
            where: { id: row.id },
            data: { views: { increment: 1 } },
          })
          .catch(() => {});

        return successEnvelope(reply, commercePublicPayload(row));
      } catch (err) {
        req.log.error({ err }, "GET /api/public/payment-links/by-id/:id");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  app.get(
    "/api/public/payment-links/:slug",
    async (req: FastifyRequest<{ Params: { slug: string } }>, reply) => {
      try {
        const raw = (req.params.slug ?? "").trim();
        const lookup = decodeURIComponent(raw);
        if (!lookup) {
          return errorEnvelope(reply, "Invalid code.", 400);
        }

        const row = await findActiveCommerceByLookup(lookup);

        if (!row) {
          return errorEnvelope(reply, "Not found.", 404);
        }

        void prisma.paymentLink
          .update({
            where: { id: row.id },
            data: { views: { increment: 1 } },
          })
          .catch(() => {});

        return successEnvelope(reply, commercePublicPayload(row));
      } catch (err) {
        req.log.error({ err }, "GET /api/public/payment-links/:slug");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );
}
