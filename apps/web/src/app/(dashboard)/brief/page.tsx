'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiGet, formatMoney } from '@/lib/api-v2';
import { usePageHeader } from '@/hooks/usePageHeader';

interface BriefItem {
  id: string;
  companyName?: string;
  message: string;
  severity?: string;
  daysLeft?: number;
  value?: number;
}

interface Brief {
  generatedAt: string;
  quadrants: {
    contractRisks: { title: string; count: number; items: BriefItem[] };
    pipelineMomentum: { title: string; verbalYesPending: BriefItem[]; stalledProposals: BriefItem[] };
    accountsReceivable: { title: string; totalOverdueAmount: number; overdue30: BriefItem[]; overdue60: BriefItem[] };
    teamCapacity: { title: string; hotspotCount: number; bottlenecks: BriefItem[] };
  };
}


function Section({ title, count, severity, children }: { title: string; count: number; severity?: 'danger' | 'warning' | 'ok'; children: React.ReactNode }) {
  const borderColor = severity === 'danger' ? 'border-l-danger' : severity === 'warning' ? 'border-l-warning' : 'border-l-border';
  return (
    <div className={`border border-border rounded-xl overflow-hidden border-l-[3px] ${borderColor}`}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <h3 className="text-sm font-semibold text-primary">{title}</h3>
        <span className={`text-xl font-bold tabular-nums ${severity === 'danger' ? 'text-danger' : severity === 'warning' ? 'text-warning-ink' : 'text-primary'}`}>
          {count}
        </span>
      </div>
      <div className="divide-y divide-border">{children}</div>
    </div>
  );
}

function BriefRow({ item }: { item: BriefItem }) {
  return (
    <div className="px-5 py-3">
      {item.companyName && <p className="text-sm font-semibold text-primary mb-0.5">{item.companyName}</p>}
      <p className="text-sm text-secondary">{item.message}</p>
    </div>
  );
}

export default function MondayBriefPage() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiGet<any>('/brief/monday');
      if (res.success) setBrief(res);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load briefing');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const genDate = brief ? new Date(brief.generatedAt).toLocaleString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }) : '';

  const q = brief?.quadrants;
  const contractCount = q?.contractRisks.count ?? 0;
  const stalledCount = (q?.pipelineMomentum.stalledProposals.length ?? 0) + (q?.pipelineMomentum.verbalYesPending.length ?? 0);
  const arAmount = q?.accountsReceivable.totalOverdueAmount ?? 0;
  const hotspotCount = q?.teamCapacity.hotspotCount ?? 0;

  usePageHeader('Monday brief', genDate ? `Generated ${genDate}` : null);

  return (
    <div className="page-shell">
      {/* Header */}
      <div className="flex items-center justify-end mb-8">
        <button
          onClick={load}
          className="border border-border text-secondary text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-subtle transition-colors"
        >
          Refresh
        </button>
      </div>

      {loading && (
        <div className="border border-border rounded-xl py-16 text-center">
          <p className="text-sm text-secondary">Generating briefing…</p>
        </div>
      )}

      {error && (
        <div className="border border-danger/30 bg-danger-tint rounded-xl p-5">
          <p className="text-sm font-semibold text-danger">{error}</p>
          <p className="text-micro text-secondary mt-1">You may not have permission to view the Monday brief.</p>
        </div>
      )}

      {brief && q && (
        <div className="grid grid-cols-2 gap-4">
          {/* Contract Risks */}
          <Section
            title={q.contractRisks.title}
            count={contractCount}
            severity={contractCount > 0 ? 'danger' : 'ok'}
          >
            {contractCount === 0 ? (
              <p className="px-5 py-4 text-sm text-secondary">No contracts expiring within 45 days.</p>
            ) : q.contractRisks.items.map(item => <BriefRow key={item.id} item={item} />)}
          </Section>

          {/* Pipeline Momentum */}
          <Section
            title={q.pipelineMomentum.title}
            count={stalledCount}
            severity={stalledCount > 2 ? 'warning' : stalledCount > 0 ? 'warning' : 'ok'}
          >
            {q.pipelineMomentum.verbalYesPending.length > 0 && (
              <div className="px-5 py-3 border-b border-border">
                <p className="eyebrow mb-2">Verbal yes — needs advance</p>
                {q.pipelineMomentum.verbalYesPending.map(item => <BriefRow key={item.id} item={item} />)}
              </div>
            )}
            {q.pipelineMomentum.stalledProposals.length === 0 && q.pipelineMomentum.verbalYesPending.length === 0 ? (
              <p className="px-5 py-4 text-sm text-secondary">Pipeline is moving.</p>
            ) : q.pipelineMomentum.stalledProposals.map(item => <BriefRow key={item.id} item={item} />)}
          </Section>

          {/* Accounts Receivable */}
          <Section
            title={q.accountsReceivable.title}
            count={q.accountsReceivable.overdue30.length + q.accountsReceivable.overdue60.length}
            severity={arAmount > 0 ? 'danger' : 'ok'}
          >
            {arAmount > 0 && (
              <div className="px-5 py-3 border-b border-border">
                <p className="text-micro text-secondary">Total outstanding:</p>
                <p className="text-xl font-bold tabular-nums text-danger">{formatMoney(arAmount)}</p>
              </div>
            )}
            {q.accountsReceivable.overdue60.map(item => <BriefRow key={item.id} item={item} />)}
            {q.accountsReceivable.overdue30.map(item => <BriefRow key={item.id} item={item} />)}
            {arAmount === 0 && <p className="px-5 py-4 text-sm text-secondary">No overdue invoices.</p>}
          </Section>

          {/* Team Capacity */}
          <Section
            title={q.teamCapacity.title}
            count={hotspotCount}
            severity={hotspotCount >= 2 ? 'danger' : hotspotCount > 0 ? 'warning' : 'ok'}
          >
            {hotspotCount === 0 ? (
              <p className="px-5 py-4 text-sm text-secondary">Team capacity looks fine.</p>
            ) : q.teamCapacity.bottlenecks.map(item => <BriefRow key={item.id} item={item} />)}
          </Section>
        </div>
      )}
    </div>
  );
}
