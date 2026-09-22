-- Task templates, removed.
--
-- A template was a per-retainer blueprint: a list of lines, each spawning its
-- tasks on a fixed day of the month, so a month card came up with the client's
-- routine work already on it.
--
-- It goes because nobody was going to maintain it. A second place where work
-- is defined only helps while somebody keeps it matching what the client
-- actually buys; left alone it drifts, and a month card full of work nobody
-- agreed to is worse than an empty one. The editor could not even set a line's
-- `count` or `dept` — the route's validation dropped both — so editing a
-- template through the app silently halved the work it produced.
--
-- What the 1st-of-month roll still does is the part that mattered: it opens
-- the card, with its revenue, for every active retainer. Nobody has to
-- remember to start the month; they just put their own work on it.

-- The tasks keep their history. `templateItemId` grouped tasks spawned from
-- the same line so §8 could take a median elapsed time per kind of work;
-- `taskTypeGroupKey` already falls back to the normalised title when it is
-- null, which is what §8 calls for on ad-hoc work — so the medians survive the
-- column going away.
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "templateItemId";

ALTER TABLE "retainers" DROP CONSTRAINT IF EXISTS "retainers_templateId_fkey";
ALTER TABLE "retainers" DROP COLUMN IF EXISTS "templateId";

DROP TABLE IF EXISTS "task_templates";
