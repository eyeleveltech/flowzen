-- Monday brief redesign: one row per organisation per week, holding the AI summary.
-- Additive only: a new table, its unique index and its foreign key.

-- CreateTable
CREATE TABLE "weekly_briefs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "summary" TEXT,
    "summaryModel" TEXT,
    "summaryInput" JSONB,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekly_briefs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "weekly_briefs_organizationId_weekStart_key" ON "weekly_briefs"("organizationId", "weekStart");

-- AddForeignKey
ALTER TABLE "weekly_briefs" ADD CONSTRAINT "weekly_briefs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

