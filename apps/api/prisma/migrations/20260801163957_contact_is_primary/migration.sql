-- Marks the main person on a company.
--
-- Step 1 of moving a lead's contact details off the lead row and into lead_contacts. A lead is a
-- COMPANY; the people belong to it and there can be several, each with their own details and role
-- (decision maker / champion / gatekeeper). Until now a lead ALSO carried one flat contact in its
-- own columns, so the same person existed in two places.
--
-- Purely additive: both columns default to false and nothing is dropped or retyped. The existing
-- flat columns on "leads" stay untouched — they are removed only after the backfill has been
-- verified in production (expand -> backfill -> contract).
--
-- Mirrored onto client_contacts so the primary survives conversion: a lead and the client it
-- becomes hold the same contact shape.
ALTER TABLE "lead_contacts"   ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "client_contacts" ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT false;
