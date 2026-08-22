-- Module K — retainer renewal tracking.
CREATE TYPE "RenewalStatus" AS ENUM ('UPCOMING', 'IN_DISCUSSION', 'RENEWED', 'AT_RISK', 'CHURNED');

ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "contractStartDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "contractEndDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "nextRenewalDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "autoRenewal" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "renewalStatus" "RenewalStatus",
  ADD COLUMN IF NOT EXISTS "renewalNotes" TEXT;
