-- Real file attachments.
--
-- Everything file-shaped in this product was a URL string (driveLink, folderLink, assetLinks,
-- receiptUrl), so the work an agency actually delivers lived in somebody's Drive and Flowzen
-- only remembered where to look. This stores the file itself.
--
-- Purely additive: one new table, nothing existing changes.

CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "uploadedById" TEXT,
    -- What the user named it. Display only — never used to build a filesystem path.
    "filename" TEXT NOT NULL,
    -- Randomly generated on-disk name, the ONLY value ever joined to the uploads path. Keeping
    -- these separate is what stops an uploaded "../../.env" from escaping the uploads directory.
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "taskId" TEXT,
    "leadId" TEXT,
    "clientId" TEXT,
    "projectId" TEXT,
    "expenseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "attachments_storedName_key" ON "attachments"("storedName");
CREATE INDEX "attachments_organizationId_idx" ON "attachments"("organizationId");
CREATE INDEX "attachments_taskId_idx" ON "attachments"("taskId");
CREATE INDEX "attachments_leadId_idx" ON "attachments"("leadId");
CREATE INDEX "attachments_clientId_idx" ON "attachments"("clientId");
CREATE INDEX "attachments_projectId_idx" ON "attachments"("projectId");

-- Owner FKs cascade: an attachment describes a specific thing and is meaningless once that thing
-- is gone. Nullable set of FKs rather than a polymorphic (type, id) pair so the database itself
-- guarantees the row points at something real, and orphans cannot accumulate.
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- The uploader is set NULL, not cascaded: deleting a person must not delete the files they
-- uploaded on the agency's behalf.
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_expenseId_fkey"
  FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
