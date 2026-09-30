'use client';

/**
 * Money → Retainer billing: every retainer's month, and what each is waiting for.
 *
 * The month's billing is one job — every retainer, three steps each — and it
 * used to be spread across a page per client that Accounts could not even
 * open. One table: the month on top, anything earlier that is still unpaid
 * above it (a month does not stop being owed because the calendar moved), and
 * on every row the button for the next step.
 *
 * "Raise all proformas" does the first of the month in one go, after showing
 * exactly what it is about to send.
 */

import { useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { api, ApiError, formatMoney, type RetainerBillingRow } from '@/lib/api-v2';
import { useConfirmStore } from '@/stores/confirm';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ErrorNote } from '@/components/ui/empty-state';
import { TableRowsSkeleton } from '@/components/ui/skeleton-loaders';
import { BillingNext } from '@/components/work/RetainerBilling';
import { BILLING_LABEL, monthLabel } from '@/lib/retainerBilling';

const money = (v: number) => formatMoney(v, 'INR', 'en-IN');

const shiftMonth = (month: string, delta: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** The key the Money page's tab count reads too, so the two share one fetch. */
export const retainerBillingKey = (month: string) => ['retainer-billing', month] as const;

export function RetainerBillingBoard() {
  const queryClient = useQueryClient();
  const confirm = useConfirmStore((st) => st.confirm);
  // Empty is "this month", as the server decides it.
  const [month, setMonth] = useState('');
  const [raising, setRaising] = useState(false);

  const { data, isPending, error, refetch } = useQuery({
    queryKey: retainerBillingKey(month),
    queryFn: () => api.invoices.retainerBilling(month || undefined),
  });

  const shown = data?.month ?? month;
  const rows = data?.rows ?? [];
  const earlier = rows.filter((r) => r.earlier);
  const current = rows.filter((r) => !r.earlier);
  const raisable = rows.filter((r) => r.step === 'PROFORMA');

  const changed = () => {
    void refetch();
    // An invoice or a payment moves the rest of the Money screen too.
    void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    void queryClient.invalidateQueries({ queryKey: ['retainer-billing'] });
  };

  const raiseAll = async () => {
    if (raisable.length === 0) return;
    const noRate = raisable.filter((r) => r.gstPercent == null).length;
    const lines = raisable
      .slice(0, 12)
      .map((r) => `• ${r.companyName} — ${monthLabel(r.month)} · ${money(r.fee)}`)
      .join('\n');
    const ok = await confirm({
      title: `Raise ${raisable.length} proforma${raisable.length === 1 ? '' : 's'}?`,
      message:
        `Each is filled from the client's billing details, the month's fee and the retainer's GST rate.\n\n${lines}` +
        (raisable.length > 12 ? `\n…and ${raisable.length - 12} more` : '') +
        (noRate > 0 ? `\n\n${noRate} ${noRate === 1 ? 'has' : 'have'} no GST rate recorded — 18% will be used.` : ''),
      confirmText: 'Raise them',
      variant: 'info',
    });
    if (!ok) return;
    setRaising(true);
    try {
      const res = await api.proformas.raiseForRetainerMonths(raisable.map((r) => r.monthCardId));
      if (res.created.length > 0) toast.success(`${res.created.length} proforma${res.created.length === 1 ? '' : 's'} raised`);
      for (const s of res.skipped) toast.error(`${s.companyName}: ${s.reason}`, { duration: 8000 });
      changed();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not raise the proformas');
    } finally {
      setRaising(false);
    }
  };

  const summary = data?.summary;

  return (
    <div className="space-y-4">
      {/* ── Which month, and how it stands ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            icon={ChevronLeft}
            aria-label="Previous month"
            onClick={() => shown && setMonth(shiftMonth(shown, -1))}
          />
          <span className="min-w-36 text-center text-sm font-semibold text-primary">
            {shown ? monthLabel(shown) : '…'}
          </span>
          <Button
            size="sm"
            variant="ghost"
            icon={ChevronRight}
            aria-label="Next month"
            disabled={!shown || (data?.thisMonth != null && shown >= data.thisMonth)}
            onClick={() => shown && setMonth(shiftMonth(shown, 1))}
          />
          {data && shown !== data.thisMonth && (
            <Button size="sm" variant="ghost" onClick={() => setMonth('')}>
              This month
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {summary && (
            <p className="text-xs text-secondary">
              <b className="text-primary">{summary.toRaise}</b> to raise ·{' '}
              <b className="text-primary">{summary.awaitingInvoice}</b> waiting on the client ·{' '}
              <b className="text-primary">{summary.awaitingPayment}</b> invoiced, unpaid ·{' '}
              <b className="text-primary">{money(summary.outstanding)}</b> still to come in
            </p>
          )}
          <Button
            size="sm"
            variant="primary"
            icon={FileText}
            onClick={() => void raiseAll()}
            loading={raising}
            disabled={raisable.length === 0 || raising}
          >
            Raise all proformas{raisable.length > 0 ? ` (${raisable.length})` : ''}
          </Button>
        </div>
      </div>

      {error && <ErrorNote onDismiss={() => void refetch()}>{error instanceof Error ? error.message : 'Could not load billing'}</ErrorNote>}

      <div className="overflow-hidden rounded-xl border border-border">
        <div className="overflow-x-auto">
          <table className="data-table w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="eyebrow text-left">Client</th>
                <th className="eyebrow text-left">Month</th>
                <th className="eyebrow text-right">Fee</th>
                <th className="eyebrow text-left">Proforma</th>
                <th className="eyebrow text-left">Invoice</th>
                <th className="eyebrow text-right">Received</th>
                <th className="eyebrow" aria-label="Next step" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isPending ? (
                <TableRowsSkeleton cols={7} />
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-14 text-center text-sm text-secondary">
                    No retainer has a month in {shown ? monthLabel(shown) : 'this month'}.
                  </td>
                </tr>
              ) : (
                <>
                  {earlier.length > 0 && <GroupHeading label="Earlier months, still owed" />}
                  {earlier.map((r) => (
                    <BoardRow key={r.monthCardId} r={r} onChanged={changed} />
                  ))}
                  {earlier.length > 0 && current.length > 0 && <GroupHeading label={monthLabel(shown)} />}
                  {current.map((r) => (
                    <BoardRow key={r.monthCardId} r={r} onChanged={changed} />
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/**
 * One retainer's billing, every month — its page's Billing tab.
 *
 * The board is the month across every client; this is the client across every
 * month, so "has Carlton paid for August?" is answered on Carlton's retainer
 * without going to Money and paging back. Same rows, same buttons, newest
 * month first.
 */
export function RetainerBillingHistory({ retainerId, onChanged }: { retainerId: string; onChanged?: () => void }) {
  const queryClient = useQueryClient();
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['retainer-billing', 'retainer', retainerId],
    queryFn: () => api.invoices.retainerBilling(undefined, retainerId),
  });
  const rows = data?.rows ?? [];
  const summary = data?.summary;

  const changed = () => {
    void refetch();
    void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    void queryClient.invalidateQueries({ queryKey: ['retainer-billing'] });
    onChanged?.();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-secondary">
          {rows[0] ? BILLING_LABEL[rows[0].billing] : 'Every month of this retainer'} · Proforma → Invoice → Paid
        </p>
        {summary && (
          <p className="text-xs text-secondary">
            <b className="text-primary">{summary.toRaise}</b> to raise ·{' '}
            <b className="text-primary">{summary.awaitingInvoice}</b> waiting on the client ·{' '}
            <b className="text-primary">{summary.awaitingPayment}</b> invoiced, unpaid ·{' '}
            <b className="text-primary">{money(summary.outstanding)}</b> still to come in
          </p>
        )}
      </div>

      {error && <ErrorNote onDismiss={() => void refetch()}>{error instanceof Error ? error.message : 'Could not load billing'}</ErrorNote>}

      <div className="overflow-hidden rounded-xl border border-border">
        <div className="overflow-x-auto">
          <table className="data-table w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="eyebrow text-left">Month</th>
                <th className="eyebrow text-right">Fee</th>
                <th className="eyebrow text-left">Proforma</th>
                <th className="eyebrow text-left">Invoice</th>
                <th className="eyebrow text-right">Received</th>
                <th className="eyebrow" aria-label="Next step" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isPending ? (
                <TableRowsSkeleton cols={6} />
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-14 text-center text-sm text-secondary">
                    No months yet — the first one is created on the retainer's start date.
                  </td>
                </tr>
              ) : (
                rows.map((r) => <BoardRow key={r.monthCardId} r={r} onChanged={changed} showClient={false} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function GroupHeading({ label }: { label: string }) {
  return (
    <tr className="bg-surface">
      <th colSpan={7} scope="colgroup" className="eyebrow text-left">
        {label}
      </th>
    </tr>
  );
}

const PF_TONE: Record<string, 'good' | 'warn' | 'bad' | 'neutral'> = {
  UNPAID: 'warn',
  PAID: 'good',
  EXPIRED: 'bad',
  CANCELLED: 'neutral',
};
const PF_WORD: Record<string, string> = { UNPAID: 'Unpaid', PAID: 'Paid', EXPIRED: 'Expired', CANCELLED: 'Cancelled' };

function BoardRow({
  r,
  onChanged,
  showClient = true,
}: {
  r: RetainerBillingRow;
  onChanged: () => void;
  /** Off on a retainer's own page, where every row is the same client. */
  showClient?: boolean;
}) {
  const overdue =
    r.invoice && r.invoice.status !== 'PAID' && r.invoice.status !== 'CANCELLED' && new Date(r.invoice.dueAt) < new Date();

  return (
    <tr className="transition-colors hover:bg-subtle">
      {showClient && (
        <td>
          <Link
            href={`/companies/${r.companyId}?tab=MONEY`}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            {r.companyName}
          </Link>
          <span className="block text-micro text-secondary">
            {BILLING_LABEL[r.billing]}
            {r.retainerStopped ? ' · retainer ended' : ''}
          </span>
        </td>
      )}
      <td className="whitespace-nowrap text-secondary">
        {monthLabel(r.month)}
        {r.earlier && <span className="block text-micro font-medium text-warning-ink">still owed</span>}
      </td>
      <td className="text-right tabular-nums text-primary">
        {money(r.fee)}
        <span className="block text-micro text-secondary">
          {r.gstPercent == null ? 'GST not set' : r.gstPercent === 0 ? 'no GST' : `+${r.gstPercent}% GST`}
        </span>
      </td>
      <td>
        {r.proforma ? (
          <span className="flex flex-col items-start gap-0.5">
            <span className="text-sm text-primary">{r.proforma.number}</span>
            <Badge tone={PF_TONE[r.proforma.status]}>{PF_WORD[r.proforma.status]}</Badge>
          </span>
        ) : (
          <span className="text-xs text-secondary">{r.invoice ? '—' : 'Not raised'}</span>
        )}
      </td>
      <td>
        {r.invoice ? (
          <span className="flex flex-col">
            <span className="text-sm text-primary">{r.invoice.number}</span>
            <span className={`text-micro ${overdue ? 'font-medium text-danger' : 'text-secondary'}`}>
              due {day(r.invoice.dueAt)}
              {overdue ? ' · overdue' : ''}
            </span>
          </span>
        ) : (
          <span className="text-xs text-secondary">—</span>
        )}
      </td>
      <td className="text-right tabular-nums">
        {r.invoice ? (
          <span className={r.invoice.status === 'PAID' ? 'text-success' : 'text-primary'}>
            {money(r.invoice.paid)}
            {r.invoice.status !== 'PAID' && <span className="block text-micro text-secondary">of {money(r.invoice.amount)}</span>}
          </span>
        ) : (
          <span className="text-xs text-secondary">—</span>
        )}
      </td>
      <td className="text-right">
        <BillingNext subject={r} onChanged={onChanged} />
      </td>
    </tr>
  );
}
