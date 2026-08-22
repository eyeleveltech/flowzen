-- Module C: Quotation / Proforma Invoice Generator

-- Enums
CREATE TYPE "DocumentType" AS ENUM ('QUOTATION', 'PROFORMA_INVOICE');
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'EXPIRED', 'CANCELLED');

-- Generic document-number counter (per org, per scope, per year)
CREATE TABLE "doc_counters" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "counter" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "doc_counters_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "doc_counters_organizationId_scope_period_key" ON "doc_counters"("organizationId", "scope", "period");

-- Quote documents
CREATE TABLE "quote_documents" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "documentType" "DocumentType" NOT NULL,
  "documentNumber" TEXT NOT NULL,
  "documentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expirationDate" TIMESTAMP(3) NOT NULL,
  "leadId" TEXT NOT NULL,
  "clientName" TEXT NOT NULL,
  "contactPerson" TEXT NOT NULL,
  "clientEmail" TEXT,
  "clientPhone" TEXT,
  "billingAddress" TEXT,
  "clientState" TEXT,
  "paymentTerms" TEXT NOT NULL,
  "customerRef" TEXT,
  "salespersonId" TEXT,
  "salesTeam" TEXT,
  "onlineSignature" BOOLEAN NOT NULL DEFAULT false,
  "onlinePayment" BOOLEAN NOT NULL DEFAULT false,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "paymentMethod" TEXT,
  "clientGst" TEXT,
  "projectStartDate" TIMESTAMP(3),
  "deliveryDate" TIMESTAMP(3),
  "projectNotes" TEXT,
  "termsConditions" TEXT NOT NULL,
  "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
  "untaxedAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "totalDiscount" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "cgst" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "sgst" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "igst" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "totalTax" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "grandTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "amountInWords" TEXT,
  "pdfUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "quote_documents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "quote_documents_documentNumber_key" ON "quote_documents"("documentNumber");
CREATE INDEX "quote_documents_organizationId_status_idx" ON "quote_documents"("organizationId", "status");
CREATE INDEX "quote_documents_leadId_idx" ON "quote_documents"("leadId");

-- Quote line items
CREATE TABLE "quote_line_items" (
  "id" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "quantity" DECIMAL(65,30) NOT NULL,
  "unitPrice" DECIMAL(65,30) NOT NULL,
  "discountPct" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "taxPct" DECIMAL(65,30) NOT NULL DEFAULT 18,
  "amount" DECIMAL(65,30) NOT NULL,
  CONSTRAINT "quote_line_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "quote_line_items_quoteId_idx" ON "quote_line_items"("quoteId");

-- Foreign keys
ALTER TABLE "quote_documents" ADD CONSTRAINT "quote_documents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quote_documents" ADD CONSTRAINT "quote_documents_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("leadId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_documents" ADD CONSTRAINT "quote_documents_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quote_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
