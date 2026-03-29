import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "./generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { WalletManager } from "../src/utils/wallet-manager.js";
import { loadEnv } from "../src/config/env.js";
import { hashPassword } from "../src/services/admin-auth.service.js";
import { getKeyPrefix, hashApiKey } from "../src/services/api-key.service.js";

try {
  loadEnv();
} catch {
  // Env validation may fail; use process.env for seed
}
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "";
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

/** Real business id for kalcorp dashboard demo (products, CRM, webhooks, etc.). */
const KALCORP_BUSINESS_ID = "b963e7ff-9cf3-4ffc-b479-fbdd185da698";

function hex(byteLength: number): string {
  return Buffer.from(Array.from({ length: byteLength }, () => Math.floor(Math.random() * 256))).toString("hex");
}

/** Fixed ids + deterministic dev keys so `pnpm prisma db seed` stays idempotent. */
const KAL_SEED_API_KEY_LIVE_ID = "a1111111-1111-4111-8111-111111111101";
const KAL_SEED_API_KEY_TEST_ID = "a1111111-1111-4111-8111-111111111102";
const KAL_SEED_RAW_KEY_LIVE = "sk_live_kalcorp_seed_live_dev_only_00000000000000000000000000000000";
const KAL_SEED_RAW_KEY_TEST = "sk_live_kalcorp_seed_test_dev_only_00000000000000000000000000000000";

async function upsertKalcorpSeedApiKeys(prismaClient: PrismaClient, businessId: string): Promise<void> {
  const now = new Date();
  const domains: string[] = [];
  const permissions: string[] = [];
  await prismaClient.$executeRaw`
    DELETE FROM "ApiKey" WHERE id IN (${KAL_SEED_API_KEY_LIVE_ID}, ${KAL_SEED_API_KEY_TEST_ID})
  `;
  const insert = async (
    id: string,
    name: string,
    rawKey: string,
    environment: "TEST" | "LIVE"
  ) => {
    const keyHash = hashApiKey(rawKey);
    const keyPrefix = getKeyPrefix(rawKey);
    await prismaClient.$executeRaw`
      INSERT INTO "ApiKey" ("id", "createdAt", "updatedAt", "keyHash", "keyPrefix", "name", "domains", "permissions", "isActive", "expiresAt", "businessId", "environment")
      VALUES (${id}, ${now}, ${now}, ${keyHash}, ${keyPrefix}, ${name}, ${domains}, ${permissions}, true, ${null}, ${businessId}, ${environment})
    `;
  };
  await insert(KAL_SEED_API_KEY_LIVE_ID, "Seed — Dashboard LIVE (deterministic)", KAL_SEED_RAW_KEY_LIVE, "LIVE");
  await insert(KAL_SEED_API_KEY_TEST_ID, "Seed — Integration TEST (deterministic)", KAL_SEED_RAW_KEY_TEST, "TEST");
  console.log("  [kalcorp] API keys (dev seed, idempotent):");
  console.log(`           LIVE: ${KAL_SEED_RAW_KEY_LIVE}`);
  console.log(`           TEST: ${KAL_SEED_RAW_KEY_TEST}`);
}

type SeedUser = { id: string; email: string | null; address: string | null };

async function seedKalcorpDemoData(
  prismaClient: PrismaClient,
  kalcorpId: string,
  alice: SeedUser,
  bob: SeedUser,
  charlie: SeedUser
): Promise<void> {
  console.log("Seeding kalcorp demo (commerce, payouts, CRM, invoices, webhooks)...");
  const now = new Date();
  const issued = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const due = new Date(now.getTime() + 16 * 24 * 60 * 60 * 1000);

  await prismaClient.feeSchedule.upsert({
    where: { businessId: kalcorpId },
    create: { businessId: kalcorpId, flatFee: 0.5, percentageFee: 1.25, maxFee: 100 },
    update: {},
  });

  const kalPmUsd = await prismaClient.payoutMethod.upsert({
    where: { id: "b1000001-0000-4000-8000-000000000001" },
    create: {
      id: "b1000001-0000-4000-8000-000000000001",
      businessId: kalcorpId,
      type: "BANK_ACCOUNT",
      currency: "USD",
      details: { accountName: "Kalcorp Ltd", accountNumber: "****7788", bankCode: "058", bankName: "GTBank" },
      isPrimary: true,
      isActive: true,
    },
    update: {},
  });

  const kalPmCrypto = await prismaClient.payoutMethod.upsert({
    where: { id: "b1000002-0000-4000-8000-000000000001" },
    create: {
      id: "b1000002-0000-4000-8000-000000000001",
      businessId: kalcorpId,
      type: "CRYPTO_WALLET",
      currency: "USDC",
      details: { chain: "BASE", walletAddress: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0" },
      isPrimary: false,
      isActive: true,
    },
    update: {},
  });

  const prodLive1 = await prismaClient.product.upsert({
    where: { id: "f1a00001-0000-4000-8000-000000000001" },
    create: {
      id: "f1a00001-0000-4000-8000-000000000001",
      businessId: kalcorpId,
      environment: "LIVE",
      name: "API Integration Course",
      description: "Self-paced course: REST webhooks, idempotency, and test vs live keys. Includes certificate.",
      type: "DIGITAL",
      price: new Prisma.Decimal("149.0"),
      currency: "USD",
      imageUrl: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=800&q=80",
      isActive: true,
      isArchived: false,
    },
    update: {},
  });

  const prodLive2 = await prismaClient.product.upsert({
    where: { id: "f1a00002-0000-4000-8000-000000000001" },
    create: {
      id: "f1a00002-0000-4000-8000-000000000001",
      businessId: kalcorpId,
      environment: "LIVE",
      name: "Enterprise Support — Quarterly",
      description: "Dedicated Slack channel, SLA-backed responses, and quarterly architecture reviews.",
      type: "SERVICE",
      price: new Prisma.Decimal("4999.0"),
      currency: "USD",
      imageUrl: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&q=80",
      isActive: true,
      isArchived: false,
    },
    update: {},
  });

  const prodLive3 = await prismaClient.product.upsert({
    where: { id: "f1a00003-0000-4000-8000-000000000001" },
    create: {
      id: "f1a00003-0000-4000-8000-000000000001",
      businessId: kalcorpId,
      environment: "LIVE",
      name: "Hardware Wallet — Batch 2",
      description: "Cold storage device with USB-C. Ships within 5 business days.",
      type: "PHYSICAL",
      price: new Prisma.Decimal("89.0"),
      currency: "USD",
      imageUrl: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80",
      isActive: true,
      isArchived: false,
    },
    update: {},
  });

  const prodLive4 = await prismaClient.product.upsert({
    where: { id: "f1a00004-0000-4000-8000-000000000001" },
    create: {
      id: "f1a00004-0000-4000-8000-000000000001",
      businessId: kalcorpId,
      environment: "LIVE",
      name: "Starter Template Pack",
      description: "Next.js dashboard + Morapay merchant SDK examples (TypeScript).",
      type: "DIGITAL",
      price: new Prisma.Decimal("29.0"),
      currency: "USD",
      imageUrl: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=800&q=80",
      isActive: true,
      isArchived: false,
    },
    update: {},
  });

  await prismaClient.product.upsert({
    where: { id: "f1b00001-0000-4000-8000-000000000001" },
    create: {
      id: "f1b00001-0000-4000-8000-000000000001",
      businessId: kalcorpId,
      environment: "TEST",
      name: "[TEST] Sandbox Widget",
      description: "Fake product for test-mode checkout flows.",
      type: "DIGITAL",
      price: new Prisma.Decimal("1.0"),
      currency: "USD",
      imageUrl: "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=800&q=80",
      isActive: true,
      isArchived: false,
    },
    update: {},
  });

  await prismaClient.product.upsert({
    where: { id: "f1b00002-0000-4000-8000-000000000001" },
    create: {
      id: "f1b00002-0000-4000-8000-000000000001",
      businessId: kalcorpId,
      environment: "TEST",
      name: "[TEST] Fake subscription",
      description: "Use with test API keys only.",
      type: "SERVICE",
      price: new Prisma.Decimal("10.0"),
      currency: "USD",
      imageUrl: "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=800&q=80",
      isActive: true,
      isArchived: false,
    },
    update: {},
  });

  const payLive1 = await prismaClient.paymentLink.upsert({
    where: { slug: "kalcorp-live-api-course" },
    create: {
      id: "e1a00001-0000-4000-8000-000000000001",
      businessId: kalcorpId,
      environment: "LIVE",
      title: "Pay — API Course",
      description: "Checkout for API Integration Course",
      slug: "kalcorp-live-api-course",
      publicCode: "seed0001pay1",
      type: "PRODUCT",
      productId: prodLive1.id,
      amount: new Prisma.Decimal("149.0"),
      currency: "USD",
      isActive: true,
      views: 128,
    },
    update: { publicCode: "seed0001pay1" },
  });

  const payLive2 = await prismaClient.paymentLink.upsert({
    where: { slug: "kalcorp-live-enterprise" },
    create: {
      id: "e1a00002-0000-4000-8000-000000000001",
      businessId: kalcorpId,
      environment: "LIVE",
      title: "Enterprise support checkout",
      slug: "kalcorp-live-enterprise",
      publicCode: "seed0002pay2",
      type: "PRODUCT",
      productId: prodLive2.id,
      amount: new Prisma.Decimal("4999.0"),
      currency: "USD",
      isActive: true,
      views: 42,
    },
    update: { publicCode: "seed0002pay2" },
  });

  await prismaClient.paymentLink.upsert({
    where: { slug: "kalcorp-live-donation" },
    create: {
      id: "e1a00003-0000-4000-8000-000000000001",
      businessId: kalcorpId,
      environment: "LIVE",
      title: "Support kalcorp",
      description: "Open amount donation",
      slug: "kalcorp-live-donation",
      publicCode: "seed0003pay3",
      type: "DONATION",
      amount: null,
      currency: "USD",
      isActive: true,
      views: 256,
    },
    update: { publicCode: "seed0003pay3" },
  });

  await prismaClient.paymentLink.upsert({
    where: { slug: "kalcorp-live-starter" },
    create: {
      id: "e1a00004-0000-4000-8000-000000000001",
      businessId: kalcorpId,
      environment: "LIVE",
      title: "Starter template",
      slug: "kalcorp-live-starter",
      publicCode: "seed0004pay4",
      type: "PRODUCT",
      productId: prodLive4.id,
      amount: new Prisma.Decimal("29.0"),
      currency: "USD",
      isActive: true,
      views: 89,
    },
    update: { publicCode: "seed0004pay4" },
  });

  await prismaClient.paymentLink.upsert({
    where: { slug: "kalcorp-test-sandbox-a" },
    create: {
      id: "e1b00001-0000-4000-8000-000000000001",
      businessId: kalcorpId,
      environment: "TEST",
      title: "[TEST] Sandbox pay link A",
      slug: "kalcorp-test-sandbox-a",
      publicCode: "seed0005pay5",
      type: "STANDARD",
      amount: new Prisma.Decimal("1.0"),
      currency: "USD",
      isActive: true,
      views: 3,
    },
    update: { publicCode: "seed0005pay5" },
  });

  await prismaClient.paymentLink.upsert({
    where: { slug: "kalcorp-test-sandbox-b" },
    create: {
      id: "e1b00002-0000-4000-8000-000000000001",
      businessId: kalcorpId,
      environment: "TEST",
      title: "[TEST] Sandbox pay link B",
      slug: "kalcorp-test-sandbox-b",
      publicCode: "seed0006pay6",
      type: "PRODUCT",
      productId: "f1b00001-0000-4000-8000-000000000001",
      amount: new Prisma.Decimal("1.0"),
      currency: "USD",
      isActive: true,
      views: 1,
    },
    update: { publicCode: "seed0006pay6" },
  });

  const txKalCompleted1 = await prismaClient.transaction.upsert({
    where: { id: "k0000001-0000-4000-8000-000000000001" },
    create: {
      id: "k0000001-0000-4000-8000-000000000001",
      type: "BUY",
      status: "COMPLETED",
      businessId: kalcorpId,
      environment: "LIVE",
      paymentLinkId: payLive1.id,
      productId: prodLive1.id,
      fromUserId: alice.id,
      fromIdentifier: alice.email,
      fromType: "EMAIL",
      toIdentifier: alice.address ?? "0x1111111111111111111111111111111111111111",
      toType: "ADDRESS",
      f_amount: new Prisma.Decimal("149"),
      t_amount: new Prisma.Decimal("149"),
      exchangeRate: new Prisma.Decimal("1"),
      f_tokenPriceUsd: new Prisma.Decimal("1"),
      t_tokenPriceUsd: new Prisma.Decimal("1"),
      f_chain: "BASE",
      t_chain: "BASE",
      f_token: "USDC",
      t_token: "USDC",
      f_provider: "KLYRA",
      t_provider: "KLYRA",
      platformFee: new Prisma.Decimal("1.49"),
      merchantFee: new Prisma.Decimal("0.75"),
      fee: new Prisma.Decimal("2.24"),
      feeInUsd: new Prisma.Decimal("2.24"),
      lineItems: [
        { productId: prodLive1.id, name: prodLive1.name, qty: 1, unitPrice: 149, amount: 149 },
      ],
    },
    update: {},
  });

  await prismaClient.transaction.upsert({
    where: { id: "k0000002-0000-4000-8000-000000000001" },
    create: {
      id: "k0000002-0000-4000-8000-000000000001",
      type: "BUY",
      status: "FAILED",
      businessId: kalcorpId,
      environment: "LIVE",
      paymentLinkId: payLive2.id,
      productId: prodLive2.id,
      fromIdentifier: "payer@example.com",
      fromType: "EMAIL",
      toIdentifier: bob.email,
      toType: "EMAIL",
      f_amount: new Prisma.Decimal("4999"),
      t_amount: new Prisma.Decimal("4999"),
      f_chain: "BASE",
      t_chain: "BASE",
      f_token: "USDC",
      t_token: "USDC",
      f_provider: "PAYSTACK",
      t_provider: "KLYRA",
      f_tokenPriceUsd: new Prisma.Decimal("1"),
      t_tokenPriceUsd: new Prisma.Decimal("1"),
    },
    update: {},
  });

  await prismaClient.transaction.upsert({
    where: { id: "k0000003-0000-4000-8000-000000000001" },
    create: {
      id: "k0000003-0000-4000-8000-000000000001",
      type: "BUY",
      status: "COMPLETED",
      businessId: kalcorpId,
      environment: "LIVE",
      productId: prodLive3.id,
      fromUserId: bob.id,
      fromIdentifier: bob.email,
      fromType: "EMAIL",
      toIdentifier: bob.address ?? "",
      toType: "ADDRESS",
      f_amount: new Prisma.Decimal("89"),
      t_amount: new Prisma.Decimal("89"),
      f_chain: "BASE",
      t_chain: "BASE",
      f_token: "USDC",
      t_token: "USDC",
      f_provider: "KLYRA",
      t_provider: "KLYRA",
      f_tokenPriceUsd: new Prisma.Decimal("1"),
      t_tokenPriceUsd: new Prisma.Decimal("1"),
      platformFee: new Prisma.Decimal("0.89"),
      merchantFee: new Prisma.Decimal("0.44"),
      fee: new Prisma.Decimal("1.33"),
      feeInUsd: new Prisma.Decimal("1.33"),
    },
    update: {},
  });

  await prismaClient.transaction.upsert({
    where: { id: "k0000004-0000-4000-8000-000000000001" },
    create: {
      id: "k0000004-0000-4000-8000-000000000001",
      type: "BUY",
      status: "COMPLETED",
      businessId: kalcorpId,
      environment: "TEST",
      productId: "f1b00001-0000-4000-8000-000000000001",
      fromIdentifier: "tester@kalcorp.test",
      fromType: "EMAIL",
      toIdentifier: charlie.email,
      toType: "EMAIL",
      f_amount: new Prisma.Decimal("1"),
      t_amount: new Prisma.Decimal("1"),
      f_chain: "BASE",
      t_chain: "BASE",
      f_token: "USDC",
      t_token: "USDC",
      f_provider: "KLYRA",
      t_provider: "KLYRA",
      f_tokenPriceUsd: new Prisma.Decimal("1"),
      t_tokenPriceUsd: new Prisma.Decimal("1"),
      fee: new Prisma.Decimal("0.01"),
      feeInUsd: new Prisma.Decimal("0.01"),
    },
    update: {},
  });

  const txKalReq = await prismaClient.transaction.upsert({
    where: { id: "k0000005-0000-4000-8000-000000000001" },
    create: {
      id: "k0000005-0000-4000-8000-000000000001",
      type: "REQUEST",
      status: "PENDING",
      businessId: kalcorpId,
      environment: "LIVE",
      fromIdentifier: "invoice@client.com",
      fromType: "EMAIL",
      toIdentifier: charlie.email,
      toType: "EMAIL",
      f_amount: new Prisma.Decimal("250"),
      t_amount: new Prisma.Decimal("250"),
      f_chain: "MOMO",
      t_chain: "MOMO",
      f_token: "GHS",
      t_token: "GHS",
      f_provider: "PAYSTACK",
      t_provider: "KLYRA",
      f_tokenPriceUsd: new Prisma.Decimal("0.08"),
      t_tokenPriceUsd: new Prisma.Decimal("0.08"),
    },
    update: {},
  });

  const kalRequest = await prismaClient.request.upsert({
    where: { code: "KALREQ001" },
    create: {
      code: "KALREQ001",
      linkId: "kallink001abc",
      transactionId: txKalReq.id,
      businessId: kalcorpId,
      environment: "LIVE",
    },
    update: {},
  });

  await prismaClient.transaction.update({
    where: { id: txKalReq.id },
    data: { requestId: kalRequest.id },
  });

  await prismaClient.claim.upsert({
    where: { requestId: kalRequest.id },
    create: {
      requestId: kalRequest.id,
      status: "ACTIVE",
      value: new Prisma.Decimal("250"),
      price: new Prisma.Decimal("1"),
      token: "GHS",
      payerIdentifier: "invoice@client.com",
      toIdentifier: charlie.email ?? "",
      code: "KAL123",
    },
    update: {},
  });

  const kalWebhook = await prismaClient.webhookEndpoint.upsert({
    where: { id: "w1000001-0000-4000-8000-000000000001" },
    create: {
      id: "w1000001-0000-4000-8000-000000000001",
      businessId: kalcorpId,
      environment: "LIVE",
      url: "https://kalcorp.com/api/webhooks/klyra",
      secret: "whsec_seed_do_not_use_in_prod",
      events: ["payment.completed", "payment.failed", "payout.completed"],
      isActive: true,
    },
    update: {},
  });

  await prismaClient.webhookEndpoint.upsert({
    where: { id: "w1000002-0000-4000-8000-000000000001" },
    create: {
      id: "w1000002-0000-4000-8000-000000000001",
      businessId: kalcorpId,
      environment: "TEST",
      url: "https://staging.kalcorp.com/hooks/klyra",
      events: ["payment.completed"],
      isActive: true,
    },
    update: {},
  });

  await prismaClient.webhookDeliveryLog.upsert({
    where: { id: "w2000001-0000-4000-8000-000000000001" },
    create: {
      id: "w2000001-0000-4000-8000-000000000001",
      endpointId: kalWebhook.id,
      eventType: "payment.completed",
      payload: {
        id: txKalCompleted1.id,
        businessId: kalcorpId,
        amount: "149",
        currency: "USDC",
      },
      httpStatus: 200,
      responseBody: '{"ok":true}',
      status: "DELIVERED",
      attemptCount: 1,
      lastAttemptAt: new Date(now.getTime() - 3600_000),
      transactionId: txKalCompleted1.id,
    },
    update: {},
  });

  await prismaClient.webhookDeliveryLog.upsert({
    where: { id: "w2000002-0000-4000-8000-000000000001" },
    create: {
      id: "w2000002-0000-4000-8000-000000000001",
      endpointId: kalWebhook.id,
      eventType: "payment.failed",
      payload: { reason: "insufficient_funds" },
      httpStatus: 500,
      responseBody: "Internal Server Error",
      status: "FAILED",
      attemptCount: 3,
      lastAttemptAt: new Date(now.getTime() - 86_400_000),
    },
    update: {},
  });

  await prismaClient.refund.upsert({
    where: { id: "r1000001-0000-4000-8000-000000000001" },
    create: {
      id: "r1000001-0000-4000-8000-000000000001",
      businessId: kalcorpId,
      environment: "LIVE",
      transactionId: txKalCompleted1.id,
      amount: new Prisma.Decimal("10"),
      currency: "USDC",
      status: "PENDING",
      reason: "Customer goodwill credit — seed demo",
    },
    update: {},
  });

  const lineItemsSample = [
    { id: randomUUID(), productName: "API Integration Course", qty: 1, unitPrice: 149, amount: 149 },
  ];
  const logSample = [{ id: randomUUID(), description: "Invoice created (seed)", date: issued.toISOString() }];

  await prismaClient.invoice.upsert({
    where: { invoiceNumber: "KAL-INV-1001" },
    create: {
      businessId: kalcorpId,
      environment: "LIVE",
      invoiceNumber: "KAL-INV-1001",
      status: "Paid",
      amount: new Prisma.Decimal("149"),
      currency: "USD",
      paidAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
      batchTitle: "Q1 Services",
      billedTo: "Acme Client Ltd",
      billingDetails: "billing@acmeclient.test",
      subject: "API course license",
      issued,
      dueDate: due,
      lineItems: lineItemsSample,
      subtotal: new Prisma.Decimal("149"),
      discountPercent: new Prisma.Decimal("0"),
      discountAmount: new Prisma.Decimal("0"),
      total: new Prisma.Decimal("149"),
      amountDue: new Prisma.Decimal("0"),
      termsAndConditions: "Net 30",
      notesContent: "Thank you for your business.",
      log: logSample,
    },
    update: {},
  });

  await prismaClient.invoice.upsert({
    where: { invoiceNumber: "KAL-INV-1002" },
    create: {
      businessId: kalcorpId,
      environment: "LIVE",
      invoiceNumber: "KAL-INV-1002",
      status: "Pending",
      amount: new Prisma.Decimal("4999"),
      currency: "USD",
      batchTitle: "Enterprise",
      billedTo: "Globex Corporation",
      subject: "Support retainer — March",
      issued,
      dueDate: due,
      lineItems: [
        { id: randomUUID(), productName: "Enterprise Support — Quarterly", qty: 1, unitPrice: 4999, amount: 4999 },
      ],
      subtotal: new Prisma.Decimal("4999"),
      discountPercent: new Prisma.Decimal("0"),
      discountAmount: new Prisma.Decimal("0"),
      total: new Prisma.Decimal("4999"),
      amountDue: new Prisma.Decimal("4999"),
      termsAndConditions: "Due on receipt",
      notesContent: "",
      log: logSample,
    },
    update: {},
  });

  await prismaClient.invoice.upsert({
    where: { invoiceNumber: "KAL-INV-TEST-1" },
    create: {
      businessId: kalcorpId,
      environment: "TEST",
      invoiceNumber: "KAL-INV-TEST-1",
      status: "Draft",
      amount: new Prisma.Decimal("10"),
      currency: "USD",
      batchTitle: "Test",
      billedTo: "Test Customer",
      subject: "Sandbox invoice",
      issued,
      dueDate: due,
      lineItems: [{ id: randomUUID(), productName: "Test line", qty: 1, unitPrice: 10, amount: 10 }],
      subtotal: new Prisma.Decimal("10"),
      discountPercent: new Prisma.Decimal("0"),
      discountAmount: new Prisma.Decimal("0"),
      total: new Prisma.Decimal("10"),
      amountDue: new Prisma.Decimal("10"),
      termsAndConditions: "",
      notesContent: "Test mode only",
      log: [],
    },
    update: {},
  });

  await prismaClient.merchantCustomer.upsert({
    where: { id: "c1000001-0000-4000-8000-000000000001" },
    create: {
      id: "c1000001-0000-4000-8000-000000000001",
      businessId: kalcorpId,
      environment: "LIVE",
      userId: alice.id,
      email: alice.email,
      displayName: "Alice (VIP)",
      totalSpend: new Prisma.Decimal("1490"),
      orderCount: 4,
      notes: "Prefers USDC on Base. Ask before upselling.",
      firstSeenAt: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
      lastActivityAt: now,
    },
    update: {},
  });

  await prismaClient.merchantCustomer.upsert({
    where: { id: "c1000002-0000-4000-8000-000000000001" },
    create: {
      id: "c1000002-0000-4000-8000-000000000001",
      businessId: kalcorpId,
      environment: "LIVE",
      email: "prospect@bigco.com",
      displayName: "BigCo procurement",
      phone: "+233201234567",
      totalSpend: new Prisma.Decimal("0"),
      orderCount: 0,
      notes: "Evaluating enterprise tier — follow up next week.",
      metadata: { crmStage: "evaluation", region: "EU" } as Prisma.InputJsonValue,
    },
    update: {},
  });

  await prismaClient.merchantCustomer.upsert({
    where: { id: "c1000003-0000-4000-8000-000000000001" },
    create: {
      id: "c1000003-0000-4000-8000-000000000001",
      businessId: kalcorpId,
      environment: "TEST",
      email: "sandbox-user@kalcorp.test",
      displayName: "Sandbox user",
      totalSpend: new Prisma.Decimal("1"),
      orderCount: 1,
      notes: "Test-mode only contact",
    },
    update: {},
  });

  await prismaClient.payout.upsert({
    where: { id: "b2000001-0000-4000-8000-000000000001" },
    create: {
      id: "b2000001-0000-4000-8000-000000000001",
      businessId: kalcorpId,
      environment: "LIVE",
      methodId: kalPmUsd.id,
      amount: new Prisma.Decimal("12050.75"),
      fee: new Prisma.Decimal("25"),
      currency: "USD",
      status: "PAID",
      reference: "KAL-PAYOUT-001",
      batchId: "kalcorp-batch-2026-03-a",
    },
    update: {},
  });

  await prismaClient.payout.upsert({
    where: { id: "b2000002-0000-4000-8000-000000000001" },
    create: {
      id: "b2000002-0000-4000-8000-000000000001",
      businessId: kalcorpId,
      environment: "LIVE",
      methodId: kalPmCrypto.id,
      amount: new Prisma.Decimal("3100"),
      fee: new Prisma.Decimal("5"),
      currency: "USDC",
      status: "PROCESSING",
      reference: "KAL-PAYOUT-002",
    },
    update: {},
  });

  await prismaClient.payout.upsert({
    where: { id: "b2000003-0000-4000-8000-000000000001" },
    create: {
      id: "b2000003-0000-4000-8000-000000000001",
      businessId: kalcorpId,
      environment: "LIVE",
      methodId: kalPmUsd.id,
      amount: new Prisma.Decimal("890"),
      fee: new Prisma.Decimal("2"),
      currency: "USD",
      status: "SCHEDULED",
      reference: "KAL-PAYOUT-003",
    },
    update: {},
  });

  await prismaClient.payout.upsert({
    where: { id: "b2000004-0000-4000-8000-000000000001" },
    create: {
      id: "b2000004-0000-4000-8000-000000000001",
      businessId: kalcorpId,
      environment: "LIVE",
      methodId: kalPmUsd.id,
      amount: new Prisma.Decimal("100"),
      fee: new Prisma.Decimal("1"),
      currency: "USD",
      status: "FAILED",
      reference: "KAL-PAYOUT-FAIL-1",
    },
    update: {},
  });

  await prismaClient.payout.upsert({
    where: { id: "b2000005-0000-4000-8000-000000000001" },
    create: {
      id: "b2000005-0000-4000-8000-000000000001",
      businessId: kalcorpId,
      environment: "TEST",
      methodId: kalPmUsd.id,
      amount: new Prisma.Decimal("50"),
      fee: new Prisma.Decimal("0"),
      currency: "USD",
      status: "PAID",
      reference: "KAL-TEST-PAYOUT-1",
    },
    update: {},
  });

  await prismaClient.businessMemberInvite.upsert({
    where: { token: "kalcorp-seed-invite-token-demo" },
    create: {
      token: "kalcorp-seed-invite-token-demo",
      businessId: kalcorpId,
      email: "newhire@kalcorp.com",
      role: "SUPPORT",
      expiresAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
    },
    update: {},
  });

  await upsertKalcorpSeedApiKeys(prismaClient, kalcorpId);

  console.log(
    "  [kalcorp] Note: GET /api/v1/merchant/logs is in-memory only — request logs are not persisted in the DB."
  );
}

async function main() {
  let encryptedKey: string;
  try {
    loadEnv();
    encryptedKey = WalletManager.encrypt("seed-placeholder-private-key-do-not-use");
  } catch {
    encryptedKey = hex(32 + 16 + 16 + 32);
  }

  console.log("Seeding users...");
  const [alice, bob, charlie] = await Promise.all([
    prisma.user.upsert({
      where: { email: "alice@example.com" },
      create: {
        email: "alice@example.com",
        address: "0x1111111111111111111111111111111111111111",
        number: "233201234567",
        username: "alice",
      },
      update: {},
    }),
    prisma.user.upsert({
      where: { email: "bob@example.com" },
      create: {
        email: "bob@example.com",
        address: "0x2222222222222222222222222222222222222222",
        number: "233209876543",
        username: "bob",
      },
      update: {},
    }),
    prisma.user.upsert({
      where: { email: "charlie@example.com" },
      create: {
        email: "charlie@example.com",
        address: "0x3333333333333333333333333333333333333333",
        username: "charlie",
      },
      update: {},
    }),
  ]);

  console.log("Seeding wallets...");
  // Single platform receiving wallet for offramp (BASE + BASE SEPOLIA). Use this address to receive crypto.
  const PLATFORM_RECEIVING_ADDRESS = "0x9f08eFb0767Bf180B8b8094FaaEF9DAB5a0755e1";
  const [walletEth, walletBase, walletPool] = await Promise.all([
    prisma.wallet.upsert({
      where: { address: "0xEeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee1" },
      create: {
        address: "0xEeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee1",
        encryptedKey,
        supportedChains: ["ETHEREUM", "BASE"],
        supportedTokens: ["ETH", "USDC"],
        isLiquidityPool: false,
        collectFees: false,
      },
      update: { isLiquidityPool: false },
    }),
    prisma.wallet.upsert({
      where: { address: "0xEeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee2" },
      create: {
        address: "0xEeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee2",
        encryptedKey,
        supportedChains: ["ETHEREUM"],
        supportedTokens: ["USDC", "DAI"],
      },
      update: {},
    }),
    prisma.wallet.upsert({
      where: { address: PLATFORM_RECEIVING_ADDRESS },
      create: {
        address: PLATFORM_RECEIVING_ADDRESS,
        encryptedKey,
        supportedChains: ["BASE", "BASE SEPOLIA"],
        supportedTokens: ["USDC", "ETH"],
        isLiquidityPool: true,
        collectFees: false,
      },
      update: { isLiquidityPool: true, supportedChains: ["BASE", "BASE SEPOLIA"] },
    }),
  ]);

  console.log("Seeding inventory assets...");
  const defaultAddress = walletEth.address;
  const [usdcEth, ethEth, usdcBase] = await Promise.all([
    prisma.inventoryAsset.upsert({
      where: {
        chainId_tokenAddress_address: {
          chainId: 1,
          tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          address: defaultAddress,
        },
      },
      create: {
        chain: "ETHEREUM",
        chainId: 1,
        tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        symbol: "USDC",
        address: defaultAddress,
        walletId: walletEth.id,
        currentBalance: 50_000,
      },
      update: {},
    }),
    prisma.inventoryAsset.upsert({
      where: {
        chainId_tokenAddress_address: {
          chainId: 1,
          tokenAddress: "0x0000000000000000000000000000000000000000",
          address: defaultAddress,
        },
      },
      create: {
        chain: "ETHEREUM",
        chainId: 1,
        tokenAddress: "0x0000000000000000000000000000000000000000",
        symbol: "ETH",
        address: defaultAddress,
        walletId: walletEth.id,
        currentBalance: 10,
      },
      update: {},
    }),
    prisma.inventoryAsset.upsert({
      where: {
        chainId_tokenAddress_address: {
          chainId: 8453,
          tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          address: defaultAddress,
        },
      },
      create: {
        chain: "BASE",
        chainId: 8453,
        tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        symbol: "USDC",
        address: defaultAddress,
        walletId: walletEth.id,
        currentBalance: 25_000,
      },
      update: {},
    }),
  ]);

  console.log("Seeding businesses (B2B2C)...");
  const [acme, betaCorp, kalcorp] = await Promise.all([
    prisma.business.upsert({
      where: { slug: "acme" },
      create: {
        name: "Acme Inc",
        slug: "acme",
        country: "US",
        kybStatus: "APPROVED",
        riskScore: 10,
        settlementSchedule: "WEEKLY",
        webhookUrl: "https://acme.example.com/webhook",
      },
      update: {},
    }),
    prisma.business.upsert({
      where: { slug: "beta-corp" },
      create: {
        name: "Beta Corp",
        slug: "beta-corp",
        country: "GH",
        kybStatus: "PENDING",
        riskScore: 25,
        settlementSchedule: "DAILY",
      },
      update: {},
    }),
    prisma.business.upsert({
      where: { id: KALCORP_BUSINESS_ID },
      create: {
        id: KALCORP_BUSINESS_ID,
        name: "kalcorp",
        slug: "kalcorp",
        country: "GH",
        kybStatus: "APPROVED",
        riskScore: 12,
        settlementSchedule: "WEEKLY",
        website: "https://kalcorp.com",
        supportEmail: "support@kalcorp.com",
        logoUrl: "https://images.unsplash.com/photo-1560179707-f14e90ef3623?w=256&h=256&fit=crop",
        webhookUrl: "https://kalcorp.com/api/webhooks/klyra",
        brandColor: "#0f172a",
        buttonColor: "#3b82f6",
        supportUrl: "https://kalcorp.com/support",
        termsOfServiceUrl: "https://kalcorp.com/legal/terms",
        returnPolicyUrl: "https://kalcorp.com/legal/returns",
      },
      update: {
        name: "kalcorp",
        slug: "kalcorp",
        website: "https://kalcorp.com",
        supportEmail: "support@kalcorp.com",
        logoUrl: "https://images.unsplash.com/photo-1560179707-f14e90ef3623?w=256&h=256&fit=crop",
        kybStatus: "APPROVED",
        riskScore: 12,
        webhookUrl: "https://kalcorp.com/api/webhooks/klyra",
        brandColor: "#0f172a",
        buttonColor: "#3b82f6",
        supportUrl: "https://kalcorp.com/support",
        termsOfServiceUrl: "https://kalcorp.com/legal/terms",
        returnPolicyUrl: "https://kalcorp.com/legal/returns",
      },
    }),
  ]);

  console.log("Seeding business members...");
  await Promise.all([
    prisma.businessMember.upsert({
      where: { userId_businessId: { userId: alice.id, businessId: acme.id } },
      create: { userId: alice.id, businessId: acme.id, role: "OWNER", isActive: true },
      update: {},
    }),
    prisma.businessMember.upsert({
      where: { userId_businessId: { userId: bob.id, businessId: acme.id } },
      create: { userId: bob.id, businessId: acme.id, role: "ADMIN", isActive: true },
      update: {},
    }),
    prisma.businessMember.upsert({
      where: { userId_businessId: { userId: charlie.id, businessId: betaCorp.id } },
      create: { userId: charlie.id, businessId: betaCorp.id, role: "DEVELOPER", isActive: true },
      update: {},
    }),
    prisma.businessMember.upsert({
      where: { userId_businessId: { userId: alice.id, businessId: kalcorp.id } },
      create: { userId: alice.id, businessId: kalcorp.id, role: "OWNER", isActive: true },
      update: {},
    }),
    prisma.businessMember.upsert({
      where: { userId_businessId: { userId: bob.id, businessId: kalcorp.id } },
      create: { userId: bob.id, businessId: kalcorp.id, role: "DEVELOPER", isActive: true },
      update: {},
    }),
    prisma.businessMember.upsert({
      where: { userId_businessId: { userId: charlie.id, businessId: kalcorp.id } },
      create: { userId: charlie.id, businessId: kalcorp.id, role: "FINANCE", isActive: true },
      update: {},
    }),
  ]);

  await prisma.feeSchedule.upsert({
    where: { businessId: acme.id },
    create: { businessId: acme.id, flatFee: 0, percentageFee: 1, maxFee: 50 },
    update: {},
  });

  const acmePayoutMethod = await prisma.payoutMethod.upsert({
    where: { id: "00000000-0000-0000-000a-000000000001" },
    create: {
      id: "00000000-0000-0000-000a-000000000001",
      businessId: acme.id,
      type: "BANK_ACCOUNT",
      currency: "USD",
      details: { accountNumber: "****1234", bankCode: "063", accountName: "Acme Inc" },
      isPrimary: true,
      isActive: true,
    },
    update: {},
  });

  await prisma.payout.upsert({
    where: { id: "00000000-0000-0000-000b-000000000001" },
    create: {
      id: "00000000-0000-0000-000b-000000000001",
      businessId: acme.id,
      methodId: acmePayoutMethod.id,
      amount: 50230,
      fee: 25,
      currency: "USD",
      status: "PAID",
      reference: "WIRE-REF-8821",
      batchId: "batch-8821",
    },
    update: {},
  });

  console.log("Seeding transactions...");
  const buyTx = await prisma.transaction.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      type: "BUY",
      status: "COMPLETED",
      fromUserId: alice.id,
      fromIdentifier: alice.email,
      fromType: "EMAIL",
      toIdentifier: alice.address ?? undefined,
      toType: "ADDRESS",
      f_amount: 100,
      t_amount: 0.05,
      exchangeRate: 0.0005,
      f_tokenPriceUsd: 1,
      t_tokenPriceUsd: 2000,
      f_chain: "ETHEREUM",
      t_chain: "ETHEREUM",
      f_token: "USDC",
      t_token: "ETH",
      f_provider: "NONE",
      t_provider: "SQUID",
      businessId: acme.id,
      platformFee: 1,
      merchantFee: 0.5,
    },
    update: {},
  });

  const sellTx = await prisma.transaction.upsert({
    where: { id: "00000000-0000-0000-0000-000000000002" },
    create: {
      id: "00000000-0000-0000-0000-000000000002",
      type: "SELL",
      status: "COMPLETED",
      fromUserId: bob.id,
      fromIdentifier: bob.address ?? undefined,
      fromType: "ADDRESS",
      toIdentifier: bob.email,
      toType: "EMAIL",
      f_amount: 0.02,
      t_amount: 40,
      exchangeRate: 2000,
      f_tokenPriceUsd: 2000,
      t_tokenPriceUsd: 1,
      f_chain: "ETHEREUM",
      t_chain: "ETHEREUM",
      f_token: "ETH",
      t_token: "USDC",
      businessId: acme.id,
      platformFee: 0.4,
      merchantFee: 0.2,
    },
    update: {},
  });

  const requestTemplateTx = await prisma.transaction.upsert({
    where: { id: "00000000-0000-0000-0000-000000000003" },
    create: {
      id: "00000000-0000-0000-0000-000000000003",
      type: "REQUEST",
      status: "PENDING",
      fromIdentifier: charlie.email,
      fromType: "EMAIL",
      toIdentifier: "233201111111",
      toType: "NUMBER",
      f_amount: 20,
      t_amount: 20,
      exchangeRate: 1,
      f_tokenPriceUsd: 1 / 12.5,
      t_tokenPriceUsd: 1 / 12.5,
      f_chain: "ETHEREUM",
      t_chain: "ETHEREUM",
      f_token: "GHS",
      t_token: "GHS",
    },
    update: {},
  });

  console.log("Seeding request & claim...");
  const request = await prisma.request.upsert({
    where: { code: "REQ8A8790" },
    create: {
      code: "REQ8A8790",
      linkId: "link1abc",
      transactionId: requestTemplateTx.id,
    },
    update: {},
  });

  await prisma.transaction.update({
    where: { id: requestTemplateTx.id },
    data: { requestId: request.id },
  });

  const claim = await prisma.claim.upsert({
    where: { requestId: request.id },
    create: {
      requestId: request.id,
      status: "ACTIVE",
      value: 20,
      price: 12.5,
      token: "GHS",
      payerIdentifier: "233201111111",
      toIdentifier: charlie.email ?? "",
      code: "123456",
    },
    update: {},
  });

  await seedKalcorpDemoData(prisma, kalcorp.id, alice, bob, charlie);

  console.log("Seeding countries (Fonbnk + Paystack supported)...");
  const countryData: Array<{ code: string; name: string; currency: string; supportedFonbnk: boolean; supportedPaystack: boolean }> = [
    { code: "NG", name: "Nigeria", currency: "NGN", supportedFonbnk: true, supportedPaystack: true },
    { code: "KE", name: "Kenya", currency: "KES", supportedFonbnk: true, supportedPaystack: true },
    { code: "GH", name: "Ghana", currency: "GHS", supportedFonbnk: true, supportedPaystack: true },
    { code: "ZA", name: "South Africa", currency: "ZAR", supportedFonbnk: true, supportedPaystack: true },
    { code: "TZ", name: "Tanzania", currency: "TZS", supportedFonbnk: true, supportedPaystack: false },
    { code: "UG", name: "Uganda", currency: "UGX", supportedFonbnk: true, supportedPaystack: false },
    { code: "ZM", name: "Zambia", currency: "ZMW", supportedFonbnk: true, supportedPaystack: false },
    { code: "BF", name: "Burkina Faso", currency: "XOF", supportedFonbnk: true, supportedPaystack: false },
    { code: "BR", name: "Brazil", currency: "BRL", supportedFonbnk: true, supportedPaystack: false },
    { code: "SN", name: "Senegal", currency: "XOF", supportedFonbnk: true, supportedPaystack: false },
    { code: "CG", name: "Republic of the Congo", currency: "XAF", supportedFonbnk: true, supportedPaystack: false },
    { code: "BJ", name: "Benin", currency: "XOF", supportedFonbnk: true, supportedPaystack: false },
    { code: "GA", name: "Gabon", currency: "XAF", supportedFonbnk: true, supportedPaystack: false },
    { code: "RW", name: "Rwanda", currency: "RWF", supportedFonbnk: true, supportedPaystack: false },
    { code: "CI", name: "Ivory Coast", currency: "XOF", supportedFonbnk: true, supportedPaystack: false },
    { code: "CM", name: "Cameroon", currency: "XAF", supportedFonbnk: true, supportedPaystack: false },
    { code: "MW", name: "Malawi", currency: "MWK", supportedFonbnk: true, supportedPaystack: false },
  ];
  for (const c of countryData) {
    await prisma.country.upsert({
      where: { code: c.code },
      create: c,
      update: { name: c.name, currency: c.currency, supportedFonbnk: c.supportedFonbnk, supportedPaystack: c.supportedPaystack },
    });
  }

  console.log("Seeding supported chains and tokens...");
  const CHAIN_ID_BASE = 8453;
  const CHAIN_ID_BASE_SEPOLIA = 84532;
  const CHAIN_ID_ETHEREUM = 1;
  const CHAIN_ID_MOMO = 0; // fiat/offchain (onramp, offramp)
  const CHAIN_ID_BANK = 2;
  const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
  const FIAT_SENTINEL = "0x0000000000000000000000000000000000000000";
  const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

  await prisma.chain.upsert({
    where: { chainId: CHAIN_ID_BASE },
    create: { chainId: CHAIN_ID_BASE, name: "Base", iconUri: null },
    update: { name: "Base", iconUri: undefined },
  });
  await prisma.chain.upsert({
    where: { chainId: CHAIN_ID_BASE_SEPOLIA },
    create: { chainId: CHAIN_ID_BASE_SEPOLIA, name: "Base Sepolia", iconUri: null },
    update: { name: "Base Sepolia", iconUri: undefined },
  });
  await prisma.chain.upsert({
    where: { chainId: CHAIN_ID_ETHEREUM },
    create: { chainId: CHAIN_ID_ETHEREUM, name: "Ethereum", iconUri: null },
    update: { name: "Ethereum", iconUri: undefined },
  });
  await prisma.chain.upsert({
    where: { chainId: CHAIN_ID_MOMO },
    create: { chainId: CHAIN_ID_MOMO, name: "MOMO", iconUri: null },
    update: { name: "MOMO", iconUri: undefined },
  });
  await prisma.chain.upsert({
    where: { chainId: CHAIN_ID_BANK },
    create: { chainId: CHAIN_ID_BANK, name: "BANK", iconUri: null },
    update: { name: "BANK", iconUri: undefined },
  });

  const CHAIN_ID_BNB = 56;
  const CHAIN_ID_SOLANA = 101;
  const BSC_USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
  const ETHEREUM_WXRP = "0x39fBBABf11738317a448031930706cd3e612e1B9";
  const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  /** Wrapped SOL — standard mint for native SOL balance / quotes on Solana. */
  const SOLANA_NATIVE_MINT = "So11111111111111111111111111111111111111112";

  await prisma.chain.upsert({
    where: { chainId: CHAIN_ID_BNB },
    create: { chainId: CHAIN_ID_BNB, name: "BNB", iconUri: null },
    update: { name: "BNB", iconUri: undefined },
  });
  await prisma.chain.upsert({
    where: { chainId: CHAIN_ID_SOLANA },
    create: { chainId: CHAIN_ID_SOLANA, name: "SOLANA", iconUri: null },
    update: { name: "SOLANA", iconUri: undefined },
  });

  const tokenData: Array<{ chainId: number; tokenAddress: string; symbol: string; decimals: number; name: string | null; logoUri: string | null; fonbnkCode: string | null }> = [
    { chainId: CHAIN_ID_BASE, tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", decimals: 6, name: "USD Coin", logoUri: null, fonbnkCode: "BASE_USDC" },
    { chainId: CHAIN_ID_BASE, tokenAddress: NATIVE, symbol: "ETH", decimals: 18, name: "Ether", logoUri: null, fonbnkCode: "BASE_ETH" },
    { chainId: CHAIN_ID_BASE, tokenAddress: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", symbol: "DAI", decimals: 18, name: "Dai Stablecoin", logoUri: null, fonbnkCode: null },
    { chainId: CHAIN_ID_BASE_SEPOLIA, tokenAddress: BASE_SEPOLIA_USDC, symbol: "USDC", decimals: 6, name: "USD Coin (Base Sepolia)", logoUri: null, fonbnkCode: "BASE_SEPOLIA_USDC" },
    { chainId: CHAIN_ID_BASE_SEPOLIA, tokenAddress: NATIVE, symbol: "ETH", decimals: 18, name: "Ether", logoUri: null, fonbnkCode: "BASE_SEPOLIA_ETH" },
    { chainId: CHAIN_ID_ETHEREUM, tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", decimals: 6, name: "USD Coin", logoUri: null, fonbnkCode: "ETHEREUM_USDC" },
    { chainId: CHAIN_ID_ETHEREUM, tokenAddress: NATIVE, symbol: "ETH", decimals: 18, name: "Ether", logoUri: null, fonbnkCode: "ETHEREUM_NATIVE" },
    {
      chainId: CHAIN_ID_ETHEREUM,
      tokenAddress: ETHEREUM_WXRP,
      symbol: "WXRP",
      decimals: 18,
      name: "Wrapped XRP",
      logoUri: null,
      fonbnkCode: null,
    },
    { chainId: CHAIN_ID_BNB, tokenAddress: BSC_USDC, symbol: "USDC", decimals: 18, name: "USD Coin (BNB)", logoUri: null, fonbnkCode: "BNB_USDC" },
    { chainId: CHAIN_ID_BNB, tokenAddress: NATIVE, symbol: "BNB", decimals: 18, name: "BNB", logoUri: null, fonbnkCode: "BNB_NATIVE" },
    {
      chainId: CHAIN_ID_SOLANA,
      tokenAddress: SOLANA_USDC,
      symbol: "USDC",
      decimals: 6,
      name: "USD Coin (Solana)",
      logoUri: null,
      fonbnkCode: "SOLANA_USDC",
    },
    {
      chainId: CHAIN_ID_SOLANA,
      tokenAddress: SOLANA_NATIVE_MINT,
      symbol: "SOL",
      decimals: 9,
      name: "Solana",
      logoUri: null,
      fonbnkCode: "SOLANA_NATIVE",
    },
    { chainId: CHAIN_ID_MOMO, tokenAddress: FIAT_SENTINEL, symbol: "GHS", decimals: 2, name: "Ghana Cedi", logoUri: null, fonbnkCode: "MOMO_GHS" },
    { chainId: CHAIN_ID_MOMO, tokenAddress: "0x0000000000000000000000000000000000000001", symbol: "USD", decimals: 2, name: "US Dollar", logoUri: null, fonbnkCode: "MOMO_USD" },
    { chainId: CHAIN_ID_BANK, tokenAddress: FIAT_SENTINEL, symbol: "USD", decimals: 2, name: "US Dollar", logoUri: null, fonbnkCode: "BANK_USD" },
  ];
  for (const t of tokenData) {
    await prisma.supportedToken.upsert({
      where: { chainId_tokenAddress: { chainId: t.chainId, tokenAddress: t.tokenAddress } },
      create: t,
      update: { symbol: t.symbol, decimals: t.decimals, name: t.name, logoUri: t.logoUri, fonbnkCode: t.fonbnkCode },
    });
  }

  console.log("Seeding platform settings (defaults)...");
  const platformSettingDefaults: Array<{ key: string; value: object }> = [
    { key: "general", value: { publicName: "MyCryptoApp", supportEmail: "", supportPhone: "", defaultCurrency: "USD", timezone: "UTC", maintenanceMode: false } },
    { key: "financials", value: { baseFeePercent: 1, fixedFee: 0, minTransactionSize: 0, maxTransactionSize: 1_000_000, lowBalanceAlert: 1000 } },
    {
      key: "providers",
      value: {
        maxSlippagePercent: 1,
        providers: [
          { id: "SQUID", enabled: true, priority: 1, apiKey: "", status: "operational", latencyMs: null },
          { id: "LIFI", enabled: true, priority: 2, apiKey: "", status: "operational", latencyMs: null },
          { id: "0X", enabled: true, priority: 3, apiKey: "", status: "operational", latencyMs: null },
          { id: "PAYSTACK", enabled: true, priority: 4, apiKey: "", status: "operational", latencyMs: null },
        ],
      },
    },
    { key: "risk", value: { enforceKycOver1000: false, blockHighRiskIp: false, blacklist: [] } },
    { key: "api", value: { webhookSigningSecret: "", slackWebhookUrl: "", alertEmails: "" } },
  ];
  for (const { key, value } of platformSettingDefaults) {
    await prisma.platformSetting.upsert({
      where: { key },
      create: { key, value },
      update: {},
    });
  }

  console.log("Seeding provider routing...");
  const providerCodes = ["SQUID", "LIFI", "ZERO_X", "PAYSTACK"] as const;
  for (let i = 0; i < providerCodes.length; i++) {
    const code = providerCodes[i];
    await prisma.providerRouting.upsert({
      where: { code },
      create: {
        code,
        name: code === "ZERO_X" ? "0x" : code,
        status: "ACTIVE",
        operational: true,
        enabled: true,
        priority: i + 1,
        fee: null,
      },
      update: {},
    });
  }

  console.log("Seeding platform admin...");
  const adminPasswordHash = await hashPassword("password");
  await prisma.platformAdmin.upsert({
    where: { email: "kaleel@gmail.com" },
    create: {
      email: "kaleel@gmail.com",
      name: "Kaleel",
      role: "super_admin",
      passwordHash: adminPasswordHash,
      emailVerifiedAt: new Date(),
    },
    update: {},
  });

  console.log("Seeding admin invite (optional setup for kaleel@gmail.com)...");
  await prisma.adminInvite.upsert({
    where: { token: "seed-invite-token-do-not-use-in-production" },
    create: {
      email: "kaleel@gmail.com",
      role: "super_admin",
      token: "seed-invite-token-do-not-use-in-production",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    update: {},
  });

  console.log("Seeding inventory ledger...");
  await Promise.all([
    prisma.inventoryLedger.upsert({
      where: { id: "00000000-0000-0000-0000-000000000010" },
      create: {
        id: "00000000-0000-0000-0000-000000000010",
        assetId: usdcEth.id,
        type: "DISPOSED",
        quantity: -100,
        pricePerTokenUsd: 1,
        totalValueUsd: 100,
        referenceId: "",
      },
      update: {},
    }),
    prisma.inventoryLedger.upsert({
      where: { id: "00000000-0000-0000-0000-000000000011" },
      create: {
        id: "00000000-0000-0000-0000-000000000011",
        assetId: ethEth.id,
        type: "ACQUIRED",
        quantity: 0.05,
        pricePerTokenUsd: 2000,
        totalValueUsd: 100,
        referenceId: "",
      },
      update: {},
    }),
  ]);

  console.log("Seed completed.");
  console.log({
    users: 3,
    businesses: 3,
    businessMembers: 6,
    wallets: 2,
    inventoryAssets: 3,
    transactions: 3,
    request: request.code,
    claim: claim.id,
    inventoryLedger: 2,
    countries: countryData.length,
    chains: 4,
    supportedTokens: tokenData.length,
    feeSchedules: 2,
    payoutMethods: 3,
    payouts: 6,
    platformSettings: platformSettingDefaults.length,
    providerRouting: providerCodes.length,
    platformAdmin: 1,
    adminInvite: 1,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
