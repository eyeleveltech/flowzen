-- Add the new enum values used by the app (client INACTIVE status, SOCIAL_MEDIA task type).
-- These were added to schema.prisma but never had a migration, so the DB enums lacked them.
-- IF NOT EXISTS keeps this safe/idempotent across environments.
ALTER TYPE "ClientStatus" ADD VALUE IF NOT EXISTS 'INACTIVE';
ALTER TYPE "TaskType" ADD VALUE IF NOT EXISTS 'SOCIAL_MEDIA';
