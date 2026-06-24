-- Pipeline Phase 1 deltas: human-readable Lead ID + expanded lead fields.

-- 1. New columns on leads
ALTER TABLE "leads" ADD COLUMN "leadId" TEXT;
ALTER TABLE "leads" ADD COLUMN "companySize" TEXT;
ALTER TABLE "leads" ADD COLUMN "landlinePhone" TEXT;
ALTER TABLE "leads" ADD COLUMN "address" TEXT;
ALTER TABLE "leads" ADD COLUMN "city" TEXT;
ALTER TABLE "leads" ADD COLUMN "state" TEXT;
ALTER TABLE "leads" ADD COLUMN "zip" TEXT;
ALTER TABLE "leads" ADD COLUMN "country" TEXT DEFAULT 'India';
ALTER TABLE "leads" ADD COLUMN "website" TEXT;
ALTER TABLE "leads" ADD COLUMN "instagramHandle" TEXT;
ALTER TABLE "leads" ADD COLUMN "facebookPage" TEXT;
ALTER TABLE "leads" ADD COLUMN "industry" TEXT;
ALTER TABLE "leads" ADD COLUMN "lastContactedDate" TIMESTAMP(3);

-- 2. Lead ID counter table (per org, per month)
CREATE TABLE "lead_id_counters" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "yearMonth" TEXT NOT NULL,
  "counter" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "lead_id_counters_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "lead_id_counters_organizationId_yearMonth_key" ON "lead_id_counters"("organizationId", "yearMonth");

-- 3. Backfill leadId for existing leads: FL-YYYYMM-XXXXXX, sequential per org per month
WITH numbered AS (
  SELECT id,
         to_char("createdAt", 'YYYYMM') AS ym,
         row_number() OVER (
           PARTITION BY "organizationId", to_char("createdAt", 'YYYYMM')
           ORDER BY "createdAt", id
         ) AS rn
  FROM "leads"
)
UPDATE "leads" l
SET "leadId" = 'FL-' || n.ym || '-' || lpad(n.rn::text, 6, '0')
FROM numbered n
WHERE l.id = n.id;

-- 4. Seed the counters so newly created leads continue the sequence
INSERT INTO "lead_id_counters" ("id", "organizationId", "yearMonth", "counter")
SELECT gen_random_uuid()::text, "organizationId", to_char("createdAt", 'YYYYMM'), COUNT(*)::int
FROM "leads"
GROUP BY "organizationId", to_char("createdAt", 'YYYYMM');

-- 5. Constraints / indexes
CREATE UNIQUE INDEX "leads_leadId_key" ON "leads"("leadId");
CREATE INDEX "leads_organizationId_contactPhone_idx" ON "leads"("organizationId", "contactPhone");
