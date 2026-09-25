-- A lead can be removed, and can come back.
--
-- The list had one way out: mark it Dead. That is the right end for a lead that
-- went nowhere -- who found them, what was said, when it stopped -- and it is
-- the wrong end for a row typed twice, a typo, or a line from a bad import.
-- Those sat in the Dead tab pretending to be leads that failed, which makes the
-- one number that tab exists to give ("how many did we lose") untrue.
--
-- Soft, like everything else a person removes in this app (§16): the row keeps
-- its history and Settings > Trash puts it back. Deleting one that was already
-- promoted is refused in the route -- the lead IS that company's history, and
-- the company page reads it.

ALTER TABLE "outreach_entries" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Every list, count and duplicate check filters on it, so it is worth an index
-- alongside the organisation the way the other soft-deleted tables have.
CREATE INDEX "outreach_entries_organizationId_deletedAt_idx"
  ON "outreach_entries"("organizationId", "deletedAt");
