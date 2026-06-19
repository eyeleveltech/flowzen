-- CreateEnum
CREATE TYPE "LeadPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LeadSource" ADD VALUE 'OUTBOUND';
ALTER TYPE "LeadSource" ADD VALUE 'SOCIAL_MEDIA';
ALTER TYPE "LeadSource" ADD VALUE 'EVENT';
ALTER TYPE "LeadSource" ADD VALUE 'COLD_CALL';
ALTER TYPE "LeadSource" ADD VALUE 'EXISTING_CLIENT';

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "expectedRevenue" DOUBLE PRECISION,
ADD COLUMN     "followUpDate" TIMESTAMP(3),
ADD COLUMN     "priority" "LeadPriority" NOT NULL DEFAULT 'MEDIUM';

-- AlterTable
ALTER TABLE "notes" ADD COLUMN     "leadId" TEXT,
ALTER COLUMN "clientId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "lastActivityReadAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

