-- Remove PROSPECT from ClientStatus.
--
-- A Client is a customer — the account is born only when a deal is won, or by bulk import of
-- customers you already have. "Not yet a customer" is what the pipeline is for, and a lead sitting
-- at NEW_LEAD already says it. Keeping PROSPECT on the client record meant the same relationship
-- was tracked in two places, and the Clients list mixed customers with non-customers, which is why
-- the dashboard's Active Clients count and the list disagreed.
--
-- Existing prospects become ACTIVE rather than being deleted: the row was imported deliberately,
-- and its projects/quotes/contacts hang off it. Anything genuinely not a customer should be worked
-- from its pipeline card and, if it never converts, moved to CHURNED.

-- 1. Empty the value before the type can drop it.
UPDATE "clients" SET "status" = 'ACTIVE' WHERE "status" = 'PROSPECT';

-- 2. Rebuild the enum. Postgres cannot remove a value from an enum in place, so this is the same
--    create-new / swap / drop-old dance used by 20260620160000_pipeline_redesign_phase1.
CREATE TYPE "ClientStatus_new" AS ENUM ('ACTIVE','ONHOLD','CHURNED','PROJECT_COMPLETED');

ALTER TABLE "clients" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "clients" ALTER COLUMN "status" TYPE "ClientStatus_new" USING ("status"::text::"ClientStatus_new");
DROP TYPE "ClientStatus";
ALTER TYPE "ClientStatus_new" RENAME TO "ClientStatus";

-- 3. New default. An account only ever comes into existence at a win or as an imported customer,
--    so ACTIVE is the correct starting point for both; the stage cascade moves it on from there.
ALTER TABLE "clients" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
