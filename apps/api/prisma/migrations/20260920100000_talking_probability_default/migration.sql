-- TALKING is the one stage §14 does not price, because a proposal only reaches
-- the board at Proposal sent. The app held two values for it — the board said
-- 20, the forecast said 10 — and unifying on 20 doubled the speculative inflow
-- in the forecast's own "does the pipeline flatter this month" test.
--
-- The lower one wins. This figure feeds a solvency verdict, and the forecast
-- must never report a surplus that exists only if deals land.

ALTER TABLE "organizations" ALTER COLUMN "stageProbTalking" SET DEFAULT 10;
UPDATE "organizations" SET "stageProbTalking" = 10 WHERE "stageProbTalking" = 20;
