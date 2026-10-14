-- Working on now (Team plan 1): the one task each person says they are on.
--
-- Additive only: one nullable column, its index and its foreign key. Nothing
-- is backfilled — nobody is working on anything until they say so. Deleting
-- the task clears it (SET NULL).

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "focusTaskId" TEXT;

-- CreateIndex
CREATE INDEX "users_focusTaskId_idx" ON "users"("focusTaskId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_focusTaskId_fkey" FOREIGN KEY ("focusTaskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
