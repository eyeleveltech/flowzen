-- Internal work plan: optional dates and an owning department on an internal project.
--
-- Additive only: three nullable columns, an index and a foreign key. Nothing
-- is backfilled. Archiving or removing a department leaves its projects with
-- no department (SET NULL).

-- AlterTable
ALTER TABLE "internal_projects" ADD COLUMN     "departmentId" TEXT,
ADD COLUMN     "startDate" DATE,
ADD COLUMN     "targetDate" DATE;

-- CreateIndex
CREATE INDEX "internal_projects_departmentId_idx" ON "internal_projects"("departmentId");

-- AddForeignKey
ALTER TABLE "internal_projects" ADD CONSTRAINT "internal_projects_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
