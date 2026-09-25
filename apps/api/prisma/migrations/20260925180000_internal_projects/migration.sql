-- Somewhere to file the studio's own work.
--
-- An internal task carried `workType = 'INTERNAL'` and nothing else: no month
-- card, no project, no bucket of any kind. So a website refresh, a hiring
-- round, GST filing prep and an office Wi-Fi renewal all sat in one flat list,
-- told apart only by whoever happened to be holding them.
--
-- This is `retainer_projects` with the retainer taken off. It holds no money
-- and cannot come to hold any: a cost row points at a month card or a one-time
-- project, and no column added here points at this table.
--
-- Entirely additive — one new table, one nullable column, one index. Nothing is
-- dropped, nothing is rewritten, and no existing row changes. Existing internal
-- tasks keep a NULL project and are filed later by editing the task.

CREATE TYPE "InternalProjectStatus" AS ENUM ('ACTIVE', 'DONE');

CREATE TABLE "internal_projects" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" TEXT,
    "status" "InternalProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "internal_projects_pkey" PRIMARY KEY ("id")
);

-- One bucket per name, so the list cannot quietly grow two "Hiring"s.
CREATE UNIQUE INDEX "internal_projects_organizationId_name_key" ON "internal_projects"("organizationId", "name");
CREATE INDEX "internal_projects_organizationId_status_idx" ON "internal_projects"("organizationId", "status");

ALTER TABLE "internal_projects"
  ADD CONSTRAINT "internal_projects_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SetNull: a person leaving does not close down the work they were named on.
ALTER TABLE "internal_projects"
  ADD CONSTRAINT "internal_projects_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tasks" ADD COLUMN "internalProjectId" TEXT;

CREATE INDEX "tasks_internalProjectId_idx" ON "tasks"("internalProjectId");

-- SetNull for the same reason as the retainer one: closing a bucket must not
-- take the work that was done under it.
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_internalProjectId_fkey"
  FOREIGN KEY ("internalProjectId") REFERENCES "internal_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
