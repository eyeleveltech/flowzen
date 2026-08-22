-- CreateEnum
CREATE TYPE "ProjectPlatform" AS ENUM ('INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'X_TWITTER', 'TIKTOK', 'YOUTUBE', 'GOOGLE_ADS', 'WEBSITE', 'MOBILE_APP', 'E_COMMERCE', 'CROSS_PLATFORM', 'OTHER');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'TASK_REVIEW';

-- AlterEnum
ALTER TYPE "TaskStatus" ADD VALUE 'ON_HOLD';

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "platform" "ProjectPlatform";

-- AlterTable
ALTER TABLE "quote_documents" ADD COLUMN     "scope" TEXT;

-- AlterTable
ALTER TABLE "quote_line_items" ALTER COLUMN "taxType" SET DEFAULT 'IGST_S';

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "assignedById" TEXT;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

