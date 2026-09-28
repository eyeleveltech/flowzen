-- A task can say which client it is about.
--
-- Chasing somebody was already a thing this system did in three places —
-- adding a company with a follow-up date, logging a meeting with one, and the
-- scanner when a proposal has gone quiet — and all three created the same
-- shape: an INTERNAL task titled "Follow up — Acme Interiors", with the
-- client's name in a string and no link to the client at all.
--
-- Two things followed from that. The company's own page could not show what
-- was outstanding against it, so the follow-up you scheduled on Monday was
-- invisible on the screen you open on Friday. And renaming a company left
-- those tasks pointing at a name nobody uses any more.
--
-- Only ever set on an INTERNAL task. A month-card or project task already
-- knows its client through the work, and a second answer to the same question
-- is a second thing that can disagree.
--
-- Additive: one nullable column, one index, one foreign key. Nothing is
-- dropped and no existing row changes — the follow-up tasks already in the
-- table keep their titles and simply have no link yet.

ALTER TABLE "tasks" ADD COLUMN "companyId" TEXT;

CREATE INDEX "tasks_companyId_status_idx" ON "tasks"("companyId", "status");

-- Cascade, like the month card and the project: chasing a client that no
-- longer exists is not work anybody has to do.
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
