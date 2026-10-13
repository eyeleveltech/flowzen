import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { moneyClock, monthBounds, monthOfDay, orgMonth } from '../utils/moneyDates.js';

/**
 * §13: "00:15 on the 1st — Create recurring Cost rows (rent, internet,
 * software, salaries) in draft, for confirmation."
 *
 * A `recurring: true` Cost row is the template — rent entered once, flagged
 * recurring. Each month this clones it forward as a new row pointing back
 * at the template via `recurringSourceId`, `confirmed: false` so it reads
 * as a draft until someone reviews it. The template itself is never
 * touched again after the month it was entered for.
 */
export async function rollRecurringCosts(
  month?: string,
  now: Date = new Date(),
): Promise<{ created: number; waiting: number }> {
  const templates = await prisma.cost.findMany({
    where: { recurring: true, deletedAt: null },
    include: { monthCard: { select: { retainerId: true } } },
  });

  // "This month" is the studio's month, not the server's (decision 8).
  const clocks = new Map<string, string>();
  const monthFor = async (orgId: string) => {
    if (month) return month;
    if (!clocks.has(orgId)) clocks.set(orgId, orgMonth((await moneyClock(orgId)).timezone, now));
    return clocks.get(orgId)!;
  };

  let created = 0;
  let waiting = 0;
  for (const template of templates) {
    const targetMonth = await monthFor(template.organizationId);

    /*
     * Never in the template's own month. The template IS that month's cost —
     * cloning it there as well counted rent twice in the month it was
     * entered. Nor before it.
     */
    if (targetMonth <= monthOfDay(template.incurredAt)) continue;

    /*
     * Once per template per month, ever. A clone somebody deleted counts: it
     * was deleted on purpose (we did not pay that this month), and bringing it
     * back within the hour is the job overruling a person. So deleted rows are
     * looked at too.
     */
    const { start, end } = monthBounds(targetMonth);
    const alreadyRolled = await prisma.cost.findFirst({
      where: { recurringSourceId: template.id, incurredAt: { gte: start, lt: end }, deletedAt: undefined },
      select: { id: true },
    });
    if (alreadyRolled) continue;

    /*
     * The right month. A retainer's cost goes on THAT retainer's card for the
     * month being rolled — copying the template's own card put every clone on
     * the month the template was entered in, long since closed. A company
     * cost belongs to no card; a project cost keeps its project.
     */
    let monthCardId: string | null = null;
    let workId = template.workId;
    const isRetainerCost = template.type !== 'COMPANY' && (template.monthCardId || template.workType === 'MONTH_CARD');
    if (isRetainerCost) {
      const retainerId =
        template.monthCard?.retainerId ??
        (template.workId
          ? (await prisma.monthCard.findUnique({ where: { id: template.workId }, select: { retainerId: true } }))?.retainerId
          : null);
      const card = retainerId
        ? await prisma.monthCard.findFirst({ where: { retainerId, month: targetMonth }, select: { id: true, status: true } })
        : null;
      // No card yet (the month's roll has not run, or the retainer stopped),
      // or a closed one: nothing to put it on. The next hourly run looks again.
      if (!card || card.status !== 'OPEN') {
        waiting++;
        continue;
      }
      monthCardId = card.id;
      if (template.workType === 'MONTH_CARD') workId = card.id;
    }

    const clone = await prisma.cost.create({
      data: {
        organizationId: template.organizationId,
        type: template.type,
        workType: template.workType,
        workId,
        monthCardId,
        projectId: template.projectId,
        category: template.category,
        vendor: template.vendor,
        amount: template.amount,
        gstPercent: template.gstPercent,
        incurredAt: start,
        committedNotPaid: template.committedNotPaid,
        paidBy: template.paidBy,
        treatment: template.treatment,
        enteredById: template.enteredById,
        recurring: false,
        recurringSourceId: template.id,
        confirmed: false,
        notes: template.notes,
      },
    });

    await prisma.activity.create({
      data: {
        organizationId: template.organizationId,
        entityType: 'Cost',
        entityId: template.id,
        actorId: null,
        verb: 'recurring_cost_rolled',
        payload: { month: targetMonth, category: template.category, vendor: template.vendor, cloneId: clone.id },
      },
    });

    created++;
  }

  return { created, waiting };
}

/**
 * Polls hourly rather than firing at exactly 00:15 on the 1st — same
 * documented tradeoff as monthCard.cron.ts and allocation.cron.ts. The
 * per-template dedupe check makes repeated runs within the month a no-op.
 */
export function startRecurringCostScheduler(intervalMs = 3600000) {
  if (process.env.NODE_ENV !== 'test') {
    rollRecurringCosts().catch((e) => logger.error(`Recurring cost roll error: ${e}`));
    setInterval(() => {
      rollRecurringCosts().catch((e) => logger.error(`Recurring cost roll error: ${e}`));
    }, intervalMs);
  }
}
