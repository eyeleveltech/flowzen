-- Departments Plan 1: a department becomes a real record.
-- Additive only: a new table, its indexes and foreign keys, one new column on
-- users, then the backfill (INSERT and UPDATE). Nothing is dropped:
-- users.dept and organizations.departments stay until Plan 4.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "departmentId" TEXT;

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "headId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "departments_organizationId_archivedAt_idx" ON "departments"("organizationId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "departments_organizationId_name_key" ON "departments"("organizationId", "name");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_headId_fkey" FOREIGN KEY ("headId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Backfill (decision 8) ──────────────────────────────────────────────────
--
-- One department per name in use: the organisation's old list plus every
-- non-blank users.dept, trimmed. Names that differ only by case are ONE
-- department; the spelling kept is the old list's if it has one, otherwise the
-- one most people use (ties: alphabetical). Nothing else is merged — "Video /
-- Production" and "Video & Production" stay two, for management to merge in
-- Settings -> Departments. Ordered as the old list was, then alphabetically.
-- prisma/departments-report.ts prints the result and anyone left unplaced.
WITH candidates AS (
  SELECT o."id" AS org, btrim(d.name) AS name, 0 AS src, d.pos AS pos, 0::bigint AS uses
  FROM "organizations" o
  CROSS JOIN LATERAL unnest(o."departments") WITH ORDINALITY AS d(name, pos)
  WHERE btrim(d.name) <> ''
  UNION ALL
  SELECT u."organizationId", btrim(u."dept"), 1, NULL, count(*)
  FROM "users" u
  WHERE btrim(u."dept") <> ''
  GROUP BY u."organizationId", btrim(u."dept")
),
keys AS (
  SELECT org, lower(name) AS key, min(pos) FILTER (WHERE src = 0) AS listpos
  FROM candidates
  GROUP BY org, lower(name)
),
spelling AS (
  SELECT DISTINCT ON (org, lower(name)) org, lower(name) AS key, name
  FROM candidates
  ORDER BY org, lower(name), src ASC, uses DESC, name ASC
)
INSERT INTO "departments" ("id", "organizationId", "name", "sortOrder", "createdAt", "updatedAt")
SELECT
  'dept_' || substr(md5(k.org || ':' || k.key), 1, 20),
  k.org,
  s.name,
  (row_number() OVER (PARTITION BY k.org ORDER BY k.listpos NULLS LAST, s.name) - 1)::int,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM keys k
JOIN spelling s ON s.org = k.org AND s.key = k.key;

-- Everyone with a department name points at its record, matched trimmed and
-- ignoring case; their text is set to the record's spelling. A blank stays
-- null and shows under "No department".
UPDATE "users" u
SET "departmentId" = d."id", "dept" = d."name"
FROM "departments" d
WHERE d."organizationId" = u."organizationId"
  AND lower(d."name") = lower(btrim(u."dept"))
  AND btrim(u."dept") <> '';
