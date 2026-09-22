-- The empty cards the Talking stage left behind.
--
-- The migration before this one moved every TALKING proposal to PROPOSAL_SENT
-- so the enum value could be dropped. That is right for a proposal that was
-- actually sent, and wrong for the ones that were never sent at all: adding a
-- company used to open a TALKING proposal by itself, with no version, no value
-- and no scope. On a database that has been in use, those would have arrived on
-- the board as valueless cards in the first column -- the same phantom, moved
-- one column to the right.
--
-- A proposal with NO version rows can only be one of them. POST /proposals
-- writes the proposal and its version n=1 in a single transaction, so a real
-- proposal has had a version from the moment it existed. (A version worth ₹0 is
-- a different thing -- somebody logged a quote before the number was settled --
-- and is deliberately left alone.)
--
-- Safe to delete: proposal_versions is the only foreign key pointing at a
-- proposal, and these have none.
--
-- This is a separate migration rather than an edit to the one before it because
-- that one has already been applied; changing an applied migration's contents
-- breaks its checksum and every later `migrate deploy`.

DELETE FROM "proposals" p
WHERE NOT EXISTS (
  SELECT 1 FROM "proposal_versions" v WHERE v."proposalId" = p."id"
);
