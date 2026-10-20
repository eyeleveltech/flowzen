'use client';

/**
 * Editing one person's time split for a month — percentages of their month on
 * each piece of work, never money. The Time split page and My Department's
 * Time split tab both use it; the server refuses a person outside a Head's
 * departments and any change to a closed month.
 */

import { useEffect, useMemo, useState } from 'react';
import { ApiError, api, type Company } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { FieldSelect } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';

/** A company as the task form's targets name it. */
type TargetCompany = { id: string; name: string; jobs: { key: string; label: string; workType: string; monthCardId?: string; projectId?: string }[] };

/** What a company's record carries that the editor reads. */
type CompanyRecord = {
  name: string;
  retainers?: { status: string; monthCards?: { id: string; month: string }[] }[];
  projects?: { id: string; name: string; status: string }[];
};

/** What the editor needs of a person's split. */
export type EditableMember = {
  id: string;
  name: string;
  allocations: {
    id: string;
    workType: string;
    workId: string;
    monthCardId: string | null;
    projectId: string | null;
    percent: number;
    proposedPercent: number;
    jobTitle: string;
  }[];
};

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

export function EditAllocationsModal({
  member,
  month,
  jobsFrom = 'companies',
  onClose,
  onSaved,
}: {
  member: EditableMember;
  month: string;
  /**
   * Where "Add work item" finds work. `companies` reads the client book
   * (company.read) and works for any month. `targets` reads the names a task
   * form offers (work.own) — this month's retainer cards and live projects —
   * which is what a department head can read: Heads hold no company.read.
   */
  jobsFrom?: 'companies' | 'targets';
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
  /** A company's live work, read from its record — the `companies` source. */
  const [companyJobs, setCompanyJobs] = useState<JobOption[]>([]);
  const [jobKey, setJobKey] = useState('');
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The task form's targets, when that is where work comes from: names only, this month only. */
  const [targets, setTargets] = useState<TargetCompany[]>([]);

  useEffect(() => {
    if (jobsFrom === 'targets') {
      void api.tasks
        .targets()
        .then((res) => {
          const list = (res?.companies ?? []) as TargetCompany[];
          setTargets(list);
          setCompanies(list.map((c) => ({ id: c.id, name: c.name })) as Company[]);
        })
        .catch(() => {});
      return;
    }
    void api.companies.list().then((res) => setCompanies(res.companies)).catch(() => {});
  }, [jobsFrom]);

  // From the targets: one row per retainer month card — the split is by month card — and each live project.
  const targetJobs = useMemo(() => {
    const company = targets.find((c) => c.id === companyId);
    if (!company) return [];
    const seen = new Set<string>();
    const options: JobOption[] = [];
    for (const j of company.jobs) {
      if (j.workType === 'RETAINER' && j.monthCardId && !seen.has(j.monthCardId)) {
        seen.add(j.monthCardId);
        options.push({ key: `m:${j.monthCardId}`, label: `${company.name} — Retainer ${month}`, workType: 'MONTH_CARD', monthCardId: j.monthCardId });
      } else if (j.workType === 'PROJECT' && j.projectId) {
        options.push({ key: `p:${j.projectId}`, label: `${company.name} — ${j.label.replace(/^(Project|Sample) — /, '')}`, workType: 'PROJECT', projectId: j.projectId });
      }
    }
    return options;
  }, [targets, companyId, month]);
  const jobOptions = jobsFrom === 'targets' ? targetJobs : companyJobs;

  /** A new company picked: its work is fetched afresh, and nothing stays chosen from the last one. */
  const chooseCompany = (id: string) => {
    setCompanyId(id);
    setJobKey('');
    setCompanyJobs([]);
    setLoadingJobs(jobsFrom === 'companies' && Boolean(id));
  };

  useEffect(() => {
    if (jobsFrom !== 'companies' || !companyId) return;
    void api.companies
      .get(companyId)
      .then((res) => {
        const company = ((res as { company?: CompanyRecord }).company ?? res) as CompanyRecord;
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
        setCompanyJobs(options);
      })
      .catch(() => {})
      .finally(() => setLoadingJobs(false));
  }, [companyId, month, jobsFrom]);

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
              onChange={chooseCompany}
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
