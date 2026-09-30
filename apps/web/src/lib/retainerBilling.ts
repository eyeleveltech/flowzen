/**
 * Where a retainer month's billing has got to — the one rule, for every screen.
 *
 * The Money board gets `step` from the server; the retainer page works it out
 * from the month it already loaded. Both go through here so the two can never
 * disagree about what a month is waiting for.
 */

import type { BillingInvoice, BillingProforma, BillingStep, RetainerBilling } from '@/lib/api-v2';

/** A proforma that still stands — cancelled or expired ones ask for nothing. */
export const isLiveProforma = (pf: Pick<BillingProforma, 'status'> | null | undefined) =>
  Boolean(pf && (pf.status === 'UNPAID' || pf.status === 'PAID'));

export function billingStepFor(args: {
  billing: RetainerBilling;
  month: string;
  monthOpen: boolean;
  proforma: BillingProforma | null;
  invoice: Pick<BillingInvoice, 'status'> | null;
  now?: Date;
}): BillingStep {
  const now = args.now ?? new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (args.invoice) return args.invoice.status === 'PAID' ? 'DONE' : 'PAYMENT';
  if (isLiveProforma(args.proforma)) return 'INVOICE';
  // Billed after the month: nothing to ask for while it is still running.
  if (args.billing === 'IN_ARREARS' && args.monthOpen && args.month >= thisMonth) return 'NOT_YET';
  return 'PROFORMA';
}

export const BILLING_LABEL: Record<RetainerBilling, string> = {
  IN_ADVANCE: 'Billed in advance',
  IN_ARREARS: 'Billed after the month',
};

export const BILLING_OPTIONS: { value: RetainerBilling; label: string }[] = [
  { value: 'IN_ADVANCE', label: 'In advance — proforma at the start of the month' },
  { value: 'IN_ARREARS', label: 'After the month — billed once it is over' },
];

/** "2026-10" → "October 2026". */
export const monthLabel = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
};

/** "2026-10" → "1 Nov" — when a month billed after it becomes billable. */
export const billableFrom = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 1).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
