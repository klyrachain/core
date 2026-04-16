-- CreateEnum
CREATE TYPE "PaymentLinkChargeKind" AS ENUM ('FIAT', 'CRYPTO');

-- AlterTable
ALTER TABLE "PaymentLink" ADD COLUMN "chargeKind" "PaymentLinkChargeKind" NOT NULL DEFAULT 'FIAT';
