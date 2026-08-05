-- Remove file attachments.
--
-- The feature was built (20260804140000_attachments) and is now withdrawn by decision: uploads
-- had a 25 MB per-file limit but NO per-organisation quota and no total cap, so nothing bounded
-- how much disk they could consume. On a single-VPS deployment Postgres shares that disk, which
-- makes "storage fills up" the same event as "the database stops accepting writes" — the whole
-- app goes down, not just uploads. Rather than ship a capless feature, we go back to pasting
-- links (driveLink, folderLink, assetLinks, receiptUrl are all still there and untouched).
--
-- The earlier CREATE migration is deliberately left in place: applied migrations are history and
-- are never edited. An environment that has not run either one simply creates the table and drops
-- it again in the same `migrate deploy`, which is correct and costs nothing.
--
-- All FK constraints and indexes belong to this table and go with it; no other table references
-- "attachments", so nothing else is touched. Any files still sitting in uploads/attachments on
-- disk become unreferenced and can be deleted by hand — the rows that named them are gone.

DROP TABLE IF EXISTS "attachments";
