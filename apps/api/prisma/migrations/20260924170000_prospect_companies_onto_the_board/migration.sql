-- Put the prospects that already exist onto the board.
--
-- The Prospect column shows deals, and a deal is created when an outreach lead
-- is promoted. Every company that arrived any other way -- imported from a
-- spreadsheet, typed in, created from the pipeline's own "New lead" button --
-- has no deal at all, so the column was empty on a database holding eighteen
-- companies, six of them prospects.
--
-- One deal per PROSPECT company that has none. A company already carrying a
-- deal is left alone: it is further along the board and a second card would be
-- the same prospect twice.
--
-- Clients and past clients are not touched. A client is not a prospect, and
-- putting one on the pipeline would be inventing a deal nobody is working.
--
-- RETAINER because the studio's work is mostly retainers and nothing records
-- which this is -- the same default the promote form uses, and one click to
-- change on the deal.
INSERT INTO "proposals" ("id", "organizationId", "companyId", "kind", "ownerId", "stage", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  c."organizationId",
  c."id",
  'RETAINER'::"ProposalKind",
  -- The company's owner, or whoever runs the place. `ownerId` is required on a
  -- proposal and nullable on a company, so a prospect nobody owns still needs
  -- somebody's name against it.
  COALESCE(
    c."ownerId",
    (SELECT u."id" FROM "users" u
      WHERE u."organizationId" = c."organizationId" AND u."active"
      ORDER BY (u."preset" = 'MANAGEMENT') DESC, u."createdAt"
      LIMIT 1)
  ),
  'PROSPECT'::"ProposalStage",
  NOW(),
  NOW()
FROM "companies" c
WHERE c."status" = 'PROSPECT'
  AND NOT EXISTS (
    SELECT 1 FROM "proposals" p WHERE p."companyId" = c."id" AND p."deletedAt" IS NULL
  )
  -- Without an owner the insert would fail the NOT NULL; skip rather than stop
  -- the whole migration on an organisation with no active users.
  AND COALESCE(
    c."ownerId",
    (SELECT u."id" FROM "users" u
      WHERE u."organizationId" = c."organizationId" AND u."active"
      ORDER BY (u."preset" = 'MANAGEMENT') DESC, u."createdAt"
      LIMIT 1)
  ) IS NOT NULL;
