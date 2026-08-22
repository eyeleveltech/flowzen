-- Reconcile schema drift on the Client model.
--
-- The merged CRM work added these nine columns to Client in schema.prisma AND writes to them in
-- the lead->client conversion (identityFrom), but shipped NO migration for them. On any database
-- built from the migration history the columns are absent, so winning a deal (client.create with
-- source/priority/... ) fails with "column does not exist". This migration creates them so schema,
-- migrations and DB agree again. All nullable/additive — safe on existing rows.
--
-- (companySize, landlinePhone, zip, country, instagramHandle, facebookPage were already added by
-- 20260727160000_client_pipeline_field_parity, so they are intentionally not repeated here.)

ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "jobTitle" TEXT;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "linkedinUrl" TEXT;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "source" "LeadSource";
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "priority" "LeadPriority";
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "contractType" "ContractType";
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "healthStatus" "HealthStatus";
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "expectedRevenue" DOUBLE PRECISION;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "dossierJson" JSONB;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "dossierStatus" TEXT;
