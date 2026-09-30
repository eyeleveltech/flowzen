-- "Other" as a type of work.
--
-- Additive only: one new enum value, nothing dropped or rewritten. It is also
-- what a task needing approval is filed under when nobody picked a type —
-- approval no longer asks for one, because the same approvers cover all work.

-- AlterEnum
ALTER TYPE "TaskType" ADD VALUE 'OTHER';
