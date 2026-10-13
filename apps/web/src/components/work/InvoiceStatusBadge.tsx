'use client';

import { INVOICE_STATE, type InvoiceStateKey } from '@/lib/money';

/**
 * An invoice's status, the same everywhere: /money, a client's tab, a
 * project's invoices (Money Plan 2, decisions 6 and 15).
 *
 * The server works it out — overdue is due before today where the studio is,
 * part-paid is open with money in — and sends `state`. Rows from before that
 * fall back to the stored status, so an old cache never shows a blank badge.
 */
const TONE: Record<string, string> = {
  neutral: 'border border-warning/40 text-warning-ink bg-warning-tint',
  info: 'border border-info/30 text-info bg-info-tint',
  danger: 'border border-danger/40 text-danger bg-danger-tint',
  success: 'border border-success/30 text-success bg-success-tint',
  muted: 'border border-border text-secondary bg-subtle',
};

export function InvoiceStatusBadge({
  invoice,
  className = '',
}: {
  invoice: { status: string; state?: string | null; isOverdue?: boolean; partPaid?: boolean; agingDays?: number };
  className?: string;
}) {
  const key: InvoiceStateKey =
    (invoice.state as InvoiceStateKey | undefined) ??
    (invoice.status === 'PAID' || invoice.status === 'CANCELLED'
      ? (invoice.status as InvoiceStateKey)
      : invoice.isOverdue || invoice.status === 'OVERDUE'
        ? 'OVERDUE'
        : invoice.partPaid
          ? 'PART_PAID'
          : 'RAISED');
  const s = INVOICE_STATE[key] ?? INVOICE_STATE.RAISED;
  const extra = [
    key === 'OVERDUE' && invoice.agingDays ? `${invoice.agingDays}d` : null,
    key === 'OVERDUE' && invoice.partPaid ? 'part-paid' : null,
  ].filter(Boolean);
  return (
    <span className={`whitespace-nowrap text-micro font-medium px-2 py-0.5 rounded ${TONE[s.tone]} ${className}`}>
      {s.label}
      {extra.length ? ` · ${extra.join(' · ')}` : ''}
    </span>
  );
}
