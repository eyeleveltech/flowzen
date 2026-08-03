-- The lead's people move into lead_contacts, and the lead becomes purely the COMPANY.
--
-- Final step of expand -> backfill -> contract. Until now a lead carried ONE person in flat
-- columns on its own row (contactName / contactEmail / contactPhone / jobTitle / linkedinUrl)
-- while lead_contacts held the real list, so the same human existed twice and the two copies
-- could disagree. Application code now reads and writes only lead_contacts.
--
-- THIS MIGRATION IS DESTRUCTIVE. Steps 1-3 exist so it is also SAFE: it re-runs the backfill in
-- SQL before dropping anything, so it cannot lose a contact even if
-- scripts/backfill-lead-primary-contact.ts was never run against this database. Prisma wraps the
-- whole file in one transaction, so a failure anywhere rolls the entire thing back.

-- 1. Every lead that still has flat contact data but no contact row gets one, marked primary.
--    Name falls back to the email's local part so details are never stranded; a lead with no
--    person at all is skipped (a company with nobody attached is a legitimate state).
INSERT INTO "lead_contacts" ("id", "leadId", "name", "designation", "email", "phone", "linkedinUrl", "role", "isPrimary", "createdAt")
SELECT
  gen_random_uuid()::text,
  l."id",
  COALESCE(NULLIF(TRIM(l."contactName"), ''), NULLIF(split_part(COALESCE(l."contactEmail", ''), '@', 1), '')),
  NULLIF(TRIM(COALESCE(l."jobTitle", '')), ''),
  NULLIF(TRIM(COALESCE(l."contactEmail", '')), ''),
  NULLIF(TRIM(COALESCE(l."contactPhone", '')), ''),
  NULLIF(TRIM(COALESCE(l."linkedinUrl", '')), ''),
  'CC_ONLY'::"ContactRole",
  true,
  NOW()
FROM "leads" l
WHERE NOT EXISTS (SELECT 1 FROM "lead_contacts" c WHERE c."leadId" = l."id")
  AND COALESCE(NULLIF(TRIM(l."contactName"), ''), NULLIF(split_part(COALESCE(l."contactEmail", ''), '@', 1), '')) IS NOT NULL;

-- 2. A lead that already had contacts but none flagged primary gets its oldest promoted, so every
--    lead ends up with exactly one primary for primaryContactOf to find.
UPDATE "lead_contacts" SET "isPrimary" = true
WHERE "id" IN (
  SELECT DISTINCT ON (x."leadId") x."id"
  FROM "lead_contacts" x
  WHERE NOT EXISTS (
    SELECT 1 FROM "lead_contacts" y WHERE y."leadId" = x."leadId" AND y."isPrimary" = true
  )
  ORDER BY x."leadId", x."createdAt" ASC
);

-- 3. companyName becomes NOT NULL (the lead IS the company). Fill any gaps from the best evidence
--    available before enforcing it, so an old person-first lead can't block the migration.
UPDATE "leads" l SET "companyName" = COALESCE(
  NULLIF(TRIM(l."companyName"), ''),
  (SELECT NULLIF(TRIM(COALESCE(cl."company", cl."name")), '') FROM "clients" cl WHERE cl."id" = l."clientId"),
  NULLIF(TRIM(COALESCE(l."contactName", '')), ''),
  'Unknown Company'
)
WHERE l."companyName" IS NULL OR TRIM(l."companyName") = '';

ALTER TABLE "leads" ALTER COLUMN "companyName" SET NOT NULL;

-- 4. Duplicate-phone uniqueness moves into the application (leadContact.service.ts). lead_contacts
--    has no organizationId of its own to rebuild this constraint from — it reaches the org through
--    its lead — so there is no equivalent database-level index to replace it with.
DROP INDEX IF EXISTS "leads_organizationId_contactPhone_key";

-- 5. The second copy of the person goes.
ALTER TABLE "leads"
  DROP COLUMN "contactName",
  DROP COLUMN "contactEmail",
  DROP COLUMN "contactPhone",
  DROP COLUMN "jobTitle",
  DROP COLUMN "linkedinUrl";
