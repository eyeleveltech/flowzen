-- Remove the Milestone feature. Milestones overlapped with Tasks (which are richer:
-- assignees, status, subtasks, comments), and the endpoints had no tenant scoping. The
-- feature is being dropped rather than hardened. The FK from milestones -> projects was
-- ON DELETE CASCADE, so this only removes milestone rows, never project data.
DROP TABLE IF EXISTS "milestones";
