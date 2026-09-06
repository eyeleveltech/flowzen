'use client';

import { useState, useEffect, useCallback } from 'react';
import { TableRowsSkeleton } from '@/components/ui/skeleton-loaders';
import toast from 'react-hot-toast';
import { ApiError, api, formatMoney, type Company } from '@/lib/api-v2';
import { getInitials, getAvatarColor } from '@/lib/utils';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { FieldSelect } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';
import { usePageHeader } from '@/hooks/usePageHeader';
import { StatTile, StatRow } from '@/components/ui/stat-tile';

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
  const [confirming, setConfirming] = useState<string | null>(null);
  const [editing, setEditing] = useState<MemberAllocation | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.allocations.list(month);
      if (res.success) {
        setMembers(res.members);
        setCanSeeFigures(res.canSeeFigures);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
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

type Row = {
  key: string;
  jobTitle: string;
  workType: string;
  workId: string;
  monthCardId: string | null;
  projectId: string | null;
  percent: string;
  proposedPercent: number;
};

type JobOption = { key: string; label: string; workType: string; monthCardId?: string; projectId?: string };

function EditAllocationsModal({
  member,
  month,
  onClose,
  onSaved,
}: {
  member: MemberAllocation;
  month: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    member.allocations.map((a) => ({
      key: a.id,
      jobTitle: a.jobTitle,
      workType: a.workType,
      workId: a.workId,
      monthCardId: a.monthCardId,
      projectId: a.projectId,
      percent: String(a.percent),
      proposedPercent: a.proposedPercent,
    })),
  );
  const [adding, setAdding] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [jobOptions, setJobOptions] = useState<JobOption[]>([]);
  const [jobKey, setJobKey] = useState('');
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.companies.list().then((res) => setCompanies(res.companies)).catch(() => {});
  }, []);

  useEffect(() => {
    setJobOptions([]);
    setJobKey('');
    if (!companyId) return;
    setLoadingJobs(true);
    void api.companies
      .get(companyId)
      .then((res) => {
        const company = (res as { company?: any }).company ?? res;
        const options: JobOption[] = [];
        for (const r of company.retainers ?? []) {
          if (r.status !== 'ACTIVE') continue;
          for (const mc of r.monthCards ?? []) {
            if (mc.month !== month) continue;
            options.push({ key: `m:${mc.id}`, label: `${company.name} — Retainer ${mc.month}`, workType: 'MONTH_CARD', monthCardId: mc.id });
          }
        }
        for (const p of company.projects ?? []) {
          if (p.status !== 'LIVE') continue;
          options.push({ key: `p:${p.id}`, label: `${company.name} — ${p.name}`, workType: 'PROJECT', projectId: p.id });
        }
        setJobOptions(options);
      })
      .catch(() => {})
      .finally(() => setLoadingJobs(false));
  }, [companyId, month]);

  const total = rows.reduce((s, r) => s + (Number(r.percent) || 0), 0);

  const updatePercent = (key: string, percent: string) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, percent } : r)));

  const removeRow = (key: string) => setRows((prev) => prev.filter((r) => r.key !== key));

  const confirmAddRow = () => {
    const job = jobOptions.find((j) => j.key === jobKey);
    if (!job) return;
    const workId = job.monthCardId ?? job.projectId!;
    if (rows.some((r) => r.workId === workId)) {
      setAdding(false);
      return;
    }
    setRows((prev) => [
      ...prev,
      {
        key: `new:${workId}`,
        jobTitle: job.label,
        workType: job.workType,
        workId,
        monthCardId: job.monthCardId ?? null,
        projectId: job.projectId ?? null,
        percent: '0',
        proposedPercent: 0,
      },
    ]);
    setAdding(false);
    setCompanyId('');
    setJobKey('');
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.allocations.bulkSave({
        userId: member.id,
        month,
        allocations: rows
          .filter((r) => Number(r.percent) > 0)
          .map((r) => ({
            workType: r.workType,
            workId: r.workId,
            monthCardId: r.monthCardId,
            projectId: r.projectId,
            percent: Number(r.percent),
            proposedPercent: r.proposedPercent,
          })),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this split');
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Time split — ${member.name}`} description={new Date(month + '-01').toLocaleString('en-IN', { month: 'long', year: 'numeric' })}>
      <ModalBody className="space-y-3">
        {rows.length === 0 && !adding && (
          <p className="text-sm text-secondary">No work items yet. Add one below.</p>
        )}
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-3 rounded-xl border border-border p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-body">{r.jobTitle}</p>
              {r.proposedPercent > 0 && Number(r.percent) !== r.proposedPercent && (
                <p className="text-xs text-secondary">Proposed {r.proposedPercent}%</p>
              )}
            </div>
            <input
              type="number"
              min={0}
              max={100}
              aria-label={`Percent of the month on ${r.jobTitle}`}
              value={r.percent}
              onChange={(e) => updatePercent(r.key, e.target.value)}
              className="w-20 rounded-lg border border-border px-2 py-1.5 text-sm text-right outline-none focus-visible:border-primary"
            />
            <span className="text-sm text-secondary">%</span>
            <button type="button" onClick={() => removeRow(r.key)} className="text-secondary hover:text-danger">
              ✕
            </button>
          </div>
        ))}

        {adding ? (
          <div className="space-y-3 rounded-xl border border-dashed border-border p-3">
            <FieldSelect
              label="Company"
              value={companyId}
              onChange={setCompanyId}
              placeholder="Choose a company…"
              options={companies.map((c) => ({ value: c.id, label: c.name }))}
            />
            <FieldSelect
              label="Work item"
              value={jobKey}
              onChange={setJobKey}
              disabled={!companyId || loadingJobs}
              placeholder={!companyId ? 'Choose a company first' : loadingJobs ? 'Loading…' : jobOptions.length === 0 ? `Nothing live for ${month}` : 'Choose…'}
              options={jobOptions.map((j) => ({ value: j.key, label: j.label }))}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
              <Button type="button" variant="primary" size="sm" onClick={confirmAddRow} disabled={!jobKey}>Add</Button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="text-sm font-medium text-primary hover:underline">
            + Add work item
          </button>
        )}

        <p className={`text-sm font-medium ${total === 100 ? 'text-secondary' : 'text-warning-ink'}`}>
          {total}% allocated {total !== 100 ? '— usually adds up to 100%' : ''}
        </p>

        {error && <ErrorNote>{error}</ErrorNote>}
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button type="button" variant="primary" loading={saving} onClick={() => void save()}>Save</Button>
      </ModalFooter>
    </Modal>
  );
}
