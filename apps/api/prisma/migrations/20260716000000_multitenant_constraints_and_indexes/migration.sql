-- Multi-tenant constraint hardening + finance indexes.
--
-- 1) leadId / documentNumber / draftNumber were GLOBAL @unique, but they are minted
--    from PER-ORG counters (FL-YYYYMM-000001, EL/QT/YYYY/001, ...). The 2nd org to
--    reach the same sequence hit a P2002 and could not create leads/quotes/drafts.
--    Re-scope uniqueness to (organizationId, value).
-- 2) leads.clientId FK was ON DELETE CASCADE, so deleting a converted client wiped the
--    originating lead + its stage history / deal fields. Change to SET NULL to preserve
--    the CRM conversion audit trail.
-- 3) Add the missing per-tenant indexes on the finance tables.
--
-- All steps are safe/additive: the dropped global unique constraints were strict
-- supersets of the new composite ones, so no existing row can violate them.

-- 1) Re-scope unique constraints per organization ---------------------------------
-- Drop the old GLOBAL uniques. Cover both forms (unique index vs. table constraint)
-- since the constraint could have been created either way across Prisma versions.
ALTER TABLE "leads"            DROP CONSTRAINT IF EXISTS "leads_leadId_key";
ALTER TABLE "quote_documents"  DROP CONSTRAINT IF EXISTS "quote_documents_documentNumber_key";
ALTER TABLE "invoice_drafts"   DROP CONSTRAINT IF EXISTS "invoice_drafts_draftNumber_key";
DROP INDEX IF EXISTS "leads_leadId_key";
DROP INDEX IF EXISTS "quote_documents_documentNumber_key";
DROP INDEX IF EXISTS "invoice_drafts_draftNumber_key";

CREATE UNIQUE INDEX "leads_organizationId_leadId_key"
  ON "leads" ("organizationId", "leadId");
CREATE UNIQUE INDEX "quote_documents_organizationId_documentNumber_key"
  ON "quote_documents" ("organizationId", "documentNumber");
CREATE UNIQUE INDEX "invoice_drafts_organizationId_draftNumber_key"
  ON "invoice_drafts" ("organizationId", "draftNumber");

-- 2) Preserve lead history when a client is deleted -------------------------------
ALTER TABLE "leads" DROP CONSTRAINT IF EXISTS "leads_clientId_fkey";
ALTER TABLE "leads" ADD CONSTRAINT "leads_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "clients"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) Per-tenant indexes on finance tables -----------------------------------------
CREATE INDEX IF NOT EXISTS "contracts_organizationId_idx"     ON "contracts" ("organizationId");
CREATE INDEX IF NOT EXISTS "payments_organizationId_idx"      ON "payments" ("organizationId");
CREATE INDEX IF NOT EXISTS "subscriptions_organizationId_idx" ON "subscriptions" ("organizationId");
CREATE INDEX IF NOT EXISTS "expenses_organizationId_idx"      ON "expenses" ("organizationId");
CREATE INDEX IF NOT EXISTS "invoice_drafts_organizationId_idx" ON "invoice_drafts" ("organizationId");
