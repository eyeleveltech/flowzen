-- Give every pipeline (Lead) identity/contact field a home on the Client account.
--
-- These six fields were captured on the Lead but had no Client column, so they were dropped at
-- lead -> client conversion. Worse, landlinePhone/zip/country are in the "frozen after
-- conversion" identity set, so once a deal was won they became read-only on the lead yet had
-- nowhere to live on the client. Adding the columns reconciles the two schemas.

ALTER TABLE "clients" ADD COLUMN "landlinePhone" TEXT;
ALTER TABLE "clients" ADD COLUMN "zip" TEXT;
ALTER TABLE "clients" ADD COLUMN "country" TEXT;
ALTER TABLE "clients" ADD COLUMN "companySize" TEXT;
ALTER TABLE "clients" ADD COLUMN "instagramHandle" TEXT;
ALTER TABLE "clients" ADD COLUMN "facebookPage" TEXT;
