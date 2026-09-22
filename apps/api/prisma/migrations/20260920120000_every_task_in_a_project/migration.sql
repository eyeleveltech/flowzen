-- Every retainer task belongs to a project.
--
-- Until now a task on a month card could carry a project or not, and most did
-- not: the screen showed a "Not in a project" card holding 36 of the 52
-- month-card tasks, and three retainers had no projects at all, so every one
-- of their tasks lived there. Optional grouping that most work skips is not
-- grouping; it is a second list with a worse name.
--
-- So the rule becomes: a task on a month card names a retainer project. Which
-- needs four things, in this order — the column, a project for every retainer
-- to point at, the existing rows moved into it, and only then the constraint.

-- 1. The default project flag.
ALTER TABLE "retainer_projects" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- One default per retainer, enforced by the database rather than by hope. A
-- partial index is the honest way to say "at most one row where isDefault".
CREATE UNIQUE INDEX "retainer_projects_one_default_per_retainer"
  ON "retainer_projects" ("retainerId") WHERE "isDefault";

-- 2. Every retainer gets one.
--
-- Named for what it is rather than for a campaign nobody agreed to: this is
-- the monthly baseline the template produces, not a piece of work somebody
-- scoped. A retainer that already has projects still gets one, because the
-- existing ones are campaigns with ends and this is the thing that does not.
INSERT INTO "retainer_projects" ("id", "retainerId", "name", "status", "isDefault", "createdAt", "updatedAt")
SELECT
  -- cuid-shaped enough to sit beside the rest without pretending to be one.
  'seedless' || substr(md5(r."id" || 'default-project'), 1, 17),
  r."id",
  'Monthly Retainer Work',
  'ACTIVE',
  true,
  NOW(),
  NOW()
FROM "retainers" r
WHERE NOT EXISTS (
  SELECT 1 FROM "retainer_projects" p WHERE p."retainerId" = r."id" AND p."isDefault"
);

-- 3. Move the ungrouped work into it.
--
-- Scoped through the month card's retainer, so a task lands in ITS client's
-- default project and never somebody else's — the same pairing rule the
-- trigger below enforces.
UPDATE "tasks" t
SET "retainerProjectId" = p."id"
FROM "month_cards" mc
JOIN "retainer_projects" p ON p."retainerId" = mc."retainerId" AND p."isDefault"
WHERE t."monthCardId" = mc."id"
  AND t."retainerProjectId" IS NULL;

-- 4. And now it can be a rule.
--
-- A CHECK rather than a trigger because it is a statement about one row and
-- nothing else: if a task is billed to a month, it is filed under a project.
-- The reverse was already enforced (a project needs a month) and stays so.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_month_card_needs_project"
  CHECK ("monthCardId" IS NULL OR "retainerProjectId" IS NOT NULL);

-- 5. Deleting a project must not orphan its work.
--
-- The foreign key was ON DELETE SET NULL, which would now break the CHECK
-- above — deleting a project would try to leave its tasks on a month with no
-- project and the whole delete would fail with a constraint error nobody could
-- read. The route reassigns tasks to the default before deleting, and this
-- trigger is what holds when the route is not the one writing: it moves them
-- rather than nulling them.
CREATE OR REPLACE FUNCTION reassign_tasks_before_project_delete() RETURNS trigger AS $$
DECLARE
  held    INTEGER;
  fallback TEXT;
BEGIN
  SELECT count(*) INTO held FROM "tasks" WHERE "retainerProjectId" = OLD."id";

  -- Nothing hangs off it, so there is nothing to protect. This is also the
  -- path a cascading delete takes — the retainer goes, its month cards go,
  -- its tasks go, and the projects follow an empty table.
  IF held = 0 THEN
    RETURN OLD;
  END IF;

  -- It still holds work, and it is the thing every other project falls back
  -- to, so there is nowhere for that work to go.
  IF OLD."isDefault" THEN
    RAISE EXCEPTION 'The default project still holds work, so it cannot be deleted';
  END IF;

  SELECT p."id" INTO fallback
  FROM "retainer_projects" p
  WHERE p."retainerId" = OLD."retainerId" AND p."isDefault"
  LIMIT 1;
  IF fallback IS NULL THEN
    RAISE EXCEPTION 'That retainer has no default project to move the work into';
  END IF;

  UPDATE "tasks" SET "retainerProjectId" = fallback WHERE "retainerProjectId" = OLD."id";
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER retainer_projects_reassign_before_delete
  BEFORE DELETE ON "retainer_projects"
  FOR EACH ROW EXECUTE FUNCTION reassign_tasks_before_project_delete();
