-- An optional due time on a task, beside its due date.
--
-- Additive only: one nullable column, nothing dropped or rewritten. Every
-- existing task gets NULL — no time — which is how they read today.

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "dueTime" TEXT;
