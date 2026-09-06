'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiGet, formatMoney } from '@/lib/api-v2';
import { Select } from '@/components/ui/select';
import { usePageHeader } from '@/hooks/usePageHeader';
import { StatTile, StatRow } from '@/components/ui/stat-tile';

interface ForecastMonth {
  monthKey: string;
  monthName: string;
  inflows: {
    retainers: number;
    projects: number;
    assumedWon: number;
    /** Retainers + milestones due. Money somebody is obliged to pay. */
    committed: number;
    /** A probability times an unsigned number. Never added to the above. */
    pipelineWeighted: number;
    total: number;
  };
  outflows: { payroll: number; vendorAndDirect: number; total: number };
  /** Committed cash, less payroll and vendors. The figure the verdict uses. */
  netCashFlow: number;
  /** The same month if every weighted deal lands. Shown beside, never as. */
  netCashFlowWithPipeline: number;
  cashKeptPercent: number;
  status: 'SURPLUS' | 'DEFICIT';
  activeRetainersCount: number;
  dealsInRadarCount: number;
}

interface Summary {
  currentMrr: number;
  monthlyPayroll: number;
  activeRetainersCount: number;
  activeDealsCount: number;
}

interface Deal { id: string; companyName: string; stage: string; value: number }

export default function ForecastPage() {
  const [forecast, setForecast] = useState<ForecastMonth[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // "What if" scenario (§10: "what if per deal") — a second forecast fetch
  // with the picked proposal's pipeline contribution forced to its full
  // value, so the delta below shows exactly what that one deal is worth.
  const [scenarioDealId, setScenarioDealId] = useState('');
  const [scenarioForecast, setScenarioForecast] = useState<ForecastMonth[] | null>(null);
  const [scenarioLoading, setScenarioLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiGet<any>('/forecast/3-month');
      if (res.success) {
        setForecast(res.forecast);
        setSummary(res.summary);
        setDeals(res.deals ?? []);
      }
    } catch (e: any) {
      setError(e.message ?? 'Failed to load forecast');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!scenarioDealId) {
      setScenarioForecast(null);
      return;
    }
    let cancelled = false;
    setScenarioLoading(true);
    apiGet<any>(`/forecast/3-month?assumeWon=${scenarioDealId}`)
      .then((res) => { if (!cancelled && res.success) setScenarioForecast(res.forecast); })
      .catch(() => { if (!cancelled) setScenarioForecast(null); })
      .finally(() => { if (!cancelled) setScenarioLoading(false); });
    return () => { cancelled = true; };
  }, [scenarioDealId]);


  usePageHeader('Forecast', '3-month forward view');

  return (
    <div className="page-shell">
      {/* Summary stats */}
      {summary && (
        <StatRow className="mb-8">
          <StatTile
            label="Current MRR"
            value={formatMoney(summary.currentMrr)}
            note={`${summary.activeRetainersCount} active retainer${summary.activeRetainersCount === 1 ? '' : 's'}`}
          />
          <StatTile
            label="Monthly Payroll"
            value={formatMoney(summary.monthlyPayroll)}
            note="fixed monthly cost"
          />
          <StatTile
            label="MRR − Payroll"
            value={formatMoney(summary.currentMrr - summary.monthlyPayroll)}
            note="contribution margin"
            tone={summary.currentMrr - summary.monthlyPayroll >= 0 ? 'success' : 'danger'}
          />
          <StatTile label="Active Deals" value={summary.activeDealsCount} note="in pipeline" />
        </StatRow>
      )}

      {error && (
        <div className="border border-danger/30 bg-danger-tint rounded-xl p-5 mb-6">
          <p className="text-sm font-semibold text-danger">{error}</p>
          <p className="text-micro text-secondary mt-1">You may not have permission to view the forecast.</p>
        </div>
      )}

      {/* §10: "what if per deal" — pick one open deal and see what closing it
          would actually do to the next 3 months, instead of guessing from
          its stage-weighted sliver already baked into Pipeline (weighted). */}
      {deals.length > 0 && (
        <div className="border border-border bg-white rounded-xl p-5 mb-8">
          <p className="text-sm font-bold text-primary mb-1">What if this deal closes?</p>
          <p className="text-micro text-secondary mb-3">Treats one deal as signed — its full value moves into cash in, carrying the direct spend it would bring with it.</p>
          <div className="max-w-md">
            <Select
              value={scenarioDealId}
              onChange={setScenarioDealId}
              placeholder="Pick a deal…"
              options={[{ value: '', label: 'None — show the base forecast' }, ...deals.map((d) => ({ value: d.id, label: `${d.companyName} — ${formatMoney(d.value)} (${d.stage.replace(/_/g, ' ').toLowerCase()})` }))]}
            />
          </div>
          {scenarioDealId && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
              {(scenarioLoading || !scenarioForecast) ? (
                <p className="text-sm text-secondary sm:col-span-3">Recalculating…</p>
              ) : (
                forecast.map((m, idx) => {
                  const scenario = scenarioForecast[idx];
                  if (!scenario) return null;
                  const delta = scenario.netCashFlow - m.netCashFlow;
                  return (
                    <div key={m.monthKey} className="border border-border rounded-lg p-3.5">
                      <p className="eyebrow mb-1">{m.monthName}</p>
                      <p className="text-base font-bold text-success">+{formatMoney(delta)}</p>
                      <p className="text-micro text-secondary mt-0.5">net cash flow becomes {formatMoney(scenario.netCashFlow)}</p>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}

      {/* 3-month forecast cards */}
      {!loading && forecast.length > 0 && (
        <div className="space-y-4">
          {forecast.map((m, idx) => (
            <div key={m.monthKey} className={`border rounded-xl overflow-hidden ${m.status === 'SURPLUS' ? 'border-border' : 'border-danger/30'}`}>
              {/* Month header */}
              <div className={`flex items-center justify-between px-6 py-4 border-b border-border ${idx === 0 ? 'bg-subtle' : 'bg-white'}`}>
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-semibold text-primary">{m.monthName}</h3>
                  {idx === 0 && <span className="eyebrow px-2 py-0.5 bg-white border border-border rounded-full">Current</span>}
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <p className="eyebrow">Net Cash Flow</p>
                    <p className={`text-lg font-bold ${m.status === 'SURPLUS' ? 'text-success' : 'text-danger'}`}>
                      {m.netCashFlow >= 0 ? '+' : ''}{formatMoney(m.netCashFlow)}
                    </p>
                    {/*
                      The optimistic number is worth seeing and is not the
                      verdict. It only earns a line when the pipeline actually
                      changes the answer — otherwise it is noise repeating the
                      figure above it.
                    */}
                    {m.inflows.pipelineWeighted > 0 && (
                      <p className="text-micro text-secondary mt-0.5">
                        {formatMoney(m.netCashFlowWithPipeline)} if the pipeline lands
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="eyebrow">Cash Kept</p>
                    <p className={`text-lg font-bold ${m.cashKeptPercent >= 20 ? 'text-success' : m.cashKeptPercent >= 0 ? 'text-warning-ink' : 'text-danger'}`}>
                      {m.cashKeptPercent}%
                    </p>
                    <p className="text-micro text-secondary mt-0.5">of committed cash</p>
                  </div>
                </div>
              </div>

              {/* Breakdown */}
              <div className="grid grid-cols-2 divide-x divide-border">
                {/* Inflows */}
                <div className="px-6 py-4">
                  <p className="eyebrow mb-3">Inflows</p>
                  <div className="space-y-2">
                    {/*
                      Retainer money and one-off money stay on their own lines
                      (brief §8) and what adds them is called CASH IN, not
                      revenue — as cash arriving in one month they are the same
                      kind of number, as revenue they are not.

                      Pipeline sits BELOW that line, outside the sum. It used
                      to be inside it, which made a signed retainer and a
                      10%-likely conversation add up to one figure that then
                      decided whether the month said SURPLUS.
                    */}
                    <div className="flex justify-between">
                      <span className="text-sm text-secondary">Retainers</span>
                      <span className="text-sm font-semibold text-primary">{formatMoney(m.inflows.retainers)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-secondary">Projects (milestones due)</span>
                      <span className="text-sm font-semibold text-primary">{formatMoney(m.inflows.projects)}</span>
                    </div>
                    {m.inflows.assumedWon > 0 && (
                      <div className="flex justify-between">
                        <span className="text-sm text-secondary">Deal assumed won</span>
                        <span className="text-sm font-semibold text-primary">{formatMoney(m.inflows.assumedWon)}</span>
                      </div>
                    )}
                    <div className="flex justify-between pt-2 border-t border-border">
                      <span className="text-sm font-bold text-primary">Cash in</span>
                      <span className="text-sm font-bold text-primary">{formatMoney(m.inflows.committed)}</span>
                    </div>
                    <div className="flex justify-between pt-2">
                      <span className="text-sm text-secondary">Pipeline (weighted)</span>
                      <span className="text-sm font-semibold text-warning-ink">{formatMoney(m.inflows.pipelineWeighted)}</span>
                    </div>
                    <p className="text-micro text-secondary">Not counted above — nobody has signed it.</p>
                  </div>
                </div>

                {/* Outflows */}
                <div className="px-6 py-4">
                  <p className="eyebrow mb-3">Outflows</p>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-secondary">Payroll</span>
                      <span className="text-sm font-semibold text-primary">{formatMoney(m.outflows.payroll)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-secondary">Vendor & Direct</span>
                      <span className="text-sm font-semibold text-primary">{formatMoney(m.outflows.vendorAndDirect)}</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-border">
                      <span className="text-sm font-bold text-primary">Total</span>
                      <span className="text-sm font-bold text-primary">{formatMoney(m.outflows.total)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {loading && (
        <div className="border border-border rounded-xl py-16 text-center">
          <p className="text-sm text-secondary">Loading forecast…</p>
        </div>
      )}
    </div>
  );
}
