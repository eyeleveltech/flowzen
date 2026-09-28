'use client';

/** Quickly handing a specific person a task, from the Team screen — the assignee isn't a field, it's why this opened. */

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api-v2';
import { useTeamMembers } from '@/hooks/queries';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';
import { PRIORITY_CONFIG } from '@/lib/priority';
import { personOptions } from '@/lib/people';
import { useAuthStore } from '@/stores';

const PRIORITY_OPTIONS = Object.entries(PRIORITY_CONFIG).map(([value, cfg]) => ({ value, label: cfg.label }));

/**
 * One thing a task can be filed against.
 *
 * A retainer option is a piece of work INSIDE the retainer, not the retainer's
 * month — see the note in the loader below. `key` is what the dropdown stores,
 * and it is the retainer project or the one-time project, both unique.
 */
type Target = {
  key: string;
  label: string;
  workType: 'RETAINER' | 'PROJECT';
  monthCardId?: string;
  retainerProjectId?: string;
  projectId?: string;
  /** Which month a retainer option bills into, for the line under the field. */
  month?: string;
};

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
  const team = useTeamMembers();
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<'INTERNAL' | 'CLIENT'>('INTERNAL');
  const [companyId, setCompanyId] = useState('');
  const [targetKey, setTargetKey] = useState('');
  /*
   * Which piece of the studio's own work, when this is not a client's.
   *
   * Optional on purpose. A retainer task must name a project because the
   * database insists; most internal work genuinely belongs to nothing —
   * "Office Wi-Fi vendor renewal" is not a programme — and forcing a bucket on
   * it would only breed empty ones.
   */
  const [internalProjectId, setInternalProjectId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Nobody, until somebody says otherwise — see tasks.ts on why this
    // field means nothing when it is filled in by default.
    setAssignedById('');
  }, [me?.id]);

  /*
   * One request for everything this form can offer.
   *
   * It used to be three — the company list, a whole company detail payload per
   * pick, and the internal projects — across two permissions nobody but
   * Management holds: `company.read` opens the client book, `work.all` is Head
   * and Management. So an EMPLOYEE (who holds `work.own` and nothing else) met
   * two empty dropdowns and could not write down a task at all, and a HEAD had
   * no company list either.
   *
   * `/tasks/targets` answers with names and ids only — nothing with a value on
   * it — which is why it can be gated on `work.own`: anybody who can hold a
   * task can write one down.
   */
  const { data: targetData, isPending: loadingTargets } = useQuery({
    queryKey: ['task-targets'],
    queryFn: () => api.tasks.targets(),
    staleTime: 60_000,
  });
  const companies: { id: string; name: string; jobs: Target[] }[] = targetData?.companies ?? [];
  const internalProjects: { id: string; name: string }[] = targetData?.internalProjects ?? [];
  const targets: Target[] = companies.find((c) => c.id === companyId)?.jobs ?? [];

  // Changing the client clears the job under it — the old pick belongs to a
  // company that is no longer selected.
  useEffect(() => {
    setTargetKey('');
  }, [companyId, scope]);

  const selectedTarget = targets.find((t) => t.key === targetKey);
  const canSave =
    Boolean(title.trim()) &&
    Boolean(dueDate) &&
    (scope === 'INTERNAL' ? Boolean(internalProjectId) : Boolean(selectedTarget));

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
        // What the work is for, alongside the month that bills it. Omitted for
        // a one-time project, which is its own answer to both questions.
        retainerProjectId: scope === 'CLIENT' ? selectedTarget?.retainerProjectId : undefined,
        internalProjectId: scope === 'INTERNAL' ? internalProjectId || undefined : undefined,
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

          {/*
            Which piece of the studio's own work, before anything else.

            This was optional at first, on the reasoning that plenty of internal
            work belongs to nothing in particular. In practice an optional field
            is a skipped field, and the flat list of internal tasks it existed to
            fix stayed flat. So the answer comes first and the task follows.

            With none created yet it says so and points at where they are made,
            rather than showing a required dropdown with nothing in it.
          */}
          {scope === 'INTERNAL' &&
            (internalProjects.length > 0 ? (
              <FieldSelect
                label="Which work"
                value={internalProjectId}
                onChange={setInternalProjectId}
                required
                placeholder="Choose…"
                options={internalProjects.map((p) => ({ value: p.id, label: p.name }))}
                hint="The studio's own work — a hiring round, the website, compliance."
              />
            ) : (
              <p className="rounded-xl border border-border bg-subtle/40 px-3 py-2.5 text-xs text-secondary">
                There is no internal work to file this under yet. Add one on{' '}
                <a href="/live-work?tab=internal" className="font-medium text-primary hover:underline">
                  Live work → Internal
                </a>{' '}
                first.
              </p>
            ))}

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
                options={targets.map((t) => ({ value: t.key, label: t.label }))}
                hint={selectedTarget?.month ? `Billed on the ${selectedTarget.month} month card.` : undefined}
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
