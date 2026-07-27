-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "sourceLeadId" TEXT;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "sourceLeadId" TEXT;

-- CreateIndex
CREATE INDEX "contracts_sourceLeadId_idx" ON "contracts"("sourceLeadId");

-- CreateIndex
CREATE INDEX "subscriptions_sourceLeadId_idx" ON "subscriptions"("sourceLeadId");
