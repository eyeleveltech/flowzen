'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TableRowsSkeleton } from '@/components/ui/skeleton-loaders';
import { financialYearStart, todayIn } from '@/lib/money';
import { NextStepLine, isNextStepMissing } from '@/components/sales/NextStep';
import { LastContactModal } from '@/components/sales/SalesDialogs';
import { ErrorNote, LoadError } from '@/components/ui/empty-state';
import { plural } from '@/lib/utils';
import Link from 'next/link';
import { api, fileUrl, formatMoney, formatDate } from '@/lib/api-v2';
import { NewProposalModal } from '@/components/clients/NewProposalModal';
import { ExportCsvButton } from '@/components/ui/export-csv-button';
import { usePageHeader } from '@/hooks/usePageHeader';
import { useConfig } from '@/hooks/queries';
import { StatTile, StatRow } from '@/components/ui/stat-tile';
import { Tabs, type TabDef } from '@/components/ui/tabs';
import { RotateCcw, Trash2, Download } from 'lucide-react';
import { useConfirmStore } from '@/stores/confirm';
import { ApiError } from '@/lib/api-v2';
import toast from 'react-hot-toast';
import { STAGE_LABEL } from '@flowzen/shared';
import { monthLabel } from '@/lib/retainerBilling';

/**
 * `DELETED` is here rather than only in Settings → Trash because /settings
 * redirects anyone without setup.admin, and the people who raise proposals —
 * and so the people who raise one by mistake — are BD, who do not have it.
 * A recovery screen the person who needs it cannot open is not a recovery
 * screen. Settings keeps the org-wide view for admins.
 */
type ProposalFilter = 'LIVE' | 'CLOSED' | 'PROFORMAS' | 'DELETED';

/** A proforma as the list sends it — see GET /proformas. */
type ProformaRow = {
  id: string;
  number: string;
  status: 'UNPAID' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  amount: number | string | null;
  sourceType: 'PROPOSAL' | 'MONTH_CARD' | 'PROJECT';
  raisedAt?: string | null;
  createdAt: string;
  company: { id: string; name: string };
  milestone?: { id: string; label: string; project: { id: string; name: string } } | null;
  /** The retainer month it bills, when it bills one. */
  monthCard?: { id: string; month: string; retainerId: string } | null;
  invoice?: { id: string; number: string; status: string } | null;
};

/*
 * Words, not enum values. It printed the raw status, and "UNPAID" in capitals
 * next to "PAID" in capitals read as two shades of the same thing.
 */
const PROFORMA_LABEL: Record<string, string> = {
  UNPAID: 'Unpaid',
  PAID: 'Paid',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
};
const PROFORMA_TONE: Record<string, string> = {
  UNPAID: 'border-warning/40 bg-warning-tint text-warning-ink',
  PAID: 'border-success/30 bg-success-tint text-success',
  // Neither is money coming in, so neither wears a colour that says it is.
  EXPIRED: 'border-border bg-subtle text-secondary',
  CANCELLED: 'border-border bg-subtle text-secondary line-through',
};

interface ProposalItem {
  id: string;
  companyId: string;
  kind: 'RETAINER' | 'PROJECT';
  stage: string;
  outcome?: string | null;
  /** The server's one active-deal rule: no outcome and not in a closed stage. */
  active?: boolean;
  company: { id: string; name: string; vertical: string };
  owner?: { id: string; name: string } | null;
  versions: { n: number; value: number; createdAt: string }[];
  wonVersion?: { n: number; value: number } | null;
  /** When it was won — what puts its discount in a financial year. */
  wonAt?: string | null;
  /** What happens next on an open deal, and by when (Sales next step plan). */
  nextStep?: string | null;
  nextStepDate?: string | null;
  /** The last real contact — a touch, a version, a stage change — or a date set by hand. */
  lastTouchedAt?: string | null;
  proformas: { id: string; number: string; status: string; amount: number }[];
  /** The latest proposal document written for it, if any. */
  documents?: { id: string; n: number; status: 'DRAFT' | 'IN_REVIEW' | 'FINAL' }[];
  createdAt: string;
  updatedAt: string;
}

interface DeletedProposal {
  id: string;
  kind: 'RETAINER' | 'PROJECT';
  stage: string;
  deletedAt: string;
  company: { id: string; name: string } | null;
  owner?: { id: string; name: string } | null;
  versions: { n: number; value: number }[];
}


const STAGE_COLOR: Record<string, string> = {
  PROPOSAL_SENT: 'text-body',
  IN_NEGOTIATION: 'text-body',
  PROFORMA_ISSUED: 'text-body',
  VERBAL_YES: 'text-body',
  WON: 'text-success',
  LOST: 'text-danger',
  EXPIRED: 'text-secondary',
};

export default function ProposalsPage() {
  /** A failed load, said out loud instead of only in the console. */
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ProposalFilter>('LIVE');
  const [isNewProposalOpen, setIsNewProposalOpen] = useState(false);

  const { data: config } = useConfig();
  const canRestore = Boolean(config?.me.permissions?.includes('pipeline.write'));

  const { data, isPending, error } = useQuery({
    queryKey: ['proposals'],
    queryFn: () => api.proposals.list(),
  });
  // What a deal is worth is Management's: without money.figures the server
  // sends every value as null, and the list leaves the figures out entirely.
  const showValues = data ? data.canSeeValues !== false : false;

  const { data: trashData } = useQuery({
    queryKey: ['proposals', 'trash'],
    queryFn: () => api.proposals.trash(),
    enabled: canRestore,
  });
  const deleted: DeletedProposal[] = trashData?.success ? (trashData.proposals as DeletedProposal[]) : [];
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  /*
   * Live deals picked for "Set last contact date" — imported deals corrected
   * in one go, so "going stale" counts from when they were really last spoken
   * to rather than from the import (Sales next step plan, decision 4).
   */
  const [picked, setPicked] = useState<string[]>([]);
  const [settingLastContact, setSettingLastContact] = useState(false);
  const confirm = useConfirmStore((st) => st.confirm);

  /*
   * Deleting one from here.
   *
   * Soft, like everywhere else — §16 — so it lands in the Deleted tab on this
   * same screen and can be put back. The server refuses one that has been won
   * or lost: those are outcomes the win rate has already counted, and a
   * deletion would quietly rewrite what happened.
   */
  const removeProposal = async (p: any) => {
    const ok = await confirm({
      title: `Delete this proposal for ${p.company?.name ?? 'this client'}?`,
      message:
        'It comes off the pipeline board and out of the client\'s record. Its versions are kept, so it can be restored from the Deleted tab.',
      confirmText: 'Delete it',
      variant: 'danger',
    });
    if (!ok) return;
    setDeletingId(p.id);
    try {
      await api.proposals.remove(p.id);
      toast.success('Proposal deleted');
      await queryClient.invalidateQueries();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete this proposal');
    } finally {
      setDeletingId(null);
    }
  };

  const proposals: ProposalItem[] = data?.success ? data.proposals : [];
  const loading = isPending;
  const loadError = error instanceof Error ? error.message : error ? 'Could not load proposals' : null;

  /** What the new-proposal flow calls once it has created one. */
  const load = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['proposals'] });
  }, [queryClient]);

  const restore = async (p: DeletedProposal) => {
    setRestoringId(p.id);
    try {
      await api.proposals.restore(p.id);
      toast.success(`${p.company?.name ?? 'Proposal'} is back on the pipeline.`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not restore that proposal');
    } finally {
      setRestoringId(null);
    }
  };


  const daysSince = (date: string) => Math.ceil((Date.now() - new Date(date).getTime()) / (1000 * 3600 * 24));

  /*
   * Active and closed by the server's rule (QA19 fixes plan, F01), so this
   * list, the Pipeline board, Forecast, the brief and Zen count the same deals.
   * A deal is one or the other — never both, never neither.
   */
  const isActive = (p: ProposalItem) => p.active ?? !p.outcome;
  const live = proposals.filter(isActive);
  const closed = proposals.filter((p) => !isActive(p));
  // The tiles, from the whole register — the page above is capped.
  const activeCount = data?.success ? (data.active?.count ?? live.length) : live.length;
  /*
   * Every proforma, from the proforma list — not from the proposals.
   *
   * This used to flatten the proformas nested under each proposal, which
   * missed every one raised against a PROJECT MILESTONE: those belong to no
   * proposal, so they never appeared here, and the "Proformas unpaid" tile
   * counted without them. The export button on this same tab reads the real
   * list, so the screen showed 3 and the file it exported had 4.
   */
  const { data: proformaData, isPending: proformasLoading, error: proformasError, refetch: refetchProformas } = useQuery({
    queryKey: ['proformas', 'all'],
    queryFn: () => api.proformas.list(),
  });
  const proformas: ProformaRow[] = proformaData?.proformas ?? [];

  const liveValue =
    data?.success && data.active?.value != null
      ? data.active.value
      : live.reduce((s, p) => s + Number(p.versions[0]?.value ?? 0), 0);
  // §8: "Discount given — version1.value − wonVersion.value." First ask
  // against what the deal actually closed at, won proposals only — this used
  // to just re-sum every proposal's v1 value regardless of outcome, which is
  // a first-ask total, not a discount.
  //
  // This financial year only, as the tile says (Money Plan 2, decision 15) —
  // it summed every deal ever won, so "this year" grew for ever.
  const tz = config?.organization.timezone ?? 'Asia/Kolkata';
  const fyFrom = financialYearStart(todayIn(tz), config?.organization.fiscalYearStart ?? 4);
  const givenAwayValue = proposals
    .filter((p) => p.outcome === 'WON' && p.wonVersion && p.wonAt && todayIn(tz, new Date(p.wonAt)) >= fyFrom)
    .reduce((s, p) => {
      const v1 = p.versions[p.versions.length - 1];
      const won = p.wonVersion;
      if (!v1 || !won) return s;
      return s + Math.max(0, Number(v1.value) - Number(won.value));
    }, 0);
  // UNPAID only. There is no PENDING status — this used to check for one — and
  // an EXPIRED proforma is a request for money that lapsed, not money that is
  // sitting there to be collected; it is shown in the list, marked, instead.
  const proformasUnpaid = proformas.filter(pf => pf.status === 'UNPAID');
  const proformasUnpaidValue = proformasUnpaid.reduce((s, pf) => s + Number(pf.amount || 0), 0);

  const revised = live.filter(p => p.versions.length > 1);

  const shown = tab === 'LIVE' ? live : tab === 'CLOSED' ? closed : [];

  usePageHeader('Proposals', `${plural(proposals.length, 'record')}, ${plural(proformas.length, 'proforma')}`);

  return (
    <div className="page-shell">
      {loadError && (
        <div className="mb-6">
          {/*
            A failed load used to reach console.error and stop, so the screen
            rendered its empty state and "the server is down" looked exactly
            like "you have nothing yet".
          */}
          <ErrorNote onDismiss={() => queryClient.resetQueries({ queryKey: ['proposals'] })}>{loadError}</ErrorNote>
        </div>
      )}
      {/* Header */}
      <div className="flex flex-wrap items-center justify-end gap-2 mb-8">
          {/* The export routes list live records, so it would hand back the
              opposite of what this tab is showing. */}
          {tab !== 'DELETED' && (
            <ExportCsvButton href={fileUrl(tab === 'PROFORMAS' ? '/proformas?format=csv' : '/proposals?format=csv')} />
          )}
          <button
            className="flex items-center gap-1.5 bg-primary text-white text-sm font-semibold px-4 h-8 rounded-lg hover:bg-primary/90 transition-colors"
            onClick={() => setIsNewProposalOpen(true)}
          >
            <span className="text-base leading-none">+</span> New
          </button>
      </div>

      {isNewProposalOpen && (
        <NewProposalModal
          onCancel={() => setIsNewProposalOpen(false)}
          onConfirm={() => {
            setIsNewProposalOpen(false);
            load();
          }}
        />
      )}

      <StatRow className="mb-8">
        <StatTile
          label="Active Proposals"
          value={activeCount}
          note={`${revised.length} ${revised.length === 1 ? 'has' : 'have'} been revised`}
        />
        {showValues && <StatTile label="Value Out There" value={formatMoney(liveValue)} note="if every active deal lands" />}
        {showValues && (
          <StatTile
            label="Given Away This Year"
            value={formatMoney(givenAwayValue)}
            note="first ask against what it closed at, this financial year"
            tone="warning"
          />
        )}
        <StatTile
          label="Proformas Unpaid"
          value={proformasUnpaid.length}
          note={`${formatMoney(proformasUnpaidValue)} sitting`}
        />
      </StatRow>

      <Tabs
        tabs={[
          { key: 'LIVE', label: 'Active', count: live.length },
          { key: 'CLOSED', label: 'Closed', count: closed.length },
          { key: 'PROFORMAS', label: 'Proformas', count: proformas.length },
          // Only for somebody who could actually put one back.
          ...(canRestore ? [{ key: 'DELETED' as const, label: 'Deleted', count: deleted.length }] : []),
        ] as TabDef<ProposalFilter>[]}
        active={tab}
        onChange={setTab}
      />

      {/* Table */}
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
        {tab === 'DELETED' ? (
          <table className="w-full data-table">
            <thead>
              <tr className="border-b border-border">
                <th className="eyebrow text-left">Company</th>
                <th className="eyebrow text-left">Kind</th>
                {showValues && <th className="eyebrow text-right">Last version</th>}
                <th className="eyebrow text-left">Owner</th>
                <th className="eyebrow text-left">Deleted</th>
                <th className="eyebrow text-right">Put back</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {deleted.length === 0 ? (
                <tr>
                  <td colSpan={showValues ? 6 : 5} className="px-5 py-12 text-center text-sm text-secondary">
                    Nothing deleted. A proposal that has been won or lost cannot be deleted at all — only one nothing
                    has happened to yet.
                  </td>
                </tr>
              ) : (
                deleted.map((p) => (
                  <tr key={p.id} className="hover:bg-subtle transition-colors">
                    <td className="font-semibold text-primary">{p.company?.name ?? 'No company'}</td>
                    <td className="text-secondary">{p.kind === 'RETAINER' ? 'Retainer' : 'One time'}</td>
                    {showValues && (
                      <td className="font-semibold text-primary text-right">
                        {p.versions[0] ? formatMoney(p.versions[0].value) : '—'}
                      </td>
                    )}
                    <td className="text-secondary">{p.owner?.name ?? '—'}</td>
                    <td className="text-secondary">{formatDate(p.deletedAt)}</td>
                    <td className="text-right">
                      <button
                        onClick={() => void restore(p)}
                        disabled={restoringId === p.id}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-secondary hover:bg-subtle hover:text-primary transition-colors disabled:opacity-50"
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> Restore
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : tab === 'PROFORMAS' ? (
          <table className="w-full data-table">
            <thead>
              <tr className="border-b border-border">
                <th className="eyebrow text-left">Number</th>
                <th className="eyebrow text-left">Company</th>
                {/* What it asks to be paid for — a proposal, or one billing
                    milestone of a project. Without this the list could not
                    tell an advance on a build from a retainer quote. */}
                <th className="eyebrow text-left">For</th>
                <th className="eyebrow text-left">Raised</th>
                <th className="eyebrow text-right">Amount</th>
                <th className="eyebrow text-left">Status</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {proformasLoading ? (
                <TableRowsSkeleton cols={7} />
              ) : proformasError ? (
                <tr>
                  <td colSpan={7} className="p-4">
                    <LoadError what="the proformas" error={proformasError} onRetry={() => void refetchProformas()} />
                  </td>
                </tr>
              ) : proformas.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-secondary">No proformas.</td></tr>
              ) : proformas.map(pf => (
                <tr key={pf.id} className="hover:bg-subtle transition-colors">
                  <td className="font-medium text-primary whitespace-nowrap">{pf.number}</td>
                  <td>
                    <Link
                      href={`/companies/${pf.company.id}?tab=MONEY`}
                      className="text-sm font-semibold text-primary hover:underline"
                    >
                      {pf.company.name}
                    </Link>
                  </td>
                  <td className="text-secondary">
                    {pf.milestone ? (
                      <>
                        {pf.milestone.project.name}
                        <span className="block text-micro">{pf.milestone.label}</span>
                      </>
                    ) : pf.sourceType === 'MONTH_CARD' ? (
                      <>
                        Retainer
                        {pf.monthCard && <span className="block text-micro">{monthLabel(pf.monthCard.month)}</span>}
                      </>
                    ) : (
                      'Proposal'
                    )}
                  </td>
                  <td className="text-secondary whitespace-nowrap">{formatDate(pf.raisedAt ?? pf.createdAt)}</td>
                  <td className="font-semibold text-primary text-right whitespace-nowrap">
                    {pf.amount == null ? '—' : formatMoney(pf.amount)}
                  </td>
                  <td>
                    <span className={`text-micro font-medium px-2 py-0.5 rounded border ${PROFORMA_TONE[pf.status] ?? PROFORMA_TONE.UNPAID}`}>
                      {PROFORMA_LABEL[pf.status] ?? pf.status}
                    </span>
                    {/* Once it has become a tax invoice, say which — that is
                        the document the money is actually chased against. */}
                    {pf.invoice && (
                      <span className="block mt-0.5 text-micro text-secondary">→ {pf.invoice.number}</span>
                    )}
                  </td>
                  <td className="text-right">
                    {/* The document itself. A list of proformas you cannot
                        open is a list of numbers to go looking for. */}
                    <a
                      href={api.proformas.pdfUrl(pf.id)}
                      aria-label={`Download ${pf.number}`}
                      title="Download PDF"
                      className="inline-flex rounded-lg p-1.5 text-secondary transition-colors hover:bg-subtle hover:text-primary"
                    >
                      <Download className="h-4 w-4" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <>
          {tab === 'LIVE' && canRestore && picked.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-subtle/60 px-5 py-2.5">
              <p className="text-sm text-body">{plural(picked.length, 'deal')} selected</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPicked([])}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-secondary hover:bg-subtle"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => setSettingLastContact(true)}
                  className="rounded-lg border border-primary/30 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/5"
                >
                  Set last contact date
                </button>
              </div>
            </div>
          )}
          <table className="w-full data-table">
            <thead>
              <tr className="border-b border-border">
                {tab === 'LIVE' && canRestore && (
                  <th className="w-8">
                    <input
                      type="checkbox"
                      aria-label="Select every live deal"
                      checked={shown.length > 0 && picked.length === shown.length}
                      onChange={(e) => setPicked(e.target.checked ? shown.map((x) => x.id) : [])}
                    />
                  </th>
                )}
                <th className="eyebrow text-left">Company</th>
                <th className="eyebrow text-left">Kind</th>
                {showValues && <th className="eyebrow text-right">Current Value</th>}
                <th className="eyebrow text-left">Stage</th>
                {tab === 'LIVE' && <th className="eyebrow text-left">Next step</th>}
                {tab === 'LIVE' && <th className="eyebrow text-left">Last contact</th>}
                <th className="eyebrow text-left">Sent</th>
                <th className="eyebrow text-right">Waiting</th>
                <th className="eyebrow text-left">Owner</th>
                {canRestore && <th className="w-10" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <TableRowsSkeleton cols={canRestore ? 8 : 7} />
              ) : shown.length === 0 ? (
                <tr><td colSpan={(canRestore ? 11 : 9) - (showValues ? 0 : 1)} className="px-5 py-16 text-center text-sm text-secondary">No proposals found.</td></tr>
              ) : shown.map(p => {
                const latestVersion = p.versions[0];
                const v1 = p.versions[p.versions.length - 1];
                const revised = p.versions.length > 1;
                const daysSent = daysSince(p.createdAt);
                // The client is the main link; the proposal document has its
                // own page, linked underneath.
                const stepDay = p.nextStepDate ? p.nextStepDate.slice(0, 10) : null;
                return (
                  <tr key={p.id} className="hover:bg-subtle transition-colors">
                    {tab === 'LIVE' && canRestore && (
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${p.company.name}`}
                          checked={picked.includes(p.id)}
                          onChange={(e) =>
                            setPicked((list) => (e.target.checked ? [...list, p.id] : list.filter((x) => x !== p.id)))
                          }
                        />
                      </td>
                    )}
                    <td className="">
                      <Link
                        href={`/companies/${p.company.id}`}
                        className="text-sm font-semibold text-primary rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        {p.company.name}
                      </Link>
                      {/* The proposal document, written in Flowzen (AI Proposal Builder). */}
                      <Link
                        href={`/quotations/${p.id}${p.documents?.[0] ? `?doc=${p.documents[0].id}` : ''}`}
                        className="block text-micro font-medium text-info hover:underline"
                      >
                        {p.documents?.[0]
                          ? `Proposal v${p.documents[0].n} · ${p.documents[0].status === 'FINAL' ? 'final' : p.documents[0].status === 'IN_REVIEW' ? 'in review' : 'draft'}`
                          : p.outcome
                            ? 'Proposal'
                            : 'Write the proposal'}
                      </Link>
                      {revised && (
                        <p className="text-micro text-secondary">
                          {showValues
                            ? `+${p.versions.length - 1} · first asked ${formatMoney(v1?.value ?? 0)}, now ${formatMoney(latestVersion?.value ?? 0)}`
                            : `+${p.versions.length - 1} revised`}
                        </p>
                      )}
                    </td>
                    <td className="">
                      <span className={`text-micro font-semibold px-2 py-0.5 rounded border ${
                        p.kind === 'RETAINER'
                          ? 'border-info/30 text-info bg-info-tint'
                          : 'border-info/30 text-info bg-info-tint'
                      }`}>{p.kind === 'RETAINER' ? 'Retainer' : 'One time'}</span>
                    </td>
                    {showValues && (
                      <td className="font-semibold text-primary text-right">
                        {formatMoney(latestVersion?.value ?? 0)}
                      </td>
                    )}
                    <td className={`${STAGE_COLOR[p.stage] ?? 'text-body'}`}>
                      {STAGE_LABEL[p.stage] ?? p.stage}
                    </td>
                    {tab === 'LIVE' && (
                      <td className="max-w-56">
                        <NextStepLine
                          nextStep={p.nextStep}
                          nextStepDate={stepDay}
                          missing={isNextStepMissing(p.nextStep)}
                          overdue={Boolean(stepDay) && stepDay! < todayIn(tz)}
                        />
                      </td>
                    )}
                    {tab === 'LIVE' && (
                      <td className="text-secondary whitespace-nowrap">
                        {p.lastTouchedAt ? `${daysSince(p.lastTouchedAt)}d ago` : '—'}
                      </td>
                    )}
                    <td className="text-secondary">
                      {new Date(p.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </td>
                    <td className="text-right">
                      <span className={`text-sm font-semibold ${daysSent > 30 ? 'text-warning-ink' : 'text-secondary'}`}>
                        {daysSent}d
                      </span>
                    </td>
                    <td className="text-secondary">{p.owner?.name ?? '—'}</td>
                    {/* Same permission the Deleted tab is gated on — whoever
                        may put one back is whoever may take one away. */}
                    {canRestore && (
                      <td className="text-right">
                        <button
                          type="button"
                          onClick={() => void removeProposal(p)}
                          disabled={deletingId === p.id}
                          aria-label={`Delete the proposal for ${p.company?.name ?? 'this client'}`}
                          title="Delete proposal"
                          className="rounded-lg p-1.5 text-secondary transition-colors hover:bg-danger-tint hover:text-danger disabled:opacity-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          </>
        )}
        </div>
      </div>

      {settingLastContact && (
        <LastContactModal
          kind="DEAL"
          ids={picked}
          label={plural(picked.length, 'deal')}
          onClose={() => setSettingLastContact(false)}
          onDone={() => {
            setSettingLastContact(false);
            setPicked([]);
            load();
          }}
        />
      )}
    </div>
  );
}
