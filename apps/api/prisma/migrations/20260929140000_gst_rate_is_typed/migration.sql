-- The GST rate is typed now, so it can be a decimal.
--
-- It was picked from a list — no GST, 5, 12, 18, 28 — and stored as a whole
-- number. The list became an open field, and an open field that refuses 12.5,
-- or quietly stores it as 12, is worse than the list it replaced: it invites a
-- figure and then does not keep it.
--
-- A widening cast and nothing else. Every existing value is a whole number and
-- fits in DECIMAL(5,2) exactly — 18 becomes 18.00 — so no row's rate changes,
-- and NULL (nobody said) stays NULL.

ALTER TABLE "costs"     ALTER COLUMN "gstPercent" SET DATA TYPE DECIMAL(5,2);
ALTER TABLE "projects"  ALTER COLUMN "gstPercent" SET DATA TYPE DECIMAL(5,2);
ALTER TABLE "retainers" ALTER COLUMN "gstPercent" SET DATA TYPE DECIMAL(5,2);
