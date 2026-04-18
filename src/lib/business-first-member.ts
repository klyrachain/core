/**
 * Business verification model (product intent):
 * - **User KYC** (`User.portalKyc*`): every member of the business completes their own person check.
 * - **KYB** (`Business.kyb*`): the **founding** member (first registrant / business creator) completes company
 *   verification **later on the dashboard** when the business is ready — not immediately chained after KYC,
 *   and not performed by platform admins on behalf of the merchant.
 *
 * `isFirstActiveMemberOfBusiness` identifies who is eligible to drive KYB for that org (earliest active join).
 */
import { prisma } from "./prisma.js";

/** True if this user is the earliest active member by `joinedAt` (eligible to run KYB for the business). */
export async function isFirstActiveMemberOfBusiness(
  userId: string,
  businessId: string
): Promise<boolean> {
  const first = await prisma.businessMember.findFirst({
    where: { businessId, isActive: true },
    orderBy: { joinedAt: "asc" },
    select: { userId: true },
  });
  return first?.userId === userId;
}
