-- Subscriptions: platform invoices, the files behind them, and the two
-- settings they need. Additive only: three new tables and two new columns.
-- No row is changed or removed.

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "uploadQuotaMb" INTEGER NOT NULL DEFAULT 2048,
ADD COLUMN     "usdInrRate" DECIMAL(10,4);

-- CreateTable
CREATE TABLE "stored_files" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_platforms" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_platforms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_invoices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "periodStart" DATE,
    "periodEnd" DATE,
    "planName" TEXT,
    "currency" TEXT NOT NULL,
    "subtotal" DECIMAL(14,2),
    "taxAmount" DECIMAL(14,2),
    "taxType" TEXT,
    "total" DECIMAL(14,2) NOT NULL,
    "inrCharged" DECIMAL(14,2),
    "vendorGstin" TEXT,
    "fileId" TEXT NOT NULL,
    "extracted" JSONB,
    "costId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "subscription_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stored_files_path_key" ON "stored_files"("path");

-- CreateIndex
CREATE INDEX "stored_files_organizationId_kind_deletedAt_idx" ON "stored_files"("organizationId", "kind", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_platforms_organizationId_nameKey_key" ON "subscription_platforms"("organizationId", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_invoices_costId_key" ON "subscription_invoices"("costId");

-- CreateIndex
CREATE INDEX "subscription_invoices_organizationId_invoiceDate_idx" ON "subscription_invoices"("organizationId", "invoiceDate");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_invoices_platformId_invoiceNumber_key" ON "subscription_invoices"("platformId", "invoiceNumber");

-- AddForeignKey
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_platforms" ADD CONSTRAINT "subscription_platforms_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "subscription_platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_costId_fkey" FOREIGN KEY ("costId") REFERENCES "costs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
