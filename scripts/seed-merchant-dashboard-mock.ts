/**
 * Idempotent mock data for merchant dashboard (transactions, payouts, sample customers).
 *
 * Targets an existing business + owner user. Re-run safe: removes prior rows tagged with this seed.
 *
 * Usage:
 *   pnpm seed:merchant-dashboard-mock
 *
 * Override via env:
 *   MERCHANT_MOCK_BUSINESS_ID=...
 *   MERCHANT_MOCK_OWNER_USER_ID=...
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../prisma/generated/prisma/client.js";

const SEED_TAG = "kalcorp-dashboard-mock-v1";
const PAYOUT_REF_PREFIX = "MOCK_DASH_";

const DEFAULT_BUSINESS_ID = "b963e7ff-9cf3-4ffc-b479-fbdd185da698";
const DEFAULT_OWNER_USER_ID = "d6b5c016-dcb3-44b9-a189-ba1191de0a12";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "";
if (!connectionString) {
  console.error("Set DATABASE_URL or DIRECT_URL");
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

async function main(): Promise<void> {
  const businessId =
    process.env.MERCHANT_MOCK_BUSINESS_ID?.trim() || DEFAULT_BUSINESS_ID;
  const ownerUserId =
    process.env.MERCHANT_MOCK_OWNER_USER_ID?.trim() || DEFAULT_OWNER_USER_ID;

  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) {
    console.error(`Business not found: ${businessId}`);
    process.exit(1);
  }

  const owner = await prisma.user.findUnique({ where: { id: ownerUserId } });
  if (!owner) {
    console.error(`User not found: ${ownerUserId}`);
    process.exit(1);
  }

  await prisma.businessMember.upsert({
    where: {
      userId_businessId: { userId: ownerUserId, businessId },
    },
    create: {
      userId: ownerUserId,
      businessId,
      role: "OWNER",
      isActive: true,
    },
    update: { isActive: true },
  });
  console.log("BusinessMember OK for owner ↔ business");

  await prisma.payout.deleteMany({
    where: {
      businessId,
      reference: { startsWith: PAYOUT_REF_PREFIX },
    },
  });

  const methods = await prisma.payoutMethod.findMany({ where: { businessId } });
  for (const m of methods) {
    const d = m.details as { dashboardMockPayoutMethod?: string };
    if (d?.dashboardMockPayoutMethod === SEED_TAG) {
      await prisma.payoutMethod.delete({ where: { id: m.id } });
    }
  }

  const tagged = await prisma.transaction.findMany({
    where: { businessId },
    select: { id: true, settlementQuoteSnapshot: true },
  });
  const mockTxIds = tagged
    .filter(
      (t) =>
        t.settlementQuoteSnapshot &&
        typeof t.settlementQuoteSnapshot === "object" &&
        !Array.isArray(t.settlementQuoteSnapshot) &&
        (t.settlementQuoteSnapshot as { seedTag?: string }).seedTag === SEED_TAG
    )
    .map((t) => t.id);
  if (mockTxIds.length > 0) {
    await prisma.transaction.deleteMany({ where: { id: { in: mockTxIds } } });
    console.log(`Removed ${mockTxIds.length} previous mock transaction(s)`);
  }

  const customers = await Promise.all([
    prisma.user.upsert({
      where: { email: "dashboard-mock-customer1@example.invalid" },
      create: {
        email: "dashboard-mock-customer1@example.invalid",
        username: "mock_customer_1",
      },
      update: {},
    }),
    prisma.user.upsert({
      where: { email: "dashboard-mock-customer2@example.invalid" },
      create: {
        email: "dashboard-mock-customer2@example.invalid",
        username: "mock_customer_2",
      },
      update: {},
    }),
    prisma.user.upsert({
      where: { email: "dashboard-mock-customer3@example.invalid" },
      create: {
        email: "dashboard-mock-customer3@example.invalid",
        username: "mock_customer_3",
      },
      update: {},
    }),
  ]);

  const snap = { seedTag: SEED_TAG };

  type TxRow = {
    createdAt: Date;
    type: "BUY" | "SELL" | "REQUEST" | "TRANSFER";
    status: "COMPLETED" | "PENDING" | "FAILED";
    f_amount: string;
    t_amount: string;
    f_chain: string;
    t_chain: string;
    f_token: string;
    t_token: string;
    fromUserId: string;
    toUserId: string | null;
    f_tokenPriceUsd: string;
    t_tokenPriceUsd: string;
    fee: string | null;
    merchantFee: string | null;
    platformFee: string | null;
  };

  const rows: TxRow[] = [
    {
      createdAt: daysAgo(1),
      type: "BUY",
      status: "COMPLETED",
      f_amount: "100.00",
      t_amount: "0.031",
      f_chain: "BASE",
      t_chain: "BASE",
      f_token: "USDC",
      t_token: "ETH",
      fromUserId: customers[0].id,
      toUserId: ownerUserId,
      f_tokenPriceUsd: "1",
      t_tokenPriceUsd: "3200",
      fee: "2.50",
      merchantFee: "1.00",
      platformFee: "1.50",
    },
    {
      createdAt: daysAgo(3),
      type: "REQUEST",
      status: "COMPLETED",
      f_amount: "250.00",
      t_amount: "250.00",
      f_chain: "BASE",
      t_chain: "BASE",
      f_token: "USDC",
      t_token: "USDC",
      fromUserId: customers[1].id,
      toUserId: ownerUserId,
      f_tokenPriceUsd: "1",
      t_tokenPriceUsd: "1",
      fee: "5.00",
      merchantFee: "2.00",
      platformFee: "3.00",
    },
    {
      createdAt: daysAgo(5),
      type: "BUY",
      status: "COMPLETED",
      f_amount: "50.00",
      t_amount: "50.00",
      f_chain: "BASE",
      t_chain: "BASE",
      f_token: "USDC",
      t_token: "USDC",
      fromUserId: customers[2].id,
      toUserId: ownerUserId,
      f_tokenPriceUsd: "1",
      t_tokenPriceUsd: "1",
      fee: "1.00",
      merchantFee: "0.40",
      platformFee: "0.60",
    },
    {
      createdAt: daysAgo(7),
      type: "TRANSFER",
      status: "PENDING",
      f_amount: "75.50",
      t_amount: "75.50",
      f_chain: "ETHEREUM",
      t_chain: "ETHEREUM",
      f_token: "USDC",
      t_token: "USDC",
      fromUserId: customers[0].id,
      toUserId: ownerUserId,
      f_tokenPriceUsd: "1",
      t_tokenPriceUsd: "1",
      fee: null,
      merchantFee: null,
      platformFee: null,
    },
    {
      createdAt: daysAgo(10),
      type: "BUY",
      status: "FAILED",
      f_amount: "200.00",
      t_amount: "0",
      f_chain: "BASE",
      t_chain: "BASE",
      f_token: "USDC",
      t_token: "ETH",
      fromUserId: customers[1].id,
      toUserId: ownerUserId,
      f_tokenPriceUsd: "1",
      t_tokenPriceUsd: "3100",
      fee: null,
      merchantFee: null,
      platformFee: null,
    },
    {
      createdAt: daysAgo(14),
      type: "SELL",
      status: "COMPLETED",
      f_amount: "0.5",
      t_amount: "1550.00",
      f_chain: "BASE",
      t_chain: "BASE",
      f_token: "ETH",
      t_token: "USDC",
      fromUserId: ownerUserId,
      toUserId: customers[2].id,
      f_tokenPriceUsd: "3100",
      t_tokenPriceUsd: "1",
      fee: "8.00",
      merchantFee: "3.00",
      platformFee: "5.00",
    },
    {
      createdAt: daysAgo(21),
      type: "REQUEST",
      status: "COMPLETED",
      f_amount: "1200.00",
      t_amount: "1200.00",
      f_chain: "BASE",
      t_chain: "BASE",
      f_token: "USDC",
      t_token: "USDC",
      fromUserId: customers[0].id,
      toUserId: ownerUserId,
      f_tokenPriceUsd: "1",
      t_tokenPriceUsd: "1",
      fee: "18.00",
      merchantFee: "7.00",
      platformFee: "11.00",
    },
    {
      createdAt: daysAgo(28),
      type: "BUY",
      status: "COMPLETED",
      f_amount: "89.99",
      t_amount: "89.99",
      f_chain: "BASE",
      t_chain: "BASE",
      f_token: "USDC",
      t_token: "USDC",
      fromUserId: customers[1].id,
      toUserId: ownerUserId,
      f_tokenPriceUsd: "1",
      t_tokenPriceUsd: "1",
      fee: "1.35",
      merchantFee: "0.50",
      platformFee: "0.85",
    },
  ];

  for (const r of rows) {
    await prisma.transaction.create({
      data: {
        createdAt: r.createdAt,
        type: r.type,
        status: r.status,
        fromIdentifier: null,
        fromType: "EMAIL",
        fromUserId: r.fromUserId,
        toIdentifier: null,
        toType: r.toUserId ? "EMAIL" : null,
        toUserId: r.toUserId,
        f_amount: r.f_amount,
        t_amount: r.t_amount,
        f_chain: r.f_chain,
        t_chain: r.t_chain,
        f_token: r.f_token,
        t_token: r.t_token,
        f_provider: "NONE",
        t_provider: "NONE",
        businessId,
        f_tokenPriceUsd: r.f_tokenPriceUsd,
        t_tokenPriceUsd: r.t_tokenPriceUsd,
        fee: r.fee,
        merchantFee: r.merchantFee,
        platformFee: r.platformFee,
        settlementQuoteSnapshot: snap,
      },
    });
  }
  console.log(`Inserted ${rows.length} mock transactions for ${business.slug}`);

  const payoutMethod = await prisma.payoutMethod.create({
    data: {
      businessId,
      type: "BANK_ACCOUNT",
      currency: "USD",
      details: {
        dashboardMockPayoutMethod: SEED_TAG,
        label: "Demo settlement account (mock)",
        accountLast4: "4242",
      },
      isPrimary: false,
      isActive: true,
    },
  });

  const payouts = [
    {
      amount: "4200.00",
      fee: "12.50",
      currency: "USD",
      status: "PAID" as const,
      reference: `${PAYOUT_REF_PREFIX}PAID_1`,
      createdAt: daysAgo(4),
    },
    {
      amount: "3100.00",
      fee: "10.00",
      currency: "USD",
      status: "PROCESSING" as const,
      reference: `${PAYOUT_REF_PREFIX}PROC_1`,
      createdAt: daysAgo(1),
    },
    {
      amount: "890.00",
      fee: "3.00",
      currency: "USD",
      status: "SCHEDULED" as const,
      reference: `${PAYOUT_REF_PREFIX}SCHED_1`,
      createdAt: new Date(),
    },
  ];

  for (const p of payouts) {
    await prisma.payout.create({
      data: {
        businessId,
        methodId: payoutMethod.id,
        amount: p.amount,
        fee: p.fee,
        currency: p.currency,
        status: p.status,
        reference: p.reference,
        createdAt: p.createdAt,
      },
    });
  }
  console.log(`Inserted ${payouts.length} mock payouts (settlements)`);

  console.log("\nDone. Dashboard: Bearer + X-Business-Id =", businessId);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
