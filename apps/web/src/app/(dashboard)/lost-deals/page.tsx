'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend } from 'recharts';
import { TrendingDown, Download } from 'lucide-react';
import { api } from '@/lib/api';
import { getSSE } from '@/lib/sse';
import { formatCurrency } from '@/lib/utils';
import { format } from 'date-fns';

const COLORS = ['#163027', '#2f6b53', '#5a9e7f', '#9ccdb4', '#cfe8db', '#E2FEA5'];
const fmtDate = (d: any) => (d ? format(new Date(d), 'dd MMM yyyy') : '—');
const label = (s: string) => (s || '—').replace(/_/g, ' ');

export default function LostDealsPage() {
  const qc = useQueryClient();
  const [range, setRange] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const qs = new URLSearchParams(Object.entries(range).filter(([, v]) => v)).toString();

  const { data, isLoading } = useQuery({
    queryKey: ['lost-deals', range],
    queryFn: () => api.get<any>(`/analytics/lost-deals${qs ? `?${qs}` : ''}`),
  });

  // Refresh when a deal is churned/changed elsewhere.
  useEffect(() => {
    const sse = getSSE();
    if (!sse) return;
    const h = () => qc.invalidateQueries({ queryKey: ['lost-deals'] });
    sse.on('lead:updated', h);
    return () => sse.off('lead:updated', h);
  }, [qc]);

  const exportCsv = () => {
    if (!data) return;
    // Quote any field containing a comma, quote, or newline (RFC-4180) so values can't shift columns.
    const esc = (v: any) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines: any[][] = [['Section', 'Key', 'Count', 'Value']];
    data.lossByReason.forEach((r: any) => lines.push(['Reason', label(r.reason), r.count, '']));
    data.lossByStage.forEach((r: any) => lines.push(['Stage', label(r.stage), r.count, r.avgValue]));
    data.competitors.forEach((r: any) => lines.push(['Competitor', r.competitor, r.count, r.avgValue]));
    const csv = lines.map((r) => r.map(esc).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lost-deals.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-primary tracking-tight flex items-center gap-2"><TrendingDown className="w-5 h-5 text-secondary" /> Lost Deal Analysis</h1>
          <p className="text-sm text-secondary mt-1">Where and why deals are being lost{data ? ` · ${data.total} churned` : ''}.</p>
        </div>
        <div className="flex items-end gap-2">
          <div><label className="block text-[10px] font-semibold text-secondary uppercase mb-1">From</label><input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className="rounded-lg border border-border bg-gray-50 px-3 py-1.5 text-sm" /></div>
          <div><label className="block text-[10px] font-semibold text-secondary uppercase mb-1">To</label><input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="rounded-lg border border-border bg-gray-50 px-3 py-1.5 text-sm" /></div>
          <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-secondary border border-border rounded-lg hover:text-primary"><Download className="w-4 h-4" /> CSV</button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-20 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
      ) : !data || data.total === 0 ? (
        <div className="bg-white rounded-2xl border border-border p-12 text-center text-secondary">No churned deals in this range.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Section 1 — Loss by reason */}
          <div className="bg-white rounded-2xl border border-border p-5">
            <h2 className="text-sm font-semibold text-primary mb-4">Loss by Reason</h2>
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="50%" height={200}>
                <PieChart>
                  <Pie data={data.lossByReason} dataKey="count" nameKey="reason" innerRadius={45} outerRadius={75}>
                    {data.lossByReason.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1.5">
                {data.lossByReason.map((r: any, i: number) => (
                  <div key={r.reason} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-[#374151]"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} /> {label(r.reason)}</span>
                    <span className="text-secondary">{r.count} · {r.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Section 2 — Loss by stage */}
          <div className="bg-white rounded-2xl border border-border p-5">
            <h2 className="text-sm font-semibold text-primary mb-4">Loss by Stage</h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.lossByStage} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#6B7280' }} />
                <YAxis type="category" dataKey="stage" tickFormatter={label} tick={{ fontSize: 11, fill: '#6B7280' }} width={90} />
                <Tooltip formatter={(v: any, n: any) => (n === 'avgValue' ? formatCurrency(v) : v)} />
                <Bar dataKey="count" fill="#163027" radius={[0, 4, 4, 0]} name="Count" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Section 3 — Competitors */}
          <div className="bg-white rounded-2xl border border-border p-5">
            <h2 className="text-sm font-semibold text-primary mb-4">Competitor Tracker</h2>
            {data.competitors.length === 0 ? <p className="text-sm text-secondary py-6 text-center">No competitors recorded.</p> : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase text-secondary border-b border-border"><th className="py-2">Competitor</th><th className="py-2 text-right">Times</th><th className="py-2 text-right">Avg Lost</th><th className="py-2">Verticals</th></tr></thead>
                <tbody>{data.competitors.map((c: any) => (
                  <tr key={c.competitor} className="border-b border-gray-50"><td className="py-2 font-medium text-primary">{c.competitor}</td><td className="py-2 text-right">{c.count}</td><td className="py-2 text-right">{formatCurrency(c.avgValue)}</td><td className="py-2 text-secondary text-xs">{c.verticals.join(', ') || '—'}</td></tr>
                ))}</tbody>
              </table>
            )}
          </div>

          {/* Section 5 — Loss over time */}
          <div className="bg-white rounded-2xl border border-border p-5">
            <h2 className="text-sm font-semibold text-primary mb-4">Won vs Lost Over Time</h2>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.lossOverTime}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6B7280' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} />
                <Tooltip /><Legend />
                <Line type="monotone" dataKey="won" stroke="#2f6b53" strokeWidth={2} name="Won" />
                <Line type="monotone" dataKey="lost" stroke="#dc2626" strokeWidth={2} name="Lost" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Section 4 — Reactivation pipeline */}
          <div className="bg-white rounded-2xl border border-border p-5 lg:col-span-2">
            <h2 className="text-sm font-semibold text-primary mb-4">Reactivation Pipeline</h2>
            {data.reactivation.length === 0 ? <p className="text-sm text-secondary py-6 text-center">No leads flagged for reactivation.</p> : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase text-secondary border-b border-border"><th className="py-2">Client</th><th className="py-2">Lost Date</th><th className="py-2">Reactivation Window</th><th className="py-2 text-right">Value</th><th className="py-2">Assigned To</th></tr></thead>
                <tbody>{data.reactivation.map((r: any) => (
                  <tr key={r.id} className="border-b border-gray-50"><td className="py-2 font-medium text-primary">{r.name}</td><td className="py-2 text-secondary">{fmtDate(r.lostDate)}</td><td className="py-2 text-amber-700 font-medium">{fmtDate(r.window)}</td><td className="py-2 text-right">{formatCurrency(r.value)}</td><td className="py-2 text-secondary">{r.assignedTo || '—'}</td></tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
