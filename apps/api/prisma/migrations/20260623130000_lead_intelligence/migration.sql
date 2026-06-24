-- Module A: LinkedIn Intelligence dossier fields on leads.
ALTER TABLE "leads" ADD COLUMN "dossierJson" JSONB;
ALTER TABLE "leads" ADD COLUMN "dossierStatus" TEXT;
ALTER TABLE "leads" ADD COLUMN "dossierGeneratedAt" TIMESTAMP(3);
