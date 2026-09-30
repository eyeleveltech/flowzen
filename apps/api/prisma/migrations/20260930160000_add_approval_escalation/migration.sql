-- Approval reminders and escalation (Plan 2).
--
--   · organizations.approvalRemindMinutes / approvalEscalateMinutes — working
--     minutes a task may wait on an approver before the approvers are reminded,
--     and before it escalates. Default 2h and 4h.
--   · task_reviews.remindedAt / escalatedAt — when each ping went for a round;
--     stamping them is how the chaser claims a round so it never sends twice.
--   · approval_escalation_contacts — who a stuck approval escalates to, per
--     task type. Once escalated, they can decide it too.
--
-- Additive only: new columns with defaults or nulls, and one new table.

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "approvalEscalateMinutes" INTEGER NOT NULL DEFAULT 240,
ADD COLUMN     "approvalRemindMinutes" INTEGER NOT NULL DEFAULT 120;

-- AlterTable
ALTER TABLE "task_reviews" ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "remindedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "approval_escalation_contacts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskType" "TaskType" NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "approval_escalation_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "approval_escalation_contacts_organizationId_taskType_userId_key" ON "approval_escalation_contacts"("organizationId", "taskType", "userId");

-- AddForeignKey
ALTER TABLE "approval_escalation_contacts" ADD CONSTRAINT "approval_escalation_contacts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_escalation_contacts" ADD CONSTRAINT "approval_escalation_contacts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
