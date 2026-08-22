-- Drop Task.loggedHours.
--
-- It was a single overwritable total, written by a prompt that was never wired up — 0 of 30 rows
-- ever carried a value. TimeEntry supersedes it with dated rows per person, which is what makes
-- hours correctable, attributable, and summable by day/project/client.
--
-- Leaving it would have been worse than useless: the column stayed writable through the tasks
-- PATCH route while displaying nowhere, so anything written to it would vanish silently. Two
-- homes for one fact is the shape of every sync bug this codebase has had (the lead's duplicated
-- contact columns, and agreedFinalValue overwriting dealValue).
--
-- estimatedHours is deliberately KEPT. Estimating is planning, logging is recording; they are
-- different facts, and "estimated vs actual" only became answerable now that actuals exist.
--
-- Destructive but empty: verified 0 rows with a non-zero value before writing this.

ALTER TABLE "tasks" DROP COLUMN IF EXISTS "loggedHours";
