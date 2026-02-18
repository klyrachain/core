/**
 * Request/claim notification flow: create request (notify payer), and when payment is confirmed (notify receiver + OTP).
 */

import { prisma } from "../lib/prisma.js";
import { setClaimOtp } from "../lib/redis.js";
import { normalizeNotificationChannels } from "../lib/notification.types.js";
import { sendClaimNotification, buildClaimLinkForReceiver } from "./notification.service.js";
import { generateClaimOtp } from "../utils/claim-code.js";

/** Called when payment for a REQUEST transaction is confirmed (e.g. onramp completed or transfer received). Sends claim notification to receiver and sets OTP in Redis. */
export async function onRequestPaymentConfirmed(opts: {
  transactionId: string;
}): Promise<{ ok: true; claimId: string } | { ok: false; error: string }> {
  const tx = await prisma.transaction.findUnique({
    where: { id: opts.transactionId },
    select: { id: true, type: true, status: true, requestId: true },
  });
  if (!tx || tx.type !== "REQUEST") return { ok: false, error: "Transaction not found or not a REQUEST" };
  if (tx.status !== "COMPLETED") return { ok: false, error: "Transaction not yet completed" };
  if (!tx.requestId) return { ok: false, error: "No request linked" };

  const claim = await prisma.claim.findUnique({
    where: { requestId: tx.requestId },
    include: { request: true },
  });
  if (!claim || claim.status !== "ACTIVE") return { ok: false, error: "Claim not found or not active" };

  const otp = generateClaimOtp();
  await setClaimOtp(claim.id, otp);

  const claimLinkUrl = buildClaimLinkForReceiver(claim.code);
  const amount = claim.value.toString();
  const currency = claim.token; // or map token to currency for display

  const channels = normalizeNotificationChannels(["EMAIL"]); // could be stored on Request/Claim later
  const toEmail = claim.toIdentifier.includes("@") ? claim.toIdentifier : "";
  const toPhone = claim.toIdentifier.includes("@") ? undefined : claim.toIdentifier;

  await sendClaimNotification({
    channels,
    toEmail: toEmail || "noreply@example.com", // should be required when creating request
    toPhone,
    entityRefId: claim.id,
    templateVars: {
      receiverIdentifier: claim.toIdentifier,
      amount,
      currency,
      claimCode: claim.code,
      otp,
      claimLinkUrl,
    },
  });

  return { ok: true, claimId: claim.id };
}
