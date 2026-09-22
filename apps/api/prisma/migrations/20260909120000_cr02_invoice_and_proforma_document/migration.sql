-- CHANGE REQUEST 02 · INVOICE AND PROFORMA DOCUMENT
--
-- One template, two documents. Everything a printed proforma or tax invoice
-- says is now either a column on the document or a row in its items table —
-- nothing is read live off the company or the org settings at print time.
--
-- Three things this adds that did not exist at all:
--
--   1. A line items table. Both documents could hold exactly one description,
--      one SAC code and one amount; the PDF's "items table" was a hardcoded
--      single row.
--   2. A document on the Invoice. It had twelve columns — number, company,
--      amount, dates, status — and no buyer block, no terms and no totals, so
--      there was nothing to print.
--   3. Place of supply as its own field. Inter-state was derived from the first
--      two digits of the BUYER'S GSTIN, which means a client with no GSTIN on
--      file read as same-state and was charged CGST+SGST where an out-of-state
--      client owes IGST.
--
-- Nothing here is destructive: every column added is nullable or defaulted, and
-- no column is dropped or retyped. The existing `amount` on both tables keeps
-- the meaning it already has — pre-tax on a proforma, payable total on an
-- invoice (it is what payments are settled against) — and the new `subtotal`
-- and `total` are written alongside it, not in place of it.

-- CreateEnum
CREATE TYPE "SupplyType" AS ENUM ('INTRA', 'INTER');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "stateCode" TEXT,
ADD COLUMN     "stateName" TEXT;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "amountInWords" TEXT,
ADD COLUMN     "billingAddress" TEXT,
ADD COLUMN     "billingContactName" TEXT,
ADD COLUMN     "billingName" TEXT,
ADD COLUMN     "billingStateCode" TEXT,
ADD COLUMN     "billingStateName" TEXT,
ADD COLUMN     "cgstAmount" DECIMAL(12,2),
ADD COLUMN     "customFields" JSONB,
ADD COLUMN     "gstApplicable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "gstRatePercent" INTEGER NOT NULL DEFAULT 18,
ADD COLUMN     "gstin" TEXT,
ADD COLUMN     "igstAmount" DECIMAL(12,2),
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "placeOfSupplyCode" TEXT,
ADD COLUMN     "placeOfSupplyState" TEXT,
ADD COLUMN     "poDate" DATE,
ADD COLUMN     "poNumber" TEXT,
ADD COLUMN     "roundOff" DECIMAL(12,2),
ADD COLUMN     "sellerSnapshot" JSONB,
ADD COLUMN     "sgstAmount" DECIMAL(12,2),
ADD COLUMN     "subtotal" DECIMAL(12,2),
ADD COLUMN     "supplyType" "SupplyType",
ADD COLUMN     "terms" TEXT,
ADD COLUMN     "total" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "declarationText" TEXT,
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "pan" TEXT,
ADD COLUMN     "sacCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "signatureImage" TEXT;

-- AlterTable
ALTER TABLE "proformas" ADD COLUMN     "amountInWords" TEXT,
ADD COLUMN     "billingStateCode" TEXT,
ADD COLUMN     "billingStateName" TEXT,
ADD COLUMN     "cgstAmount" DECIMAL(12,2),
ADD COLUMN     "customFields" JSONB,
ADD COLUMN     "igstAmount" DECIMAL(12,2),
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "placeOfSupplyCode" TEXT,
ADD COLUMN     "placeOfSupplyState" TEXT,
ADD COLUMN     "roundOff" DECIMAL(12,2),
ADD COLUMN     "sellerSnapshot" JSONB,
ADD COLUMN     "sgstAmount" DECIMAL(12,2),
ADD COLUMN     "subtotal" DECIMAL(12,2),
ADD COLUMN     "supplyType" "SupplyType",
ADD COLUMN     "total" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "document_line_items" (
    "id" TEXT NOT NULL,
    "proformaId" TEXT,
    "invoiceId" TEXT,
    "serialNo" INTEGER NOT NULL,
    "particulars" TEXT NOT NULL,
    "units" DECIMAL(12,3) NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "hsnSac" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "gstRate" INTEGER NOT NULL DEFAULT 18,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_line_items_proformaId_serialNo_idx" ON "document_line_items"("proformaId", "serialNo");

-- CreateIndex
CREATE INDEX "document_line_items_invoiceId_serialNo_idx" ON "document_line_items"("invoiceId", "serialNo");

-- AddForeignKey
ALTER TABLE "document_line_items" ADD CONSTRAINT "document_line_items_proformaId_fkey" FOREIGN KEY ("proformaId") REFERENCES "proformas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_line_items" ADD CONSTRAINT "document_line_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A line item belongs to exactly one document. The schema models that as two
-- nullable foreign keys rather than the spec's loose (documentType, documentId)
-- pair, so cascade delete and referential integrity come for free — but two
-- nullable columns also admit a row that belongs to both, or to neither, and
-- neither is a thing that exists. Postgres, not application code, refuses it.
ALTER TABLE "document_line_items"
  ADD CONSTRAINT "document_line_items_exactly_one_parent"
  CHECK (num_nonnulls("proformaId", "invoiceId") = 1);

-- Every proforma already on file gets the single line item it always logically
-- had, so the new items table renders an old document without special-casing
-- it. `description` is nullable and the PDF has always fallen back to this
-- exact sentence when it is empty; the backfill uses the same words so a
-- reprint of an old proforma is character-for-character what was sent.
--
-- Units 1 at unit cost = amount is not an invention: that is precisely what
-- the hardcoded row printed (Qty 1, Unit Price = the amount).
--
-- The money columns (subtotal / cgst / sgst / igst / roundOff / total) are
-- deliberately left NULL on these rows. A NULL subtotal is what tells the
-- renderer this document predates CR-02 and must be priced the way it was
-- priced the day it was raised — including the buyer-GSTIN-derived state.
-- Backfilling a place of supply now would silently reprice documents that
-- have already been sent to clients, which is the one thing a frozen document
-- exists to prevent. New documents, and any edit to an unpaid one, take the
-- explicit place of supply instead.
INSERT INTO "document_line_items" (
  "id", "proformaId", "serialNo", "particulars",
  "units", "unitCost", "hsnSac", "amount", "gstRate",
  "createdAt", "updatedAt"
)
SELECT
  'cr02li' || p."id",
  p."id",
  1,
  COALESCE(NULLIF(btrim(p."description"), ''), 'Retainer fee for the billing period.'),
  1,
  p."amount",
  p."sacCode",
  p."amount",
  p."gstRatePercent",
  p."createdAt",
  NOW()
FROM "proformas" p
WHERE NOT EXISTS (
  SELECT 1 FROM "document_line_items" li WHERE li."proformaId" = p."id"
);
