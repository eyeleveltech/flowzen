-- Talking, removed.
--
-- The stage never worked, and the way it failed put fiction on the board.
--
-- Adding a company opened a Proposal in TALKING by itself — no version, so no
-- value, no scope, nothing quoted. It was a proposal nobody had proposed,
-- carrying the client's name on the pipeline.
--
-- It could not then be advanced. `PATCH /proposals/:id/stage` refuses it
-- ("Stage is derived from records, not set directly"), and the board's own drop
-- rules reject anything landing on Talking OR Proposal sent — so the one
-- forward move a Talking card needed was the one move it could not make.
-- Quoting the client called POST /proposals, which creates a SECOND row at
-- PROPOSAL_SENT, and the first was left behind. One company, two cards, one of
-- them permanently empty and removable only by hand.
--
-- It was also mislabelled: the auto-created row hardcoded kind = PROJECT, so a
-- client being pitched a retainer got a phantom marked "one-time project".
--
-- §14 never priced it in the first place — "a proposal only reaches the board
-- at Proposal sent" — which is where the board starts now. A company is a
-- company; it appears on the pipeline when somebody actually sends a number.

-- Any straggler becomes what it would have been the moment it was quoted.
-- Nothing is lost: a TALKING row has no version, so there is no value or scope
-- to carry over, and the stage it lands in is the first one that means
-- anything.
UPDATE "proposals" SET "stage" = 'PROPOSAL_SENT' WHERE "stage" = 'TALKING';

-- Postgres cannot drop a value from an enum in place, so the type is rebuilt.
-- The default has to come off first: it references the old type, and the column
-- cannot be retyped while it does.
ALTER TYPE "ProposalStage" RENAME TO "ProposalStage_old";

CREATE TYPE "ProposalStage" AS ENUM (
  'PROPOSAL_SENT',
  'IN_NEGOTIATION',
  'PROFORMA_ISSUED',
  'VERBAL_YES',
  'WON',
  'LOST',
  'EXPIRED'
);

ALTER TABLE "proposals" ALTER COLUMN "stage" DROP DEFAULT;
ALTER TABLE "proposals"
  ALTER COLUMN "stage" TYPE "ProposalStage" USING ("stage"::text::"ProposalStage");
ALTER TABLE "proposals" ALTER COLUMN "stage" SET DEFAULT 'PROPOSAL_SENT';

DROP TYPE "ProposalStage_old";

-- The probability that priced the stage. §8 computes weighted pipeline as
-- value × probability, and with no stage to weight there is nothing for this
-- number to multiply.
ALTER TABLE "organizations" DROP COLUMN "stageProbTalking";
