-- Scope project templates per organization.
--
-- ProjectTemplate had no organizationId at all, so it sat outside the tenant wall every
-- other table sits behind. GET /settings/templates ran findMany() with no `where`, which
-- meant every tenant could read every other tenant's template names, descriptions and
-- `structure` JSON (their task breakdowns / internal process). POST created rows with no
-- owner, so one org's new template appeared in every other org's list.
--
-- Backfill strategy — the column must end up NOT NULL, but existing rows have no owner
-- recorded anywhere (the table has no createdBy either). The only evidence of ownership is
-- the projects that use a template: project -> client -> organizationId. So:
--   1. add the column nullable, so existing rows survive the ALTER;
--   2. attribute each template from the projects that reference it;
--   3. orphans (no projects) are only resolvable when a single tenant exists — assign those;
--   4. if anything is still unattributed (multi-org + orphans), RAISE rather than guess.
-- Step 4 fails the migration loudly instead of silently handing one tenant's template to
-- another. On a single-tenant or empty database steps 2-4 are no-ops.

-- 1) Add nullable so the ALTER cannot fail on existing rows.
ALTER TABLE "project_templates" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;

-- 2) Attribute via the projects that use each template.
UPDATE "project_templates" t
SET "organizationId" = sub.org
FROM (
  SELECT p."templateId" AS tpl, MIN(c."organizationId") AS org
  FROM "projects" p
  JOIN "clients" c ON c."id" = p."clientId"
  WHERE p."templateId" IS NOT NULL
  GROUP BY p."templateId"
) sub
WHERE t."id" = sub.tpl
  AND t."organizationId" IS NULL;

-- 3) Orphaned templates: unambiguous only when there is exactly one organization.
UPDATE "project_templates"
SET "organizationId" = (SELECT "id" FROM "organizations" ORDER BY "createdAt" ASC LIMIT 1)
WHERE "organizationId" IS NULL
  AND (SELECT count(*) FROM "organizations") = 1;

-- 4) Refuse to guess an owner. Assign these by hand, then re-run.
DO $$
DECLARE unattributed INT;
BEGIN
  SELECT count(*) INTO unattributed FROM "project_templates" WHERE "organizationId" IS NULL;
  IF unattributed > 0 THEN
    RAISE EXCEPTION 'Cannot migrate: % project_templates row(s) have no attributable organization. Set organizationId manually, then re-run.', unattributed;
  END IF;
END $$;

ALTER TABLE "project_templates" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "project_templates"
  ADD CONSTRAINT "project_templates_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "project_templates_organizationId_idx" ON "project_templates"("organizationId");
