-- Outreach change request 01: the cold list becomes a worklist.
--
-- ─── Read this before deploying ─────────────────────────────────────────────
--
-- This file is HAND-WRITTEN, not the one `prisma migrate diff` produces, and
-- the difference is the reason it exists. Prisma emits:
--
--     USING ("status"::text::"OutreachStatus_new")
--
-- which raises `invalid input value for enum "OutreachStatus_new": "CONTACTED"`
-- the first time it meets a row carrying a status this change removes. It does
-- not lose those rows quietly — it aborts the whole deploy. Production has
-- CONTACTED and REPLIED rows, so the generated migration could never have run.
--
-- The mapping below is therefore explicit and lossless:
--
--     REPLIED    -> INTERESTED   (a rename; the meaning is narrowed, not lost)
--     CONTACTED  -> FOLLOW_UP    (the nearest true statement: we spoke to them)
--
-- No row is deleted and no column is dropped. Nothing here is destructive.

BEGIN;

-- ─── 1. The five statuses ───────────────────────────────────────────────────

CREATE TYPE "OutreachStatus_new" AS ENUM ('NOT_CONTACTED', 'FOLLOW_UP', 'MEETING', 'INTERESTED', 'DEAD');

ALTER TABLE "public"."outreach_entries" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "public"."outreach_entries"
  ALTER COLUMN "status" TYPE "OutreachStatus_new"
  USING (
    CASE "status"::text
      WHEN 'REPLIED'   THEN 'INTERESTED'
      WHEN 'CONTACTED' THEN 'FOLLOW_UP'
      ELSE "status"::text
    END
  )::"OutreachStatus_new";

ALTER TYPE "OutreachStatus" RENAME TO "OutreachStatus_old";
ALTER TYPE "OutreachStatus_new" RENAME TO "OutreachStatus";
DROP TYPE "public"."OutreachStatus_old";

ALTER TABLE "public"."outreach_entries" ALTER COLUMN "status" SET DEFAULT 'NOT_CONTACTED';

-- ─── 2. What a lead now carries ─────────────────────────────────────────────

ALTER TABLE "public"."outreach_entries"
  ADD COLUMN "contactPersonName" TEXT,
  ADD COLUMN "email"             TEXT,
  ADD COLUMN "phone"             TEXT,
  ADD COLUMN "remarks"           TEXT,
  ADD COLUMN "nextActionDate"    DATE;

-- ─── 3. The rows we just moved off CONTACTED ────────────────────────────────
--
-- FOLLOW_UP requires a callback date and a note. The migrated rows have
-- neither — there was nowhere to record them until the columns above existed —
-- so without this they would sit in a state the application itself refuses to
-- save, and the first person to edit one would be asked for a note about a
-- call they never made. Saying so plainly is better than inventing one.

UPDATE "public"."outreach_entries"
SET "nextActionDate" = CURRENT_DATE,
    "remarks"        = 'Migrated from Contacted. No call note was recorded against this lead — please update it after the next call.'
WHERE "status" = 'FOLLOW_UP'
  AND "remarks" IS NULL;

-- ─── 4. A lead you cannot reach is a note, not a lead ───────────────────────
--
-- The change request asks for this as a database constraint:
--
--     CHECK (phone IS NOT NULL OR email IS NOT NULL)
--
-- It is NOT added here, and the reason is worth recording, because the obvious
-- fix does not work.
--
-- Every row that exists today has NULL for both columns — necessarily, since
-- neither column existed until this file ran. Adding the constraint plainly
-- rejects the whole table. Adding it NOT VALID looks like the answer and is
-- not: NOT VALID skips the existing rows only at CREATION time, and Postgres
-- still checks the constraint on every subsequent UPDATE of those rows. Tested
-- against a scratch copy of this schema, renaming one legacy lead fails with:
--
--     ERROR: new row for relation "outreach_entries" violates check
--     constraint "outreach_entries_phone_or_email"
--
-- So the seven leads already in the table could never be edited again — not
-- renamed, and not even moved to a new status — without someone inventing a
-- phone number for them. That is a worse outcome than the rule is worth.
--
-- The rule is therefore enforced in the application, on BOTH write paths (the
-- manual add form and the CSV import), where it can also say something useful
-- instead of raising a constraint violation at a person.
--
-- Once the backlog has real contact details against it, this becomes a true
-- guarantee with two statements and no exemption:
--
--     ALTER TABLE "outreach_entries"
--       ADD CONSTRAINT "outreach_entries_phone_or_email"
--       CHECK ("phone" IS NOT NULL OR "email" IS NOT NULL) NOT VALID;
--     ALTER TABLE "outreach_entries"
--       VALIDATE CONSTRAINT "outreach_entries_phone_or_email";
--
-- Run those only when `SELECT count(*) FROM outreach_entries
-- WHERE phone IS NULL AND email IS NULL` returns 0.

COMMIT;
