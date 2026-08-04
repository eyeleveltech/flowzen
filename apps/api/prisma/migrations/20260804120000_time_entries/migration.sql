-- Logged hours, for costing delivery work into the P&L.
--
-- Purely additive: one new table and one nullable column. Nothing existing changes shape, so
-- this is safe to deploy ahead of the code that uses it.
--
-- Task.loggedHours is deliberately LEFT ALONE. It is a single overwritable total that was never
-- populated (0 rows carry a value), and the new table supersedes it — but dropping a column is a
-- separate, destructive decision and does not belong in the migration that adds a feature.

-- Internal cost of an hour of a person's time. What the agency pays, not what a client is
-- billed. Numeric, not double precision — money is never a float (FZ-020).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "hourlyCostRate" DECIMAL(12,2);

CREATE TABLE "time_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT,
    "projectId" TEXT,
    "clientId" TEXT,
    -- The day the work HAPPENED, not the day it was typed in.
    "date" TIMESTAMP(3) NOT NULL,
    "hours" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    -- Snapshot of the person's rate at save time. Copied rather than joined so that a later pay
    -- rise cannot silently rewrite the reported profitability of past work.
    "costRate" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "time_entries_organizationId_date_idx" ON "time_entries"("organizationId", "date");
CREATE INDEX "time_entries_userId_date_idx" ON "time_entries"("userId", "date");
CREATE INDEX "time_entries_projectId_idx" ON "time_entries"("projectId");
CREATE INDEX "time_entries_taskId_idx" ON "time_entries"("taskId");

-- Cascade throughout: an entry describes work on a specific thing for a specific person, and is
-- meaningless once that thing is gone. Deleting a user or a project should not strand rows that
-- keep counting toward a cost total nobody can attribute.
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
