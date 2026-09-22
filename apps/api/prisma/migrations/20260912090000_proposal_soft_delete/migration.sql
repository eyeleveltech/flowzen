-- Proposal soft delete (§16: nothing is ever hard deleted by a user).
--
-- Additive and nullable, so every existing proposal reads as not deleted and
-- nothing has to be backfilled. Only a proposal with no outcome can be
-- deleted at all — see the guard in routes/proposals.ts — so the funnel, the
-- win rate and the project/retainer handoff keep reading a complete history.

-- AlterTable
ALTER TABLE "proposals" ADD COLUMN     "deletedAt" TIMESTAMP(3);
