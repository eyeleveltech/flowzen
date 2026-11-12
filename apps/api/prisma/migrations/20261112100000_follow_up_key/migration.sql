-- Data only, no schema change. The stalled-deal follow-ups kept their key
-- ("proposal_followup:<proposal id>") in notes, where it showed on the
-- company page. It moves to workId, which the scanner now reads, and the
-- notes are left empty. Nothing else carries that key.
UPDATE "tasks"
SET "workId" = "notes", "notes" = NULL
WHERE "notes" LIKE 'proposal\_followup:%' AND "workId" IS NULL;

-- And every follow-up made without a type is sales work.
UPDATE "tasks"
SET "taskType" = 'BUSINESS_DEVELOPMENT'
WHERE "taskType" IS NULL
  AND "companyId" IS NOT NULL
  AND "projectId" IS NULL AND "monthCardId" IS NULL
  AND "retainerProjectId" IS NULL AND "internalProjectId" IS NULL;
