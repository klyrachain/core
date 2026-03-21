-- MerchantEnvironment, refunds, webhooks, CRM, branding, tenant isolation

-- CreateEnum
CREATE TYPE "MerchantEnvironment" AS ENUM ('TEST', 'LIVE');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'RETRYING');

-- AlterTable Transaction
ALTER TABLE "Transaction" ADD COLUMN "environment" "MerchantEnvironment" NOT NULL DEFAULT 'LIVE';

-- AlterTable Request
ALTER TABLE "Request" ADD COLUMN "environment" "MerchantEnvironment" NOT NULL DEFAULT 'LIVE';

-- AlterTable Product
ALTER TABLE "Product" ADD COLUMN "environment" "MerchantEnvironment" NOT NULL DEFAULT 'LIVE';

-- AlterTable PaymentLink
ALTER TABLE "PaymentLink" ADD COLUMN "environment" "MerchantEnvironment" NOT NULL DEFAULT 'LIVE';

-- AlterTable Invoice
ALTER TABLE "Invoice" ADD COLUMN "environment" "MerchantEnvironment" NOT NULL DEFAULT 'LIVE';

-- AlterTable Payout
ALTER TABLE "Payout" ADD COLUMN "environment" "MerchantEnvironment" NOT NULL DEFAULT 'LIVE';

-- AlterTable ApiKey
ALTER TABLE "ApiKey" ADD COLUMN "environment" "MerchantEnvironment";

-- AlterTable Business (checkout branding)
ALTER TABLE "Business" ADD COLUMN "brandColor" TEXT,
ADD COLUMN "buttonColor" TEXT,
ADD COLUMN "supportUrl" TEXT,
ADD COLUMN "termsOfServiceUrl" TEXT,
ADD COLUMN "returnPolicyUrl" TEXT;

-- CreateIndex
CREATE INDEX "Transaction_businessId_environment_idx" ON "Transaction"("businessId", "environment");

-- CreateIndex
CREATE INDEX "Product_businessId_environment_idx" ON "Product"("businessId", "environment");

-- CreateIndex
CREATE INDEX "PaymentLink_businessId_environment_idx" ON "PaymentLink"("businessId", "environment");

-- CreateIndex
CREATE INDEX "Invoice_businessId_environment_idx" ON "Invoice"("businessId", "environment");

-- CreateIndex
CREATE INDEX "Payout_businessId_environment_idx" ON "Payout"("businessId", "environment");

-- CreateTable MerchantCustomer
CREATE TABLE "MerchantCustomer" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "businessId" TEXT NOT NULL,
    "environment" "MerchantEnvironment" NOT NULL DEFAULT 'LIVE',
    "userId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "displayName" TEXT,
    "externalId" TEXT,
    "totalSpend" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "metadata" JSONB,
    "firstSeenAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),

    CONSTRAINT "MerchantCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable WebhookEndpoint
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "businessId" TEXT NOT NULL,
    "environment" "MerchantEnvironment" NOT NULL DEFAULT 'LIVE',
    "url" TEXT NOT NULL,
    "secret" TEXT,
    "events" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable WebhookDeliveryLog
CREATE TABLE "WebhookDeliveryLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "endpointId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "httpStatus" INTEGER,
    "responseBody" TEXT,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "transactionId" TEXT,

    CONSTRAINT "WebhookDeliveryLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable Refund
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "businessId" TEXT NOT NULL,
    "environment" "MerchantEnvironment" NOT NULL DEFAULT 'LIVE',
    "transactionId" TEXT NOT NULL,
    "amount" DECIMAL(18,8) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "requestedByUserId" TEXT,
    "cryptoTxHash" TEXT,
    "failureReason" TEXT,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex MerchantCustomer
CREATE INDEX "MerchantCustomer_businessId_idx" ON "MerchantCustomer"("businessId");
CREATE INDEX "MerchantCustomer_businessId_environment_idx" ON "MerchantCustomer"("businessId", "environment");
CREATE INDEX "MerchantCustomer_email_idx" ON "MerchantCustomer"("email");
CREATE INDEX "MerchantCustomer_userId_idx" ON "MerchantCustomer"("userId");

-- CreateIndex WebhookEndpoint
CREATE INDEX "WebhookEndpoint_businessId_idx" ON "WebhookEndpoint"("businessId");
CREATE INDEX "WebhookEndpoint_businessId_environment_idx" ON "WebhookEndpoint"("businessId", "environment");

-- CreateIndex WebhookDeliveryLog
CREATE INDEX "WebhookDeliveryLog_endpointId_idx" ON "WebhookDeliveryLog"("endpointId");
CREATE INDEX "WebhookDeliveryLog_createdAt_idx" ON "WebhookDeliveryLog"("createdAt");
CREATE INDEX "WebhookDeliveryLog_transactionId_idx" ON "WebhookDeliveryLog"("transactionId");

-- CreateIndex Refund
CREATE INDEX "Refund_businessId_idx" ON "Refund"("businessId");
CREATE INDEX "Refund_businessId_environment_idx" ON "Refund"("businessId", "environment");
CREATE INDEX "Refund_transactionId_idx" ON "Refund"("transactionId");

-- AddForeignKey
ALTER TABLE "MerchantCustomer" ADD CONSTRAINT "MerchantCustomer_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantCustomer" ADD CONSTRAINT "MerchantCustomer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDeliveryLog" ADD CONSTRAINT "WebhookDeliveryLog_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDeliveryLog" ADD CONSTRAINT "WebhookDeliveryLog_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
