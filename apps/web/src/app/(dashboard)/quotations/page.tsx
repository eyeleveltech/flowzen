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
import { RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';

/**
 * `DELETED` is here rather than only in Settings → Trash because /settings
 * redirects anyone without setup.admin, and the people who raise proposals —
 * and so the people who raise one by mistake — are BD, who do not have it.
 * A recovery screen the person who needs it cannot open is not a recovery
 * screen. Settings keeps the org-wide view for admins.
 */
type ProposalFilter = 'LIVE' | 'CLOSED' | 'PROFORMAS' | 'DELETED';

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

const STAGE_LABEL: Record<string, string> = {
  TALKING: 'Talking',
  PROPOSAL_SENT: 'Proposal sent',
  IN_NEGOTIATION: 'In negotiation',
  PROFORMA_ISSUED: 'Proforma issued',
  VERBAL_YES: 'Verbal yes',
  WON: 'Won',
  LOST: 'Lost',
  EXPIRED: 'Expired',
};

const STAGE_COLOR: Record<string, string> = {
  TALKING: 'text-secondary',
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
  const proformas = proposals.flatMap(p => p.proformas.map(pf => ({ ...pf, proposal: p })));

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
  const proformasUnpaid = proformas.filter(pf => pf.status === 'PENDING' || pf.status === 'UNPAID');
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
                <th className="eyebrow text-left">Company</th>
                <th className="eyebrow text-left">Number</th>
                <th className="eyebrow text-right">Amount</th>
                <th className="eyebrow text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {proformas.length === 0 ? (
                <tr><td colSpan={4} className="px-5 py-12 text-center text-sm text-secondary">No proformas.</td></tr>
              ) : proformas.map(pf => (
                <tr key={pf.id} className="hover:bg-subtle transition-colors">
                  <td className="font-semibold text-primary">{pf.proposal.company.name}</td>
                  <td className="text-secondary">{pf.number}</td>
                  <td className="font-semibold text-primary text-right">{formatMoney(pf.amount)}</td>
                  <td className="">
                    <span className={`text-micro font-medium px-2 py-0.5 rounded border ${
                      pf.status === 'PAID' ? 'border-success/30 bg-success-tint text-success' : 'border-warning/40 bg-warning-tint text-warning-ink'
                    }`}>{pf.status}</span>
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
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <TableRowsSkeleton cols={7} />
              ) : shown.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-16 text-center text-sm text-secondary">No proposals found.</td></tr>
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
