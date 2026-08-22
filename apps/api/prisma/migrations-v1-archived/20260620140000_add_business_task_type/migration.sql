-- Add the BUSINESS task type. Additive + idempotent.
ALTER TYPE "TaskType" ADD VALUE IF NOT EXISTS 'BUSINESS';
