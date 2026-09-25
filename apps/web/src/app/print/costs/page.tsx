'use client';

/**
 * What a job cost, on a sheet of paper.
 *
 * ─── Why a page rather than a PDF ───────────────────────────────────────────
 *
 * The app already renders PDFs — quotations, proformas, invoices — through a
 * headless browser, because those are documents that go OUT: numbered, dated,
 * signed, kept for seven years. A cost sheet is none of that. It is what the
 * studio spent on one job, read in a meeting or handed to whoever is asking,
 * and building it through the statutory pipeline would mean giving it a number
 * and a template it has no business having.
 *
 * So it is a page the browser prints, which also means "Save as PDF" is right
 * there in the print dialog. It sits outside the dashboard layout so there is
 * no sidebar to hide with print CSS — the thing on screen is the thing on the
 * page.
 *
 * ─── Where the figures come from ────────────────────────────────────────────
 *
 * The rows come from the API under the reader's own permissions: `/costs`
 * blanks the amount for anybody without `money.figures`, so this sheet cannot
 * become a way around that gate. The heading is passed in by the screen that
 * opened it, which already has the names on it — decorative, and never a
 * figure.
 */

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, formatMoney, formatDate } from '@/lib/api-v2';
import { useConfig } from '@/hooks/queries';

type Row = {
  id: string;
  category: string;
  vendor: string;
  paidBy: string;
  amount: number | null;
  incurredAt: string;
  enteredBy?: { name: string } | null;
  project?: { name: string; company?: { name: string } | null } | null;
  monthCard?: { month: string; retainer?: { company?: { name: string } | null } | null } | null;
};

export default function CostSheet() {
  const params = useSearchParams();
  const projectId = params.get('projectId') ?? '';
  const monthCardId = params.get('monthCardId') ?? '';
  const { data: config } = useConfig();

  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId && !monthCardId) {
      setError('Nothing to print — no project or month was named.');
      return;
    }
    const query: Record<string, string> = { limit: '500' };
    if (projectId) query.projectId = projectId;
    if (monthCardId) query.monthCardId = monthCardId;
    // `costs.list` unwraps to the array itself — see its note in api-v2.
    void api.costs
      .list(query)
      .then((r) => setRows((r ?? []) as Row[]))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the costs'));
  }, [projectId, monthCardId]);

  /*
   * The print dialog opens once, when there is something to print.
   *
   * Not on mount: a sheet that prints before its rows arrive is a sheet of
   * headings, and the person has already walked to the printer.
   */
  useEffect(() => {
    if (rows && rows.length >= 0 && !error) {
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
  }, [rows, error]);

  const first = rows?.[0];
  const client =
    params.get('client') ||
    first?.project?.company?.name ||
    first?.monthCard?.retainer?.company?.name ||
    '';
  const job = params.get('job') || first?.project?.name || (first?.monthCard ? `Retainer · ${first.monthCard.month}` : '');

  const tz = config?.organization.timezone;
  const locale = config?.organization.locale;

  const total = useMemo(
    () => (rows ?? []).reduce((sum, r) => sum + (typeof r.amount === 'number' ? r.amount : 0), 0),
    [rows],
  );
  // Blanked for anybody without `money.figures`, and a total of zero would read
  // as "this cost nothing" rather than "you may not see this".
  const figuresHidden = (rows ?? []).some((r) => r.amount === null);

  if (error) {
    return <main className="mx-auto max-w-3xl p-10 text-sm text-danger">{error}</main>;
  }

  return (
    <main className="mx-auto max-w-3xl bg-white p-10 text-body print:p-0">
      <header className="mb-6 border-b border-border pb-4">
        {/*
          The mark, not the name in capitals. This is a sheet that leaves the
          building — a meeting, a folder, somebody's desk — and the letterhead
          on every other document the studio sends is the logo.

          A plain <img>: the print renderer is the browser here, and next/image
          would hand it a lazy, srcset-ed element for no benefit on a page whose
          whole job is to be printed once.
        */}
        <img
          src="/eyelevel-logo-green.png"
          alt={config?.organization.name ?? 'EyeLevel'}
          width={180}
          height={48}
          className="mb-3 h-9 w-auto object-contain"
        />
        <h1 className="mt-1 text-xl font-semibold text-primary">Costs{client ? ` · ${client}` : ''}</h1>
        {job && <p className="mt-0.5 text-sm text-secondary">{job}</p>}
        <p className="mt-2 text-xs text-secondary">
          Printed {formatDate(new Date().toISOString(), tz, locale)}
          {rows ? ` · ${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}` : ''}
        </p>
      </header>

      {!rows ? (
        <p className="text-sm text-secondary">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-secondary">Nothing has been spent on this yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-secondary">
              <th className="py-2 pr-3 font-medium">Date</th>
              <th className="py-2 pr-3 font-medium">Paid towards</th>
              <th className="py-2 pr-3 font-medium">Paid to</th>
              <th className="py-2 pr-3 font-medium">Company</th>
              <th className="py-2 pr-3 font-medium">Entered by</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/60 align-top">
                <td className="py-2 pr-3 whitespace-nowrap text-secondary">{formatDate(r.incurredAt, tz, locale)}</td>
                <td className="py-2 pr-3 font-medium text-primary">{r.category}</td>
                <td className="py-2 pr-3">{r.vendor}</td>
                <td className="py-2 pr-3 text-secondary">{r.paidBy}</td>
                <td className="py-2 pr-3 text-secondary">{r.enteredBy?.name ?? '—'}</td>
                <td className="py-2 text-right whitespace-nowrap">
                  {typeof r.amount === 'number' ? formatMoney(r.amount) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} className="py-3 pr-3 text-right text-sm font-semibold text-primary">
                Total
              </td>
              <td className="py-3 text-right text-sm font-semibold text-primary whitespace-nowrap">
                {figuresHidden ? '—' : formatMoney(total)}
              </td>
            </tr>
          </tfoot>
        </table>
      )}

      {figuresHidden && (
        <p className="mt-4 text-xs text-secondary">
          Amounts are not shown on this copy — they need the money permission.
        </p>
      )}

      {/* On screen only — `.no-print` is the one mechanism globals.css keeps
          for this, now that the blanket blanking is gone. */}
      <div className="no-print mt-8">
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-xl border border-border px-4 py-2 text-sm text-body transition-colors hover:bg-subtle"
        >
          Print again
        </button>
      </div>
    </main>
  );
}
