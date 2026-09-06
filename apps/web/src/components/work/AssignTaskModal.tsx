'use client';

/** Quickly handing a specific person a task, from the Team screen — the assignee isn't a field, it's why this opened. */

import { useEffect, useState } from 'react';
import { api, ApiError, type Company } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';
import { PRIORITY_CONFIG } from '@/lib/priority';
import { personOptions } from '@/lib/people';
import { useAuthStore } from '@/stores';

const PRIORITY_OPTIONS = Object.entries(PRIORITY_CONFIG).map(([value, cfg]) => ({ value, label: cfg.label }));

type Target = { label: string; workType: 'RETAINER' | 'PROJECT'; monthCardId?: string; projectId?: string };

export function AssignTaskModal({
  person,
  onClose,
  onCreated,
}: {
  person: { id: string; name: string };
  onClose: () => void;
  onCreated: () => void;
}) {
  const me = useAuthStore((s) => s.user);
  const [title, setTitle] = useState('');
  const [assignedById, setAssignedById] = useState('');
  const [team, setTeam] = useState<{ id: string; name: string; designation: string | null; dept: string }[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<'INTERNAL' | 'CLIENT'>('INTERNAL');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [targets, setTargets] = useState<Target[]>([]);
  const [targetKey, setTargetKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAssignedById(me?.id ?? '');
    api.team.members().then((r) => setTeam(r.members ?? [])).catch(() => setTeam([]));
  }, [me?.id]);

  useEffect(() => {
    if (scope !== 'CLIENT') return;
    void api.companies.list().then((res) => setCompanies(res.companies)).catch(() => {});
  }, [scope]);

  useEffect(() => {
    setTargets([]);
    setTargetKey('');
    if (scope !== 'CLIENT' || !companyId) return;
    setLoadingTargets(true);
    void api.companies
      .get(companyId)
      .then((res) => {
        const company = (res as { company?: any }).company ?? res;
        const list: Target[] = [];
        for (const r of company.retainers ?? []) {
          if (r.status !== 'ACTIVE') continue;
          const currentMonth = (r.monthCards ?? [])[0];
          if (currentMonth) list.push({ label: `Retainer — ${currentMonth.month}`, workType: 'RETAINER', monthCardId: currentMonth.id });
        }
        for (const p of company.projects ?? []) {
          if (p.status !== 'LIVE') continue;
          list.push({ label: `Project — ${p.name}`, workType: 'PROJECT', projectId: p.id });
        }
        setTargets(list);
      })
      .catch(() => {})
      .finally(() => setLoadingTargets(false));
  }, [companyId, scope]);

  const selectedTarget = targets.find((t) => (t.monthCardId ?? t.projectId) === targetKey);
  const canSave = Boolean(title.trim()) && Boolean(dueDate) && (scope === 'INTERNAL' || Boolean(selectedTarget));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await api.tasks.create({
        title: title.trim(),
        dueDate,
        assigneeId: person.id,
        workType: scope === 'INTERNAL' ? 'INTERNAL' : selectedTarget?.workType === 'RETAINER' ? 'MONTH_CARD' : 'PROJECT',
        monthCardId: scope === 'CLIENT' ? selectedTarget?.monthCardId : undefined,
        projectId: scope === 'CLIENT' ? selectedTarget?.projectId : undefined,
        priority,
        assignedById: assignedById || undefined,
        notes: description.trim() || undefined,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not assign that task');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Assign to ${person.name}`}>
      <form onSubmit={submit}>
        <ModalBody className="space-y-4">
          <Field label="What needs doing?" value={title} onChange={setTitle} required />

          <FieldSelect
            label="Belongs to"
            value={scope}
            onChange={(v) => setScope(v as 'INTERNAL' | 'CLIENT')}
            required
            options={[
              { value: 'INTERNAL', label: 'Internal — no client' },
              { value: 'CLIENT', label: 'A client’s work' },
            ]}
          />

          {scope === 'CLIENT' && (
            <>
              <FieldSelect
                label="Company"
                value={companyId}
                onChange={setCompanyId}
                required
                placeholder="Choose a company…"
                options={companies.map((c) => ({ value: c.id, label: c.name }))}
              />
              <FieldSelect
                label="Which job"
                value={targetKey}
                onChange={setTargetKey}
                required
                disabled={!companyId || loadingTargets}
                placeholder={!companyId ? 'Choose a company first' : loadingTargets ? 'Loading…' : targets.length === 0 ? 'Nothing live' : 'Choose…'}
                options={targets.map((t) => ({ value: (t.monthCardId ?? t.projectId)!, label: t.label }))}
              />
            </>
          )}

          {/* Who wanted it done. The assignee is why this modal opened, so
              this is the only person still to name. */}
          <FieldSelect
            label="Assigned by"
            value={assignedById}
            onChange={setAssignedById}
            placeholder="Nobody in particular"
            options={personOptions(team)}
          />

          <div className="grid grid-cols-2 gap-4">
            <Field label="Due date" type="date" value={dueDate} onChange={setDueDate} required />
            <FieldSelect label="Priority" value={priority} onChange={setPriority} options={PRIORITY_OPTIONS} />
          </div>
          <Field label="Description" value={description} onChange={setDescription} textarea rows={3} />
          {error && <ErrorNote>{error}</ErrorNote>}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!canSave}>
            Assign task
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
