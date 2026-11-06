-- Logins (Credentials plan): two tables, two enums and one column. Additive
-- only — no row is changed or removed.

-- CreateEnum
CREATE TYPE "CredentialScope" AS ENUM ('INTERNAL', 'CLIENT');

-- CreateEnum
CREATE TYPE "CredentialAction" AS ENUM ('SHOW', 'COPY', 'CREATE', 'UPDATE', 'PASSWORD_CHANGED', 'DELETE', 'RESTORE', 'IMPORT', 'PURGE');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "credentialsKeyCheck" TEXT;

-- CreateTable
CREATE TABLE "credentials" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scope" "CredentialScope" NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "username" TEXT,
    "passwordEnc" TEXT NOT NULL,
    "notesEnc" TEXT,
    "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,

    CONSTRAINT "credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credential_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "credentialId" TEXT,
    "credentialName" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" "CredentialAction" NOT NULL,
    "ip" TEXT,
    "detail" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credential_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credentials_organizationId_scope_idx" ON "credentials"("organizationId", "scope");

-- CreateIndex
CREATE INDEX "credentials_companyId_idx" ON "credentials"("companyId");

-- CreateIndex
CREATE INDEX "credential_logs_organizationId_at_idx" ON "credential_logs"("organizationId", "at");

-- CreateIndex
CREATE INDEX "credential_logs_credentialId_at_idx" ON "credential_logs"("credentialId", "at");

-- CreateIndex
CREATE INDEX "credential_logs_userId_at_idx" ON "credential_logs"("userId", "at");

-- AddForeignKey
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential_logs" ADD CONSTRAINT "credential_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential_logs" ADD CONSTRAINT "credential_logs_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "credentials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential_logs" ADD CONSTRAINT "credential_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
