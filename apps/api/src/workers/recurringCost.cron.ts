import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';

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
export async function rollRecurringCosts(month?: string): Promise<{ created: number }> {
  const now = new Date();
  const targetMonth = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [year, mon] = targetMonth.split('-').map((n) => parseInt(n, 10));
  const monthStart = new Date(year, mon - 1, 1);
  const monthEnd = new Date(year, mon, 1);

  const templates = await prisma.cost.findMany({
    where: { recurring: true, deletedAt: null },
  });

  let created = 0;
  for (const template of templates) {
    const alreadyRolled = await prisma.cost.findFirst({
      where: {
        recurringSourceId: template.id,
        incurredAt: { gte: monthStart, lt: monthEnd },
        deletedAt: null,
      },
    });
    if (alreadyRolled) continue;

    await prisma.cost.create({
      data: {
        organizationId: template.organizationId,
        type: template.type,
        workType: template.workType,
        workId: template.workId,
        monthCardId: template.monthCardId,
        projectId: template.projectId,
        category: template.category,
        vendor: template.vendor,
        amount: template.amount,
        incurredAt: monthStart,
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
        payload: { month: targetMonth, category: template.category, vendor: template.vendor },
      },
    });

    created++;
  }

  return { created };
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
