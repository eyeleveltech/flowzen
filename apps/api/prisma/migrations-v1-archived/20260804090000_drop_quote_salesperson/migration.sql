-- Drop the salesperson from quotations.
--
-- The Salesperson line was removed from all three PDF templates when it was decided a quotation
-- should not name an individual rep. The column and its FK to users outlived that change: still
-- written on create, still selected on four reads, never rendered anywhere. Dead weight that
-- reads as a live feature to anyone opening the schema.
--
-- Destructive but low-risk: nothing has read this value since the templates changed, so there is
-- no behaviour to preserve. Who owns the DEAL is still tracked — that is Lead.assignedToId, which
-- is what the pipeline, the renewals filter and the analytics breakdown have always used.

-- The FK constraint has to go before the column it is defined on.
ALTER TABLE "quote_documents" DROP CONSTRAINT IF EXISTS "quote_documents_salespersonId_fkey";
DROP INDEX IF EXISTS "quote_documents_salespersonId_idx";
ALTER TABLE "quote_documents" DROP COLUMN IF EXISTS "salespersonId";
