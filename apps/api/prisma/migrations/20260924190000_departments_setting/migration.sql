-- Departments become a setting.
--
-- `User.dept` is free text, so the same team is spread across whatever anybody
-- typed -- "Video & Production" and "Video/Production" are two departments as
-- far as any grouping is concerned, and nothing stops a third.
--
-- The list lives on the organisation rather than in code because every agency
-- divides itself differently, and this one will change its mind again.
ALTER TABLE "organizations" ADD COLUMN "departments" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Seeded from what is ALREADY in use, unioned with the studio's own list.
--
-- Seeding from the suggested list alone would orphan every person whose
-- department is not on it: their record would carry a value the dropdown does
-- not offer, and the first edit of anything else would silently move them.
UPDATE "organizations" o
SET "departments" = (
  SELECT ARRAY(
    SELECT DISTINCT d FROM (
      SELECT unnest(ARRAY[
        'Management', 'Sales', 'Business Development', 'Design', 'Social Media',
        'Content', 'Video / Production', 'Digital Marketing', 'Accounts / Finance'
      ]) AS d
      UNION
      SELECT u."dept" FROM "users" u WHERE u."organizationId" = o."id" AND u."dept" <> ''
    ) AS all_departments
    ORDER BY d
  )
);
