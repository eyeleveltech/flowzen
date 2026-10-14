-- Sales next step plan: a next step and date on every open deal and active
-- lead, the last real contact ("last touch"), and the two stale thresholds.
-- Additive only: ADD COLUMN and UPDATE. Nothing is dropped or narrowed.

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "dealStaleDays" INTEGER NOT NULL DEFAULT 25,
ADD COLUMN     "outreachStaleDays" INTEGER NOT NULL DEFAULT 10;

-- AlterTable
ALTER TABLE "outreach_entries" ADD COLUMN     "lastTouchedAt" TIMESTAMP(3),
ADD COLUMN     "nextStep" TEXT;

-- AlterTable
ALTER TABLE "proposals" ADD COLUMN     "lastTouchedAt" TIMESTAMP(3),
ADD COLUMN     "nextStep" TEXT,
ADD COLUMN     "nextStepDate" DATE;

-- Backfill: a deal's last touch is the latest of its versions sent, its
-- verbal yes, its win, a proforma raised against it, its own activity (not
-- probability, edit, delete or restore — those are not contact), and a call,
-- meeting, email or WhatsApp logged on its client. GREATEST skips NULLs.
UPDATE "proposals" p
SET "lastTouchedAt" = t."at"
FROM (
  SELECT
    p2."id",
    GREATEST(
      (SELECT max(v."sentAt") FROM "proposal_versions" v WHERE v."proposalId" = p2."id"),
      p2."verbalYesAt",
      p2."wonAt",
      (SELECT max(pf."raisedAt")::timestamp(3) FROM "proformas" pf
        WHERE pf."sourceType" = 'PROPOSAL' AND pf."sourceId" = p2."id"),
      (SELECT max(a."at") FROM "activities" a
        WHERE a."entityType" = 'Proposal' AND a."entityId" = p2."id"
          AND a."verb" NOT IN ('probability_overridden', 'proposal_edited', 'proposal_deleted', 'proposal_restored')),
      (SELECT max(a."at") FROM "activities" a
        WHERE a."entityType" = 'Company' AND a."entityId" = p2."companyId"
          AND a."verb" IN ('call_logged', 'meeting_logged', 'email_logged', 'whatsapp_logged'))
    ) AS "at"
  FROM "proposals" p2
) t
WHERE t."id" = p."id" AND t."at" IS NOT NULL;

-- Backfill: a lead's last touch is its latest status change. `updatedAt` is
-- not a touch — editing a phone number is not talking to anybody — so a lead
-- whose status never changed stays empty and counts from when it was added.
UPDATE "outreach_entries" o
SET "lastTouchedAt" = t."at"
FROM (
  SELECT a."entityId" AS "id", max(a."at") AS "at"
  FROM "activities" a
  WHERE a."entityType" = 'OutreachEntry' AND a."verb" = 'outreach_status_changed'
  GROUP BY a."entityId"
) t
WHERE t."id" = o."id";
