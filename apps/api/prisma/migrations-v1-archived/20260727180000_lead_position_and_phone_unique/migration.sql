-- Reconcile the remaining Lead schema drift from the merged CRM work.
--
-- schema.prisma declares Lead.position (used by GET /crm/leads orderBy and the drag-reorder
-- endpoint) and a UNIQUE index on (organizationId, contactPhone) for the phone-dedup guarantee
-- (FZ-054), but no migration shipped for either — so the DB has neither. Without position,
-- ordering the pipeline board 500s; without the unique index the P2002 phone-dedup never fires.
--
-- position is additive (default 0). The phone index is switched from non-unique to unique;
-- contactPhone is nullable and Postgres treats NULLs as distinct, so phone-less leads are
-- unaffected. NOTE: if a target DB already contains duplicate (organizationId, contactPhone)
-- rows, the unique index creation will fail — dedupe those first.

ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "position" INTEGER NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS "leads_organizationId_contactPhone_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "leads_organizationId_contactPhone_key" ON "leads"("organizationId", "contactPhone");
