-- One retainer and one project per won deal, enforced by the database.
--
-- The application already checked this, and the check had a hole: it filtered
-- `deletedAt`, so a project in the bin was invisible to it. Delete a project,
-- and the deal it came from reads as unfulfilled again; create a second from
-- the same deal, allowed; restore the first, and two live projects claim one
-- win. The pipeline board resolves the link by building a map, so the Won card
-- then points at whichever row Prisma happened to return last.
--
-- An index is the only version of this rule that survives somebody forgetting
-- to write the check. Postgres allows any number of NULLs under a unique
-- index, so the work created without naming its deal — which is all of it
-- today, 0 of 6 retainers and 0 of 8 projects — is untouched.
--
-- Verified before writing this: no proposal currently has two of either.
--
-- The last index is not a rule, it is speed: every list of live work now
-- filters on `deletedAt`, and neither of Project's existing indexes covers it,
-- so the pipeline's per-board lookup was scanning the organisation's projects.

CREATE UNIQUE INDEX "projects_sourceProposalId_key" ON "projects"("sourceProposalId");

CREATE UNIQUE INDEX "retainers_sourceProposalId_key" ON "retainers"("sourceProposalId");

CREATE INDEX "projects_organizationId_deletedAt_idx" ON "projects"("organizationId", "deletedAt");
