import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "../../lib/prisma.js";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";
import { paymentLinkAmountIsOpen } from "../../lib/payment-link-amount-open.js";
import { signGasReportToken } from "../../lib/gas-report-token.js";
import { buildGasPolicyPublic } from "../../services/gas-policy.service.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function commercePublicPayload(row: {
  id: string;
  businessId: string;
  title: string;
  description: string | null;
  slug: string;
  publicCode: string;
  amount: Decimal | null;
  currency: string;
  chargeKind: string;
  gasSponsorshipEnabled: boolean;
  isOneTime: boolean;
  paidAt: Date | null;
  paidByWalletAddress: string | null;
  business: { name: string };
}, connectedWallet: string | null) {
  const amt = row.amount;
  const open = paymentLinkAmountIsOpen(amt);

  const paidByWallet = row.paidByWalletAddress?.trim().toLowerCase() ?? "";
  const visitorWallet = connectedWallet?.trim().toLowerCase() ?? "";
  return {
    id: row.id,
    businessId: row.businessId,
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
    gasSponsorshipEnabled: row.gasSponsorshipEnabled,
    isOneTime: row.isOneTime,
    isPaid: row.paidAt != null,
    paidAt: row.paidAt?.toISOString() ?? null,
    alreadyPaidVerifiedByConnectedWallet:
      row.isOneTime &&
      row.paidAt != null &&
      paidByWallet.length > 0 &&
      visitorWallet.length > 0 &&
      paidByWallet === visitorWallet,
  };
}

async function commercePublicPayloadWithGas(
  row: Parameters<typeof commercePublicPayload>[0],
  connectedWallet: string | null
) {
  const base = commercePublicPayload(row, connectedWallet);
  const gasPolicy = await buildGasPolicyPublic(row.businessId);
  const linkGasEnabled = base.chargeKind === "CRYPTO" && base.gasSponsorshipEnabled === true;
  const gasPolicyWithLink = {
    ...gasPolicy,
    linkSponsorshipEnabled: linkGasEnabled,
    effectiveSponsorship: gasPolicy.effectiveSponsorship && linkGasEnabled,
  };
  const gasReportToken = signGasReportToken({
    paymentLinkId: row.id,
    businessId: row.businessId,
    exp: Math.floor(Date.now() / 1000) + 15 * 60,
  });
  return { ...base, gasPolicy: gasPolicyWithLink, gasReportToken };
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

        const wallet = (req.query as { wallet?: string } | undefined)?.wallet ?? null;
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

        const data = await commercePublicPayloadWithGas(row, wallet);
        return successEnvelope(reply, data);
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

        const wallet = (req.query as { wallet?: string } | undefined)?.wallet ?? null;
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

        const data = await commercePublicPayloadWithGas(row, wallet);
        return successEnvelope(reply, data);
      } catch (err) {
        req.log.error({ err }, "GET /api/public/payment-links/:slug");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );
}
