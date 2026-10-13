'use client';

import { useState, useCallback } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { TableRowsSkeleton } from '@/components/ui/skeleton-loaders';
import { LoadError, Note } from '@/components/ui/empty-state';
import { plural } from '@/lib/utils';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, fileUrl, formatMoney, type ProjectProfitRow, type ProjectProfitTotals } from '@/lib/api-v2';
import { NewInvoiceModal } from '@/components/work/NewInvoiceModal';
import { NewCostModal } from '@/components/work/NewCostModal';
import { RecordPaymentModal } from '@/components/work/RecordPaymentModal';
import { InvoiceActions } from '@/components/work/InvoiceActions';
import { useIsAdmin } from '@/components/work/PaidInvoiceLock';
import { InvoiceDocumentModal } from '@/components/work/InvoiceDocumentModal';
import { InvoiceStatusBadge } from '@/components/work/InvoiceStatusBadge';
import { RetainerBillingBoard, retainerBillingKey } from '@/components/work/RetainerBillingBoard';
import { ProjectMilestonesBilling } from '@/components/work/ProjectMilestonesBilling';
import { SendDocumentModal } from '@/components/documents/SendDocumentModal';
import { SellerGapsNote } from '@/components/documents/SellerGapsNote';
import { useConfig } from '@/hooks/queries';
import { ExportCsvButton } from '@/components/ui/export-csv-button';
import { useConfirmStore } from '@/stores/confirm';
import { usePageHeader } from '@/hooks/usePageHeader';
import { StatTile, StatRow } from '@/components/ui/stat-tile';
import { Tabs, useTabState, type TabDef } from '@/components/ui/tabs';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { isCollectible } from '@/lib/invoice-state';
import { looksLikeSalary, moneyDate, periodRange, PERIODS, todayIn, type PeriodKey } from '@/lib/money';

/*
 * Money (Money Plan 2).
 *
 * Every figure at the top comes from the server, over every row, for the
 * period picked — never from adding up a page of a list. The lists stop at
 * a page; the screen used to sum them, so past 200 invoices every tile was
 * quietly wrong. Each figure says whether it includes GST, and figures that do
 * are never added to figures that do not.
 */

interface Invoice {
  id: string;
  number: string;
  company: { id: string; name: string };
  amount: number;
  /** The GST inside `amount`, when it was recorded. */
  gstAmount?: number | null;
  status: string;
  /** What the badge says, worked out on the server. */
  state?: string;
  partPaid?: boolean;
  raisedAt: string;
  dueAt: string;
  isOverdue: boolean;
  agingDays: number;
  balanceDue: number | null;
  totalPaid: number | null;
  /** How many payments are recorded against it. */
  paymentsCount?: number;
  /** CR-02 — whether there is a printable document behind this row yet. */
  hasDocument: boolean;
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

type MoneyTab = 'INVOICES' | 'BILLING' | 'COSTS' | 'PROFIT';

interface ProfitRow {
  companyId: string;
  companyName: string;
  revenue: number;
  externalCost: number;
  peopleCost: number;
  profit: number;
  marginPercent: number;
  /** False: nothing put against the month yet, so its profit is unknown — not the whole fee. */
  costed?: boolean;
}

const PAGE_SIZE = 50;

const INVOICE_FILTERS = [
  { value: '', label: 'All invoices' },
  { value: 'OPEN', label: 'Still owed' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'PAID', label: 'Paid' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const COST_TYPE_STYLE: Record<string, string> = {
  DIRECT: 'border border-info/30 text-info bg-info-tint',
  COMPANY: 'border border-warning/40 text-warning-ink bg-warning-tint',
  CAPITAL: 'border border-border text-secondary bg-subtle',
};

const monthName = (month: string) =>
  month ? new Date(`${month}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';

/** "Page 2 of 7 · Previous · Next", under a paged list. */
function Pager({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-border px-5 py-2.5 text-xs text-secondary">
      <span>
        Page {page} of {totalPages}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

export default function MoneyPage() {
  const confirmDialog = useConfirmStore((st) => st.confirm);
  const queryClient = useQueryClient();
  const router = useRouter();
  const { data: config } = useConfig();
  const perms = config?.me.permissions ?? [];
  const canSeeFigures =
    perms.includes('money.figures') || perms.includes('setup.admin') || config?.me.preset === 'MANAGEMENT';
  const timezone = config?.organization.timezone ?? 'Asia/Kolkata';
  const fyStart = config?.organization.fiscalYearStart ?? 4;
  const today = todayIn(timezone);

  // A paid invoice's document is locked; only an admin, with a reason, may rewrite it.
  const isAdmin = useIsAdmin();
  /*
   * A tax invoice cannot print without the seller's own GSTIN, address and
   * state — the renderer refuses. Knowing that here means the row can say so
   * instead of offering a Download that returns an error page.
   */
  const sellerGaps = config?.documentSettings?.gaps ?? [];
  const canPrintTaxInvoice = !sellerGaps.some((g) => g.severity === 'required');

  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [creatingCost, setCreatingCost] = useState(false);
  const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null);
  const [documentInvoice, setDocumentInvoice] = useState<Invoice | null>(null);
  const [emailingInvoice, setEmailingInvoice] = useState<Invoice | null>(null);
  const [confirmingCost, setConfirmingCost] = useState<string | null>(null);

  // ── The period, for the figures at the top ──
  const [period, setPeriod] = useState<PeriodKey>('this-fy');
  const range = periodRange(period, today, fyStart);
  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? '';

  const summaryQuery = useQuery({
    queryKey: ['money', 'summary', range.from, range.to],
    queryFn: () => api.money.summary(range.from, range.to),
    enabled: canSeeFigures,
    placeholderData: keepPreviousData,
  });
  const summary = summaryQuery.data;

  // ── Invoices, a page at a time ──
  const [invoiceFilter, setInvoiceFilter] = useState('');
  const [invoicePage, setInvoicePage] = useState(1);
  const invoicesQuery = useQuery({
    queryKey: ['invoices', 'page', invoiceFilter, invoicePage],
    queryFn: () =>
      api.money.invoicesPage({ page: String(invoicePage), limit: String(PAGE_SIZE), ...(invoiceFilter ? { status: invoiceFilter } : {}) }),
    placeholderData: keepPreviousData,
  });
  const invoices: Invoice[] = invoicesQuery.data?.data ?? [];
  const invoiceMeta = invoicesQuery.data?.meta;

  /*
   * Retainer months with something to do — loaded with the page rather than
   * on tab click, because the count sits on the tab and a count that appears
   * only after you look is no use. Same cache as the board itself.
   */
  const { data: billingData } = useQuery({
    queryKey: retainerBillingKey(''),
    queryFn: () => api.invoices.retainerBilling(),
    enabled: canSeeFigures,
  });
  const billingToDo = (billingData?.rows ?? []).filter(
    (r) => r.step === 'PROFORMA' || r.step === 'INVOICE' || r.step === 'PAYMENT',
  ).length;

  // ── The tab, kept in the URL: ?tab=invoices|billing|costs|profit ──
  const tabs: TabDef<MoneyTab>[] = [
    { key: 'INVOICES', label: 'Invoices', count: invoiceFilter ? undefined : invoiceMeta?.total },
    { key: 'BILLING', label: 'Billing', count: billingToDo, visible: canSeeFigures },
    { key: 'COSTS', label: 'Costs' },
    { key: 'PROFIT', label: 'Profit & Costs', visible: canSeeFigures },
  ];
  const [tab, setTab] = useTabState(tabs);

  // ── Costs, a page at a time ──
  const [costPage, setCostPage] = useState(1);
  const costsQuery = useQuery({
    queryKey: ['costs', 'page', costPage],
    queryFn: () => api.money.costsPage({ page: String(costPage), limit: String(PAGE_SIZE) }),
    enabled: tab === 'COSTS',
    placeholderData: keepPreviousData,
  });
  const costs: CostRow[] = costsQuery.data?.data ?? [];
  const costMeta = costsQuery.data?.meta;

  /** Refresh after an invoice or payment changes. */
  const load = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['invoices'] });
    await queryClient.invalidateQueries({ queryKey: ['money'] });
  }, [queryClient]);

  /** Refresh after a cost is added, confirmed or deleted. */
  const loadCosts = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['costs'] });
    await queryClient.invalidateQueries({ queryKey: ['money'] });
  }, [queryClient]);

  const confirmCost = async (id: string) => {
    setConfirmingCost(id);
    try {
      await api.costs.confirm(id);
      await loadCosts();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not confirm that cost');
    } finally {
      setConfirmingCost(null);
    }
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

  // ── Profit, for a month — every section loads, and fails, on its own ──
  const [profitMonth, setProfitMonth] = useState(today.slice(0, 7));
  const onProfit = tab === 'PROFIT' && canSeeFigures;
  const companyProfitQuery = useQuery({
    queryKey: ['money', 'company-profit', profitMonth],
    queryFn: () => api.money.profit(profitMonth),
    enabled: onProfit,
  });
  const retainerProfitQuery = useQuery({
    queryKey: ['money', 'retainer-profit', profitMonth],
    queryFn: () => api.retainers.profitability(profitMonth),
    enabled: onProfit,
  });
  const overheadsQuery = useQuery({
    queryKey: ['money', 'overheads', profitMonth],
    queryFn: () => api.money.costsPage({ type: 'COMPANY', month: profitMonth, limit: '500' }),
    enabled: onProfit,
  });
  const capitalQuery = useQuery({
    queryKey: ['money', 'capital'],
    queryFn: () => api.money.costsPage({ type: 'CAPITAL', limit: '500' }),
    enabled: onProfit,
  });
  type ProjectProfit = { rows: ProjectProfitRow[]; totals: { delivered: ProjectProfitTotals; live: ProjectProfitTotals }; atRisk: number };
  const projectProfitQuery = useQuery({
    queryKey: ['money', 'project-profit'],
    queryFn: async () => (await api.projects.profitability()) as unknown as ProjectProfit,
    enabled: onProfit,
  });

  const companyProfit = companyProfitQuery.data;
  const retainerProfit = retainerProfitQuery.data;
  const profitRows: ProfitRow[] = (retainerProfit?.rows ?? []) as ProfitRow[];
  const profitTotals = retainerProfit?.totals ?? null;
  const nothingCosted = profitRows.length > 0 && profitRows.every((r) => r.costed === false);
  const overheads: CostRow[] = overheadsQuery.data?.data ?? [];
  const capital: CostRow[] = capitalQuery.data?.data ?? [];
  const projectProfit = projectProfitQuery.data ?? null;
  // The monthly-cost warning is already said above the company figures; say it once.
  const clientWarnings = (retainerProfit?.warnings ?? []).filter((w) => !(companyProfit && /monthly cost/.test(w)));

  const costAgainst = (c: CostRow) => c.monthCard?.retainer.company.name ?? (c.project ? `${c.project.company.name} — ${c.project.name}` : '—');

  usePageHeader('Money', invoiceMeta ? plural(invoiceMeta.total, 'invoice') : '');

  return (
    <div className="page-shell">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        {canSeeFigures ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-secondary">Figures for</span>
            <Select
              ariaLabel="Period for the figures"
              value={period}
              onChange={(v) => setPeriod(v as PeriodKey)}
              options={PERIODS.map((p) => ({ value: p.key, label: p.label }))}
              className="w-52"
            />
          </div>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <ExportCsvButton href={fileUrl('/invoices?format=csv')} label="Export invoices CSV" />
          <ExportCsvButton href={fileUrl('/costs?format=csv')} label="Export costs CSV" />
          {canSeeFigures && (
            <button
              className="flex items-center gap-1.5 bg-primary text-white text-sm font-semibold px-4 h-8 rounded-lg hover:bg-primary/90 transition-colors"
              onClick={() => setCreatingInvoice(true)}
            >
              <span className="text-base leading-none">+</span> New invoice
            </button>
          )}
        </div>
      </div>

      {/*
        The four figures, from the server. Billed and collected follow the
        period; outstanding and overdue are what is owed TODAY, on every
        invoice — a balance, so an old unpaid invoice never drops out of "who
        owes us" because the period moved.
      */}
      {!canSeeFigures ? (
        <Note>Amounts are hidden for your role. The list below shows which invoices are paid and which are still owed.</Note>
      ) : summaryQuery.error ? (
        <LoadError what="the money figures" error={summaryQuery.error} onRetry={() => void summaryQuery.refetch()} className="mb-8" />
      ) : (
        <StatRow className="mb-8">
          <StatTile
            label="Billed"
            value={summary ? formatMoney(summary.billed.amount) : '—'}
            note={summary ? `${plural(summary.billed.count, 'invoice')} · ${periodLabel.toLowerCase()} · incl. GST, cancelled left out` : 'loading…'}
          />
          <StatTile
            label="Collected"
            value={summary ? formatMoney(summary.collected.amount) : '—'}
            note={summary ? `${plural(summary.collected.count, 'payment')} received · ${periodLabel.toLowerCase()} · incl. GST` : 'loading…'}
            tone={summary ? 'success' : 'default'}
          />
          <StatTile
            label="Outstanding today"
            value={summary ? formatMoney(summary.outstanding.amount) : '—'}
            note={
              summary
                ? summary.outstanding.count === 0
                  ? 'nothing owed · all invoices'
                  : `${plural(summary.outstanding.count, 'invoice')} still owed · all invoices · incl. GST`
                : 'loading…'
            }
            tone={summary && summary.outstanding.amount > 0 ? 'warning' : 'default'}
          />
          <StatTile
            label="Overdue today"
            value={summary ? formatMoney(summary.overdue.amount) : '—'}
            note={
              summary
                ? summary.overdue.count === 0
                  ? 'nothing late'
                  : `${plural(summary.overdue.count, 'invoice')} past due · incl. GST`
                : 'loading…'
            }
            tone={summary && summary.overdue.count > 0 ? 'danger' : 'default'}
          />
        </StatRow>
      )}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'INVOICES' && !canPrintTaxInvoice && <SellerGapsNote gaps={sellerGaps} className="mb-3" />}

      {tab === 'INVOICES' && (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-b border-border bg-white">
            <Select
              ariaLabel="Which invoices"
              value={invoiceFilter}
              onChange={(v) => {
                setInvoiceFilter(v);
                setInvoicePage(1);
              }}
              options={INVOICE_FILTERS}
              className="w-44"
            />
            <p className="text-micro text-secondary">Amounts include GST</p>
          </div>
          {invoicesQuery.error ? (
            <LoadError what="the invoices" error={invoicesQuery.error} onRetry={() => void invoicesQuery.refetch()} className="m-4" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full data-table">
                <thead>
                  <tr className="border-b border-border">
                    <th className="eyebrow text-left">Company</th>
                    <th className="eyebrow text-left">Invoice</th>
                    <th className="eyebrow text-right">Amount</th>
                    <th className="eyebrow text-right">Balance due</th>
                    <th className="eyebrow text-left">Status</th>
                    <th className="eyebrow text-left">Due</th>
                    <th className=""></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {invoicesQuery.isPending ? (
                    <TableRowsSkeleton cols={7} />
                  ) : invoices.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-16 text-center text-sm text-secondary">
                        {invoiceFilter ? 'No invoices match.' : 'No invoices yet.'}
                      </td>
                    </tr>
                  ) : (
                    invoices.map((inv) => {
                      // A settled or cancelled invoice is not a receivable, whatever
                      // arithmetic on its payments says.
                      const owed = isCollectible(inv) ? inv.balanceDue : null;
                      const late = inv.state === 'OVERDUE' || inv.isOverdue;
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
                          <td className="text-secondary font-mono">
                            {inv.number}
                            <span className="block font-sans text-micro">raised {moneyDate(inv.raisedAt)}</span>
                          </td>
                          <td className="font-semibold text-primary text-right">
                            {formatMoney(inv.amount)}
                            {inv.gstAmount ? (
                              <span className="block text-micro font-normal text-secondary">incl. GST {formatMoney(inv.gstAmount)}</span>
                            ) : null}
                          </td>
                          <td className="text-right">
                            <span className={`text-sm font-semibold ${owed && owed > 0 ? (late ? 'text-danger' : 'text-warning-ink') : 'text-secondary'}`}>
                              {owed && owed > 0 ? formatMoney(owed) : '—'}
                            </span>
                          </td>
                          <td className="">
                            <InvoiceStatusBadge invoice={inv} />
                          </td>
                          <td className="text-secondary whitespace-nowrap">{moneyDate(inv.dueAt)}</td>
                          <td className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              {/*
                                CR-02. An invoice recorded from Tally is a number and an
                                amount; it becomes a page a client can be sent once the
                                buyer block and the line items are filled in. Until then
                                there is nothing to download, so nothing offers to.
                              */}
                              {inv.hasDocument && canPrintTaxInvoice && (
                                <>
                                  <a
                                    href={api.invoices.pdfUrl(inv.id)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-body transition-colors hover:bg-subtle"
                                  >
                                    PDF
                                  </a>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEmailingInvoice(inv);
                                    }}
                                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-body transition-colors hover:bg-subtle"
                                  >
                                    Email
                                  </button>
                                </>
                              )}
                              {inv.hasDocument && !canPrintTaxInvoice && (
                                <span
                                  className="rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-secondary"
                                  title="Set your GSTIN, address and state in Settings and this becomes a download."
                                >
                                  PDF blocked
                                </span>
                              )}
                              {canSeeFigures && inv.status !== 'CANCELLED' && (inv.status !== 'PAID' || isAdmin) && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDocumentInvoice(inv);
                                  }}
                                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-body transition-colors hover:bg-subtle"
                                >
                                  {inv.hasDocument ? 'Edit document' : 'Prepare document'}
                                </button>
                              )}
                              {canSeeFigures && inv.status !== 'PAID' && inv.status !== 'CANCELLED' && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPayingInvoice(inv);
                                  }}
                                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-body transition-colors hover:bg-subtle"
                                >
                                  Record payment
                                </button>
                              )}
                              {/* Correct it, its payments, or take it back a stage. */}
                              {canSeeFigures && (
                                <InvoiceActions invoice={inv} hasPayments={(inv.paymentsCount ?? 0) > 0} onChanged={() => void load()} />
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
          {invoiceMeta && <Pager page={invoiceMeta.page} totalPages={invoiceMeta.totalPages} onPage={setInvoicePage} />}
        </div>
      )}

      {/*
        Billing: every retainer's month, Proforma → Invoice → Paid, and the
        project milestones beside it. Raising the invoices is one person's job,
        and that person holds `money.figures` and not `work.all` — so the
        project and retainer pages bounce her. Both ladders live here.
      */}
      {tab === 'BILLING' && (
        <>
          <RetainerBillingBoard />
          <ProjectMilestonesBilling />
        </>
      )}

      {tab === 'COSTS' && (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-white">
            <p className="text-sm text-secondary">
              {costMeta ? plural(costMeta.total, 'cost') : '—'} recorded
              {costsQuery.data?.totalAmount != null ? ` · ${formatMoney(costsQuery.data.totalAmount)} in all, as paid (GST included where there was any)` : ''}
            </p>
            <button
              className="flex items-center gap-1.5 bg-primary text-white text-xs font-semibold px-3.5 py-1.5 rounded-lg hover:bg-primary/90 transition-colors"
              onClick={() => setCreatingCost(true)}
            >
              <span className="text-base leading-none">+</span> Record a cost
            </button>
          </div>
          {costsQuery.error ? (
            <LoadError what="the costs" error={costsQuery.error} onRetry={() => void costsQuery.refetch()} className="m-4" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full data-table">
                <thead>
                  <tr className="border-b border-border">
                    <th className="eyebrow text-left">Date</th>
                    <th className="eyebrow text-left">What</th>
                    <th className="eyebrow text-left">Kind</th>
                    <th className="eyebrow text-left">Against</th>
                    <th className="eyebrow text-left">Paid to</th>
                    <th className="eyebrow text-left">Paid by</th>
                    <th className="eyebrow text-right">Amount</th>
                    <th className=""></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {costsQuery.isPending ? (
                    <TableRowsSkeleton cols={8} />
                  ) : costs.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-16 text-center text-sm text-secondary">
                        Nothing recorded yet.
                      </td>
                    </tr>
                  ) : (
                    costs.map((c) => (
                      <tr key={c.id} className="hover:bg-subtle transition-colors">
                        <td className="text-secondary whitespace-nowrap">{moneyDate(c.incurredAt)}</td>
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
                        <td className="text-secondary">{c.paidBy}</td>
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
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
          {costMeta && <Pager page={costMeta.page} totalPages={costMeta.totalPages} onPage={setCostPage} />}
        </div>
      )}

      {tab === 'PROFIT' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="profit-month" className="text-xs text-secondary">
              Month
            </label>
            <input
              id="profit-month"
              type="month"
              value={profitMonth}
              max={today.slice(0, 7)}
              onChange={(e) => e.target.value && setProfitMonth(e.target.value)}
              className="h-8 rounded-lg border border-border bg-white px-2.5 text-sm text-body"
            />
          </div>

          {/*
            §8: "Company profit — allRevenue − allDirectCost − salaries −
            overheads." Worked out on the server now, retainers AND projects
            (Money Plan 2, decision 5). A failed load says so — it never shows ₹0.
          */}
          {companyProfitQuery.error ? (
            <LoadError
              what={`the company profit for ${monthName(profitMonth)}`}
              error={companyProfitQuery.error}
              onRetry={() => void companyProfitQuery.refetch()}
            />
          ) : (
            <>
              {companyProfit && companyProfit.warnings.length > 0 && (
                <div className="space-y-2">
                  {companyProfit.warnings.map((w) => (
                    <Note key={w} tone="warn">
                      {w}
                    </Note>
                  ))}
                </div>
              )}
              <StatRow>
                <StatTile
                  label="Revenue"
                  value={companyProfit ? formatMoney(companyProfit.revenue.total) : '—'}
                  note={
                    companyProfit
                      ? `retainers ${formatMoney(companyProfit.revenue.retainers)} + projects invoiced ${formatMoney(companyProfit.revenue.projects)} · before GST`
                      : 'loading…'
                  }
                />
                <StatTile
                  label="Direct + people cost"
                  value={companyProfit ? formatMoney(companyProfit.directCost.total + companyProfit.peopleCost.total) : '—'}
                  note={
                    companyProfit
                      ? `client costs ${formatMoney(companyProfit.directCost.total)} + payroll ${formatMoney(companyProfit.peopleCost.total)}`
                      : 'loading…'
                  }
                />
                <StatTile
                  label="Overheads"
                  value={companyProfit ? formatMoney(companyProfit.overheads.total) : '—'}
                  note={
                    companyProfit
                      ? companyProfit.overheads.salaryLikeLeftOut.count > 0
                        ? 'salary-like costs left out — payroll counts them'
                        : `${plural(companyProfit.overheads.count, 'company cost')}`
                      : 'loading…'
                  }
                />
                <StatTile
                  label="Company profit"
                  value={companyProfit ? formatMoney(companyProfit.profit) : '—'}
                  note={
                    companyProfit
                      ? `${monthName(companyProfit.month)}${companyProfit.marginPercent !== null ? ` · ${companyProfit.marginPercent}% of revenue` : ''}`
                      : 'loading…'
                  }
                  tone={companyProfit ? (companyProfit.profit >= 0 ? 'success' : 'danger') : 'default'}
                />
              </StatRow>
            </>
          )}

          <div className="border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-white">
              <p className="text-sm font-bold text-primary">Profit by client</p>
              <p className="text-micro text-secondary">Retainers, {monthName(profitMonth)} · fees before GST</p>
            </div>
            {retainerProfitQuery.error ? (
              <LoadError what="the profit by client" error={retainerProfitQuery.error} onRetry={() => void retainerProfitQuery.refetch()} className="m-4" />
            ) : (
              <>
                {clientWarnings.length > 0 && (
                  <div className="space-y-2 px-5 pt-3">
                    {clientWarnings.map((w) => (
                      <Note key={w} tone="warn">
                        {w}
                      </Note>
                    ))}
                  </div>
                )}
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
                      {retainerProfitQuery.isPending ? (
                        <TableRowsSkeleton cols={6} />
                      ) : profitRows.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-5 py-16 text-center text-sm text-secondary">
                            No retainer month cards for {monthName(profitMonth)}.
                          </td>
                        </tr>
                      ) : (
                        <>
                          {profitRows.map((r) => (
                            <tr key={r.companyId} className="hover:bg-subtle transition-colors">
                              <td className="font-semibold text-primary">{r.companyName}</td>
                              <td className="text-body text-right">{formatMoney(r.revenue)}</td>
                              <td className="text-secondary text-right">{formatMoney(r.externalCost)}</td>
                              <td className="text-secondary text-right">{formatMoney(r.peopleCost)}</td>
                              {r.costed === false ? (
                                <>
                                  <td className="text-right text-micro text-secondary">Not costed yet</td>
                                  <td className="text-right text-secondary">—</td>
                                </>
                              ) : (
                                <>
                                  <td className={`font-semibold text-right ${r.profit >= 0 ? 'text-success' : 'text-danger'}`}>{formatMoney(r.profit)}</td>
                                  <td className={`font-medium text-right ${r.marginPercent >= 0 ? 'text-body' : 'text-danger'}`}>{r.marginPercent}%</td>
                                </>
                              )}
                            </tr>
                          ))}
                          {profitTotals && (
                            <tr className="bg-subtle/50">
                              <td className="font-bold text-primary">Total</td>
                              <td className="font-bold text-primary text-right">{formatMoney(profitTotals.revenue)}</td>
                              <td className="font-bold text-primary text-right">{formatMoney(profitTotals.externalCost)}</td>
                              <td className="font-bold text-primary text-right">{formatMoney(profitTotals.peopleCost)}</td>
                              <td
                                className={`font-bold text-right ${nothingCosted ? 'text-secondary' : profitTotals.profit >= 0 ? 'text-success' : 'text-danger'}`}
                              >
                                {nothingCosted ? '—' : formatMoney(profitTotals.profit)}
                              </td>
                              <td className="font-bold text-primary text-right">{nothingCosted ? '—' : `${profitTotals.marginPercent}%`}</td>
                            </tr>
                          )}
                          {profitTotals?.uncostedCount ? (
                            <tr>
                              <td colSpan={6} className="text-micro text-secondary">
                                {profitTotals.uncostedCount} {profitTotals.uncostedCount === 1 ? 'retainer is' : 'retainers are'} not costed yet (
                                {formatMoney(profitTotals.uncostedRevenue ?? 0)} of fees), so {profitTotals.uncostedCount === 1 ? 'it is' : 'they are'} left out
                                of profit until a cost or a time split with salaries is entered.
                              </td>
                            </tr>
                          ) : null}
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          {/*
            The one-off work, kept in its own table — whole contracts, not a
            month. Company profit above counts a project's revenue in the
            month it is invoiced; this table is each job's running result.
            Sorted worst margin first: the reason to open it is to find the
            job going wrong.
          */}
          <div className="border border-border rounded-xl overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 border-b border-border bg-white">
              <p className="text-sm font-bold text-primary">Profit by project</p>
              <p className="text-micro text-secondary">One-off work, whole contract · before GST</p>
            </div>

            {projectProfitQuery.error ? (
              <LoadError what="the profit by project" error={projectProfitQuery.error} onRetry={() => void projectProfitQuery.refetch()} className="m-4" />
            ) : (
              <>
                {projectProfit && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-border">
                    <StatTile
                      frame="inset"
                      label="Delivered"
                      value={formatMoney(projectProfit.totals.delivered.profit)}
                      note={
                        `${projectProfit.totals.delivered.count} finished` +
                        (projectProfit.totals.delivered.marginPercent !== null ? ` · ${projectProfit.totals.delivered.marginPercent}% margin` : '') +
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
                      {projectProfitQuery.isPending ? (
                        <TableRowsSkeleton cols={7} />
                      ) : !projectProfit || projectProfit.rows.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-5 py-16 text-center text-sm text-secondary">
                            No projects yet.
                          </td>
                        </tr>
                      ) : (
                        projectProfit.rows.map((r) => (
                          <tr key={r.id} className="hover:bg-subtle transition-colors cursor-pointer" onClick={() => router.push(`/projects/${r.id}`)}>
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
                            <td className={`font-semibold text-right tabular-nums ${r.profit >= 0 ? 'text-success' : 'text-danger'}`}>{formatMoney(r.profit)}</td>
                            <td
                              className={`font-medium text-right tabular-nums ${
                                r.marginPercent === null ? 'text-secondary' : r.marginPercent >= 0 ? 'text-body' : 'text-danger'
                              }`}
                            >
                              {r.marginPercent === null ? '—' : `${r.marginPercent}%`}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          <CostTable
            title={`Company costs, ${monthName(profitMonth)}`}
            rows={overheads}
            total={overheadsQuery.data?.totalAmount ?? null}
            loading={overheadsQuery.isPending}
            error={overheadsQuery.error}
            onRetry={() => void overheadsQuery.refetch()}
            empty={`No company costs recorded for ${monthName(profitMonth)}.`}
            // Salaries are people cost; the table says so and totals what overheads count.
            leftOut={(c) => looksLikeSalary(c.category) || looksLikeSalary(c.vendor)}
            countedTotal={companyProfit?.overheads.total ?? null}
          />

          <CostTable
            title="Capital and loans"
            rows={capital}
            total={capitalQuery.data?.totalAmount ?? null}
            loading={capitalQuery.isPending}
            error={capitalQuery.error}
            onRetry={() => void capitalQuery.refetch()}
            empty="No capital or loan entries recorded."
          />
        </div>
      )}

      {creatingInvoice && (
        <NewInvoiceModal
          onClose={() => setCreatingInvoice(false)}
          onCreated={() => {
            setCreatingInvoice(false);
            void load();
          }}
        />
      )}

      {creatingCost && (
        <NewCostModal
          onClose={() => setCreatingCost(false)}
          onCreated={() => {
            setCreatingCost(false);
            void loadCosts();
          }}
        />
      )}

      {payingInvoice && (
        <RecordPaymentModal
          invoiceId={payingInvoice.id}
          defaultAmount={payingInvoice.balanceDue || payingInvoice.amount}
          invoiceTotal={payingInvoice.amount}
          invoiceGst={payingInvoice.gstAmount}
          onClose={() => setPayingInvoice(null)}
          onRecorded={() => {
            setPayingInvoice(null);
            void load();
          }}
        />
      )}

      {documentInvoice && (
        <InvoiceDocumentModal
          invoice={documentInvoice}
          onClose={() => setDocumentInvoice(null)}
          onSaved={() => {
            setDocumentInvoice(null);
            void load();
          }}
        />
      )}

      {emailingInvoice && <SendDocumentModal kind="INVOICE" id={emailingInvoice.id} onClose={() => setEmailingInvoice(null)} />}
    </div>
  );
}

/** Company costs or capital: the rows, and a total of all of them (decision 15). */
function CostTable({
  title,
  rows,
  total,
  loading,
  error,
  onRetry,
  empty,
  leftOut,
  countedTotal,
}: {
  title: string;
  rows: CostRow[];
  total: number | null;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  empty: string;
  /** Rows shown but not counted — salaries, which payroll already counts. */
  leftOut?: (c: CostRow) => boolean;
  /** What is counted, from the server, when some rows are left out. */
  countedTotal?: number | null;
}) {
  const left = leftOut ? rows.filter(leftOut) : [];
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-white">
        <p className="text-sm font-bold text-primary">{title}</p>
        <p className="text-micro text-secondary">As paid, GST included where there was any</p>
      </div>
      {error ? (
        <LoadError what={title.toLowerCase()} error={error} onRetry={onRetry} className="m-4" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full data-table">
            <thead>
              <tr className="border-b border-border">
                <th className="eyebrow text-left">Date</th>
                <th className="eyebrow text-left">Paid towards</th>
                <th className="eyebrow text-left">Paid to</th>
                <th className="eyebrow text-left">Paid by</th>
                <th className="eyebrow text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <TableRowsSkeleton cols={5} />
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-sm text-secondary">
                    {empty}
                  </td>
                </tr>
              ) : (
                <>
                  {rows.map((c) => (
                    <tr key={c.id} className="hover:bg-subtle transition-colors">
                      <td className="text-secondary whitespace-nowrap">{moneyDate(c.incurredAt)}</td>
                      <td className="font-semibold text-primary">
                        {c.category}
                        {left.includes(c) && (
                          <span className="ml-1.5 text-micro font-normal text-secondary">left out — payroll counts salaries</span>
                        )}
                      </td>
                      <td className="text-secondary">{c.vendor}</td>
                      <td className="text-secondary">{c.paidBy}</td>
                      <td className={`font-semibold text-right ${left.includes(c) ? 'text-secondary line-through' : 'text-primary'}`}>
                        {c.amount != null ? formatMoney(c.amount) : '—'}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-subtle/50">
                    <td colSpan={4} className="font-bold text-primary">
                      {left.length > 0
                        ? `Total counted · ${plural(rows.length - left.length, 'entry', 'entries')}`
                        : `Total · ${plural(rows.length, 'entry', 'entries')}`}
                    </td>
                    <td className="font-bold text-primary text-right">
                      {left.length > 0 ? (countedTotal != null ? formatMoney(countedTotal) : '—') : total != null ? formatMoney(total) : '—'}
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
