-- Bringing two §14 settings into line with the brief.
--
-- Stage probabilities: "All configurable in Setup", with defaults 30/60/85/90.
-- They were hardcoded and read 40/60/80/95, and §8 computes weighted pipeline
-- as value x probability — so every weighted figure was built on numbers the
-- brief does not authorise. Defaults here are the brief's; TALKING keeps 20
-- because the brief gives no figure for a stage a proposal has not reached.
--
-- Holidays: "Sundays and public holidays excluded". workingDays covered the
-- Sundays and nothing covered the holidays, so every elapsed-time figure
-- counted Pongal and Diwali as working days. Empty by default — an org's real
-- holiday list is its own to enter, and inventing one would be worse than none.

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "holidays" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "stageProbInNegotiation" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "stageProbProformaIssued" INTEGER NOT NULL DEFAULT 85,
ADD COLUMN     "stageProbProposalSent" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "stageProbTalking" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "stageProbVerbalYes" INTEGER NOT NULL DEFAULT 90;
