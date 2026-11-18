'use client';

/**
 * The one new-task form (Ease Plan 1, decision 1).
 *
 * There were five — My Work and the calendar, the project and retainer pages,
 * an internal project, Team, and ⌘K — each with its own copy of the same
 * fields, in its own order. They are thin wrappers around this now. Each says
 * what its screen already knows (the project, the person, the day) and this
 * shows it — fixed where the screen fixed it — and asks for the rest:
 *
 *   What needs doing? → who → due date → type of work → belongs to →
 *   priority and repeat → description.
 *
 * It also starts from the person's last choices (decision 2): the type of work
 * and "belongs to" of the last task they wrote down themselves. The type
 * everywhere; "belongs to" only where the screen has not already answered it.
 * Both stay editable, and an answer that arrives after the form opened fills a
 * field only while nobody has touched it — see `startFromLastChoices`.
 *
 * Same rules as before, none added or removed: a type of work is required,
 * client work needs a retainer or project, internal work may be "No project",
 * a due date is required — and the same `api.tasks.create` body each form sent.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api-v2';
import { qk, useLastChoices } from '@/hooks/queries';
import { Button } from '@/components/ui/button';
import { ModalBody, ModalFooter } from '@/components/ui/modal';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';
import { AssigneeField, AssignedByField } from '@/components/work/AssigneeField';
import { DueTimeField } from '@/components/work/DueTimeField';
import { PRIORITY_CONFIG } from '@/lib/priority';
import { TASK_TYPE_OPTIONS } from '@/lib/task-type';
import { repeatOptions, REPEAT_HINT } from '@/lib/repeat';
import { monthLabel } from '@/lib/retainerBilling';
import {
  EMPTY_PICK,
  NO_PROJECT,
  companyWorkOptions,
  createTaskBody,
  pickWhere,
  startFromLastChoices,
  workOptionKey,
  workWhere,
  type BelongsToPick,
  type OfferedTargets,
  type TaskWhere,
  type WorkOption,
} from '@/components/work/taskFormFields';

const PRIORITY_OPTIONS = Object.entries(PRIORITY_CONFIG).map(([value, cfg]) => ({ value, label: cfg.label }));

/** A project or retainer page's own work item. */
export type WorkTarget = { kind: 'PROJECT'; projectId: string } | { kind: 'MONTH_CARD'; monthCardId: string };

/** What "Belongs to" is on this screen. */
export type TaskFormBelongsTo =
  /** Asked here: internal, or which client's job (My Work, Calendar, Team). */
  | { kind: 'pick' }
  /**
   * One client's work, starting on the page's own (project and retainer
   * pages): every month card and live project of that client, plus which
   * piece of a retainer's work. Shown and changeable — unless the page is a
   * retainer project, where it is a fact rather than a question.
   */
  | {
      kind: 'company';
      companyId: string;
      defaultTarget: WorkTarget;
      retainerProjects?: { id: string; name: string; status: string }[];
      defaultRetainerProjectId?: string;
    }
  /** Already decided by the screen (an internal project, ⌘K's project): shown, not asked. */
  | { kind: 'fixed'; label: string; note?: string; where: TaskWhere };

/** Who does it: asked, or the person the screen opened for (Team). */
export type TaskFormAssignee = { kind: 'pick' } | { kind: 'fixed'; person: { id: string; name: string } };

/**
 * A number that goes up each time `open` turns true — the form's key, so every
 * opening starts a fresh form. The dialog keeps its content through the closing
 * animation, and one reopened during it would otherwise keep last time's.
 */
export function useOpenSession(open: boolean): number {
  const [seen, setSeen] = useState({ open, count: 0 });
  if (seen.open !== open) {
    const next = { open, count: open ? seen.count + 1 : seen.count };
    setSeen(next);
    return next.count;
  }
  return seen.count;
}

/** A field the screen already answered: the same box, read-only. */
function FixedField({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      {/* `eyebrow`, like every other label in the form — a read-only field is
          still a field, and a heavier label on the one that is not editable
          reads as the most important question. */}
      <span className="eyebrow mb-1.25 block">{label}</span>
      <div className="w-full rounded-xl border border-border bg-subtle/40 px-4 py-2.5">
        <p className="text-sm font-medium text-primary">{value}</p>
        {note && <p className="mt-0.5 text-micro text-secondary">{note}</p>}
      </div>
    </div>
  );
}

export function TaskForm({
  belongsTo,
  assignee = { kind: 'pick' },
  initialDueDate,
  initialDueTime,
  submitLabel = 'Add task',
  layout = 'modal',
  onCancel,
  onCreated,
}: {
  belongsTo: TaskFormBelongsTo;
  assignee?: TaskFormAssignee;
  /** A day to start from — the calendar opens on the day that was clicked. */
  initialDueDate?: string;
  /** And a time, when it was a time slot. */
  initialDueTime?: string;
  submitLabel?: string;
  /** In a dialog (`Modal`), or straight inside a slide-over `Drawer` (⌘K). */
  layout?: 'modal' | 'panel';
  onCancel: () => void;
  onCreated: () => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  /** Empty means "me" — the server's own default. */
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  // Nobody, until somebody says otherwise — see tasks.ts on why this field
  // means nothing when it is filled in by default.
  const [assignedById, setAssignedById] = useState('');
  const [dueDate, setDueDate] = useState(initialDueDate ?? '');
  // Optional; empty means any time that day.
  const [dueTime, setDueTime] = useState(initialDueTime ?? '');
  const [priority, setPriority] = useState('MEDIUM');
  // Doesn't repeat, unless chosen. The day comes from the due date.
  const [repeat, setRepeat] = useState('');
  const [description, setDescription] = useState('');
  /*
   * The remembered fields hold the person's own answer, or null while they
   * have not touched it — and null shows the last choice, or the empty start.
   * Worked out on every render rather than copied in when the answer arrives,
   * so an answer that lands after the form opened fills only untouched fields.
   */
  const [chosenType, setChosenType] = useState<string | null>(null);
  const [chosenPick, setChosenPick] = useState<BelongsToPick | null>(null);
  // The project and retainer pages' form: null follows what the page passed.
  const [chosenWorkKey, setChosenWorkKey] = useState<string | null>(null);
  const [chosenRetainerProjectId, setChosenRetainerProjectId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: lastChoices } = useLastChoices();

  /*
   * One request for everything the studio-wide picker can offer — names and
   * ids only, gated on `work.own`, so anybody who can hold a task can write
   * one down. Only fetched where that picker shows.
   */
  const { data: targetData, isPending: loadingTargets } = useQuery({
    queryKey: ['task-targets'],
    queryFn: () => api.tasks.targets(),
    staleTime: 60_000,
    enabled: belongsTo.kind === 'pick',
  });
  const offered: OfferedTargets | undefined = belongsTo.kind === 'pick' ? targetData : undefined;

  /*
   * One client's months and live projects, for the project and retainer pages.
   * Its own small source, needing only work.own — the full client record needs
   * company.read, which a Head on a project page does not hold. Asked again on
   * every opening, as it always was.
   */
  const companyId = belongsTo.kind === 'company' ? belongsTo.companyId : '';
  const companyQuery = useQuery({
    queryKey: ['task-targets', 'company', companyId],
    queryFn: () => api.tasks.companyTargets(companyId),
    staleTime: 0,
    enabled: belongsTo.kind === 'company' && Boolean(companyId),
  });
  const workOptions: WorkOption[] = companyQuery.data ? companyWorkOptions(companyQuery.data) : [];
  const loadError = companyQuery.error
    ? companyQuery.error instanceof ApiError
      ? companyQuery.error.message
      : 'Could not load where this task can go'
    : null;

  // The screen wins: "Belongs to" is remembered only where it is asked.
  const start = startFromLastChoices(lastChoices?.choices, offered);
  const taskType = chosenType ?? start.taskType ?? '';
  const pick = chosenPick ?? start.belongsTo ?? EMPTY_PICK;
  const changePick = (change: Partial<BelongsToPick>) => setChosenPick({ ...pick, ...change });

  const companies = offered?.companies ?? [];
  const internalProjects = offered?.internalProjects ?? [];
  const jobs = companies.find((c) => c.id === pick.companyId)?.jobs ?? [];
  const selectedJob = jobs.find((j) => j.key === pick.targetKey);

  const workKey = chosenWorkKey ?? (belongsTo.kind === 'company' ? workOptionKey(belongsTo.defaultTarget) : '');
  const retainerProjectId =
    chosenRetainerProjectId ?? (belongsTo.kind === 'company' ? (belongsTo.defaultRetainerProjectId ?? '') : '');
  const selectedWork = workOptions.find((o) => o.key === workKey);

  const where: TaskWhere | null =
    belongsTo.kind === 'fixed'
      ? belongsTo.where
      : belongsTo.kind === 'company'
        ? selectedWork
          ? workWhere(selectedWork, retainerProjectId)
          : null
        : pickWhere(pick, offered);

  const canSave = Boolean(title.trim()) && Boolean(dueDate) && Boolean(taskType) && Boolean(where) && !saving;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave || !where) return;
    setSaving(true);
    setError(null);
    try {
      await api.tasks.create(
        createTaskBody(
          {
            title,
            dueDate,
            dueTime,
            repeat,
            priority,
            taskType,
            description,
            assignedById,
            assigneeIds,
            fixedAssigneeId: assignee.kind === 'fixed' ? assignee.person.id : undefined,
          },
          where,
        ),
      );
      // What the next new task starts from has just changed.
      void queryClient.invalidateQueries({ queryKey: qk.lastChoices });
      // "Add your first task" (Ease Plan 2).
      void queryClient.invalidateQueries({ queryKey: qk.gettingStarted });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the task');
    } finally {
      setSaving(false);
    }
  };

  const fields = (
    <>
      <Field label="What needs doing?" value={title} onChange={setTitle} required disabled={saving} />

      {/* Who. The shared controls, so the rule about who may assign to whom
          lives in one place; on Team the person is why the form opened. */}
      {assignee.kind === 'fixed' ? (
        <FixedField label="Assign to" value={assignee.person.name} />
      ) : (
        <AssigneeField value={assigneeIds} onChange={setAssigneeIds} disabled={saving} />
      )}
      <AssignedByField value={assignedById} onChange={setAssignedById} disabled={saving} />

      <div className="grid grid-cols-2 gap-4">
        <Field label="Due date" type="date" value={dueDate} onChange={setDueDate} required disabled={saving} />
        <DueTimeField value={dueTime} onChange={setDueTime} disabled={saving} />
      </div>

      <FieldSelect
        label="Type of work"
        value={taskType}
        onChange={setChosenType}
        required
        placeholder="Choose…"
        options={TASK_TYPE_OPTIONS}
        disabled={saving}
      />

      {belongsTo.kind === 'fixed' && <FixedField label="Belongs to" value={belongsTo.label} note={belongsTo.note} />}

      {belongsTo.kind === 'company' && (
        <CompanyWork
          belongsTo={belongsTo}
          options={workOptions}
          loading={companyQuery.isPending}
          selected={selectedWork}
          workKey={workKey}
          onWorkKey={setChosenWorkKey}
          retainerProjectId={retainerProjectId}
          onRetainerProjectId={setChosenRetainerProjectId}
          disabled={saving}
        />
      )}

      {belongsTo.kind === 'pick' && (
        <>
          <FieldSelect
            label="Belongs to"
            value={pick.scope}
            // Another answer clears the job under it — it belonged to the old one.
            onChange={(v) => changePick(v === pick.scope ? {} : { scope: v as BelongsToPick['scope'], targetKey: '' })}
            required
            options={[
              { value: 'INTERNAL', label: 'Internal — no client' },
              { value: 'CLIENT', label: 'A client’s work' },
            ]}
            hint="Client work → a retainer or project · Internal → an internal project, or No project for one-off studio jobs."
            disabled={saving}
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
          {pick.scope === 'INTERNAL' && (
            <div>
              <FieldSelect
                label="Which internal project?"
                value={pick.internalProjectId}
                onChange={(v) => changePick({ internalProjectId: v })}
                required
                placeholder="Choose…"
                options={[
                  { value: NO_PROJECT, label: 'No project (general internal task)' },
                  ...internalProjects.map((p) => ({ value: p.id, label: p.name })),
                ]}
                disabled={saving}
              />
              {targetData && internalProjects.length === 0 && (
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

          {pick.scope === 'CLIENT' && (
            <>
              <FieldSelect
                label="Company"
                value={pick.companyId}
                onChange={(v) => changePick(v === pick.companyId ? {} : { companyId: v, targetKey: '' })}
                required
                placeholder="Choose a company…"
                options={companies.map((c) => ({ value: c.id, label: c.name }))}
                disabled={saving}
              />
              <FieldSelect
                label="Which job"
                value={pick.targetKey}
                onChange={(v) => changePick({ targetKey: v })}
                required
                disabled={!pick.companyId || loadingTargets || saving}
                placeholder={
                  !pick.companyId ? 'Choose a company first' : loadingTargets ? 'Loading…' : jobs.length === 0 ? 'Nothing live' : 'Choose…'
                }
                options={jobs.map((t) => ({ value: t.key, label: t.label }))}
                hint={selectedJob?.month ? `Billed on the ${selectedJob.month} month card.` : undefined}
              />
            </>
          )}
        </>
      )}

      <FieldSelect label="Priority" value={priority} onChange={setPriority} options={PRIORITY_OPTIONS} disabled={saving} />
      <FieldSelect
        label="Repeat"
        value={repeat}
        onChange={setRepeat}
        options={repeatOptions(dueDate)}
        hint={repeat ? REPEAT_HINT : undefined}
        disabled={saving}
      />

      <Field label="Description" value={description} onChange={setDescription} textarea rows={3} disabled={saving} />

      {(error ?? loadError) && <ErrorNote>{error ?? loadError}</ErrorNote>}
    </>
  );

  const actions = (
    <>
      <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
        Cancel
      </Button>
      <Button type="submit" variant="primary" loading={saving} disabled={!canSave}>
        {submitLabel}
      </Button>
    </>
  );

  if (layout === 'panel') {
    return (
      <form onSubmit={submit} className="flex h-full flex-col bg-white">
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">{fields}</div>
        <div className="border-t border-border bg-surface px-6 py-4">
          <div className="flex justify-end gap-3">{actions}</div>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={submit}>
      <ModalBody className="space-y-4">{fields}</ModalBody>
      <ModalFooter>{actions}</ModalFooter>
    </form>
  );
}

/**
 * "Belongs to" on the project and retainer pages: one client's work, starting
 * on the page's own.
 */
function CompanyWork({
  belongsTo,
  options,
  loading,
  selected,
  workKey,
  onWorkKey,
  retainerProjectId,
  onRetainerProjectId,
  disabled,
}: {
  belongsTo: Extract<TaskFormBelongsTo, { kind: 'company' }>;
  options: WorkOption[];
  loading: boolean;
  selected: WorkOption | undefined;
  workKey: string;
  onWorkKey: (key: string) => void;
  retainerProjectId: string;
  onRetainerProjectId: (id: string) => void;
  disabled: boolean;
}) {
  const retainerProjects = belongsTo.retainerProjects ?? [];
  // A finished project is not somewhere new work goes.
  const openProjects = retainerProjects.filter((p) => p.status !== 'DONE');
  /*
   * The project this form was opened from, if it was opened from one —
   * resolved from the list the page passes, so it is the same name the screen
   * behind the form shows.
   */
  const lockedProject = belongsTo.defaultRetainerProjectId
    ? retainerProjects.find((p) => p.id === belongsTo.defaultRetainerProjectId)
    : undefined;

  if (lockedProject) {
    /*
      Opened from inside a retainer project, so the answer is not a question.
      The month is still shown because it is load-bearing: a task on a
      retainer project sits on the month that pays for it, and that is what
      decides which card its cost and profit land on.
    */
    const month = selected?.kind === 'MONTH_CARD' && selected.month ? monthLabel(selected.month) : null;
    return (
      <FixedField
        label="Belongs to"
        value={lockedProject.name}
        note={month ? `Billed on ${month} — a project's work sits on the month that pays for it.` : 'Part of this retainer.'}
      />
    );
  }

  return (
    <>
      <FieldSelect
        label="Belongs to"
        value={workKey}
        onChange={onWorkKey}
        required
        placeholder={loading ? 'Loading…' : options.length === 0 ? 'Nothing live' : 'Choose…'}
        options={options.map((o) => ({ value: o.key, label: o.label }))}
        disabled={disabled}
      />
      {/*
        Which piece of work, on top of which month. Optional — a task that
        belongs to no campaign in particular is a normal thing, and the month
        card still holds it.
      */}
      {selected?.kind === 'MONTH_CARD' && openProjects.length > 0 && (
        <FieldSelect
          label="Project"
          value={retainerProjectId}
          onChange={onRetainerProjectId}
          placeholder="Not part of one"
          options={openProjects.map((p) => ({ value: p.id, label: p.name }))}
          disabled={disabled}
        />
      )}
    </>
  );
}
