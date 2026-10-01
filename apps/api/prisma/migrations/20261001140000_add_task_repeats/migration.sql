-- Repeating tasks: the rule (task_repeats) and each task's link to it.
--
-- Additive only: a new enum, a new table, a nullable column on tasks, two
-- indexes and their foreign keys. Nothing is dropped or rewritten; every
-- existing task gets repeatId NULL, which is "doesn't repeat".

-- CreateEnum
CREATE TYPE "RepeatFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "repeatId" TEXT;

-- CreateTable
CREATE TABLE "task_repeats" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "frequency" "RepeatFrequency" NOT NULL,
    "weekday" INTEGER,
    "dayOfMonth" INTEGER,
    "stoppedAt" TIMESTAMP(3),
    "stoppedReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_repeats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_repeats_organizationId_stoppedAt_idx" ON "task_repeats"("organizationId", "stoppedAt");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_repeatId_dueDate_key" ON "tasks"("repeatId", "dueDate");

-- AddForeignKey
ALTER TABLE "task_repeats" ADD CONSTRAINT "task_repeats_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_repeats" ADD CONSTRAINT "task_repeats_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_repeatId_fkey" FOREIGN KEY ("repeatId") REFERENCES "task_repeats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

