-- Audit fix B7 — dedicated notification type for reactivation alerts.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REACTIVATION_DUE';
