-- Changes other approvers add to a round somebody sent back.
--
-- Additive only: one new table, its index and two foreign keys. Nothing
-- existing is dropped or rewritten.

-- CreateTable
CREATE TABLE "task_review_notes" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "feedback" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_review_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_review_notes_reviewId_idx" ON "task_review_notes"("reviewId");

-- AddForeignKey
ALTER TABLE "task_review_notes" ADD CONSTRAINT "task_review_notes_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "task_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_review_notes" ADD CONSTRAINT "task_review_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

