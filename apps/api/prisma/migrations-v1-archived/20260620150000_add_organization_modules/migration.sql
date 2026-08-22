-- Module-based system: track which feature modules each org has enabled. Additive only.

-- CreateTable
CREATE TABLE "organization_modules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_modules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "organization_modules_organizationId_idx" ON "organization_modules"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_modules_organizationId_key_key" ON "organization_modules"("organizationId", "key");

-- AddForeignKey
ALTER TABLE "organization_modules" ADD CONSTRAINT "organization_modules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every existing organization gets CRM + PM enabled (so nothing changes for current users).
INSERT INTO "organization_modules" ("id", "organizationId", "key", "enabled", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, o.id, m.key, true, NOW(), NOW()
FROM "organizations" o
CROSS JOIN (VALUES ('CRM'), ('PM')) AS m(key)
ON CONFLICT ("organizationId", "key") DO NOTHING;
