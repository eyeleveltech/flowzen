'use client';

import { useState, useEffect, useCallback } from 'react';
import { TableRowsSkeleton } from '@/components/ui/skeleton-loaders';
import { ErrorNote } from '@/components/ui/empty-state';
import { plural } from '@/lib/utils';
import Link from 'next/link';
import { api, fileUrl, formatMoney } from '@/lib/api-v2';
import { NewProposalModal } from '@/components/clients/NewProposalModal';
import { ExportCsvButton } from '@/components/ui/export-csv-button';
import { usePageHeader } from '@/hooks/usePageHeader';
import { StatTile, StatRow } from '@/components/ui/stat-tile';
import { Tabs, type TabDef } from '@/components/ui/tabs';

type ProposalFilter = 'LIVE' | 'CLOSED' | 'PROFORMAS';

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
  const [proposals, setProposals] = useState<ProposalItem[]>([]);
  /** A failed load, said out loud instead of only in the console. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<ProposalFilter>('LIVE');
  const [isNewProposalOpen, setIsNewProposalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.proposals.list();
      if (res.success) setProposals(res.proposals);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load proposals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);


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
          <ErrorNote onDismiss={() => setLoadError(null)}>{loadError}</ErrorNote>
        </div>
      )}
      {/* Header */}
      <div className="flex flex-wrap items-center justify-end gap-2 mb-8">
          <ExportCsvButton href={fileUrl(tab === 'PROFORMAS' ? '/proformas?format=csv' : '/proposals?format=csv')} />
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
        ] as TabDef<'LIVE' | 'CLOSED' | 'PROFORMAS'>[]}
        active={tab}
        onChange={setTab}
      />

      {/* Table */}
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
        {tab === 'PROFORMAS' ? (
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
