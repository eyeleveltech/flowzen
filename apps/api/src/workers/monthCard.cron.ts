import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { hasStartedBy } from '../utils/retainerMonths.js';
import { defaultProjectId } from '../services/retainerProjects.js';

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
      owner: true,
      company: true,
    },
  });

  let createdCards = 0;

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

    /*
     * The card opens empty, and the team fills it.
     *
     * Task templates used to put a month's work on it automatically — a
     * blueprint per retainer, each line spawning its tasks on a fixed day.
     * They were removed: nobody was going to maintain a second place where
     * work is defined, and a template nobody edits drifts from what the
     * client actually buys until it is worse than nothing.
     *
     * What the roll still guarantees is the part that mattered: the card
     * itself appears, with its revenue, on the 1st, for every active retainer
     * — so nobody has to remember to open the month.
     */
    await defaultProjectId(retainer);
  }

  logger.info(`✅ 1st-of-month roll complete: opened ${createdCards} month card(s).`);
  // `createdTasks` is kept in the shape for the admin roll endpoint that
  // reports it, and is always nought now that nothing is spawned.
  return { createdCards, createdTasks: 0 };
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
