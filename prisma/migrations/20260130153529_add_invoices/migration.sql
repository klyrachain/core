-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('Paid', 'Pending', 'Overdue', 'Draft', 'Cancelled');

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "currencyLabel" TEXT,
    "paidAt" TIMESTAMP(3),
    "batchTitle" TEXT NOT NULL DEFAULT '',
    "billedTo" TEXT NOT NULL,
    "billingDetails" TEXT,
    "subject" TEXT NOT NULL,
    "issued" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "lineItems" JSONB NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL,
    "amountDue" DECIMAL(18,2) NOT NULL,
    "termsAndConditions" TEXT NOT NULL DEFAULT '',
    "notesContent" TEXT NOT NULL DEFAULT '',
    "log" JSONB NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_billedTo_idx" ON "Invoice"("billedTo");

-- CreateIndex
CREATE INDEX "Invoice_issued_idx" ON "Invoice"("issued");
