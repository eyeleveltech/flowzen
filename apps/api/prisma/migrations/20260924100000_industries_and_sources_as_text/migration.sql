-- Industries and lead sources become open lists.
--
-- Both were Prisma enums: eight industries and five sources. The studio wants
-- sixty-seven industries and fourteen sources, and a list that long cannot be
-- an enum -- it exists to grow, and every addition would be another migration
-- for a taxonomy that changes whenever the agency takes on a kind of work it
-- has not done before.
--
-- So the columns become TEXT and the lists live in @flowzen/shared, which the
-- API validates against. That trades database-level integrity for a check at
-- the door, which is the same trade Organization.aiProvider already makes.
--
-- Stored as the words themselves rather than SCREAMING_SNAKE with a label map.
-- The old enum needed such a map because IT_AND_SAAS title-cases to "It And
-- Saas" and D2C lower-cases into nonsense; with sixty-seven values that map
-- would be the feature, and two lists that can drift apart.

-- Companies.
ALTER TABLE "companies" ALTER COLUMN "source" DROP DEFAULT;
ALTER TABLE "companies" ALTER COLUMN "vertical" TYPE TEXT USING "vertical"::TEXT;
ALTER TABLE "companies" ALTER COLUMN "source" TYPE TEXT USING "source"::TEXT;

-- Outreach entries.
ALTER TABLE "outreach_entries" ALTER COLUMN "source" DROP DEFAULT;
ALTER TABLE "outreach_entries" ALTER COLUMN "vertical" TYPE TEXT USING "vertical"::TEXT;
ALTER TABLE "outreach_entries" ALTER COLUMN "source" TYPE TEXT USING "source"::TEXT;

-- Every existing row carries one of the old thirteen values. Mapped rather than
-- left as-is, because a company reading "REAL_ESTATE" in a dropdown of
-- "Real Estate & Infrastructure" is a row nobody can edit without changing it.
--
-- PARTNER_AGENCY is the one that needed a decision rather than a lookup: the
-- new list has no "partner agency", and the work those rows describe comes
-- referred through a partner, so it becomes Partnerships. NETWORK becomes
-- Networking & Events rather than Founder / Personal Network, because the old
-- value covered both and events is the broader reading.
UPDATE "companies" SET "vertical" = CASE "vertical"
  WHEN 'HEALTHCARE'  THEN 'Healthcare & Wellness'
  WHEN 'REAL_ESTATE' THEN 'Real Estate & Infrastructure'
  WHEN 'D2C'         THEN 'E-commerce & D2C'
  WHEN 'SPORTS'      THEN 'Sports & Fitness'
  WHEN 'IT_AND_SAAS' THEN 'Technology & SaaS'
  WHEN 'RETAIL'      THEN 'Retail'
  WHEN 'B2B'         THEN 'Corporate & B2B'
  WHEN 'HOSPITALITY' THEN 'Hospitality'
  ELSE "vertical" END;

UPDATE "companies" SET "source" = CASE "source"
  WHEN 'OUTREACH'       THEN 'Cold Outreach'
  WHEN 'REFERRAL'       THEN 'Referrals'
  WHEN 'INBOUND'        THEN 'Website / Inbound'
  WHEN 'PARTNER_AGENCY' THEN 'Partnerships'
  WHEN 'NETWORK'        THEN 'Networking & Events'
  ELSE "source" END;

UPDATE "outreach_entries" SET "vertical" = CASE "vertical"
  WHEN 'HEALTHCARE'  THEN 'Healthcare & Wellness'
  WHEN 'REAL_ESTATE' THEN 'Real Estate & Infrastructure'
  WHEN 'D2C'         THEN 'E-commerce & D2C'
  WHEN 'SPORTS'      THEN 'Sports & Fitness'
  WHEN 'IT_AND_SAAS' THEN 'Technology & SaaS'
  WHEN 'RETAIL'      THEN 'Retail'
  WHEN 'B2B'         THEN 'Corporate & B2B'
  WHEN 'HOSPITALITY' THEN 'Hospitality'
  ELSE "vertical" END;

UPDATE "outreach_entries" SET "source" = CASE "source"
  WHEN 'OUTREACH'       THEN 'Cold Outreach'
  WHEN 'REFERRAL'       THEN 'Referrals'
  WHEN 'INBOUND'        THEN 'Website / Inbound'
  WHEN 'PARTNER_AGENCY' THEN 'Partnerships'
  WHEN 'NETWORK'        THEN 'Networking & Events'
  ELSE "source" END;

ALTER TABLE "companies" ALTER COLUMN "source" SET DEFAULT 'Cold Outreach';
ALTER TABLE "outreach_entries" ALTER COLUMN "source" SET DEFAULT 'Cold Outreach';

-- Nothing references these any more.
DROP TYPE "CompanyVertical";
DROP TYPE "CompanySource";
