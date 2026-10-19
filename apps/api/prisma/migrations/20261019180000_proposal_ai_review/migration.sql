-- AI Proposal Builder, phase 2: the AI conversation on each document, the
-- review step, and the stored Word file. Additive only: new nullable or
-- defaulted columns and one foreign key. Nothing existing is changed.

-- AlterTable
ALTER TABLE "proposal_documents" ADD COLUMN     "aiThread" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "finalDocx" BYTEA,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewRequestedAt" TIMESTAMP(3),
ADD COLUMN     "reviewRequestedById" TEXT;

-- AddForeignKey
ALTER TABLE "proposal_documents" ADD CONSTRAINT "proposal_documents_reviewRequestedById_fkey" FOREIGN KEY ("reviewRequestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

