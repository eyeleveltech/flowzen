-- Captures schema changes merged from origin/main (PR #20, branch `naif`) that were
-- committed WITHOUT a migration — that branch was developed with `prisma db push`.
-- Regenerated via `prisma migrate diff` so this branch stays deployable via `migrate deploy`.
--
-- Note: drops users.department and teams.leaderId (replaced by the team_managers join
-- table). Destructive, but matches the schema already on main.

-- DropForeignKey
ALTER TABLE "quote_documents" DROP CONSTRAINT "quote_documents_clientId_fkey";

-- DropForeignKey
ALTER TABLE "teams" DROP CONSTRAINT "teams_leaderId_fkey";

-- DropIndex
DROP INDEX "teams_leaderId_key";

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "teams" DROP COLUMN "leaderId";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "department";

-- CreateTable
CREATE TABLE "team_managers" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "team_managers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "team_managers_teamId_userId_key" ON "team_managers"("teamId", "userId");

-- CreateIndex
CREATE INDEX "clients_organizationId_archivedAt_idx" ON "clients"("organizationId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "teams_organizationId_name_key" ON "teams"("organizationId", "name");

-- AddForeignKey
ALTER TABLE "team_managers" ADD CONSTRAINT "team_managers_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_managers" ADD CONSTRAINT "team_managers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_documents" ADD CONSTRAINT "quote_documents_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

