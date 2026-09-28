-- A tax invoice can say which milestone it settles.
--
-- The billing ladder on a project — Pending → Proforma raised → Invoiced →
-- Paid — was derived for its first step only. Raising a proforma moved the
-- milestone, and cancelling one gave it back. Nothing else did: creating an
-- invoice and recording a payment never touched a milestone at all, so the
-- last two steps could only be typed in by hand, and "collected" was a claim
-- with no document behind it.
--
-- The reason it was typed is that there was nowhere to write the truth down.
-- Tally is this studio's book of record, and an invoice raised there against a
-- milestone could only reach Flowzen through a proforma it never had. This is
-- that missing attachment.
--
-- Entirely additive: one nullable column and one index. Nothing is dropped,
-- nothing is rewritten, no existing row changes. Milestones already sitting at
-- INVOICED or PAID with no document keep their status — the separate backfill
-- question is a decision for the studio, not for a migration.

ALTER TABLE "invoices" ADD COLUMN "milestoneId" TEXT;

CREATE INDEX "invoices_milestoneId_idx" ON "invoices"("milestoneId");

-- SetNull, not Cascade: removing a milestone must never remove the tax invoice
-- that settled it. That document went to a client and is a statutory record.
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_milestoneId_fkey"
  FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
