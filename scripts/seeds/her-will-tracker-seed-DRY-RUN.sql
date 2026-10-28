-- Her Will Master Tracker -> Flowzen tasks: Harish's open work (+ HW-113). Generated 2026-10-28.
-- DRY RUN: shows what it would add, then ROLLBACK. Writes nothing.
-- Project "Tagmango Website and App rework", on the month card of each due date. Assigned by Akmal.
-- 20 tasks. Rerunning skips anything already added (tracker ID tag in the notes).
\encoding UTF8
\set ON_ERROR_STOP on
\pset pager off
BEGIN;

-- 0. Everything it needs is there — or it stops and nothing is written.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM retainers WHERE id = 'cmvakef3b00ijms3d0on1nd6t' AND status = 'ACTIVE') THEN RAISE EXCEPTION 'The Her Will retainer was not found, or is not active.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM retainer_projects WHERE id = 'cmvakgugo00ixms3digxjeuuq' AND "retainerId" = 'cmvakef3b00ijms3d0on1nd6t' AND name = $t$Tagmango Website and App rework$t$) THEN RAISE EXCEPTION 'Project not found: Tagmango Website and App rework'; END IF;
  IF NOT EXISTS (SELECT 1 FROM month_cards WHERE "retainerId" = 'cmvakef3b00ijms3d0on1nd6t' AND month = '2026-10' AND status = 'OPEN') THEN RAISE EXCEPTION 'The Her Will 2026-10 month card was not found, or is not open.'; END IF;
  IF (SELECT count(*) FROM users WHERE id IN ('cmudv77z7001hqx2343lgsz61', 'cmuc9fzga0002o224arovg5wr', 'cmuf1rp20000bnz3cb40kocan', 'cmvew6oqt01vloh37nnad5q9v') AND active) <> 4 THEN RAISE EXCEPTION 'One of Akmal, Harish, Dilshad, Angelina jolie is missing or switched off.'; END IF;
END $$;

-- 1. Who is who.
CREATE TEMP TABLE hwt_people (key text PRIMARY KEY, user_id text NOT NULL) ON COMMIT DROP;
INSERT INTO hwt_people VALUES ('AKMAL', 'cmudv77z7001hqx2343lgsz61'), ('HARISH', 'cmuc9fzga0002o224arovg5wr'), ('DILSHAD', 'cmuf1rp20000bnz3cb40kocan'), ('ANGELINA', 'cmvew6oqt01vloh37nnad5q9v');

-- 2. The tasks, as the sheet has them. people[1] leads.
CREATE TEMP TABLE hwt_plan (ref text PRIMARY KEY, people text[] NOT NULL, task_type "TaskType", status "TaskStatus",
                            title text NOT NULL, notes text, due date NOT NULL, priority "Priority") ON COMMIT DROP;
INSERT INTO hwt_plan VALUES
  ($t$From the Her Will Master Tracker, HW-071$t$, ARRAY['HARISH'], 'DIGITAL_MARKETING', 'IN_PROGRESS', $t$Domain verification, Pixel ownership, payment, spending limit$t$, $t$Meta setup

From the Her Will Master Tracker, HW-071$t$, '2026-10-28', 'MEDIUM'),
  ($t$From the Her Will Master Tracker, HW-107$t$, ARRAY['HARISH'], 'DEVELOPMENT', 'IN_PROGRESS', $t$TagMango WhatsApp capability check$t$, $t$WhatsApp · Waits on: TagMango access

From the Her Will Master Tracker, HW-107$t$, '2026-10-28', 'MEDIUM'),
  ($t$From the Her Will Master Tracker, HW-099$t$, ARRAY['HARISH'], 'DEVELOPMENT', 'TODO', $t$New ₹5,399 checkout with +₹600 Live upgrade$t$, $t$Checkout · Waits on: TagMango access · Old ₹4,799 link still on pages

From the Her Will Master Tracker, HW-099$t$, '2026-10-29', 'MEDIUM'),
  ($t$From the Her Will Master Tracker, HW-100$t$, ARRAY['HARISH'], 'DEVELOPMENT', 'TODO', $t$Workshop ₹199 + Gut Reset ₹1,299 checkouts$t$, $t$Checkout · 2 checkouts

From the Her Will Master Tracker, HW-100$t$, '2026-10-29', 'MEDIUM'),
  ($t$From the Her Will Master Tracker, HW-108$t$, ARRAY['HARISH'], 'DEVELOPMENT', 'TODO', $t$Provider + Her Will business number verified$t$, $t$WhatsApp

From the Her Will Master Tracker, HW-108$t$, '2026-10-29', 'MEDIUM'),
  ($t$From the Her Will Master Tracker, HW-109$t$, ARRAY['HARISH'], 'DEVELOPMENT', 'TODO', $t$Templates submitted to Meta$t$, $t$WhatsApp · 53 templates

From the Her Will Master Tracker, HW-109$t$, '2026-10-29', 'MEDIUM'),
  ($t$From the Her Will Master Tracker, HW-095$t$, ARRAY['HARISH'], 'DEVELOPMENT', 'TODO', $t$Workshop page live (URGENT)$t$, $t$Landing pages · Waits on: TagMango access

From the Her Will Master Tracker, HW-095$t$, '2026-10-30', 'URGENT'),
  ($t$From the Her Will Master Tracker, HW-101$t$, ARRAY['HARISH'], 'DEVELOPMENT', 'IN_PROGRESS', $t$Pixel + Conversions API + GA4, all events$t$, $t$Tracking · 11 events

From the Her Will Master Tracker, HW-101$t$, '2026-10-30', 'MEDIUM'),
  ($t$From the Her Will Master Tracker, HW-110$t$, ARRAY['HARISH'], 'DEVELOPMENT', 'TODO', $t$Flows built (workshop, SLIM 90, Live, Gut Reset, rescue, prospects, replies)$t$, $t$WhatsApp · 7 flows · Waits on: Templates approved

From the Her Will Master Tracker, HW-110$t$, '2026-10-30', 'MEDIUM'),
  ($t$From the Her Will Master Tracker, HW-112$t$, ARRAY['HARISH'], 'DIGITAL_MARKETING', 'TODO', $t$Google Business Profile created$t$, $t$Basics · Waits on: Address + phone

From the Her Will Master Tracker, HW-112$t$, '2026-10-30', 'MEDIUM'),
  ($t$From the Her Will Master Tracker, HW-113$t$, ARRAY['HARISH', 'DILSHAD', 'ANGELINA'], 'DIGITAL_MARKETING', 'TODO', $t$Titles + meta descriptions for every page$t$, $t$Basics · 6+ pages

From the Her Will Master Tracker, HW-113$t$, '2026-10-30', 'MEDIUM'),
  ($t$From the Her Will Master Tracker, HW-096$t$, ARRAY['HARISH'], 'DEVELOPMENT', 'TODO', $t$SLIM 90 general + 3 age pages live$t$, $t$Landing pages · 4 pages · Waits on: Checkout link

From the Her Will Master Tracker, HW-096$t$, '2026-10-31', 'MEDIUM'),
  ($t$From the Her Will Master Tracker, HW-097$t$, ARRAY['HARISH'], 'DEVELOPMENT', 'TODO', $t$Gut Reset page live$t$, $t$Landing pages · Waits on: Gut Reset answers

From the Her Will Master Tracker, HW-097$t$, '2026-10-31', 'MEDIUM'),
  ($t$From the Her Will Master Tracker, HW-098$t$, ARRAY['HARISH'], 'DEVELOPMENT', 'TODO', $t$Landing page videos embedded$t$, $t$Landing pages · 6 videos · Waits on: LP edits

From the Her Will Master Tracker, HW-098$t$, '2026-10-31', 'MEDIUM'),
  ($t$From the Her Will Master Tracker, HW-103$t$, ARRAY['HARISH'], 'DEVELOPMENT', 'TODO', $t$Real test purchase end to end (₹199 + SLIM 90)$t$, $t$Tracking · Waits on: Everything above

From the Her Will Master Tracker, HW-103$t$, '2026-10-31', 'MEDIUM'),
  ($t$From the Her Will Master Tracker, HW-104$t$, ARRAY['HARISH'], 'DEVELOPMENT', 'TODO', $t$301 redirect /90daysprogram to /slim90$t$, $t$Site

From the Her Will Master Tracker, HW-104$t$, '2026-10-31', 'MEDIUM'),
  ($t$From the Her Will Master Tracker, HW-105$t$, ARRAY['HARISH'], 'DEVELOPMENT', 'TODO', $t$Remove non-compliant claims on live site$t$, $t$Site · "India's #1", "Diabetes Reversal", kg testimonials, old prices

From the Her Will Master Tracker, HW-105$t$, '2026-10-31', 'MEDIUM'),
  ($t$From the Her Will Master Tracker, HW-106$t$, ARRAY['HARISH'], 'DEVELOPMENT', 'TODO', $t$Mobile check of every page at 390 px$t$, $t$Site · 6 pages

From the Her Will Master Tracker, HW-106$t$, '2026-10-31', 'MEDIUM'),
  ($t$From the Her Will Master Tracker, HW-111$t$, ARRAY['HARISH'], 'DEVELOPMENT', 'TODO', $t$WhatsApp journey tested + LIVE$t$, $t$WhatsApp

From the Her Will Master Tracker, HW-111$t$, '2026-10-31', 'MEDIUM'),
  ($t$From the Her Will Master Tracker, HW-114$t$, ARRAY['HARISH'], 'DIGITAL_MARKETING', 'TODO', $t$robots.txt, sitemap, llms.txt$t$, $t$Basics · 3 files

From the Her Will Master Tracker, HW-114$t$, '2026-10-31', 'MEDIUM');

-- 3. Only what is not already on the retainer.
CREATE TEMP TABLE hwt_new ON COMMIT DROP AS
SELECT 'c' || replace(gen_random_uuid()::text, '-', '') AS id, p.*, lead.user_id AS lead_id, mc.id AS card_id
FROM hwt_plan p
JOIN hwt_people lead ON lead.key = p.people[1]
JOIN month_cards mc ON mc."retainerId" = 'cmvakef3b00ijms3d0on1nd6t' AND mc.month = to_char(p.due, 'YYYY-MM')
WHERE NOT EXISTS (
  SELECT 1 FROM tasks t JOIN month_cards c2 ON c2.id = t."monthCardId"
  WHERE c2."retainerId" = 'cmvakef3b00ijms3d0on1nd6t' AND t."deletedAt" IS NULL AND t.notes LIKE '%' || p.ref
);

INSERT INTO tasks (id, "organizationId", title, "workType", "monthCardId", "retainerProjectId", "assigneeId", "createdById", "assignedById",
                   "taskType", "dueDate", "assignedAt", status, priority, notes, "createdAt", "updatedAt")
SELECT n.id, r."organizationId", n.title, 'MONTH_CARD', n.card_id, 'cmvakgugo00ixms3digxjeuuq', n.lead_id, 'cmudv77z7001hqx2343lgsz61', 'cmudv77z7001hqx2343lgsz61',
       n.task_type, n.due, now(), n.status, n.priority, n.notes, now(), now()
FROM hwt_new n, retainers r WHERE r.id = 'cmvakef3b00ijms3d0on1nd6t';

-- Everybody on it, the lead first.
INSERT INTO task_assignees (id, "taskId", "userId", "assignedAt")
SELECT 'c' || replace(gen_random_uuid()::text, '-', ''), n.id, hp.user_id, now() + (u.ord * interval '1 millisecond')
FROM hwt_new n
CROSS JOIN LATERAL unnest(n.people) WITH ORDINALITY AS u(key, ord)
JOIN hwt_people hp ON hp.key = u.key;

INSERT INTO activities (id, "organizationId", "entityType", "entityId", "actorId", verb, payload)
SELECT 'c' || replace(gen_random_uuid()::text, '-', ''), r."organizationId", 'Task', n.id, 'cmudv77z7001hqx2343lgsz61', 'task_created',
       jsonb_build_object('title', n.title, 'workType', 'MONTH_CARD',
                          'assigneeIds', (SELECT jsonb_agg(hp.user_id ORDER BY u.ord) FROM unnest(n.people) WITH ORDINALITY AS u(key, ord) JOIN hwt_people hp ON hp.key = u.key))
FROM hwt_new n, retainers r WHERE r.id = 'cmvakef3b00ijms3d0on1nd6t';

-- 4. What this run did.
SELECT count(*) AS added, count(*) FILTER (WHERE status = 'IN_PROGRESS') AS in_progress, count(*) FILTER (WHERE status = 'TODO') AS to_do,
       (SELECT count(*) FROM hwt_plan) - count(*) AS already_there
FROM hwt_new;
SELECT to_char(n.due, 'DD Mon') AS due, n.status, n.priority,
       (SELECT string_agg(u.name, ', ' ORDER BY x.ord) FROM unnest(n.people) WITH ORDINALITY AS x(key, ord) JOIN hwt_people hp ON hp.key = x.key JOIN users u ON u.id = hp.user_id) AS people,
       left(n.title, 70) AS task
FROM hwt_new n ORDER BY n.due, n.ref;

-- Harish's other open tasks in this project (from the 16 Oct team plan) — check none is the same work twice.
SELECT to_char(t."dueDate", 'DD Mon') AS due, t.status, left(t.title, 70) AS already_on_his_list
FROM tasks t JOIN task_assignees ta ON ta."taskId" = t.id
WHERE t."retainerProjectId" = 'cmvakgugo00ixms3digxjeuuq' AND t."deletedAt" IS NULL AND ta."userId" = 'cmuc9fzga0002o224arovg5wr'
  AND t.status IN ('TODO', 'IN_PROGRESS', 'ON_HOLD') AND t.id NOT IN (SELECT id FROM hwt_new)
ORDER BY t."dueDate";

ROLLBACK;
