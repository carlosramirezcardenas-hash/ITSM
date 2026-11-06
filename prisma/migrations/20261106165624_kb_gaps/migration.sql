-- CreateTable
CREATE TABLE "KbGapDismissal" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KbGapDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KbGapDismissal_orgId_key_key" ON "KbGapDismissal"("orgId", "key");

-- AddForeignKey
ALTER TABLE "KbGapDismissal" ADD CONSTRAINT "KbGapDismissal_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
