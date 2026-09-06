'use client';

import { useState, useEffect, useCallback } from 'react';
import { TableRowsSkeleton } from '@/components/ui/skeleton-loaders';
import { ErrorNote } from '@/components/ui/empty-state';
import { plural } from '@/lib/utils';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, apiGet, fileUrl, formatMoney, type ProjectProfitRow, type ProjectProfitTotals } from '@/lib/api-v2';
import { NewInvoiceModal } from '@/components/work/NewInvoiceModal';
import { NewCostModal } from '@/components/work/NewCostModal';
import { RecordPaymentModal } from '@/components/work/RecordPaymentModal';
import { ExportCsvButton } from '@/components/ui/export-csv-button';
import { useConfirmStore } from '@/stores/confirm';
import { usePageHeader } from '@/hooks/usePageHeader';
import { StatTile, StatRow } from '@/components/ui/stat-tile';
import { Tabs, type TabDef } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { isAwaiting, isCollectible, isOverdue, sumOutstanding } from '@/lib/invoice-state';

interface Invoice {
  id: string;
  number: string;
  company: { id: string; name: string };
  amount: number;
  status: string;
  raisedAt: string;
  dueAt: string;
  isOverdue: boolean;
  agingDays: number;
  balanceDue: number | null;
  totalPaid: number | null;
  amountMasked?: never;
}

interface CostRow {
  id: string;
  type: 'DIRECT' | 'COMPANY' | 'CAPITAL';
  category: string;
  vendor: string;
  amount: number | null;
  incurredAt: string;
  paidBy: string;
  recurring: boolean;
  confirmed: boolean;
  monthCard?: { retainer: { company: { name: string } } } | null;
  project?: { company: { name: string }; name: string } | null;
}

/** "2026-09" is a key. This is the label. */
const monthName = (m: string) => {
  const [y, mm] = m.split('-').map(Number);
  return new Date(y, mm - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
};

type MoneyTab = 'INVOICES' | 'TO_INVOICE' | 'COSTS' | 'PROFIT';

type AwaitingRow = {
  id: string;
  month: string;
  companyId: string;
  companyName: string;
  revenue: number;
  status: string;
  closedAt: string | null;
  due: boolean;
  retainerStopped: boolean;
};

interface ProfitRow {
  companyId: string;
  companyName: string;
  revenue: number;
  externalCost: number;
  peopleCost: number;
  profit: number;
  marginPercent: number;
}

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'border border-warning/40 text-warning-ink bg-warning-tint',
  PARTIAL: 'border border-info/30 text-info bg-info-tint',
  PAID: 'border border-success/30 text-success bg-success-tint',
  OVERDUE: 'border border-danger/40 text-danger bg-danger-tint',
  CANCELLED: 'border border-border text-secondary bg-subtle',
};

export default function MoneyPage() {
  const confirmDialog = useConfirmStore((st) => st.confirm);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [toInvoice, setToInvoice] = useState<AwaitingRow[]>([]);
  /** A failed load, said out loud instead of only in the console. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [costs, setCosts] = useState<CostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingCosts, setLoadingCosts] = useState(true);
  const router = useRouter();
  const [tab, setTab] = useState<MoneyTab>('INVOICES');
  // The one-off half of "did we make money on that job". Held apart from the
  // retainer figures, and never added to them — brief §8.
  const [projectProfit, setProjectProfit] = useState<{
    rows: ProjectProfitRow[];
    totals: { delivered: ProjectProfitTotals; live: ProjectProfitTotals };
    atRisk: number;
  } | null>(null);
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [creatingCost, setCreatingCost] = useState(false);
  const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null);
  const [profitRows, setProfitRows] = useState<ProfitRow[]>([]);
  const [profitTotals, setProfitTotals] = useState<ProfitRow | null>(null);
  const [profitMonth, setProfitMonth] = useState('');
  const [loadingProfit, setLoadingProfit] = useState(true);
  const [overheads, setOverheads] = useState<CostRow[]>([]);
  const [capital, setCapital] = useState<CostRow[]>([]);
  const [profitLoaded, setProfitLoaded] = useState(false);
  const [confirmingCost, setConfirmingCost] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // GET /invoices returns { success, data, invoices, meta } with `data`
      // and `invoices` aliased to the same array — apiGet's auto-unwrap
      // resolves straight to that array, not the envelope, so `res` here
      // already IS the invoice list.
      const res = await apiGet<Invoice[]>('/invoices');
      setInvoices(Array.isArray(res) ? res : []);
      // The step before an invoice exists: retainer months carrying none.
      // Loaded with the list rather than on tab click, because the count sits
      // on the tab and a count that appears only after you look is no use.
      const waiting = await api.invoices.awaiting().catch(() => null);
      setToInvoice(waiting?.rows ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load the money screen');
    }
    finally { setLoading(false); }
  }, []);

  const loadCosts = useCallback(async () => {
    setLoadingCosts(true);
    try {
      const res = await api.costs.list();
      setCosts(Array.isArray(res) ? res : []);
    } catch (e) { console.error(e); }
    finally { setLoadingCosts(false); }
  }, []);

  const confirmCost = async (id: string) => {
    setConfirmingCost(id);
    try {
      await api.costs.confirm(id);
      await loadCosts();
    } catch (e) {
      // A failed action used to log to the console and stop. The
      // button simply did nothing, so the natural response was to
      // press it again.
      toast.error(e instanceof Error ? e.message : 'Could not confirm that cost');
    }
    finally { setConfirmingCost(null); }
  };

  const removeCost = async (c: CostRow) => {
    const ok = await confirmDialog({
      title: 'Delete this cost?',
      message: `${c.category} — ${c.vendor}, ${c.amount != null ? formatMoney(c.amount) : 'no amount'}. It will be removed from the register immediately.`,
      confirmText: 'Delete cost',
      variant: 'danger',
    });
    if (!ok) return;
    setConfirmingCost(c.id);
    try {
      await api.costs.delete(c.id);
      toast.success('Cost deleted.');
      await loadCosts();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete that cost');
    } finally {
      setConfirmingCost(null);
    }
  };

  const loadProfit = useCallback(async () => {
    setLoadingProfit(true);
    try {
      const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
      const [pl, ov, cap, proj] = await Promise.all([
        api.retainers.profitability(),
        api.costs.list({ type: 'COMPANY', month: currentMonth }),
        api.costs.list({ type: 'CAPITAL' }),
        api.projects.profitability(),
      ]);
      setProjectProfit(proj);
      if (pl.success) {
        setProfitRows(pl.rows);
        setProfitTotals({ companyId: '', companyName: '', ...pl.totals });
        setProfitMonth(pl.month);
      }
      setOverheads(Array.isArray(ov) ? ov : []);
      setCapital(Array.isArray(cap) ? cap : []);
    } catch (e) { console.error(e); }
    finally { setLoadingProfit(false); setProfitLoaded(true); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadCosts(); }, [loadCosts]);
  useEffect(() => { if (tab === 'PROFIT' && !profitLoaded) void loadProfit(); }, [tab, profitLoaded, loadProfit]);

  const totalCosts = costs.reduce((s, c) => s + (c.amount || 0), 0);
  const overheadsTotal = overheads.reduce((s, c) => s + (c.amount || 0), 0);
  const companyProfit = (profitTotals?.profit ?? 0) - overheadsTotal;
  const costAgainst = (c: CostRow) => c.monthCard?.retainer.company.name ?? (c.project ? `${c.project.company.name} — ${c.project.name}` : '—');
  const COST_TYPE_STYLE: Record<string, string> = {
    DIRECT: 'border border-info/30 text-info bg-info-tint',
    COMPANY: 'border border-warning/40 text-warning-ink bg-warning-tint',
    CAPITAL: 'border border-border text-secondary bg-subtle',
  };

  /*
   * Every figure in this row now comes from `lib/invoice-state`, which is
   * the only place that decides what an invoice means. See the note there
   * for the four different answers this screen used to give at once.
   */
  const awaiting = invoices.filter(isAwaiting);
  const overdue = invoices.filter(isOverdue);
  const paid = invoices.filter((i) => i.status === 'PAID');

  const totalOutstanding = sumOutstanding(invoices);
  // Masked money is null, not zero — a reader without `money.figures` gets
  // nulls all the way down and must not be told the business billed ₹0.
  const masked = invoices.length > 0 && invoices.every((i) => i.amount === null);
  const totalBilled = masked ? null : invoices.reduce((s, i) => s + (i.amount || 0), 0);
  const totalCollected = masked ? null : invoices.reduce((s, i) => s + (i.totalPaid || 0), 0);

  usePageHeader('Money', plural(invoices.length, 'invoice'));

  return (
    <div className="page-shell">
      {loadError && (
        <div className="mb-6">
          {/*
            A failed load used to reach console.error and stop, so the screen
            rendered its empty state and "the server is down" looked exactly
            like "you have nothing yet".
          */}
          <ErrorNote onDismiss={() => setLoadError(null)}>{loadError}</ErrorNote>
        </div>
      )}
      {/* Header */}
      <div className="flex flex-wrap items-center justify-end gap-2 mb-8">
          <ExportCsvButton href={fileUrl('/invoices?format=csv')} label="Export invoices CSV" />
          <ExportCsvButton href={fileUrl('/costs?format=csv')} label="Export costs CSV" />
          <button
            className="flex items-center gap-1.5 bg-primary text-white text-sm font-semibold px-4 h-8 rounded-lg hover:bg-primary/90 transition-colors"
            onClick={() => setCreatingInvoice(true)}
          >
            <span className="text-base leading-none">+</span> New invoice
          </button>
      </div>

      <StatRow className="mb-8">
        <StatTile
          label="Total Billed"
          value={totalBilled === null ? '—' : formatMoney(totalBilled)}
          note={totalBilled === null ? 'figures hidden for your role' : `${plural(invoices.length, 'invoice')} raised`}
        />
        <StatTile
          label="Collected"
          value={totalCollected === null ? '—' : formatMoney(totalCollected)}
          note={totalCollected === null ? 'figures hidden for your role' : `${plural(paid.length, 'invoice')} settled`}
          tone={totalCollected === null ? 'default' : 'success'}
        />
        <StatTile
          label="Outstanding"
          value={totalOutstanding === null ? '—' : formatMoney(totalOutstanding)}
          note={
            totalOutstanding === null
              ? 'figures hidden for your role'
              : awaiting.length === 0 && overdue.length === 0
                ? 'nothing owed'
                : `${plural(awaiting.length + overdue.length, 'invoice')} still owed`
          }
          tone={totalOutstanding !== null && totalOutstanding > 0 ? 'warning' : 'default'}
        />
        <StatTile
          label="Overdue"
          value={overdue.length}
          note={overdue.length === 0 ? 'nothing late' : 'need follow-up'}
          tone={overdue.length > 0 ? 'danger' : 'default'}
        />
      </StatRow>

      <Tabs
        tabs={[
          { key: 'INVOICES', label: 'Invoices', count: invoices.length },
          { key: 'TO_INVOICE', label: 'To invoice', count: toInvoice.filter((r) => r.due).length },
          { key: 'COSTS', label: 'Costs' },
          { key: 'PROFIT', label: 'Profit & Costs' },
        ] as TabDef<MoneyTab>[]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'INVOICES' && (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full data-table">
            <thead>
              <tr className="border-b border-border">
                <th className="eyebrow text-left">Company</th>
                <th className="eyebrow text-left">Invoice</th>
                <th className="eyebrow text-right">Amount</th>
                <th className="eyebrow text-right">Balance Due</th>
                <th className="eyebrow text-left">Status</th>
                <th className="eyebrow text-left">Due</th>
                <th className=""></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <TableRowsSkeleton cols={7} />
              ) : invoices.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-16 text-center text-sm text-secondary">No invoices yet.</td></tr>
              ) : invoices.map(inv => {
                // The API already derives RAISED -> OVERDUE; this asks the
                // same helper the tiles ask, so a row and the count above it
                // cannot disagree about the same invoice.
                const late = isOverdue(inv);
                const displayStatus = late ? 'OVERDUE' : inv.status;
                // A settled or cancelled invoice is not a receivable, whatever
                // arithmetic on its payments says.
                const owed = isCollectible(inv) ? inv.balanceDue : null;
                // `cursor-pointer` with no click handler: the row said it was
                // clickable and did nothing. There is no invoice page to open,
                // so the affordance is gone and the client — which does have a
                // page — is the link instead.
                return (
                  <tr key={inv.id} className="hover:bg-subtle transition-colors">
                    <td className="">
                      {inv.company ? (
                        <Link
                          href={`/companies/${inv.company.id}`}
                          className="text-sm font-semibold text-primary rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                        >
                          {inv.company.name}
                        </Link>
                      ) : (
                        <span className="text-sm font-semibold text-primary">—</span>
                      )}
                    </td>
                    <td className="text-secondary font-mono">{inv.number}</td>
                    <td className="font-semibold text-primary text-right">{formatMoney(inv.amount)}</td>
                    <td className="text-right">
                      <span className={`text-sm font-semibold ${owed && owed > 0 ? (late ? 'text-danger' : 'text-warning-ink') : 'text-secondary'}`}>
                        {owed && owed > 0 ? formatMoney(owed) : '—'}
                      </span>
                    </td>
                    <td className="">
                      <span className={`text-micro font-medium px-2 py-0.5 rounded ${STATUS_STYLE[displayStatus] ?? ''}`}>
                        {displayStatus}
                        {late && inv.agingDays > 0 ? ` · ${inv.agingDays}d` : ''}
                      </span>
                    </td>
                    <td className="text-secondary">
                      {new Date(inv.dueAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </td>
                    <td className="text-right">
                      {inv.status !== 'PAID' && inv.status !== 'CANCELLED' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setPayingInvoice(inv); }}
                          className="border border-border text-xs font-medium text-body px-3 py-1.5 rounded-lg hover:bg-subtle transition-colors"
                        >
                          Record payment
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/*
        The billing work list.

        Raising the invoices is one person's job, and that person holds
        `money.figures` and not `work.all` — so /live-work, /retainers/:id and
        /projects/:id all bounce her to My Work, and she had no way to see which
        months were waiting for one. The alert that would have told her,
        MONTH_CARD_NOT_INVOICED, lands on one of those same screens. So the list
        lives here, where the invoice is actually raised.

        Both halves are shown. What is owed now is the job; what is still
        running is the forward view, and leaving it out would make this a
        rebuke rather than a work list.
      */}
      {tab === 'TO_INVOICE' && (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="overflow-x-auto">
            <table className="w-full data-table">
              <thead>
                <tr className="border-b border-border">
                  <th className="eyebrow text-left">Client</th>
                  <th className="eyebrow text-left">Month</th>
                  <th className="eyebrow text-right">Fee</th>
                  <th className="eyebrow text-left">State</th>
                  <th className="eyebrow"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  <TableRowsSkeleton cols={5} />
                ) : toInvoice.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-16 text-center text-sm text-secondary">
                      Every retainer month has an invoice against it.
                    </td>
                  </tr>
                ) : (
                  toInvoice.map((r) => (
                    <tr key={r.id} className="transition-colors hover:bg-subtle">
                      <td className="font-medium text-primary">{r.companyName}</td>
                      <td className="whitespace-nowrap text-secondary">{monthName(r.month)}</td>
                      <td className="text-right tabular-nums text-primary">{formatMoney(r.revenue)}</td>
                      <td>
                        {r.due ? (
                          <Badge tone="warn">
                            {r.retainerStopped ? 'Retainer ended — still owed' : 'Ready to invoice'}
                          </Badge>
                        ) : (
                          <Badge tone="neutral">Month still running</Badge>
                        )}
                      </td>
                      <td className="text-right">
                        {r.due && (
                          <Button size="sm" variant="secondary" onClick={() => setCreatingInvoice(true)}>
                            Raise invoice
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

      {tab === 'COSTS' && (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-white">
            <p className="text-sm text-secondary">{costs.length} recorded · {formatMoney(totalCosts)} total</p>
            <button
              className="flex items-center gap-1.5 bg-primary text-white text-xs font-semibold px-3.5 py-1.5 rounded-lg hover:bg-primary/90 transition-colors"
              onClick={() => setCreatingCost(true)}
            >
              <span className="text-base leading-none">+</span> Record a cost
            </button>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full data-table">
            <thead>
              <tr className="border-b border-border">
                <th className="eyebrow text-left">What</th>
                <th className="eyebrow text-left">Kind</th>
                <th className="eyebrow text-left">Against</th>
                <th className="eyebrow text-left">Vendor</th>
                <th className="eyebrow text-left">Paid by</th>
                <th className="eyebrow text-right">Amount</th>
                <th className=""></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loadingCosts ? (
                <TableRowsSkeleton cols={7} />
              ) : costs.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-16 text-center text-sm text-secondary">Nothing recorded yet.</td></tr>
              ) : costs.map(c => (
                <tr key={c.id} className="hover:bg-subtle transition-colors">
                  <td className="font-semibold text-primary">
                    {c.category}
                    {c.recurring && <span className="ml-1.5 text-micro text-secondary font-normal">↻ recurring</span>}
                  </td>
                  <td className="">
                    <span className={`text-micro font-medium px-2 py-0.5 rounded ${COST_TYPE_STYLE[c.type] ?? ''}`}>
                      {c.type === 'DIRECT' ? 'Client' : c.type === 'CAPITAL' ? 'Capital' : 'Company'}
                    </span>
                  </td>
                  <td className="text-secondary">{costAgainst(c)}</td>
                  <td className="text-secondary">{c.vendor}</td>
                  <td className="text-secondary">{c.paidBy?.replace(/_/g, ' ')}</td>
                  <td className="font-semibold text-primary text-right">{c.amount != null ? formatMoney(c.amount) : '—'}</td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {c.confirmed === false && (
                        <button
                          onClick={() => void confirmCost(c.id)}
                          disabled={confirmingCost === c.id}
                          className="border border-warning/40 text-micro font-medium text-warning-ink bg-warning-tint px-2.5 py-1 rounded-lg hover:bg-warning-tint transition-colors disabled:opacity-50 whitespace-nowrap"
                        >
                          {confirmingCost === c.id ? 'Confirming…' : 'Confirm draft'}
                        </button>
                      )}
                      <button
                        onClick={() => void removeCost(c)}
                        disabled={confirmingCost === c.id}
                        title="Delete cost"
                        className="rounded-lg p-1.5 text-secondary hover:bg-danger-tint hover:text-danger transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {tab === 'PROFIT' && (
        <div className="space-y-6">
          {/* §8: "Company profit — allRevenue − allDirectCost − salaries −
              overheads. Salary appears once here and is allocated down to
              jobs. Never added twice." Every ingredient was already being
              fetched on this screen (profitTotals, overheads) — just never
              combined into the one figure the brief actually asks for. */}
          <StatRow>
            <StatTile
              label="Revenue"
              value={loadingProfit ? '—' : formatMoney(profitTotals?.revenue ?? 0)}
            />
            <StatTile
              label="Direct + people cost"
              value={
                loadingProfit
                  ? '—'
                  : formatMoney((profitTotals?.externalCost ?? 0) + (profitTotals?.peopleCost ?? 0))
              }
            />
            <StatTile label="Overheads" value={loadingProfit ? '—' : formatMoney(overheadsTotal)} />
            <StatTile
              label="Company profit"
              value={loadingProfit ? '—' : formatMoney(companyProfit)}
              note={`Retainers only, ${profitMonth ? new Date(`${profitMonth}-01`).toLocaleString('en-IN', { month: 'long', year: 'numeric' }) : 'this month'}`}
              tone={loadingProfit ? 'default' : companyProfit >= 0 ? 'success' : 'danger'}
            />
          </StatRow>

          <div className="border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-white">
              <p className="text-sm font-bold text-primary">Profit by client</p>
              <p className="text-micro text-secondary">
                Retainers only, {profitMonth ? new Date(`${profitMonth}-01`).toLocaleString('en-IN', { month: 'long', year: 'numeric' }) : 'this month'}
              </p>
            </div>
            <div className="overflow-x-auto">
            <table className="w-full data-table">
              <thead>
                <tr className="border-b border-border">
                  <th className="eyebrow text-left">Client</th>
                  <th className="eyebrow text-right">Revenue</th>
                  <th className="eyebrow text-right">External cost</th>
                  <th className="eyebrow text-right">People cost</th>
                  <th className="eyebrow text-right">Profit</th>
                  <th className="eyebrow text-right">Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loadingProfit ? (
                  <TableRowsSkeleton cols={6} />
                ) : profitRows.length === 0 ? (
                  <tr><td colSpan={6} className="px-5 py-16 text-center text-sm text-secondary">No active retainer month cards this month.</td></tr>
                ) : (
                  <>
                    {profitRows.map(r => (
                      <tr key={r.companyId} className="hover:bg-subtle transition-colors">
                        <td className="font-semibold text-primary">{r.companyName}</td>
                        <td className="text-body text-right">{formatMoney(r.revenue)}</td>
                        <td className="text-secondary text-right">{formatMoney(r.externalCost)}</td>
                        <td className="text-secondary text-right">{formatMoney(r.peopleCost)}</td>
                        <td className={`font-semibold text-right ${r.profit >= 0 ? 'text-success' : 'text-danger'}`}>
                          {formatMoney(r.profit)}
                        </td>
                        <td className={`font-medium text-right ${r.marginPercent >= 0 ? 'text-body' : 'text-danger'}`}>
                          {r.marginPercent}%
                        </td>
                      </tr>
                    ))}
                    {profitTotals && (
                      <tr className="bg-subtle/50">
                        <td className="font-bold text-primary">Total</td>
                        <td className="font-bold text-primary text-right">{formatMoney(profitTotals.revenue)}</td>
                        <td className="font-bold text-primary text-right">{formatMoney(profitTotals.externalCost)}</td>
                        <td className="font-bold text-primary text-right">{formatMoney(profitTotals.peopleCost)}</td>
                        <td className={`font-bold text-right ${profitTotals.profit >= 0 ? 'text-success' : 'text-danger'}`}>
                          {formatMoney(profitTotals.profit)}
                        </td>
                        <td className="font-bold text-primary text-right">{profitTotals.marginPercent}%</td>
                      </tr>
                    )}
                  </>
                )}
              </tbody>
            </table>
            </div>
          </div>

          {/*
            The one-off work, kept in its own table and deliberately NOT added
            to the retainer figures above.

            Brief §8: retainer and one-time money are "reported split by
            Retainer and One time, never summed into a single figure". A month
            of retainer revenue and a project's whole contract value are
            different kinds of number, and a total across both answers nothing.

            Sorted worst margin first, because the reason to open this table is
            to find the job that is going wrong, not to admire the good ones.
          */}
          <div className="border border-border rounded-xl overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 border-b border-border bg-white">
              <p className="text-sm font-bold text-primary">Profit by project</p>
              <p className="text-micro text-secondary">
                One-off work, whole contract · never added to the retainer figures above
              </p>
            </div>

            {projectProfit && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-border">
                <StatTile
                  frame="inset"
                  label="Delivered"
                  value={formatMoney(projectProfit.totals.delivered.profit)}
                  note={
                    `${projectProfit.totals.delivered.count} finished` +
                    (projectProfit.totals.delivered.marginPercent !== null
                      ? ` · ${projectProfit.totals.delivered.marginPercent}% margin`
                      : '') +
                    ' — the only figures that are final'
                  }
                />
                <StatTile
                  frame="inset"
                  label="Live so far"
                  value={formatMoney(projectProfit.totals.live.profit)}
                  note={`${projectProfit.totals.live.count} running · still moving`}
                />
                <StatTile
                  frame="inset"
                  label="Heading the wrong way"
                  value={projectProfit.atRisk}
                  note={projectProfit.atRisk > 0 ? 'still time to act on these' : 'nothing tracking over'}
                  tone={projectProfit.atRisk > 0 ? 'danger' : 'default'}
                />
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full data-table">
                <thead>
                  <tr className="border-b border-t border-border">
                    <th className="eyebrow text-left">Project</th>
                    <th className="eyebrow text-right">Done</th>
                    <th className="eyebrow text-right">Quoted</th>
                    <th className="eyebrow text-right">External</th>
                    <th className="eyebrow text-right">People</th>
                    <th className="eyebrow text-right">Profit</th>
                    <th className="eyebrow text-right">Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loadingProfit ? (
                    <TableRowsSkeleton cols={7} />
                  ) : !projectProfit || projectProfit.rows.length === 0 ? (
                    <tr><td colSpan={7} className="px-5 py-16 text-center text-sm text-secondary">No projects yet.</td></tr>
                  ) : (
                    projectProfit.rows.map((r) => (
                      <tr
                        key={r.id}
                        className="hover:bg-subtle transition-colors cursor-pointer"
                        onClick={() => router.push(`/projects/${r.id}`)}
                      >
                        <td className="">
                          <Link
                            href={`/projects/${r.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-sm font-semibold text-primary rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                          >
                            {r.name}
                          </Link>
                          <p className="text-micro text-secondary">
                            {r.company.name} · {r.status.toLowerCase()}
                            {r.costRisk.reason ? ` · ${r.costRisk.reason}` : ''}
                          </p>
                        </td>
                        <td className="text-secondary text-right tabular-nums">{r.percentComplete}%</td>
                        <td className="text-body text-right tabular-nums">{formatMoney(r.revenue)}</td>
                        <td className="text-secondary text-right tabular-nums">{formatMoney(r.directCost)}</td>
                        <td className="text-secondary text-right tabular-nums">{formatMoney(r.peopleCost)}</td>
                        <td className={`font-semibold text-right tabular-nums ${r.profit >= 0 ? 'text-success' : 'text-danger'}`}>
                          {formatMoney(r.profit)}
                        </td>
                        <td className={`font-medium text-right tabular-nums ${
                          r.marginPercent === null ? 'text-secondary' : r.marginPercent >= 0 ? 'text-body' : 'text-danger'
                        }`}>
                          {r.marginPercent === null ? '—' : `${r.marginPercent}%`}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border bg-white">
              <p className="text-sm font-bold text-primary">Company costs, this month</p>
            </div>
            <div className="overflow-x-auto">
            <table className="w-full data-table">
              <thead>
                <tr className="border-b border-border">
                  <th className="eyebrow text-left">Category</th>
                  <th className="eyebrow text-left">Vendor</th>
                  <th className="eyebrow text-left">Paid by</th>
                  <th className="eyebrow text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loadingProfit ? (
                  <TableRowsSkeleton cols={4} />
                ) : overheads.length === 0 ? (
                  <tr><td colSpan={4} className="px-5 py-10 text-center text-sm text-secondary">No company costs recorded this month.</td></tr>
                ) : overheads.map(c => (
                  <tr key={c.id} className="hover:bg-subtle transition-colors">
                    <td className="font-semibold text-primary">{c.category}</td>
                    <td className="text-secondary">{c.vendor}</td>
                    <td className="text-secondary">{c.paidBy?.replace(/_/g, ' ')}</td>
                    <td className="font-semibold text-primary text-right">{c.amount != null ? formatMoney(c.amount) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>

          <div className="border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border bg-white">
              <p className="text-sm font-bold text-primary">Capital and loans</p>
            </div>
            <div className="overflow-x-auto">
            <table className="w-full data-table">
              <thead>
                <tr className="border-b border-border">
                  <th className="eyebrow text-left">Category</th>
                  <th className="eyebrow text-left">Vendor</th>
                  <th className="eyebrow text-left">Paid by</th>
                  <th className="eyebrow text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loadingProfit ? (
                  <TableRowsSkeleton cols={4} />
                ) : capital.length === 0 ? (
                  <tr><td colSpan={4} className="px-5 py-10 text-center text-sm text-secondary">No capital or loan entries recorded.</td></tr>
                ) : capital.map(c => (
                  <tr key={c.id} className="hover:bg-subtle transition-colors">
                    <td className="font-semibold text-primary">{c.category}</td>
                    <td className="text-secondary">{c.vendor}</td>
                    <td className="text-secondary">{c.paidBy?.replace(/_/g, ' ')}</td>
                    <td className="font-semibold text-primary text-right">{c.amount != null ? formatMoney(c.amount) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      )}

      {creatingInvoice && (
        <NewInvoiceModal
          onClose={() => setCreatingInvoice(false)}
          onCreated={() => { setCreatingInvoice(false); void load(); }}
        />
      )}

      {creatingCost && (
        <NewCostModal
          onClose={() => setCreatingCost(false)}
          onCreated={() => { setCreatingCost(false); void loadCosts(); }}
        />
      )}

      {payingInvoice && (
        <RecordPaymentModal
          invoiceId={payingInvoice.id}
          defaultAmount={payingInvoice.balanceDue || payingInvoice.amount}
          onClose={() => setPayingInvoice(null)}
          onRecorded={() => { setPayingInvoice(null); void load(); }}
        />
      )}
    </div>
  );
}
