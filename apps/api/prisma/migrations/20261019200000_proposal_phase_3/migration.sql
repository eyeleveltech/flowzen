-- AI Proposal Builder, phase 3: two more rate sources (a client's agreed rate, a
-- past proposal's rate), the payment split on a one-time fee, and the table of
-- client-specific rates. Additive only: two enum values, one nullable column,
-- one new table. Nothing existing is changed or removed. (Postgres 16: two
-- enum values in one migration are fine.)

ALTER TYPE "ProposalPriceSource" ADD VALUE 'CLIENT_RATE';
ALTER TYPE "ProposalPriceSource" ADD VALUE 'HISTORY';

-- AlterTable
ALTER TABLE "proposal_documents" ADD COLUMN     "milestoneSplit" JSONB;

-- CreateTable
CREATE TABLE "client_rates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "agreedRate" DECIMAL(12,2) NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "note" TEXT,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_rates_organizationId_companyId_idx" ON "client_rates"("organizationId", "companyId");

-- CreateIndex
CREATE INDEX "client_rates_companyId_catalogItemId_idx" ON "client_rates"("companyId", "catalogItemId");

-- AddForeignKey
ALTER TABLE "client_rates" ADD CONSTRAINT "client_rates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_rates" ADD CONSTRAINT "client_rates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_rates" ADD CONSTRAINT "client_rates_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "service_catalog_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_rates" ADD CONSTRAINT "client_rates_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

