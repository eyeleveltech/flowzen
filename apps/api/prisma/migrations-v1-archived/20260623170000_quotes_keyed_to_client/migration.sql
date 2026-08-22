-- Quotations are raised for clients-page clients: move billing details to Client, re-key quote FK.

-- Client billing fields (used to auto-fill quotations)
ALTER TABLE "clients" ADD COLUMN "state" TEXT;
ALTER TABLE "clients" ADD COLUMN "billingAddress" TEXT;
ALTER TABLE "clients" ADD COLUMN "gstNumber" TEXT;

-- Re-key quote_documents from lead -> client (table has no rows yet)
ALTER TABLE "quote_documents" DROP CONSTRAINT IF EXISTS "quote_documents_leadId_fkey";
DROP INDEX IF EXISTS "quote_documents_leadId_idx";
ALTER TABLE "quote_documents" DROP COLUMN IF EXISTS "leadId";
ALTER TABLE "quote_documents" ADD COLUMN "clientId" TEXT NOT NULL;
ALTER TABLE "quote_documents" ADD CONSTRAINT "quote_documents_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "quote_documents_clientId_idx" ON "quote_documents"("clientId");
