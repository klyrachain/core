/**
 * After a custodial SELL (pool) deposit from Pay, email the payer (claim code to share)
 * and the beneficiary (OTP + claim link) using platform notification templates.
 * Payload is stored in Redis for a future redeem API.
 */

import { prisma } from "../lib/prisma.js";
import { generateClaimCode, generateClaimLinkId, generateClaimOtp } from "../utils/claim-code.js";
import {
  getCustodialSendPayload,
  setCustodialSendPayload,
  setCustodialClaimLinkIndex,
} from "../lib/redis.js";
import { normalizeNotificationChannels } from "../lib/notification.types.js";
import {
  buildClaimLinkByClaimLinkId,
  sendClaimNotification,
  sendRequestPaymentReceivedToPayer,
} from "./notification.service.js";

export async function notifyCustodialSellAfterDeposit(
  transactionId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = transactionId.trim();
  if (!id) return { ok: false, error: "transaction_id is required" };

  const existing = await getCustodialSendPayload(id);
  if (existing) return { ok: true };

  const tx = await prisma.transaction.findUnique({
    where: { id },
    select: {
      id: true,
      type: true,
      toIdentifier: true,
      toType: true,
      fromIdentifier: true,
      f_amount: true,
      f_token: true,
      f_chain: true,
    },
  });
  if (!tx || tx.type !== "SELL") {
    return { ok: false, error: "Transaction not found or not a custodial send" };
  }
  if (tx.toType !== "EMAIL" && tx.toType !== "NUMBER") {
    return { ok: false, error: "No email or phone beneficiary on this transaction" };
  }

  const payerEmail = (tx.fromIdentifier ?? "").trim();
  if (!payerEmail.includes("@")) {
    return { ok: false, error: "Payer email is missing on this transaction" };
  }

  const beneficiary = (tx.toIdentifier ?? "").trim();
  if (!beneficiary) return { ok: false, error: "Beneficiary is missing" };

  const claimCode = generateClaimCode();
  const otp = generateClaimOtp();
  const claimLinkId = generateClaimLinkId();
  const amount = tx.f_amount.toString();
  const token = tx.f_token;
  const claimLinkUrl = buildClaimLinkByClaimLinkId(claimLinkId);

  const payerResult = await sendRequestPaymentReceivedToPayer(
    payerEmail,
    {
      payerIdentifier: payerEmail,
      requesterIdentifier: "your recipient",
      amount,
      currency: token,
      claimShareCode: claimCode,
    },
    id
  );
  if (!payerResult.ok) return { ok: false, error: payerResult.error ?? "Could not email payer" };

  if (tx.toType === "EMAIL") {
    const channels = normalizeNotificationChannels(["EMAIL"]);
    const results = await sendClaimNotification({
      channels,
      toEmail: beneficiary,
      entityRefId: id,
      templateVars: {
        receiverIdentifier: beneficiary,
        amount,
        currency: token,
        claimCode,
        otp,
        claimLinkUrl,
      },
    });
    const emailRes = results.email;
    if (!emailRes || emailRes.ok !== true) {
      const err = emailRes && emailRes.ok === false ? emailRes.error : "Could not email recipient";
      return { ok: false, error: err };
    }
  }

  await setCustodialSendPayload(
    id,
    JSON.stringify({
      claimCode,
      otp,
      beneficiary,
      payerEmail,
      amount,
      token,
      chain: tx.f_chain,
      claimLinkId,
    })
  );
  await setCustodialClaimLinkIndex(claimLinkId, id);

  return { ok: true };
}
