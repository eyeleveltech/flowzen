-- Usage tracking: which screens each person opened each day (a summary only).
-- Additive only: one new table, its indexes and foreign keys. Nothing existing is altered.

-- CreateTable
CREATE TABLE "usage_days" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "screen" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 1,
    "firstAt" TIMESTAMP(3) NOT NULL,
    "lastAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usage_days_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "usage_days_organizationId_day_idx" ON "usage_days"("organizationId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "usage_days_userId_day_screen_key" ON "usage_days"("userId", "day", "screen");

-- AddForeignKey
ALTER TABLE "usage_days" ADD CONSTRAINT "usage_days_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_days" ADD CONSTRAINT "usage_days_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

