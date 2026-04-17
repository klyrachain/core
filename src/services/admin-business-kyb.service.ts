/**
 * Platform admin: list / reset / override KYB on `Business` (DB only; no Didit API calls).
 */

import { KybStatus } from "../../prisma/generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";

export type AdminKybBusinessRow = {
  id: string;
  name: string;
  slug: string;
  kybStatus: string;
  kybDiditSessionId: string | null;
  updatedAt: string;
};

export async function listAdminKybBusinesses(
  q: string | undefined,
  limit: number
): Promise<AdminKybBusinessRow[]> {
  const take = Math.min(Math.max(limit, 1), 200);
  const search = q?.trim();
  const where =
    search && search.length > 0
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { slug: { contains: search, mode: "insensitive" as const } },
            { legalName: { contains: search, mode: "insensitive" as const } },
            { supportEmail: { contains: search, mode: "insensitive" as const } },
            { id: search },
          ],
        }
      : undefined;

  const rows = await prisma.business.findMany({
    where,
    take,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      slug: true,
      kybStatus: true,
      kybDiditSessionId: true,
      updatedAt: true,
    },
  });

  return rows.map((b) => ({
    id: b.id,
    name: b.name,
    slug: b.slug,
    kybStatus: b.kybStatus,
    kybDiditSessionId: b.kybDiditSessionId,
    updatedAt: b.updatedAt.toISOString(),
  }));
}

/** Clear Didit session id and status so the business can restart KYB in-app. */
export async function resetBusinessKyb(
  businessIdRaw: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = businessIdRaw.trim();
  if (!id) return { ok: false, error: "Missing id" };

  const exists = await prisma.business.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return { ok: false, error: "Business not found" };

  await prisma.business.update({
    where: { id },
    data: {
      kybDiditSessionId: null,
      kybStatus: KybStatus.NOT_STARTED,
    },
  });
  return { ok: true };
}

/** Set KYB outcome in our DB only. */
export async function overrideBusinessKyb(
  businessIdRaw: string,
  status: "approved" | "declined"
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = businessIdRaw.trim();
  if (!id) return { ok: false, error: "Missing id" };

  const kybStatus = status === "approved" ? KybStatus.APPROVED : KybStatus.REJECTED;

  try {
    await prisma.business.update({
      where: { id },
      data: { kybStatus },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "Business not found" };
  }
}
