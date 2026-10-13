import { prisma } from '../lib/prisma.js';
import { asStoredDay, dayKey, moneyClock, orgToday } from '../utils/moneyDates.js';

/**
 * Proformas past their valid-till date become EXPIRED (Money Plan 2,
 * decision 12). Nothing ever set the status, so a lapsed request for money
 * sat as UNPAID for ever, counted as money "sitting" to be collected.
 *
 * The plan's data-safety rule 6, kept exactly:
 *   · only UNPAID → EXPIRED; nothing else about the proforma changes
 *   · each one is logged in Activity with the status it had
 *   · never a proforma with anything recorded against it — one that became an
 *     invoice (which is where payments are recorded) is left alone
 *
 * Runs with the hourly scan; each proforma expires once, so it is a daily
 * step in effect. "Past valid-till" is by the studio's calendar.
 */
export async function expireLapsedProformas(organizationId: string, now: Date = new Date()): Promise<number> {
  const today = asStoredDay(orgToday((await moneyClock(organizationId)).timezone, now));
  const lapsed = await prisma.proforma.findMany({
    where: { organizationId, status: 'UNPAID', validTill: { lt: today }, invoiceId: null },
    select: { id: true, number: true, validTill: true, company: { select: { name: true } } },
  });
  if (lapsed.length === 0) return 0;

  // An invoice can point at its proforma without the proforma pointing back
  // (recorded before the two were linked both ways). That counts as billed.
  const billed = new Set(
    (
      await prisma.invoice.findMany({
        where: { organizationId, proformaId: { in: lapsed.map((p) => p.id) } },
        select: { proformaId: true },
      })
    ).map((i) => i.proformaId),
  );

  let expired = 0;
  for (const pf of lapsed) {
    if (billed.has(pf.id)) continue;
    // Only if it is still UNPAID at this moment — never over a payment just recorded.
    const changed = await prisma.proforma.updateMany({
      where: { id: pf.id, status: 'UNPAID', invoiceId: null },
      data: { status: 'EXPIRED' },
    });
    if (changed.count === 0) continue;
    await prisma.activity.create({
      data: {
        organizationId,
        entityType: 'Proforma',
        entityId: pf.id,
        actorId: null,
        verb: 'proforma_expired',
        payload: { number: pf.number, companyName: pf.company.name, validTill: dayKey(pf.validTill), from: 'UNPAID', to: 'EXPIRED' },
      },
    });
    expired++;
  }
  return expired;
}
