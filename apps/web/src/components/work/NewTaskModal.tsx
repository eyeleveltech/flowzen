'use client';

/**
 * The new-task form everybody has: "Task for myself", or "New task" for
 * somebody who may hand work to others. It lived inside My Work; the calendar
 * opens it too, on the day (and time) that was clicked.
 */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api-v2';
import { useTeamMembers } from '@/hooks/queries';
import { Button } from '@/components/ui/button';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Field, FieldSelect } from '@/components/ui/field';
import { AssigneeField, AssignedByField, useMayAssignOthers } from '@/components/work/AssigneeField';
import { ErrorNote } from '@/components/ui/empty-state';
import { PRIORITY_CONFIG } from '@/lib/priority';
import { useAuthStore } from '@/stores';
import { TASK_TYPE_OPTIONS } from '@/lib/task-type';
import { DueTimeField } from '@/components/work/DueTimeField';
import { repeatOptions, REPEAT_HINT } from '@/lib/repeat';

const PRIORITY_OPTIONS = Object.entries(PRIORITY_CONFIG).map(([value, cfg]) => ({ value, label: cfg.label }));

/** "No project" in the internal picker — a choice, sent as no internal project at all. */
const NO_PROJECT = 'none';

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

export function NewTaskModal({
  open,
  onClose,
  onCreated,
  initialDueDate,
  initialDueTime,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  /** A day to start from — the calendar opens this on the day that was clicked. */
  initialDueDate?: string;
  /** And a time, when it was a time slot. */
  initialDueTime?: string;
}) {
  const me = useAuthStore((s) => s.user);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  // Optional; empty means any time that day.
  const [dueTime, setDueTime] = useState('');
  // Doesn't repeat, unless chosen. The day comes from the due date.
  const [repeat, setRepeat] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [description, setDescription] = useState('');
  /*
   * This form kept its own fields and never got the ones the other two task
   * forms grew — a reviewer and a kind of work — so a task raised from My Work
   * came out different from an identical task raised anywhere else.
   *
   * There is deliberately no assignee picker: the dialog is called "Task for
   * myself" and the server already defaults to the caller. A reviewer is still
   * worth asking for, because "somebody should check this" is a thing you know
   * when you write the task down, whoever is doing it.
   */
  /** Empty means "me" — the server's own default, so this stays a self-task until somebody says otherwise. */
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [assignedById, setAssignedById] = useState('');
  const [taskType, setTaskType] = useState('');
  const team = useTeamMembers();
  /** Decides the dialog's own name: a head opening it is not writing a task for themselves. */
  const { may: mayAssignOthers } = useMayAssignOthers();

  useEffect(() => {
    if (!open) return;
  }, [open]);
  const [scope, setScope] = useState<'INTERNAL' | 'CLIENT'>('INTERNAL');
  const [companyId, setCompanyId] = useState('');
  const [targetKey, setTargetKey] = useState('');
  /*
   * Which internal project, when this is the studio's own work — or
   * NO_PROJECT, for a one-off job like "Renew domain" (Internal work plan).
   * Empty means nothing chosen yet, which the form does not accept: "No
   * project" is a decision, not a field somebody skipped.
   */
  const [internalProjectId, setInternalProjectId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(''); setDueDate(initialDueDate ?? '');
    setDueTime(initialDueTime ?? ''); setRepeat(''); setPriority('MEDIUM'); setDescription('');
      setScope('INTERNAL'); setCompanyId(''); setTargetKey(''); setInternalProjectId(''); setError(null);
      setTaskType('');
      // Nobody, until somebody says otherwise — see tasks.ts on why this
    // field means nothing when it is filled in by default.
    setAssignedById('');
    }
  }, [open, me?.id, initialDueDate, initialDueTime]);

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
  const companies = targetData?.companies ?? [];
  const internalProjects = targetData?.internalProjects ?? [];
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
        workType: scope === 'INTERNAL' ? 'INTERNAL' : selectedTarget?.workType === 'RETAINER' ? 'MONTH_CARD' : 'PROJECT',
        monthCardId: scope === 'CLIENT' ? selectedTarget?.monthCardId : undefined,
        // What the work is for, alongside the month that bills it. Omitted for
        // a one-time project, which is its own answer to both questions.
        retainerProjectId: scope === 'CLIENT' ? selectedTarget?.retainerProjectId : undefined,
        // "No project" is sent as no internal project at all.
        internalProjectId: scope === 'INTERNAL' && internalProjectId !== NO_PROJECT ? internalProjectId || undefined : undefined,
        projectId: scope === 'CLIENT' ? selectedTarget?.projectId : undefined,
        dueDate,
        dueTime: dueTime || undefined,
        repeat: repeat || undefined,
        priority,
        // Empty means "me", which is what the server already defaults to.
        assigneeIds: assigneeIds.length > 0 ? assigneeIds : undefined,
        assignedById: assignedById || undefined,
        taskType: taskType || undefined,
        notes: description.trim() || undefined,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the task');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={mayAssignOthers ? 'New task' : 'Task for myself'}>
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
            hint="Client work → a retainer or project · Internal → an internal project, or No project for one-off studio jobs."
          />

          {/*
            Which internal project — or No project, as a deliberate choice.

            When this was optional, people skipped it and internal work became
            one flat list; when it was required, a one-off job like "Renew
            domain" had to be filed under a project made up for it. So "No
            project" is the first option and one has to be picked: never blank,
            never forced into a bucket. It is there even when no internal
            projects exist yet; making one is a hint, not a blocker.
          */}
          {scope === 'INTERNAL' && (
            <div>
              <FieldSelect
                label="Which internal project?"
                value={internalProjectId}
                onChange={setInternalProjectId}
                required
                placeholder="Choose…"
                options={[
                  { value: NO_PROJECT, label: 'No project (general internal task)' },
                  ...internalProjects.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
              {internalProjects.length === 0 && (
                <p className="mt-1 text-micro text-secondary">
                  No internal projects yet. Several jobs that belong together? Start one on{' '}
                  <Link href="/live-work?tab=internal" className="font-medium text-primary hover:underline">
                    Live work → Internal
                  </Link>
                  .
                </p>
              )}
            </div>
          )}

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

          {/*
            Who it is for.

            This dialog had no assignee control at all, on the reasoning that
            it is called "Task for myself" and the server defaults to the
            caller. That was fine when nobody could assign to anybody from
            anywhere, and wrong once they could: a head opening it saw a
            picker for who ASKED for the work and none for who DOES it, which
            reads backwards — and left them navigating to a project page to do
            the obvious thing.

            The shared field settles it per person. Somebody who may only
            manage their own work still sees their own name and no picker, so
            the dialog keeps its original behaviour for them.
          */}
          <AssigneeField value={assigneeIds} onChange={setAssigneeIds} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Due date" type="date" value={dueDate} onChange={setDueDate} required />
            <DueTimeField value={dueTime} onChange={setDueTime} />
            <FieldSelect label="Priority" value={priority} onChange={setPriority} options={PRIORITY_OPTIONS} />
          </div>
          <FieldSelect
            label="Repeat"
            value={repeat}
            onChange={setRepeat}
            options={repeatOptions(dueDate)}
            hint={repeat ? REPEAT_HINT : undefined}
          />
          <AssignedByField value={assignedById} onChange={setAssignedById} />
          <FieldSelect
            label="Type of work"
            value={taskType}
            onChange={setTaskType}
            placeholder="Not set"
            options={TASK_TYPE_OPTIONS}
          />
          <Field label="Description" value={description} onChange={setDescription} textarea rows={3} />
          {error && <ErrorNote>{error}</ErrorNote>}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!canSave}>Add task</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
