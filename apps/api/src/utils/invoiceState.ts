import { dayKey, isOverdueOn } from './moneyDates.js';
import { sumPaise } from './paise.js';

/**
 * What an invoice is, as a person reads it — worked out on the server, in one
 * place, so `/money`, a client's tab and a project's invoices show the same
 * badge for the same invoice (Money Plan 2, decisions 6 and 15).
 *
 * OVERDUE is never stored by anything that matters: a RAISED invoice becomes
 * overdue by the calendar, so it is derived from `dueAt` against today in the
 * studio's timezone. Part-paid is derived from its payments.
 */
export type InvoiceState = 'RAISED' | 'PART_PAID' | 'OVERDUE' | 'PAID' | 'CANCELLED';

export function invoiceState(
  inv: { status: string; dueAt: Date; payments?: readonly { amount: unknown }[] },
  today: string,
): { state: InvoiceState; isOverdue: boolean; partPaid: boolean } {
  if (inv.status === 'PAID') return { state: 'PAID', isOverdue: false, partPaid: false };
  if (inv.status === 'CANCELLED') return { state: 'CANCELLED', isOverdue: false, partPaid: false };
  const isOverdue = isOverdueOn(inv, today);
  const partPaid = (inv.payments ? sumPaise(inv.payments) : 0) > 0;
  return { state: isOverdue ? 'OVERDUE' : partPaid ? 'PART_PAID' : 'RAISED', isOverdue, partPaid };
}

/** Days past due, for the "· 12d" on an overdue badge. */
export const daysPastDue = (dueAt: Date, today: string): number =>
  Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dayKey(dueAt)}T00:00:00Z`)) / 86400000));
