-- CreateTable
CREATE TABLE "FailedOrderValidation" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "code" TEXT,
    "payload" JSONB NOT NULL,
    "requestId" TEXT,

    CONSTRAINT "FailedOrderValidation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FailedOrderValidation_createdAt_idx" ON "FailedOrderValidation"("createdAt");

-- CreateIndex
CREATE INDEX "FailedOrderValidation_code_idx" ON "FailedOrderValidation"("code");
