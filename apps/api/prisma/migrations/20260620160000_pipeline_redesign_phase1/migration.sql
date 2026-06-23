-- Pipeline redesign Phase 1: 7-stage LeadStage, ClientStatus INACTIVE->PROJECT_COMPLETED,
-- Lead.clientId optional + lead-owned contact fields. Enum types are rebuilt (Postgres
-- can't drop enum values in place) with a data remap. Backup-first via the deploy entrypoint.

-- ========== LeadStage: 15 -> 10 (rebuild + remap) ==========
CREATE TYPE "LeadStage_new" AS ENUM (
  'NEW_LEAD','OUTREACH','MEETING','PROPOSAL','NEGOTIATION',
  'CONTRACT','ACTIVE_RETAINER','ACTIVE_PROJECT','PROJECT_COMPLETED','CHURNED'
);

ALTER TABLE "leads" ALTER COLUMN "stage" DROP DEFAULT;

ALTER TABLE "leads" ALTER COLUMN "stage" TYPE "LeadStage_new" USING (
  CASE "stage"::text
    WHEN 'LEAD'         THEN 'NEW_LEAD'
    WHEN 'MQL'          THEN 'NEW_LEAD'
    WHEN 'SQL'          THEN 'OUTREACH'
    WHEN 'REACH_OUT'    THEN 'OUTREACH'
    WHEN 'DISCOVERY'    THEN 'MEETING'
    WHEN 'AUDIT'        THEN 'MEETING'
    WHEN 'PRESENTATION' THEN 'MEETING'
    WHEN 'FINALIZATION' THEN 'CONTRACT'
    WHEN 'WON_CLOSED'   THEN (CASE WHEN "contractType"::text = 'ONE_TIME' THEN 'ACTIVE_PROJECT' ELSE 'ACTIVE_RETAINER' END)
    WHEN 'LOST_CLOSED'  THEN 'CHURNED'
    ELSE "stage"::text  -- PROPOSAL, NEGOTIATION, CONTRACT, ACTIVE_RETAINER, ACTIVE_PROJECT unchanged
  END::"LeadStage_new"
);

ALTER TABLE "stage_history" ALTER COLUMN "fromStage" TYPE "LeadStage_new" USING (
  CASE "fromStage"::text
    WHEN 'LEAD' THEN 'NEW_LEAD' WHEN 'MQL' THEN 'NEW_LEAD' WHEN 'SQL' THEN 'OUTREACH'
    WHEN 'REACH_OUT' THEN 'OUTREACH' WHEN 'DISCOVERY' THEN 'MEETING' WHEN 'AUDIT' THEN 'MEETING'
    WHEN 'PRESENTATION' THEN 'MEETING' WHEN 'FINALIZATION' THEN 'CONTRACT'
    WHEN 'WON_CLOSED' THEN 'ACTIVE_RETAINER' WHEN 'LOST_CLOSED' THEN 'CHURNED'
    ELSE "fromStage"::text
  END::"LeadStage_new"
);

ALTER TABLE "stage_history" ALTER COLUMN "toStage" TYPE "LeadStage_new" USING (
  CASE "toStage"::text
    WHEN 'LEAD' THEN 'NEW_LEAD' WHEN 'MQL' THEN 'NEW_LEAD' WHEN 'SQL' THEN 'OUTREACH'
    WHEN 'REACH_OUT' THEN 'OUTREACH' WHEN 'DISCOVERY' THEN 'MEETING' WHEN 'AUDIT' THEN 'MEETING'
    WHEN 'PRESENTATION' THEN 'MEETING' WHEN 'FINALIZATION' THEN 'CONTRACT'
    WHEN 'WON_CLOSED' THEN 'ACTIVE_RETAINER' WHEN 'LOST_CLOSED' THEN 'CHURNED'
    ELSE "toStage"::text
  END::"LeadStage_new"
);

DROP TYPE "LeadStage";
ALTER TYPE "LeadStage_new" RENAME TO "LeadStage";
ALTER TABLE "leads" ALTER COLUMN "stage" SET DEFAULT 'NEW_LEAD';

-- ========== ClientStatus: INACTIVE -> PROJECT_COMPLETED (rebuild) ==========
CREATE TYPE "ClientStatus_new" AS ENUM ('PROSPECT','ACTIVE','ONHOLD','CHURNED','PROJECT_COMPLETED');

ALTER TABLE "clients" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "clients" ALTER COLUMN "status" TYPE "ClientStatus_new" USING (
  CASE "status"::text WHEN 'INACTIVE' THEN 'PROJECT_COMPLETED' ELSE "status"::text END::"ClientStatus_new"
);
DROP TYPE "ClientStatus";
ALTER TYPE "ClientStatus_new" RENAME TO "ClientStatus";
ALTER TABLE "clients" ALTER COLUMN "status" SET DEFAULT 'PROSPECT';

-- ========== Lead: clientId optional + lead-owned contact fields ==========
ALTER TABLE "leads" ALTER COLUMN "clientId" DROP NOT NULL;
ALTER TABLE "leads"
  ADD COLUMN "contactName"     TEXT,
  ADD COLUMN "companyName"     TEXT,
  ADD COLUMN "contactEmail"    TEXT,
  ADD COLUMN "contactPhone"    TEXT,
  ADD COLUMN "jobTitle"        TEXT,
  ADD COLUMN "linkedinUrl"     TEXT,
  ADD COLUMN "linkedinChecked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "linkedinFound"   BOOLEAN;

-- Backfill lead contact identity from the linked client so existing leads keep their info.
UPDATE "leads" l SET
  "contactName"  = COALESCE(l."contactName",  c."name"),
  "companyName"  = COALESCE(l."companyName",  c."company"),
  "contactEmail" = COALESCE(l."contactEmail", c."email"),
  "contactPhone" = COALESCE(l."contactPhone", c."phone")
FROM "clients" c
WHERE l."clientId" = c."id";
