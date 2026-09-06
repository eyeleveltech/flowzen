/**
 * A number on Today, and the list behind it, must be the same set.
 *
 * This is the only thing that makes a clickable figure worth having. If "4
 * overdue" opens a list of 6, the reader does not conclude that one screen has a
 * bug — they conclude that neither number can be trusted, and they go back to
 * counting by hand.
 *
 * The two sides are deliberately reached through DIFFERENT routes here
 * (`GET /dashboard` and `GET /projects/tasks/all`), because that is the pairing
 * that used to drift: `dashboard.ts` had its own definition of overdue that
 * excluded only DONE, while everything else also excluded ON_HOLD and BLOCKED.
 *
 * Creates its own tasks, on its own throwaway project, and deletes them.
 *
 * Needs the API running:  npm run dev
 * Run:                    npx tsx test/drill-through.check.ts
 */

import { prisma } from '../src/lib/prisma.js';
import { generateToken } from '../src/utils/jwt.js';
import { startOfDay, addDays } from '../src/utils/orgDay.js';

const BASE = process.env.API_BASE ?? 'http://localhost:4000/api';
const STAMP = `zz-drill-${Date.now()}`;
let failures = 0;

const check = (label: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok || !detail ? '' : `  — ${detail}`}`);
  if (!ok) failures++;
};

const run = async () => {
  const membership = await prisma.userRole.findFirstOrThrow({
    where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
    select: { role: true, user: { select: { id: true, organizationId: true, email: true } } },
  });
  const me = membership.user;
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: me.organizationId },
    select: { timezone: true },
  });
  const token = generateToken({
    userId: me.id,
    email: me.email,
    organizationId: me.organizationId,
    role: membership.role,
  });
  const headers = { Cookie: `token=${token}` };

  const company = await prisma.company.create({
    data: { organizationId: me.organizationId, name: STAMP, status: 'PROSPECT' },
    select: { id: true },
  });
  const project = await prisma.project.create({
    data: { organizationId: me.organizationId, companyId: company.id, name: STAMP },
    select: { id: true },
  });

  const now = new Date();
  const yesterday = addDays(startOfDay(now, org.timezone), -1, org.timezone);
  const today = new Date(startOfDay(now, org.timezone).getTime() + 6 * 3600_000);

  const task = (title: string, data: Record<string, unknown>) =>
    prisma.task.create({
      data: {
        organizationId: me.organizationId,
        projectId: project.id,
        title: `${STAMP} ${title}`,
        ...data,
      },
      select: { id: true },
    });

  try {
    await Promise.all([
      // Counted: late, live, mine.
      task('late-assigned', { assigneeId: me.id, status: 'TODO', dueDate: yesterday }),
      task('late-reviewing', { reviewerId: me.id, status: 'IN_REVIEW', dueDate: yesterday }),
      // NOT counted: parked. This is the pair the two definitions disagreed on.
      task('late-blocked', { assigneeId: me.id, status: 'BLOCKED', dueDate: yesterday }),
      task('late-onhold', { assigneeId: me.id, status: 'ON_HOLD', dueDate: yesterday }),
      // NOT counted: finished, or somebody else's.
      task('late-done', { assigneeId: me.id, status: 'DONE', dueDate: yesterday }),
      task('late-not-mine', { status: 'TODO', dueDate: yesterday }),
      // Due today, not overdue.
      task('today-mine', { assigneeId: me.id, status: 'TODO', dueDate: today }),
    ]);

    const dash = await fetch(`${BASE}/dashboard`, { headers }).then((r) => r.json());
    const work = dash.data.work;

    const listCount = async (query: string) => {
      const r = await fetch(`${BASE}/projects/tasks/all?${query}&limit=1000`, { headers });
      const j = await r.json();
      return { status: r.status, rows: (j.data ?? []) as { title: string; status: string }[] };
    };

    // ── Overdue ──────────────────────────────────────────────────────────────
    const overdue = await listCount('mine=1&overdue=1');
    check('the overdue list loads', overdue.status === 200, String(overdue.status));
    check(
      'Today’s overdue count equals the list it links to',
      work.overdue === overdue.rows.length,
      `count ${work.overdue} vs list ${overdue.rows.length}`,
    );

    const mineOverdue = overdue.rows.filter((t) => t.title.startsWith(STAMP)).map((t) => t.title);
    check('it includes the one assigned to me', mineOverdue.some((t) => t.endsWith('late-assigned')));
    check('and the one waiting on my review', mineOverdue.some((t) => t.endsWith('late-reviewing')));
    check('parked work is NOT overdue — blocked', !mineOverdue.some((t) => t.endsWith('late-blocked')));
    check('parked work is NOT overdue — on hold', !mineOverdue.some((t) => t.endsWith('late-onhold')));
    check('finished work is not overdue', !mineOverdue.some((t) => t.endsWith('late-done')));
    check('somebody else’s work is not mine', !mineOverdue.some((t) => t.endsWith('late-not-mine')));

    // ── Due today ────────────────────────────────────────────────────────────
    const due = await listCount('mine=1&due=today');
    check(
      'Today’s due-today count equals its list',
      work.dueToday === due.rows.length,
      `count ${work.dueToday} vs list ${due.rows.length}`,
    );
    check(
      'due today does not leak yesterday',
      !due.rows.some((t) => t.title.endsWith('late-assigned')),
    );

    // ── Awaiting review ──────────────────────────────────────────────────────
    const review = await listCount('awaitingReview=1');
    check(
      'the review count equals its list',
      work.awaitingMyReview === review.rows.length,
      `count ${work.awaitingMyReview} vs list ${review.rows.length}`,
    );
    check(
      'everything in it is actually in review',
      review.rows.every((t) => t.status === 'IN_REVIEW'),
    );

    // ── The filters narrow, they do not widen ────────────────────────────────
    const all = await listCount('mine=1');
    check(
      'adding overdue narrows the set',
      overdue.rows.length <= all.rows.length,
      `${overdue.rows.length} > ${all.rows.length}`,
    );
  } finally {
    await prisma.task.deleteMany({ where: { title: { startsWith: STAMP } } });
    await prisma.project.deleteMany({ where: { companyId: company.id } });
    await prisma.activity.deleteMany({ where: { companyId: company.id } });
    await prisma.deal.deleteMany({ where: { companyId: company.id } });
    await prisma.company.deleteMany({ where: { id: company.id } });
    const left = await prisma.task.count({ where: { title: { startsWith: STAMP } } });
    check('cleaned up after itself', left === 0, `${left} left`);
    await prisma.$disconnect();
  }

  console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
