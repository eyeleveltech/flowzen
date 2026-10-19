-- AI Proposal Builder, phase 1: proposal documents, their line items, the service
-- catalogue, and the retainer pricing floors. Additive only: new types, tables,
-- columns, indexes and keys. Nothing existing is changed or removed.

-- CreateEnum
CREATE TYPE "ProposalDocStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'FINAL');

-- CreateEnum
CREATE TYPE "ProposalLayout" AS ENUM ('MINIMAL', 'PREMIUM', 'COMPACT');

-- CreateEnum
CREATE TYPE "ProposalBilling" AS ENUM ('ONE_TIME', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ProposalPriceSource" AS ENUM ('USER', 'VERSION', 'CATALOG');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "proposalFloorBase" DECIMAL(12,2) NOT NULL DEFAULT 75000,
ADD COLUMN     "proposalFloors" JSONB NOT NULL DEFAULT '{"Real Estate & Infrastructure": 200000, "Healthcare & Wellness": 150000}';

-- AlterTable
ALTER TABLE "proposals" ADD COLUMN     "refNo" TEXT;

-- CreateTable
CREATE TABLE "proposal_documents" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "n" INTEGER NOT NULL,
    "status" "ProposalDocStatus" NOT NULL DEFAULT 'DRAFT',
    "layout" "ProposalLayout" NOT NULL DEFAULT 'MINIMAL',
    "title" TEXT,
    "sections" JSONB NOT NULL DEFAULT '[]',
    "revisionNote" TEXT,
    "basedOnId" TEXT,
    "createdById" TEXT,
    "finalisedById" TEXT,
    "finalisedAt" TIMESTAMP(3),
    "commercialSnapshot" JSONB,
    "floorOverrideReason" TEXT,
    "floorOverrideById" TEXT,
    "floorOverrideAt" TIMESTAMP(3),
    "finalPdf" BYTEA,
    "sentVersionId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_line_items" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "billing" "ProposalBilling" NOT NULL,
    "qty" DECIMAL(12,2) NOT NULL DEFAULT 1,
    "unit" TEXT,
    "unitRate" DECIMAL(12,2) NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discountTrade" TEXT,
    "isPassthrough" BOOLEAN NOT NULL DEFAULT false,
    "priceSource" "ProposalPriceSource" NOT NULL DEFAULT 'USER',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "proposal_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_catalog_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'month',
    "billing" "ProposalBilling" NOT NULL DEFAULT 'MONTHLY',
    "standardRate" DECIMAL(12,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "proposal_documents_sentVersionId_key" ON "proposal_documents"("sentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "proposal_documents_proposalId_n_key" ON "proposal_documents"("proposalId", "n");

-- CreateIndex
CREATE INDEX "proposal_line_items_documentId_idx" ON "proposal_line_items"("documentId");

-- CreateIndex
CREATE INDEX "service_catalog_items_organizationId_active_idx" ON "service_catalog_items"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "service_catalog_items_organizationId_name_key" ON "service_catalog_items"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "proposals_organizationId_refNo_key" ON "proposals"("organizationId", "refNo");

-- AddForeignKey
ALTER TABLE "proposal_documents" ADD CONSTRAINT "proposal_documents_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_documents" ADD CONSTRAINT "proposal_documents_basedOnId_fkey" FOREIGN KEY ("basedOnId") REFERENCES "proposal_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_documents" ADD CONSTRAINT "proposal_documents_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_documents" ADD CONSTRAINT "proposal_documents_finalisedById_fkey" FOREIGN KEY ("finalisedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_documents" ADD CONSTRAINT "proposal_documents_floorOverrideById_fkey" FOREIGN KEY ("floorOverrideById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_documents" ADD CONSTRAINT "proposal_documents_sentVersionId_fkey" FOREIGN KEY ("sentVersionId") REFERENCES "proposal_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_line_items" ADD CONSTRAINT "proposal_line_items_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "proposal_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_line_items" ADD CONSTRAINT "proposal_line_items_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "service_catalog_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_catalog_items" ADD CONSTRAINT "service_catalog_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_catalog_items" ADD CONSTRAINT "service_catalog_items_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

