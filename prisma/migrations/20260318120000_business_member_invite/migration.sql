-- CreateTable
CREATE TABLE "BusinessMemberInvite" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "BusinessRole" NOT NULL,
    "invitedByUserId" TEXT,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "BusinessMemberInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessMemberInvite_token_key" ON "BusinessMemberInvite"("token");

-- CreateIndex
CREATE INDEX "BusinessMemberInvite_businessId_idx" ON "BusinessMemberInvite"("businessId");

-- CreateIndex
CREATE INDEX "BusinessMemberInvite_email_idx" ON "BusinessMemberInvite"("email");

-- AddForeignKey
ALTER TABLE "BusinessMemberInvite" ADD CONSTRAINT "BusinessMemberInvite_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
