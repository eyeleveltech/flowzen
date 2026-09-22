-- The "For <legal name> / Authorised Signatory" box becomes a choice.
--
-- Additive, NOT NULL with a default of true, so every organisation keeps the
-- behaviour it had and no document already raised reprints differently.

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "showSignatureBlock" BOOLEAN NOT NULL DEFAULT true;
