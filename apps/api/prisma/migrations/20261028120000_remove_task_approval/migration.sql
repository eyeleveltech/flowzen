-- Task approval is removed (28 Oct 2026). Data only: no table, column or enum
-- value is dropped, so the approval history stays readable.

-- Work that was waiting on an approver goes back to the people on it.
UPDATE "tasks" SET "status" = 'IN_PROGRESS', "updatedAt" = NOW() WHERE "status" = 'IN_REVIEW';

-- Its reminders and escalations close with it.
UPDATE "alerts" SET "resolvedAt" = NOW(), "updatedAt" = NOW()
WHERE "rule" IN ('APPROVAL_REMINDER', 'APPROVAL_ESCALATED') AND "resolvedAt" IS NULL;

-- Approval pushes still waiting for working hours are not sent.
UPDATE "push_outbox" SET "sentAt" = NOW(), "lastError" = 'Task approval was removed.'
WHERE "kind" = 'APPROVALS' AND "sentAt" IS NULL;
