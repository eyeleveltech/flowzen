import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { TaskWorkType, TaskStatus } from '@prisma/client';
import { hasStartedBy } from '../utils/retainerMonths.js';

/**
 * 1st-of-the-month Retainer MonthCard creation and task schedule engine.
 */
export async function rollActiveRetainers(specifiedMonth?: string): Promise<{ createdCards: number; createdTasks: number }> {
  const now = new Date();
  const year = now.getFullYear();
  const monthNum = String(now.getMonth() + 1).padStart(2, '0');
  const targetMonth = specifiedMonth || `${year}-${monthNum}`;

  logger.info(`🔄 Running 1st-of-month roll for MonthCards: ${targetMonth}`);

  /*
   * Last month is over — close it.
   *
   * Nothing in the product has ever set `MonthCardStatus.CLOSED`; every card
   * created since the first roll is still OPEN. That is not just an unused
   * enum value, because one alert rule depends on it: MONTH_CARD_NOT_INVOICED
   * looks for a card CLOSED more than five days ago with no invoice against
   * it — the month's work finished and nobody billed for it — and it has been
   * unable to fire since the day it was written.
   *
   * Derived rather than a button. A month that has ended is closed; that is
   * the calendar's opinion, not a judgement anybody needs to make by hand, and
   * this job already wakes up on the 1st to open the new one.
   *
   * Not filtered to ACTIVE retainers: a client who left in March still has a
   * March card, and it still wants invoicing.
   */
  const closed = await prisma.monthCard.updateMany({
    where: { month: { lt: targetMonth }, status: 'OPEN' },
    data: { status: 'CLOSED', closedAt: new Date() },
  });
  if (closed.count > 0) {
    logger.info(`   closed ${closed.count} month card(s) for months before ${targetMonth}`);
  }

  const activeRetainers = await prisma.retainer.findMany({
    where: { status: 'ACTIVE' },
    include: {
      template: true,
      owner: true,
      company: true,
    },
  });

  let createdCards = 0;
  let createdTasks = 0;

  for (const retainer of activeRetainers) {
    /*
     * Not before it starts.
     *
     * The roll took every ACTIVE retainer and billed it for the target month,
     * so a retainer signed today to begin in November produced a September and
     * an October card as the months came round — two bills for work not yet
     * begun, and two months of revenue in the figures. `status: ACTIVE` says
     * the agreement is live, not that it has commenced.
     */
    if (!hasStartedBy(retainer.startDate, targetMonth)) {
      continue;
    }

    // Check if MonthCard already exists
    const existing = await prisma.monthCard.findUnique({
      where: {
        retainerId_month: {
          retainerId: retainer.id,
          month: targetMonth,
        },
      },
    });

    if (existing) {
      continue;
    }

    // Create MonthCard
    const [targetYear, targetMonthStr] = targetMonth.split('-');
    const y = parseInt(targetYear, 10);
    const m = parseInt(targetMonthStr, 10) - 1; // 0-indexed month

    const monthCard = await prisma.monthCard.create({
      data: {
        retainerId: retainer.id,
        month: targetMonth,
        revenue: retainer.monthlyValue,
        status: 'OPEN',
      },
    });
    createdCards++;

    // System-generated — no actor. §16: "every create ... writes an Activity
    // row, no exceptions" doesn't stop applying just because a job did it
    // instead of a person; this is what makes the MonthCard traceable from
    // the company's History tab.
    await prisma.activity.create({
      data: {
        organizationId: retainer.organizationId,
        entityType: 'MonthCard',
        entityId: monthCard.id,
        actorId: null,
        verb: 'month_card_created',
        payload: { retainerId: retainer.id, month: targetMonth, companyName: retainer.company.name },
      },
    });

    // Spawn template tasks if retainer has linked template
    if (retainer.template && Array.isArray(retainer.template.items)) {
      const items = retainer.template.items as Array<{
        title: string;
        dept?: string;
        dayOfMonth?: number;
      }>;

      for (const [index, item] of items.entries()) {
        const day = item.dayOfMonth || 5;
        const dueDate = new Date(y, m, Math.min(day, 28));

        await prisma.task.create({
          data: {
            organizationId: retainer.organizationId,
            title: `${item.title} (${retainer.company.name})`,
            workType: TaskWorkType.MONTH_CARD,
            workId: monthCard.id,
            monthCardId: monthCard.id,
            assigneeId: retainer.ownerId,
            createdById: retainer.ownerId,
            // My Work and a person's load read the join, so a template-spawned
            // task without a row here would appear on nobody's screen.
            assignees: { create: { userId: retainer.ownerId } },
            dueDate,
            status: TaskStatus.TODO,
            // §8 "Task type average": median for tasks sharing the same
            // templateItemId — this is what lets the aging rule group
            // template-spawned tasks by what they actually are, not just
            // who they're assigned to. `index` into the template's own
            // items array is the stable-enough identity of "this line".
            templateItemId: `${retainer.templateId}:${index}`,
          },
        });
        createdTasks++;
      }
    }
  }

  logger.info(`✅ 1st-of-month roll complete: Created ${createdCards} MonthCards and ${createdTasks} tasks.`);
  return { createdCards, createdTasks };
}

/**
 * Background runner that keeps MonthCards rolling on their own. `rollActiveRetainers`
 * is idempotent per (retainerId, month) — every run resolves to "today's" month and
 * skips retainers that already have a card for it — so polling on an interval rather
 * than computing an exact midnight-on-the-1st timer is enough: whichever tick lands
 * after midnight on the 1st creates the month's cards, and every other tick is a
 * cheap no-op. This is what makes the roll actually automatic instead of the
 * `POST /retainers/roll-month` admin button being the only way it ever runs.
 */
export function startMonthCardScheduler(intervalMs = 3600000) {
  if (process.env.NODE_ENV !== 'test') {
    rollActiveRetainers().catch((e) => logger.error(`Initial month-card roll error: ${e}`));
    setInterval(() => {
      rollActiveRetainers().catch((e) => logger.error(`Periodic month-card roll error: ${e}`));
    }, intervalMs);
  }
}
