import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { TaskWorkType } from '@prisma/client';

/**
 * §11.2 step 6 / §13: "On the 25th the allocation job computes each
 * person's proposed split from completed task counts. Heads confirm on
 * one screen, in percentages only."
 *
 * A person's proposed split for a work item = that work item's share of
 * their OWN completed tasks that month — the closest arithmetic proxy for
 * "where did this person's month actually go" without a timesheet.
 * `percent` is seeded to match on first computation so the screen always
 * has something sensible to show; once a head confirms a row, later runs
 * only refresh `proposedPercent` and never touch the confirmed `percent`.
 */
export async function computeProposedAllocations(month?: string): Promise<{ usersProcessed: number; rowsUpserted: number }> {
  const now = new Date();
  const targetMonth = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [year, mon] = targetMonth.split('-').map((n) => parseInt(n, 10));
  const monthStart = new Date(year, mon - 1, 1);
  const monthEnd = new Date(year, mon, 1);

  const completedTasks = await prisma.task.findMany({
    where: {
      status: 'DONE',
      deletedAt: null,
      completedAt: { gte: monthStart, lt: monthEnd },
      workType: { in: [TaskWorkType.MONTH_CARD, TaskWorkType.PROJECT] },
    },
    // Everybody on the task, not just its lead. This feeds the monthly time
    // split, so counting a shared task against one desk understates what the
    // other two spent their month on — and the split is what people cost is
    // apportioned by.
    select: {
      organizationId: true,
      workType: true,
      monthCardId: true,
      projectId: true,
      monthCard: { select: { status: true } },
      assignees: { select: { userId: true } },
    },
  });

  type WorkCount = { workType: TaskWorkType; workId: string; monthCardId: string | null; projectId: string | null; count: number };
  const byUser = new Map<string, Map<string, WorkCount>>();

  for (const t of completedTasks) {
    const workId = t.monthCardId ?? t.projectId;
    if (!workId) continue;
    /*
     * Not a month that is closed. An October task finished in November put a
     * November row on October's card, and the card's profit counts every row
     * on it — so October's reported profit moved after it was closed, and the
     * row could not even be edited (the card refuses changes once closed).
     */
    if (t.monthCard?.status === 'CLOSED') continue;
    // Once per person on the task. A task two designers finished together is
    // a month's work for both of them, and the split this feeds is what people
    // cost is apportioned by.
    for (const { userId } of t.assignees) {
      const perWork = byUser.get(userId) ?? new Map<string, WorkCount>();
      const existing = perWork.get(workId);
      if (existing) {
        existing.count++;
      } else {
        perWork.set(workId, { workType: t.workType, workId, monthCardId: t.monthCardId, projectId: t.projectId, count: 1 });
      }
      byUser.set(userId, perWork);
    }
  }

  let rowsUpserted = 0;

  for (const [userId, perWork] of byUser) {
    const total = [...perWork.values()].reduce((s, w) => s + w.count, 0);
    if (total === 0) continue;

    /*
     * Largest remainder: each share rounded down, then the points left over go
     * to the biggest fractions. Rounding each on its own gave 1/1/4 tasks as
     * 17 + 17 + 67 = 101% — overallocated, and 101% of a salary in people cost.
     */
    const works = [...perWork.values()];
    const exact = works.map((w) => (w.count / total) * 100);
    const shares = exact.map(Math.floor);
    let left = 100 - shares.reduce((a, b) => a + b, 0);
    for (const i of exact.map((x, i) => i).sort((a, b) => exact[b] - Math.floor(exact[b]) - (exact[a] - Math.floor(exact[a])))) {
      if (left <= 0) break;
      shares[i] += 1;
      left -= 1;
    }
    const shareOf = new Map(works.map((w, i) => [w.workId, shares[i]]));

    for (const w of perWork.values()) {
      const proposedPercent = shareOf.get(w.workId) ?? 0;

      const existing = await prisma.peopleAllocation.findUnique({
        where: { userId_month_workId: { userId, month: targetMonth, workId: w.workId } },
      });

      if (!existing) {
        await prisma.peopleAllocation.create({
          data: {
            userId,
            month: targetMonth,
            workType: w.workType,
            workId: w.workId,
            monthCardId: w.monthCardId,
            projectId: w.projectId,
            proposedPercent,
            percent: proposedPercent,
          },
        });
      } else if (!existing.confirmedAt) {
        await prisma.peopleAllocation.update({
          where: { id: existing.id },
          data: { proposedPercent, percent: proposedPercent },
        });
      } else {
        await prisma.peopleAllocation.update({
          where: { id: existing.id },
          data: { proposedPercent },
        });
      }
      rowsUpserted++;
    }
  }

  return { usersProcessed: byUser.size, rowsUpserted };
}

/**
 * Polls hourly like the other workers rather than firing at an exact
 * 00:30-on-the-25th instant — see monthCard.cron.ts for why that pattern is
 * intentional here too. The compute itself is a cheap, idempotent upsert,
 * so recomputing every hour from the 25th through month-end just keeps the
 * proposal fresh as more tasks get marked done before a head confirms.
 */
export function startAllocationScheduler(intervalMs = 3600000) {
  const tick = () => {
    if (new Date().getDate() < 25) return;
    computeProposedAllocations().catch((e) => logger.error(`Allocation proposal compute error: ${e}`));
  };
  if (process.env.NODE_ENV !== 'test') {
    tick();
    setInterval(tick, intervalMs);
  }
}
