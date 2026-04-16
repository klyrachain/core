-- Provider catalog snapshots (Paystack banks / channels, Fonbnk assets + fiat corridors)
-- Idempotent: safe when the table was created earlier via `db push` or out-of-band SQL.

CREATE TABLE IF NOT EXISTS "ProviderCatalogSnapshot" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "provider" TEXT NOT NULL,
    "snapshotKey" TEXT NOT NULL,
    "rowCount" INTEGER,
    "data" JSONB NOT NULL,
    "source" TEXT,

    CONSTRAINT "ProviderCatalogSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProviderCatalogSnapshot_provider_snapshotKey_key" ON "ProviderCatalogSnapshot"("provider", "snapshotKey");

CREATE INDEX IF NOT EXISTS "ProviderCatalogSnapshot_provider_idx" ON "ProviderCatalogSnapshot"("provider");
