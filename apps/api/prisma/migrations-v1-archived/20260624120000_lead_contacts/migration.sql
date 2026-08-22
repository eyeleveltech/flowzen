-- Module G — secondary contacts per lead.
CREATE TYPE "ContactRole" AS ENUM ('DECISION_MAKER', 'INFLUENCER', 'GATEKEEPER', 'CHAMPION', 'CC_ONLY');

CREATE TABLE "lead_contacts" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "designation" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "linkedinUrl" TEXT,
  "role" "ContactRole" NOT NULL,
  "notes" TEXT,
  "dossierJson" JSONB,
  "dossierStatus" TEXT,
  "dossierGeneratedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_contacts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lead_contacts_leadId_idx" ON "lead_contacts"("leadId");

ALTER TABLE "lead_contacts" ADD CONSTRAINT "lead_contacts_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
