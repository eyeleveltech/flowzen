-- Who paid becomes a name somebody types, not one of three.
--
-- `CostPaidBy` held COMPANY, AKMAL and JAMEEL_N_J_MACSON -- two partners and the
-- firm, written into the database in 2026. Anybody else who puts their own money
-- into a shoot has nowhere to be recorded, and a new partner, a new director or
-- a staff member covering a courier is a migration. The column exists to say
-- WHOSE money it was, and that is an open question.
--
-- Nothing branches on the value: it is stored, shown and exported. The loan
-- accounting runs off `treatment` (COMPANY_EXPENSE / AKMAL_LOAN /
-- N_J_MACSON_LOAN), which stays an enum because those three ARE the rule.
--
-- Stored as the words themselves, the same trade Company.vertical and
-- Organization.aiProvider already make: database-level integrity for a list
-- that can grow without a migration.

ALTER TABLE "costs" ALTER COLUMN "paidBy" DROP DEFAULT;
ALTER TABLE "costs" ALTER COLUMN "paidBy" TYPE TEXT USING "paidBy"::TEXT;

-- Every existing row carries one of the three. Mapped rather than left as-is,
-- because a cost reading "JAMEEL_N_J_MACSON" in a box somebody is about to
-- retype is a row that cannot be edited without changing it.
UPDATE "costs" SET "paidBy" = 'Company'            WHERE "paidBy" = 'COMPANY';
UPDATE "costs" SET "paidBy" = 'Akmal'              WHERE "paidBy" = 'AKMAL';
UPDATE "costs" SET "paidBy" = 'Jameel, N J Macson' WHERE "paidBy" = 'JAMEEL_N_J_MACSON';

ALTER TABLE "costs" ALTER COLUMN "paidBy" SET DEFAULT 'Company';

DROP TYPE "CostPaidBy";
