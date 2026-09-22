-- Projects inside a retainer.
--
-- A retainer client does not buy "six tasks in September" — they buy a Diwali
-- campaign, an always-on content stream, a brand film. Those run across month
-- boundaries, and there was nowhere to say so: tasks hung directly off a
-- MonthCard, so a campaign spanning October and November was some tasks in one
-- month and some more in the next, with nothing joining them.
--
-- Two things worth knowing about the shape:
--
--   1. It carries no money. The retainer is already billed monthly through its
--      month cards; a value here would bill the same work twice and put a
--      second revenue figure into every report. That is also why this is its
--      own table rather than a nullable-money variant of `projects` — a
--      Project is one-off work sold for a quoted value, with milestones and
--      its own invoices, and none of that is true here.
--
--   2. `tasks.retainerProjectId` is set ALONGSIDE `monthCardId`, never instead
--      of it. The month card says which month a task is billed and costed in;
--      this says what the task is for. Both have to survive for a campaign to
--      cross a month without breaking that month's profit figure.
--
-- Entirely additive: one new table, one new nullable column, no existing row
-- read or rewritten.

-- CreateEnum
CREATE TYPE "RetainerProjectStatus" AS ENUM ('ACTIVE', 'DONE');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "retainerProjectId" TEXT;

-- CreateTable
CREATE TABLE "retainer_projects" (
    "id" TEXT NOT NULL,
    "retainerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE,
    "endDate" DATE,
    "ownerId" TEXT,
    "status" "RetainerProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retainer_projects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "retainer_projects_retainerId_status_idx" ON "retainer_projects"("retainerId", "status");

-- CreateIndex
CREATE INDEX "tasks_retainerProjectId_idx" ON "tasks"("retainerProjectId");

-- AddForeignKey
ALTER TABLE "retainer_projects" ADD CONSTRAINT "retainer_projects_retainerId_fkey" FOREIGN KEY ("retainerId") REFERENCES "retainers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retainer_projects" ADD CONSTRAINT "retainer_projects_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Deleting a piece of retainer work must not delete the tasks done under it:
-- they stay on their month card, which is where the month's cost and profit are
-- counted from. Hence SET NULL rather than CASCADE.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_retainerProjectId_fkey" FOREIGN KEY ("retainerProjectId") REFERENCES "retainer_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A task's project and its month card must belong to the SAME retainer.
-- Nothing in the schema alone prevents putting a Carlton task under a VOSO
-- campaign; the route checks it, and this is the check that holds when the
-- route is not the one writing.
CREATE OR REPLACE FUNCTION retainer_project_matches_month_card() RETURNS trigger AS $$
BEGIN
  IF NEW."retainerProjectId" IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW."monthCardId" IS NULL THEN
    RAISE EXCEPTION 'A task on a retainer project must also sit on a month card';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "retainer_projects" rp
    JOIN "month_cards" mc ON mc."retainerId" = rp."retainerId"
    WHERE rp."id" = NEW."retainerProjectId" AND mc."id" = NEW."monthCardId"
  ) THEN
    RAISE EXCEPTION 'That project and that month card belong to different retainers';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_retainer_project_check
  BEFORE INSERT OR UPDATE OF "retainerProjectId", "monthCardId" ON "tasks"
  FOR EACH ROW EXECUTE FUNCTION retainer_project_matches_month_card();
