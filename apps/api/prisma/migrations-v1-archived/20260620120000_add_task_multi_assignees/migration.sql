-- Multi-assignee support: many-to-many join between tasks and users.
-- Additive only — the existing single "assigneeId" column is kept as the primary assignee.

-- CreateTable
CREATE TABLE "_TaskAssignees" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TaskAssignees_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_TaskAssignees_B_index" ON "_TaskAssignees"("B");

-- AddForeignKey
ALTER TABLE "_TaskAssignees" ADD CONSTRAINT "_TaskAssignees_A_fkey" FOREIGN KEY ("A") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TaskAssignees" ADD CONSTRAINT "_TaskAssignees_B_fkey" FOREIGN KEY ("B") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: copy each task's existing single assignee into the new list so nothing looks empty.
INSERT INTO "_TaskAssignees" ("A", "B")
SELECT "id", "assigneeId" FROM "tasks" WHERE "assigneeId" IS NOT NULL
ON CONFLICT DO NOTHING;
