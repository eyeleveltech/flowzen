-- Task approvals (Plan 1): a task can need an approver's sign-off before it is
-- done.
--
--   · TaskStatus gains IN_REVIEW — sent for approval, waiting on an approver.
--   · tasks.needsApproval — ticked by whoever creates the task, off by default.
--   · task_reviews — one row per "Send for approval" (round 1, 2, 3…), with the
--     decision, who made it and any feedback.
--   · task_approvers — who can approve which task type; any one is enough.
--
-- Additive only: a new enum value, a new column with a default, two new tables
-- and their indexes. Nothing existing is changed or removed.

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('APPROVED', 'CHANGES_REQUESTED');

-- AlterEnum
ALTER TYPE "TaskStatus" ADD VALUE 'IN_REVIEW';

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "needsApproval" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "task_reviews" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "link" TEXT,
    "note" TEXT,
    "decision" "ReviewDecision",
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "feedback" TEXT,
    CONSTRAINT "task_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_approvers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskType" "TaskType" NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "task_approvers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_reviews_organizationId_decidedAt_idx" ON "task_reviews"("organizationId", "decidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "task_reviews_taskId_round_key" ON "task_reviews"("taskId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "task_approvers_organizationId_taskType_userId_key" ON "task_approvers"("organizationId", "taskType", "userId");

-- AddForeignKey
ALTER TABLE "task_reviews" ADD CONSTRAINT "task_reviews_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_reviews" ADD CONSTRAINT "task_reviews_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_reviews" ADD CONSTRAINT "task_reviews_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_reviews" ADD CONSTRAINT "task_reviews_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_approvers" ADD CONSTRAINT "task_approvers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_approvers" ADD CONSTRAINT "task_approvers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
