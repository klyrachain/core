import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { errorEnvelope, successEnvelope } from "../../lib/api-helpers.js";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import { PERMISSION_CONNECT_TRANSACTIONS } from "../../lib/permissions.js";
import { sendEmail } from "../../services/email.service.js";
import { sendMessageToPhone } from "../../services/sent.service.js";
import { getEnv } from "../../config/env.js";
import {
  paymentLinkDispatchRecipientHtml,
  paymentLinkDispatchRecipientSubject,
  paymentLinkDispatchRecipientText,
  paymentLinkDispatchSenderHtml,
  paymentLinkDispatchSenderSubject,
  paymentLinkDispatchSenderText,
} from "../../email/templates/payment-link-dispatch.js";

const DispatchBodySchema = z.object({
  channel: z.enum(["EMAIL", "SMS"]),
  destination: z.string().min(3),
  link_url: z.string().min(8),
  amount: z.string().optional(),
  token_symbol: z.string().optional(),
  chain_id: z.string().optional(),
  receive_mode: z.enum(["CRYPTO", "FIAT"]).optional(),
  notify_sender_email: z.string().email().optional(),
  country_name: z.string().optional(),
});

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

export async function paymentLinkDispatchApiRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: unknown }>("/api/payment-link-dispatch", async (req: FastifyRequest<{ Body: unknown }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS, { allowMerchant: true })) return;
      const parse = DispatchBodySchema.safeParse(req.body);
      if (!parse.success) {
        return reply.status(400).send({ success: false, error: "Validation failed", details: parse.error.flatten() });
      }
      const {
        channel,
        destination,
        link_url,
        amount,
        token_symbol,
        chain_id,
        receive_mode,
        notify_sender_email,
        country_name,
      } = parse.data;
      const dest = destination.trim();
      if (channel === "EMAIL" && !isEmail(dest)) {
        return errorEnvelope(reply, "Invalid email address.", 400);
      }

      const amountStr = amount ?? "";
      const currencyOrToken = token_symbol ?? "";
      const mode = receive_mode ?? "CRYPTO";
      const entityBase = `dispatch_${Date.now()}`;

      let sendOk = false;
      let sendError: string | undefined;

      if (channel === "EMAIL") {
        const r = await sendEmail({
          to: dest,
          subject: paymentLinkDispatchRecipientSubject({
            linkUrl: link_url,
            amount: amountStr,
            currencyOrToken,
            receiveMode: mode,
            countryName: country_name,
          }),
          html: paymentLinkDispatchRecipientHtml({
            linkUrl: link_url,
            amount: amountStr,
            currencyOrToken,
            receiveMode: mode,
            countryName: country_name,
          }),
          text: paymentLinkDispatchRecipientText({
            linkUrl: link_url,
            amount: amountStr,
            currencyOrToken,
            receiveMode: mode,
            countryName: country_name,
          }),
          entityRefId: `${entityBase}_recipient`,
        });
        sendOk = r.ok;
        sendError = r.ok ? undefined : r.error;

        if (sendOk && notify_sender_email?.trim()) {
          const sender = notify_sender_email.trim();
          if (isEmail(sender)) {
            await sendEmail({
              to: sender,
              subject: paymentLinkDispatchSenderSubject({
                destination: dest,
                linkUrl: link_url,
                amount: amountStr,
                currencyOrToken,
                receiveMode: mode,
              }),
              html: paymentLinkDispatchSenderHtml({
                destination: dest,
                linkUrl: link_url,
                amount: amountStr,
                currencyOrToken,
                receiveMode: mode,
              }),
              text: paymentLinkDispatchSenderText({
                destination: dest,
                linkUrl: link_url,
                amount: amountStr,
                currencyOrToken,
                receiveMode: mode,
              }),
              entityRefId: `${entityBase}_sender`,
            });
          }
        }
      } else {
        const templateId = getEnv().SENT_DM_TEMPLATE_PAYMENT_REQUEST;
        if (!templateId) {
          sendError = "SMS template not configured (SENT_DM_TEMPLATE_PAYMENT_REQUEST)";
        } else {
          const r = await sendMessageToPhone({
            phoneNumber: dest,
            templateId,
            templateVariables: {
              link: link_url,
              amount: amount ?? "",
              currency: token_symbol ?? "",
              receiveSummary: `${amount ?? ""} ${token_symbol ?? ""}`.trim(),
            },
          });
          sendOk = r.ok;
          sendError = r.ok ? undefined : r.error;
        }

        if (sendOk && notify_sender_email?.trim() && isEmail(notify_sender_email.trim())) {
          await sendEmail({
            to: notify_sender_email.trim(),
            subject: paymentLinkDispatchSenderSubject({
              destination: dest,
              linkUrl: link_url,
              amount: amountStr,
              currencyOrToken,
              receiveMode: mode,
            }),
            html: paymentLinkDispatchSenderHtml({
              destination: dest,
              linkUrl: link_url,
              amount: amountStr,
              currencyOrToken,
              receiveMode: mode,
            }),
            text: paymentLinkDispatchSenderText({
              destination: dest,
              linkUrl: link_url,
              amount: amountStr,
              currencyOrToken,
              receiveMode: mode,
            }),
            entityRefId: `${entityBase}_sender`,
          });
        }
      }

      await prisma.paymentLinkDispatch.create({
        data: {
          channel,
          destination: dest,
          linkUrl: link_url,
          amount: amount ?? null,
          tokenSymbol: token_symbol ?? null,
          chainId: chain_id ?? null,
          receiveMode: mode,
        },
      });

      if (!sendOk) {
        return reply.status(502).send({
          success: false,
          error: sendError ?? "Dispatch failed",
          persisted: true,
        });
      }

      return successEnvelope(reply, { sent: true, channel });
    } catch (err) {
      req.log.error({ err }, "POST /api/payment-link-dispatch");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });
}
