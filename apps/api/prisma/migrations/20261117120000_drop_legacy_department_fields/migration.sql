-- Departments Plan 4: the old free-text department fields. DESTRUCTIVE.
-- Every reader now uses Department rows (User.departmentId); the API still
-- returns `dept`, filled from the department record. Checked on production
-- 2026-11-17: nobody has text without a department record.

-- AlterTable
ALTER TABLE "users" DROP COLUMN "dept";

-- AlterTable
ALTER TABLE "organizations" DROP COLUMN "departments";
