'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { formatMoney, type BriefAlertRow } from '@/lib/api-v2';
import { cn, getInitials } from '@/lib/utils';
import { remembered } from './format';

/** Groups longer than this fold, with "Show all". */
const FOLD_AT = 5;

/** The stripe down a row's left edge: how urgent it is. Risks are drawn calmer. */
const STRIPE: Record<'action' | 'risk', Record<BriefAlertRow['severity'], string>> = {
  action: { HIGH: 'bg-danger', MED: 'bg-warning', LOW: 'bg-line' },
  risk: { HIGH: 'bg-warning', MED: 'bg-info', LOW: 'bg-line' },
};
const SEVERITY_WORD: Record<BriefAlertRow['severity'], string> = { HIGH: 'High', MED: 'Medium', LOW: 'Low' };

const age = (days: number) => (days === 0 ? 'today' : `${days}d`);

/** One row: client, what, amount, who to ask, how long it has been flagged. The whole row opens it. */
function Row({ row, tone, currency }: { row: BriefAlertRow; tone: 'action' | 'risk'; currency: string }) {
  const body = (
    <>
      <span className={cn('w-[3px] shrink-0 self-stretch rounded-full', STRIPE[tone][row.severity])} aria-hidden="true" />
      <span className="sr-only">{SEVERITY_WORD[row.severity]}:</span>
      <span className="min-w-0 flex-1 py-0.5">
        <span className="block text-sm leading-snug text-body">
          {row.clientName && <span className="font-semibold text-primary">{row.clientName} </span>}
          {row.title}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-secondary">
          {row.ownerName && (
            <span className="inline-flex items-center gap-1.5">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-micro font-semibold leading-none text-white" aria-hidden="true">
                {getInitials(row.ownerName)}
              </span>
              {row.ownerName}
            </span>
          )}
          <span className="rounded-full bg-subtle px-1.5 py-px tabular-nums" title={`Flagged ${row.flaggedDaysAgo} days ago`}>
            <span className="sr-only">Flagged </span>
            {age(row.flaggedDaysAgo)}
            <span className="sr-only">{row.flaggedDaysAgo ? ' ago' : ''}</span>
          </span>
        </span>
      </span>
      {row.amount !== undefined && (
        <span className="shrink-0 pt-0.5 text-sm font-semibold tabular-nums text-primary">{formatMoney(row.amount, currency)}</span>
      )}
    </>
  );
  const cls = 'flex items-start gap-3 rounded-lg px-2.5 py-2.5';
  return row.link ? (
    <Link
      href={row.link}
      className={cn(
        cls,
        'group/row transition-[background-color,transform] duration-150 hover:-translate-y-px hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none motion-reduce:hover:translate-y-0',
      )}
    >
      {body}
      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-line transition-colors group-hover/row:text-secondary" aria-hidden="true" />
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/**
 * A group card: what kind of thing, how many, the money in it, and the rows.
 * Past five it folds; whether it is open is remembered in this browser.
 */
export function AlertGroup({
  group,
  items,
  icon: Icon,
  tone,
  currency,
  showTotal,
}: {
  group: string;
  items: BriefAlertRow[];
  icon: LucideIcon;
  tone: 'action' | 'risk';
  currency: string;
  showTotal?: boolean;
}) {
  const key = `flowzen.brief.open.${group}`;
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(remembered.get(key) === '1'), [key]);
  const toggle = () =>
    setOpen((o) => {
      remembered.set(key, o ? null : '1');
      return !o;
    });

  const shown = open ? items : items.slice(0, FOLD_AT);
  const total = items.reduce((s, r) => s + (r.amount ?? 0), 0);

  return (
    <section aria-label={group} className="rounded-card border border-border bg-white">
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-subtle text-primary" aria-hidden="true">
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <h3 className="text-sm font-semibold text-primary">{group}</h3>
        <span className="rounded-full bg-subtle px-1.5 py-px text-micro font-medium tabular-nums text-secondary">{items.length}</span>
        {showTotal && total > 0 && (
          <span className="ml-auto text-sm font-semibold tabular-nums text-primary">{formatMoney(total, currency)}</span>
        )}
      </header>
      <div className="p-1.5">
        {shown.map((r) => (
          <Row key={r.alertId} row={r} tone={tone} currency={currency} />
        ))}
      </div>
      {items.length > FOLD_AT && (
        <div className="border-t border-border px-4 py-2">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            className="rounded text-xs font-medium text-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {open ? 'Show fewer' : `Show all ${items.length}`}
          </button>
        </div>
      )}
    </section>
  );
}
