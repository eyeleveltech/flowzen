'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TableRowsSkeleton } from '@/components/ui/skeleton-loaders';
import { ErrorNote } from '@/components/ui/empty-state';
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
  company: { id: string; name: string; vertical: string };
  owner?: { id: string; name: string } | null;
  versions: { n: number; value: number; createdAt: string }[];
  wonVersion?: { n: number; value: number } | null;
  proformas: { id: string; number: string; status: string; amount: number }[];
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

  const { data: trashData } = useQuery({
    queryKey: ['proposals', 'trash'],
    queryFn: () => api.proposals.trash(),
    enabled: canRestore,
  });
  const deleted: DeletedProposal[] = trashData?.success ? (trashData.proposals as DeletedProposal[]) : [];
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
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

  const live = proposals.filter(p => !p.outcome);
  const closed = proposals.filter(p => p.outcome === 'WON' || p.outcome === 'LOST' || p.outcome === 'EXPIRED');
  /*
   * Every proforma, from the proforma list — not from the proposals.
   *
   * This used to flatten the proformas nested under each proposal, which
   * missed every one raised against a PROJECT MILESTONE: those belong to no
   * proposal, so they never appeared here, and the "Proformas unpaid" tile
   * counted without them. The export button on this same tab reads the real
   * list, so the screen showed 3 and the file it exported had 4.
   */
  const { data: proformaData } = useQuery({
    queryKey: ['proformas', 'all'],
    queryFn: () => api.proformas.list(),
  });
  const proformas: ProformaRow[] = proformaData?.proformas ?? [];

  const liveValue = live.reduce((s, p) => s + Number(p.versions[0]?.value ?? 0), 0);
  // §8: "Discount given — version1.value − wonVersion.value." First ask
  // against what the deal actually closed at, won proposals only — this used
  // to just re-sum every proposal's v1 value regardless of outcome, which is
  // a first-ask total, not a discount.
  const givenAwayValue = proposals
    .filter((p) => p.outcome === 'WON' && p.wonVersion)
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
          label="Live Proposals"
          value={live.length}
          note={`${revised.length} ${revised.length === 1 ? 'has' : 'have'} been revised`}
        />
        <StatTile label="Value Out There" value={formatMoney(liveValue)} note="at current versions" />
        <StatTile
          label="Given Away This Year"
          value={formatMoney(givenAwayValue)}
          note="first ask against closed value"
          tone="warning"
        />
        <StatTile
          label="Proformas Unpaid"
          value={proformasUnpaid.length}
          note={`${formatMoney(proformasUnpaidValue)} sitting`}
        />
      </StatRow>

      <Tabs
        tabs={[
          { key: 'LIVE', label: 'Live', count: live.length },
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
                <th className="eyebrow text-right">Last version</th>
                <th className="eyebrow text-left">Owner</th>
                <th className="eyebrow text-left">Deleted</th>
                <th className="eyebrow text-right">Put back</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {deleted.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-sm text-secondary">
                    Nothing deleted. A proposal that has been won or lost cannot be deleted at all — only one nothing
                    has happened to yet.
                  </td>
                </tr>
              ) : (
                deleted.map((p) => (
                  <tr key={p.id} className="hover:bg-subtle transition-colors">
                    <td className="font-semibold text-primary">{p.company?.name ?? 'No company'}</td>
                    <td className="text-secondary">{p.kind === 'RETAINER' ? 'Retainer' : 'One time'}</td>
                    <td className="font-semibold text-primary text-right">
                      {p.versions[0] ? formatMoney(p.versions[0].value) : '—'}
                    </td>
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
              {proformas.length === 0 ? (
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
                      'Retainer month'
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
          <table className="w-full data-table">
            <thead>
              <tr className="border-b border-border">
                <th className="eyebrow text-left">Company</th>
                <th className="eyebrow text-left">Kind</th>
                <th className="eyebrow text-right">Current Value</th>
                <th className="eyebrow text-left">Stage</th>
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
                <tr><td colSpan={canRestore ? 8 : 7} className="px-5 py-16 text-center text-sm text-secondary">No proposals found.</td></tr>
              ) : shown.map(p => {
                const latestVersion = p.versions[0];
                const v1 = p.versions[p.versions.length - 1];
                const revised = p.versions.length > 1;
                const daysSent = daysSince(p.createdAt);
                // Same false affordance as the invoice table: pointer cursor,
                // no handler. Proposals have no page of their own, so the
                // client is the link.
                return (
                  <tr key={p.id} className="hover:bg-subtle transition-colors">
                    <td className="">
                      <Link
                        href={`/companies/${p.company.id}`}
                        className="text-sm font-semibold text-primary rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        {p.company.name}
                      </Link>
                      {revised && (
                        <p className="text-micro text-secondary">
                          +{p.versions.length - 1} · first asked {formatMoney(v1?.value ?? 0)}, now {formatMoney(latestVersion?.value ?? 0)}
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
                    <td className="font-semibold text-primary text-right">
                      {formatMoney(latestVersion?.value ?? 0)}
                    </td>
                    <td className={`${STAGE_COLOR[p.stage] ?? 'text-body'}`}>
                      {STAGE_LABEL[p.stage] ?? p.stage}
                    </td>
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
        )}
        </div>
      </div>
    </div>
  );
}
