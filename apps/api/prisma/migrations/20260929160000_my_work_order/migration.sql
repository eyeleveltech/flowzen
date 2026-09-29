-- The order somebody has arranged their own work into.
--
-- My Work groups tasks by when they are due — overdue, today, later this week
-- — and inside each group they came in whatever order the query returned.
-- The order a person actually works in is theirs to decide: the call they
-- have to make before ten, the thing that unblocks somebody else.
--
-- On the assignee row, not the task. Three people sharing one task each have
-- their own desk, and one of them dragging it to the top must not move it on
-- the other two.
--
-- Additive: one nullable column. Null is "not arranged", which sorts first so
-- new work is seen rather than filed under a list already put in order.

ALTER TABLE "task_assignees" ADD COLUMN "sortOrder" INTEGER;
