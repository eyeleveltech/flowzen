/**
 * Money on screen — one set of words and dates for every money view
 * (Money Plan 2, decisions 8 and 15).
 *
 * Money dates are calendar days (an invoice's date, a payment's, a cost's),
 * stored as midnight UTC. Shown in the browser's zone they can slip a day, so
 * they are shown as the day they are — and always with the year, because a
 * money list spans years and "5 Mar" alone is two different invoices.
 */

/** A stored calendar day, with its year: "5 Mar 2026". */
export const moneyDate = (value: string | Date | null | undefined): string => {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
};

/** Today where the studio is, as "2026-10-05". */
export const todayIn = (timezone = 'Asia/Kolkata', now: Date = new Date()): string => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
};

/** The first day of the financial year a day is in: "2026-04-01". */
export function financialYearStart(day: string, fyStartMonth = 4): string {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  return `${m < fyStartMonth ? y - 1 : y}-${String(fyStartMonth).padStart(2, '0')}-01`;
}

const lastDayOf = (month: string): string => {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
const shiftMonth = (month: string, n: number): string => {
  const [y, m] = month.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

export type PeriodKey = 'this-month' | 'last-month' | 'this-quarter' | 'this-fy' | 'last-fy' | 'all';

export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'this-month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: 'this-quarter', label: 'This quarter' },
  { key: 'this-fy', label: 'This financial year' },
  { key: 'last-fy', label: 'Last financial year' },
  { key: 'all', label: 'All time' },
];

/** A period, as the from/to days the money summary takes (both included). */
export function periodRange(key: PeriodKey, today: string, fyStartMonth = 4): { from: string; to: string } {
  const month = today.slice(0, 7);
  const fyStart = financialYearStart(today, fyStartMonth);
  switch (key) {
    case 'this-month':
      return { from: `${month}-01`, to: lastDayOf(month) };
    case 'last-month': {
      const last = shiftMonth(month, -1);
      return { from: `${last}-01`, to: lastDayOf(last) };
    }
    case 'this-quarter': {
      // Quarters of the financial year: Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar.
      const fyMonth = fyStart.slice(0, 7);
      const [fy, fm] = fyMonth.split('-').map(Number);
      const [y, m] = month.split('-').map(Number);
      const into = (y * 12 + m) - (fy * 12 + fm);
      const qStart = shiftMonth(fyMonth, into - (into % 3));
      return { from: `${qStart}-01`, to: lastDayOf(shiftMonth(qStart, 2)) };
    }
    case 'this-fy':
      return { from: fyStart, to: lastDayOf(shiftMonth(fyStart.slice(0, 7), 11)) };
    case 'last-fy': {
      const start = shiftMonth(fyStart.slice(0, 7), -12);
      return { from: `${start}-01`, to: lastDayOf(shiftMonth(start, 11)) };
    }
    case 'all':
      return { from: '2000-01-01', to: lastDayOf(shiftMonth(month, 12)) };
  }
}

/**
 * How a payment came in — the same list and the same words wherever a payment
 * is recorded or shown. The stored value is the code; people read the label.
 */
export const PAYMENT_MODES = [
  { value: 'NEFT', label: 'NEFT' },
  { value: 'RTGS', label: 'RTGS' },
  { value: 'UPI', label: 'UPI' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'CASH', label: 'Cash' },
];

export const paymentModeLabel = (mode: string | null | undefined): string =>
  PAYMENT_MODES.find((m) => m.value === mode)?.label ?? (mode ? mode.charAt(0) + mode.slice(1).toLowerCase().replace(/_/g, ' ') : '—');

/** What an invoice is, as its badge says it — worked out on the server. */
export type InvoiceStateKey = 'RAISED' | 'PART_PAID' | 'OVERDUE' | 'PAID' | 'CANCELLED';

export const INVOICE_STATE: Record<InvoiceStateKey, { label: string; tone: 'neutral' | 'info' | 'danger' | 'success' | 'muted' }> = {
  RAISED: { label: 'Raised', tone: 'neutral' },
  PART_PAID: { label: 'Part-paid', tone: 'info' },
  OVERDUE: { label: 'Overdue', tone: 'danger' },
  PAID: { label: 'Paid', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'muted' },
};

/**
 * A cost that looks like salaries — the server's own rule (utils/salaryCost.ts).
 * Salaries are counted once, as people cost, so these are left out of overheads.
 */
export const looksLikeSalary = (text: string | null | undefined): boolean =>
  /salar|payroll|stipend|\bwages?\b|\bctc\b/i.test(text ?? '');
