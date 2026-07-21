'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { X, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { getSSE } from '@/lib/sse';
import { formatCurrency, formatDate, getInitials, getAvatarColor } from '@/lib/utils';
import toast from 'react-hot-toast';

const STATUSES = ['UPCOMING', 'IN_DISCUSSION', 'RENEWED', 'AT_RISK', 'CHURNED'] as const;
const STATUS_BADGE: Record<string, string> = {
  UPCOMING: 'bg-blue-50 text-blue-700 border-blue-200',
  IN_DISCUSSION: 'bg-amber-50 text-amber-700 border-amber-200',
  RENEWED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  AT_RISK: 'bg-red-50 text-red-700 border-red-200',
  CHURNED: 'bg-gray-100 text-gray-600 border-gray-200',
};
const fmtDate = formatDate;
const daysTo = (end: any) => (end ? Math.ceil((new Date(end).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000) : null);
const name = (l: any) => l.companyName || l.contactName || 'Client';

export default function RenewalsPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [editing, setEditing] = useState<any>(null);

  const { data: rows = [], isLoading } = useQuery({ queryKey: ['renewals'], queryFn: () => api.get<any[]>('/crm/renewals') });
  const { data: summary } = useQuery({ queryKey: ['renewals', 'summary'], queryFn: () => api.get<any>('/crm/renewals/summary') });

  // Keep the tracker live when leads change elsewhere (stage moves, renewal edits).
  useEffect(() => {
    const sse = getSSE();
    if (!sse) return;
    const h = () => qc.invalidateQueries({ queryKey: ['renewals'] });
    sse.on('lead:updated', h);
    return () => sse.off('lead:updated', h);
  }, [qc]);

  const filtered = useMemo(() => (statusFilter ? rows.filter((r) => r.renewalStatus === statusFilter) : rows), [rows, statusFilter]);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-primary tracking-tight flex items-center gap-2"><RefreshCw className="w-5 h-5 text-secondary" /> Renewal Tracker</h1>
        <p className="text-sm text-secondary mt-1">Retainer contracts and when they come up for renewal.</p>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-border p-5">
          <p className="text-xs font-medium text-secondary uppercase tracking-wider">Active Retainer MRR</p>
          <p className="text-2xl font-bold text-primary mt-1">{formatCurrency(summary?.totalMrr || 0)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-border p-5">
          <p className="text-xs font-medium text-secondary uppercase tracking-wider">Renewals due (30 days)</p>
          <p className="text-2xl font-bold text-primary mt-1">{summary?.due30?.count || 0} <span className="text-sm font-medium text-secondary">· {formatCurrency(summary?.due30?.value || 0)}</span></p>
        </div>
        <div className="bg-white rounded-2xl border border-border p-5">
          <p className="text-xs font-medium text-secondary uppercase tracking-wider">At risk</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{summary?.atRisk?.count || 0} <span className="text-sm font-medium text-secondary">· {formatCurrency(summary?.atRisk?.value || 0)}</span></p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setStatusFilter('')} className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${!statusFilter ? 'bg-primary text-white border-primary' : 'bg-white text-secondary border-border hover:text-primary'}`}>All</button>
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${statusFilter === s ? 'bg-primary text-white border-primary' : 'bg-white text-secondary border-border hover:text-primary'}`}>{s.replace(/_/g, ' ')}</button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-230">
            <thead><tr className="text-left text-[11px] uppercase tracking-wider text-secondary border-b border-border bg-gray-50/50">
              <th className="px-4 py-3">Company</th><th className="px-4 py-3 text-right">Monthly Value</th><th className="px-4 py-3">Contract Start</th>
              <th className="px-4 py-3">Contract End</th><th className="px-4 py-3 text-right">Days to Renewal</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Salesperson</th><th className="px-4 py-3"></th>
            </tr></thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto" /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-secondary">No retainer contracts{statusFilter ? ' in this status' : ''} yet.</td></tr>
              ) : filtered.map((r) => {
                const d = daysTo(r.contractEndDate);
                return (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/40">
                    <td className="px-4 py-3"><Link href={`/pipeline/${r.id}`} className="font-medium text-primary hover:underline">{name(r)}</Link>{r.autoRenewal && <span className="ml-2 text-[10px] font-semibold text-emerald-600">AUTO</span>}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.dealValue ? formatCurrency(r.dealValue) : '—'}</td>
                    <td className="px-4 py-3 text-secondary">{fmtDate(r.contractStartDate)}</td>
                    <td className="px-4 py-3 text-secondary">{fmtDate(r.contractEndDate)}</td>
                    <td className={`px-4 py-3 text-right font-medium tabular-nums ${d != null && d <= 7 ? 'text-red-600' : d != null && d <= 30 ? 'text-amber-600' : 'text-primary'}`}>{d == null ? '—' : d < 0 ? `${Math.abs(d)}d overdue` : `${d}d`}</td>
                    <td className="px-4 py-3">{r.renewalStatus ? <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border ${STATUS_BADGE[r.renewalStatus] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>{r.renewalStatus.replace(/_/g, ' ')}</span> : <span className="text-secondary">—</span>}</td>
                    <td className="px-4 py-3">{r.assignedTo ? <span className="flex items-center gap-1.5"><span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${getAvatarColor(r.assignedTo.name)}`}>{getInitials(r.assignedTo.name)}</span><span className="text-secondary">{r.assignedTo.name}</span></span> : <span className="text-secondary">—</span>}</td>
                    <td className="px-4 py-3 text-right"><button onClick={() => setEditing(r)} className="text-xs font-medium text-primary border border-border rounded-lg px-3 py-1.5 hover:bg-gray-50">Update</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {editing && <RenewalModal lead={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['renewals'] }); }} />}
      </AnimatePresence>
    </div>
  );
}

const inputCls = 'w-full rounded-xl border border-border bg-gray-50 px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:bg-white transition-all';
const labelCls = 'block text-[11px] font-semibold text-secondary uppercase tracking-wider mb-1.5';
const toDateInput = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : '');

function RenewalModal({ lead, onClose, onSaved }: { lead: any; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<any>({
    renewalStatus: lead.renewalStatus || 'UPCOMING', autoRenewal: !!lead.autoRenewal,
    contractStartDate: toDateInput(lead.contractStartDate), contractEndDate: toDateInput(lead.contractEndDate),
    nextRenewalDate: toDateInput(lead.nextRenewalDate), renewalNotes: lead.renewalNotes || '',
  });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: () => api.patch(`/crm/leads/${lead.id}/renewal`, form),
    onSuccess: () => { toast.success('Renewal updated'); onSaved(); },
    onError: (e: any) => toast.error(e?.message || 'Failed to update'),
  });

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-100 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="fixed right-0 top-0 bottom-0 z-101 w-full max-w-md bg-white border-l border-border shadow-2xl overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white z-10">
          <h2 className="text-lg font-semibold text-primary">Update Renewal</h2>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100"><X className="h-4 w-4 text-secondary" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div><label className={labelCls}>Renewal Status</label>
            <select className={inputCls} value={form.renewalStatus} onChange={(e) => set('renewalStatus', e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={labelCls}>Contract Start</label><input type="date" className={inputCls} value={form.contractStartDate} onChange={(e) => set('contractStartDate', e.target.value)} /></div>
            <div><label className={labelCls}>Contract End</label><input type="date" className={inputCls} value={form.contractEndDate} onChange={(e) => set('contractEndDate', e.target.value)} /></div>
          </div>
          <div><label className={labelCls}>Next Renewal Conversation</label><input type="date" className={inputCls} value={form.nextRenewalDate} onChange={(e) => set('nextRenewalDate', e.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm text-primary"><input type="checkbox" checked={form.autoRenewal} onChange={(e) => set('autoRenewal', e.target.checked)} /> Auto-renew (no alerts; extends automatically)</label>
          <div><label className={labelCls}>Renewal Notes</label><textarea rows={3} className={inputCls} value={form.renewalNotes} onChange={(e) => set('renewalNotes', e.target.value)} /></div>
        </div>
        <div className="p-5 border-t border-border bg-white flex justify-end gap-3 sticky bottom-0">
          <button onClick={onClose} className="px-5 py-2.5 text-sm font-medium text-gray-700 bg-white border border-border rounded-xl hover:bg-gray-50">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="px-5 py-2.5 text-sm font-medium text-white bg-primary rounded-xl hover:bg-gray-800 disabled:opacity-50">{mutation.isPending ? 'Saving…' : 'Save'}</button>
        </div>
      </motion.div>
    </>
  );
}
