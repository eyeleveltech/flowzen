'use client';

/**
 * Project milestones to bill — on /money → Billing, beside the retainer board
 * (Money Plan 2, decision 11).
 *
 * Milestone billing lived only on the project page, which needs `work.all`, so
 * Accounts — who raise the invoices and hold `money.figures`, not `work.all` —
 * could not bill a project at all. The same three steps live here now, with
 * the same forms the project page uses:
 *
 *   Raise proforma  →  Record invoice  →  Record payment
 *
 * Each project shows its next milestone not yet billed, and every milestone
 * with a proforma or an invoice out.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, formatMoney, type MilestoneToBill } from '@/lib/api-v2';
import { Button } from '@/components/ui/button';
import { LoadError } from '@/components/ui/empty-state';
import { TableRowsSkeleton } from '@/components/ui/skeleton-loaders';
import { NewProformaModal } from '@/components/clients/NewProformaModal';
import { MilestoneInvoiceModal } from '@/components/work/MilestoneInvoiceModal';
import { InvoiceStatusBadge } from '@/components/work/InvoiceStatusBadge';
import { moneyDate } from '@/lib/money';

export const projectMilestonesKey = ['money', 'milestones'] as const;

const STEP_LABEL: Record<MilestoneToBill['next'], string> = {
  PROFORMA: 'To raise',
  INVOICE: 'Proforma out',
  PAYMENT: 'Invoiced, unpaid',
};

export function ProjectMilestonesBilling() {
  const queryClient = useQueryClient();
  const { data, isPending, error, refetch } = useQuery({
    queryKey: projectMilestonesKey,
    queryFn: () => api.money.milestones(),
  });
  const rows = data?.rows ?? [];
  const [raising, setRaising] = useState<MilestoneToBill | null>(null);
  const [billing, setBilling] = useState<{ mode: 'INVOICE' | 'PAYMENT'; row: MilestoneToBill } | null>(null);

  const done = async () => {
    setRaising(null);
    setBilling(null);
    await queryClient.invalidateQueries({ queryKey: ['money'] });
    await queryClient.invalidateQueries({ queryKey: ['invoices'] });
  };

  return (
    <section className="mt-8 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-primary">Project milestones</h2>
        <p className="text-micro text-secondary">
          Milestone amounts are before GST · invoice balances include GST · Proforma → Invoice → Paid
        </p>
      </div>

      {error ? (
        <LoadError what="the project milestones" error={error} onRetry={() => void refetch()} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="overflow-x-auto">
            <table className="w-full data-table">
              <thead>
                <tr className="border-b border-border">
                  <th className="eyebrow text-left">Project</th>
                  <th className="eyebrow text-left">Milestone</th>
                  <th className="eyebrow text-right">Amount</th>
                  <th className="eyebrow text-left">Where it is</th>
                  <th className="eyebrow text-left">Document</th>
                  <th className="" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isPending ? (
                  <TableRowsSkeleton cols={6} />
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-sm text-secondary">
                      No project milestones waiting to be billed or paid.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="hover:bg-subtle transition-colors">
                      <td>
                        <Link href={`/companies/${r.company.id}`} className="text-sm font-semibold text-primary hover:underline">
                          {r.company.name}
                        </Link>
                        <p className="text-micro text-secondary">{r.project.name}</p>
                      </td>
                      <td className="text-body">
                        {r.label} <span className="text-micro text-secondary">· {r.percent}%</span>
                      </td>
                      <td className="text-right tabular-nums">
                        {r.invoice ? (
                          <>
                            {formatMoney(r.invoice.balanceDue)}
                            <span className="block text-micro text-secondary">left of {formatMoney(r.invoice.amount)}, incl. GST</span>
                          </>
                        ) : (
                          <>
                            {formatMoney(r.amount)}
                            <span className="block text-micro text-secondary">before GST</span>
                          </>
                        )}
                      </td>
                      <td>
                        {r.invoice ? (
                          <InvoiceStatusBadge invoice={r.invoice} />
                        ) : (
                          <span className="text-micro text-secondary">{STEP_LABEL[r.next]}</span>
                        )}
                      </td>
                      <td className="font-mono text-xs text-secondary">
                        {r.invoice ? (
                          <>
                            {r.invoice.number}
                            <span className="block font-sans text-micro">due {moneyDate(r.invoice.dueAt)}</span>
                          </>
                        ) : r.proforma ? (
                          <>
                            {r.proforma.number}
                            <span className="block font-sans text-micro">
                              {r.proforma.status === 'EXPIRED' ? 'expired' : `valid till ${moneyDate(r.proforma.validTill)}`}
                            </span>
                          </>
                        ) : r.status !== 'PENDING' ? (
                          // The status says a document exists and none is on file.
                          <span className="font-sans text-warning-ink">Not on file</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="text-right">
                        {r.next === 'PROFORMA' && (
                          <Button size="sm" variant="ghost" onClick={() => setRaising(r)}>
                            Raise proforma
                          </Button>
                        )}
                        {r.next === 'INVOICE' && (
                          <Button size="sm" variant="ghost" onClick={() => setBilling({ mode: 'INVOICE', row: r })}>
                            Record invoice
                          </Button>
                        )}
                        {r.next === 'PAYMENT' && r.invoice && (
                          <Button size="sm" variant="ghost" onClick={() => setBilling({ mode: 'PAYMENT', row: r })}>
                            Record payment
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {raising && (
        <NewProformaModal
          companyId={raising.company.id}
          companyName={raising.company.name}
          source={{ type: 'MILESTONE', projectId: raising.project.id, milestoneId: raising.id }}
          defaultAmount={raising.amount}
          defaultDescription={`${raising.label} — ${raising.project.name}`}
          onCancel={() => setRaising(null)}
          onConfirm={() => void done()}
        />
      )}

      {billing && (
        <MilestoneInvoiceModal
          mode={billing.mode}
          projectId={billing.row.project.id}
          companyId={billing.row.company.id}
          milestone={{
            id: billing.row.id,
            label: billing.row.label,
            amount: billing.row.amount,
            status: billing.row.status,
            invoice: billing.row.invoice
              ? { id: billing.row.invoice.id, number: billing.row.invoice.number, amount: billing.row.invoice.amount, gstAmount: billing.row.invoice.gstAmount }
              : null,
          }}
          onClose={() => setBilling(null)}
          onDone={() => void done()}
        />
      )}
    </section>
  );
}
