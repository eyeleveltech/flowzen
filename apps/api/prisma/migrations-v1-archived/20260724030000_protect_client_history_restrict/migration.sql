-- Defense-in-depth against the cascade-delete data-loss bug.
--
-- Deleting a client is already soft (sets archivedAt) in the application, so a client's
-- projects, tasks and notes are preserved in normal use. But the FKs still said ON DELETE
-- CASCADE, meaning ANY hard delete — a stray client.delete(), a cleanup script, a manual DB
-- op — would silently erase all that delivery history. Soft-delete is a convention; this
-- makes the protection a database-level guarantee.
--
-- projects / tasks / notes -> RESTRICT: the DB refuses to delete a client that still has
--   them, so the destruction simply cannot happen by accident.
-- client_contacts is intentionally left CASCADE: a contact has no meaning apart from its
--   client, so it is fine for it to go if a client is ever genuinely hard-deleted.

-- DropForeignKey
ALTER TABLE "notes" DROP CONSTRAINT "notes_clientId_fkey";

-- DropForeignKey
ALTER TABLE "projects" DROP CONSTRAINT "projects_clientId_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_clientId_fkey";

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
