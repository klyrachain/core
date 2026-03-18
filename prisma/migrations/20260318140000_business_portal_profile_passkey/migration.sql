-- AlterTable
ALTER TABLE "User" ADD COLUMN "portalDisplayName" TEXT;

-- CreateTable
CREATE TABLE "UserPortalPasskey" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT,

    CONSTRAINT "UserPortalPasskey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserPortalPasskey_credentialId_key" ON "UserPortalPasskey"("credentialId");

-- CreateIndex
CREATE INDEX "UserPortalPasskey_userId_idx" ON "UserPortalPasskey"("userId");

-- CreateIndex
CREATE INDEX "UserPortalPasskey_credentialId_idx" ON "UserPortalPasskey"("credentialId");

-- AddForeignKey
ALTER TABLE "UserPortalPasskey" ADD CONSTRAINT "UserPortalPasskey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
