/**
 * KYB is typically completed by the first active member of a business (founding signup),
 * while other members complete person KYC (DIDIT_WORKFLOW_ID) before full access.
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
