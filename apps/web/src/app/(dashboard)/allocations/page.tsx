'use client';

import { useState, useEffect, useCallback } from 'react';
import { TableRowsSkeleton } from '@/components/ui/skeleton-loaders';
import toast from 'react-hot-toast';
import { api, formatMoney } from '@/lib/api-v2';
import { getInitials, getAvatarColor } from '@/lib/utils';
import { LoadError } from '@/components/ui/empty-state';
import { usePageHeader } from '@/hooks/usePageHeader';
import { StatTile, StatRow } from '@/components/ui/stat-tile';
import { EditAllocationsModal } from '@/components/work/EditAllocationsModal';

interface Allocation {
  id: string;
  workType: string;
  workId: string;
  monthCardId: string | null;
  projectId: string | null;
  percent: number;
  proposedPercent: number;
  confirmedAt?: string | null;
  confirmedBy?: { name: string } | null;
  jobTitle: string;
}

interface MemberAllocation {
  id: string;
  name: string;
  dept?: string | null;
  monthlyCost?: number | null;
  totalPercent: number;
  isConfirmed: boolean;
  allocations: Allocation[];
}

export default function AllocationsPage() {
  const [members, setMembers] = useState<MemberAllocation[]>([]);
  /** Whether this person may see money at all — the API decides, not the shape of the data. */
  const [canSeeFigures, setCanSeeFigures] = useState(false);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [loading, setLoading] = useState(true);
  // A failed load, said on the page — it only reached the console, and the
  // screen then showed an empty month as if nobody had a split.
  const [loadError, setLoadError] = useState<unknown>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [editing, setEditing] = useState<MemberAllocation | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.allocations.list(month);
      if (res.success) {
        setMembers(res.members);
        setCanSeeFigures(res.canSeeFigures);
      }
    } catch (e) {
      setLoadError(e);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const confirmAllocation = async (memberId: string) => {
    setConfirming(memberId);
    try {
      await api.allocations.confirm(month, [memberId]);
      await load();
    } catch (e) {
      // A failed action used to log to the console and stop. The
      // button simply did nothing, so the natural response was to
      // press it again.
      toast.error(e instanceof Error ? e.message : 'Could not confirm that split');
    }
    finally { setConfirming(null); }
  };


  // The API says whether this person may see money at all. Summing
  // `monthlyCost ?? 0` over a masked list printed "Total Payroll ₹0" to a Head
  // — a figure they are not allowed to see, and the wrong one.
  const totalCost = members.reduce((s, m) => s + (m.monthlyCost ?? 0), 0);
  const confirmed = members.filter(m => m.isConfirmed).length;

  const prevMonth = () => {
    const d = new Date(month + '-01');
    d.setMonth(d.getMonth() - 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const nextMonth = () => {
    const d = new Date(month + '-01');
    d.setMonth(d.getMonth() + 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const monthLabel = new Date(month + '-01').toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  usePageHeader('Time split', `${confirmed}/${members.length} confirmed`);

  return (
    <div className="page-shell">
      <div className="flex flex-wrap items-center justify-end gap-2 mb-8">
        <button onClick={prevMonth} className="border border-border rounded-lg w-8 h-8 flex items-center justify-center text-secondary hover:bg-subtle">‹</button>
        <span className="text-sm font-semibold text-primary w-36 text-center">{monthLabel}</span>
        <button onClick={nextMonth} className="border border-border rounded-lg w-8 h-8 flex items-center justify-center text-secondary hover:bg-subtle">›</button>
      </div>

      {loadError ? <LoadError what={`the time split for ${monthLabel}`} error={loadError} onRetry={() => void load()} className="mb-6" /> : null}

      <StatRow className="mb-8 sm:grid-cols-3 lg:grid-cols-3">
        <StatTile label="People" value={members.length} note={`${confirmed} confirmed this month`} />
        {canSeeFigures && (
          <StatTile label="Total Payroll" value={formatMoney(totalCost)} note="to be allocated" />
        )}
        <StatTile
          label="Pending Confirmation"
          value={members.length - confirmed}
          note="need head sign-off"
          tone={members.length - confirmed > 0 ? 'warning' : 'success'}
        />
      </StatRow>

      <div className="border border-border rounded-xl p-4 mb-6 bg-white">
        <p className="text-sm font-semibold text-primary mb-0.5">Proposed from completed work, not typed from scratch</p>
        <p className="text-sm text-secondary">
          From the 25th, each person&apos;s split is proposed automatically from that month&apos;s completed tasks. Review, adjust if it&apos;s wrong, then confirm.
        </p>
      </div>

      <div className="border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full data-table">
          <thead>
            <tr className="border-b border-border">
              <th className="eyebrow text-left">Person</th>
              <th className="eyebrow text-left">Allocated to</th>
              <th className="eyebrow text-center">Total %</th>
              {canSeeFigures && (
                <th className="eyebrow text-right">Monthly Cost</th>
              )}
              <th className="eyebrow text-left">Status</th>
              <th className=""></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <TableRowsSkeleton cols={canSeeFigures ? 6 : 5} />
            ) : members.length === 0 ? (
              <tr><td colSpan={canSeeFigures ? 6 : 5} className="px-5 py-16 text-center text-sm text-secondary">No team members found.</td></tr>
            ) : members.map(m => (
              <tr key={m.id} className="hover:bg-subtle transition-colors">
                <td className="">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-micro font-bold ${getAvatarColor(m.name)}`}>
                      {getInitials(m.name)}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-primary">{m.name}</p>
                      <p className="text-micro text-secondary">{m.dept ?? '—'}</p>
                    </div>
                  </div>
                </td>
                <td className="">
                  <div className="flex flex-wrap gap-1">
                    {m.allocations.length === 0 ? (
                      <span className="text-micro text-secondary italic">No allocations</span>
                    ) : m.allocations.map(a => (
                      <span key={a.id} className="text-micro bg-subtle border border-border px-2 py-0.5 rounded font-medium text-body" title={a.percent !== a.proposedPercent ? `Proposed ${a.proposedPercent}%` : undefined}>
                        {a.jobTitle} ({a.percent}%)
                      </span>
                    ))}
                  </div>
                </td>
                <td className="text-center">
                  <span className={`text-sm font-bold ${m.totalPercent > 100 ? 'text-danger' : m.totalPercent === 100 ? 'text-success' : 'text-warning-ink'}`}>
                    {m.totalPercent}%
                  </span>
                </td>
                {canSeeFigures && (
                  <td className="text-right font-semibold text-primary">
                    {m.monthlyCost ? formatMoney(m.monthlyCost) : '—'}
                  </td>
                )}
                <td className="">
                  {m.isConfirmed ? (
                    <span className="text-micro font-medium px-2 py-0.5 rounded border border-success/30 text-success bg-success-tint">Confirmed</span>
                  ) : (
                    <span className="text-micro font-medium px-2 py-0.5 rounded border border-warning/40 text-warning-ink bg-warning-tint">Pending</span>
                  )}
                </td>
                <td className="">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setEditing(m)}
                      className="border border-border text-xs font-medium text-body px-3 py-1.5 rounded-lg hover:bg-subtle transition-colors"
                    >
                      Edit
                    </button>
                    {!m.isConfirmed && m.allocations.length > 0 && (
                      <button
                        onClick={() => confirmAllocation(m.id)}
                        disabled={confirming === m.id}
                        className="border border-border text-xs font-medium text-body px-3 py-1.5 rounded-lg hover:bg-subtle transition-colors disabled:opacity-50"
                      >
                        {confirming === m.id ? 'Confirming…' : 'Confirm'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {editing && (
        <EditAllocationsModal
          member={editing}
          month={month}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      )}
    </div>
  );
}
