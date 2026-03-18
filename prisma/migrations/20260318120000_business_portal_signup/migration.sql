-- CreateEnum
CREATE TYPE "MerchantSignupRole" AS ENUM ('DEVELOPER', 'FOUNDER_EXECUTIVE', 'FINANCE_OPS', 'PRODUCT');

-- CreateEnum
CREATE TYPE "MerchantPrimaryGoal" AS ENUM ('ACCEPT_PAYMENTS', 'SEND_PAYOUTS', 'INTEGRATE_SDK', 'EXPLORING');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "googleSub" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");

-- CreateTable
CREATE TABLE "MerchantOnboarding" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "companyName" TEXT,
    "website" TEXT,
    "signupRole" "MerchantSignupRole",
    "primaryGoal" "MerchantPrimaryGoal",

    CONSTRAINT "MerchantOnboarding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantOnboarding_userId_key" ON "MerchantOnboarding"("userId");

-- CreateIndex
CREATE INDEX "MerchantOnboarding_userId_idx" ON "MerchantOnboarding"("userId");

-- AddForeignKey
ALTER TABLE "MerchantOnboarding" ADD CONSTRAINT "MerchantOnboarding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
