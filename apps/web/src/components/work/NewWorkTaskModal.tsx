'use client';

/**
 * Adding a task against a company's live work — a Project or a Retainer's
 * current month card, the two `workType`s a task can hang off besides
 * internal work. Opened from a Project or Retainer page, "Belongs to" is
 * pre-selected to that page's own work item, but shown and changeable
 * rather than silently implicit — every task sits inside a specific piece
 * of work, and the person creating it should see which one before saving,
 * not just trust that clicking "+Task" here got it right.
 */

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { AssigneeField, AssignedByField } from '@/components/work/AssigneeField';
import { TASK_TYPE_OPTIONS } from '@/lib/task-type';
import { ErrorNote } from '@/components/ui/empty-state';
import { PRIORITY_CONFIG } from '@/lib/priority';
import { personOptions } from '@/lib/people';
import { useAuthStore } from '@/stores';

const PRIORITY_OPTIONS = Object.entries(PRIORITY_CONFIG).map(([value, cfg]) => ({ value, label: cfg.label }));

type Target = { kind: 'PROJECT'; projectId: string } | { kind: 'MONTH_CARD'; monthCardId: string };
type WorkOption = { key: string; label: string; kind: 'PROJECT' | 'MONTH_CARD'; projectId?: string; monthCardId?: string };

type Props = {
  open: boolean;
  team: { id: string; name: string; dept: string }[];
  companyId: string;
  defaultTarget: Target;
  /**
   * The named pieces of work inside the retainer this task is being added to.
   *
   * Only offered when the target is a month card, because that is the only
   * place they mean anything — a one-off project is its own piece of work.
   */
  retainerProjects?: { id: string; name: string; status: string }[];
  /**
   * Which of them the task already belongs to.
   *
   * Set when the modal is opened from inside a project, where the answer is
   * not a question — the screen is already that project. The field stays
   * visible and changeable; it just starts on the right one instead of blank.
   */
  defaultRetainerProjectId?: string;
  onClose: () => void;
  onCreated: () => void;
};

const targetKey = (t: Target) => (t.kind === 'PROJECT' ? `p:${t.projectId}` : `m:${t.monthCardId}`);

export function NewWorkTaskModal({
  open,
  team,
  companyId,
  defaultTarget,
  retainerProjects = [],
  defaultRetainerProjectId,
  onClose,
  onCreated,
}: Props) {
  const me = useAuthStore((s) => s.user);
  const [title, setTitle] = useState('');
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [assignedById, setAssignedById] = useState('');
  const [reviewerId, setReviewerId] = useState('');
  const [taskType, setTaskType] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [workOptions, setWorkOptions] = useState<WorkOption[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [retainerProjectId, setRetainerProjectId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setAssigneeIds([]);
    // Whoever is typing, because that is who it usually is. Changing it is
    // the point of the field, not the exception it handles.
    setAssignedById(me?.id ?? '');
    setReviewerId('');
    setTaskType('');
    setPriority('MEDIUM');
    setDescription('');
    setDueDate('');
    setSelectedKey(targetKey(defaultTarget));
    setRetainerProjectId(defaultRetainerProjectId ?? '');
    setError(null);

    void api.companies
      .get(companyId)
      .then((res) => {
        const company = (res as { company?: any }).company ?? res;
        const options: WorkOption[] = [];
        for (const r of company.retainers ?? []) {
          if (r.status !== 'ACTIVE') continue;
          // Every month card, not just the latest — the page this modal opens
          // from can be showing any month via its own navigator, and the
          // pre-selection below needs that exact card to be a real option.
          for (const monthCard of r.monthCards ?? []) {
            options.push({ key: `m:${monthCard.id}`, label: `Retainer — ${monthCard.month}`, kind: 'MONTH_CARD', monthCardId: monthCard.id });
          }
        }
        for (const p of company.projects ?? []) {
          if (p.status !== 'LIVE') continue;
          options.push({ key: `p:${p.id}`, label: `Project — ${p.name}`, kind: 'PROJECT', projectId: p.id });
        }
        setWorkOptions(options);
      })
      .catch(() => {});
  }, [open, companyId, defaultTarget, defaultRetainerProjectId, me?.id]);

  const selected = workOptions.find((o) => o.key === selectedKey);
  // A finished project is not somewhere new work goes.
  const openProjects = retainerProjects.filter((p) => p.status !== 'DONE');

  /*
   * The project this form was opened from, if it was opened from one.
   *
   * Its presence is what turns the target from a question into a statement —
   * see the locked box below. Resolved from the list the caller passes rather
   * than fetched, so it is the same name the screen behind the modal shows.
   */
  const lockedProject = defaultRetainerProjectId
    ? retainerProjects.find((p) => p.id === defaultRetainerProjectId)
    : undefined;
  /** "2026-09" out of "Retainer — 2026-09", spelled the way a person reads it. */
  const lockedMonth = (() => {
    if (!lockedProject || selected?.kind !== 'MONTH_CARD') return null;
    const key = /(\d{4})-(\d{2})/.exec(selected.label);
    if (!key) return null;
    return new Date(Number(key[1]), Number(key[2]) - 1, 1).toLocaleDateString('en-IN', {
      month: 'long',
      year: 'numeric',
    });
  })();
  const canSave = Boolean(title.trim()) && Boolean(dueDate) && Boolean(selected);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave || !selected) return;
    setSaving(true);
    setError(null);
    try {
      await api.tasks.create({
        title: title.trim(),
        workType: selected.kind,
        projectId: selected.kind === 'PROJECT' ? selected.projectId : undefined,
        monthCardId: selected.kind === 'MONTH_CARD' ? selected.monthCardId : undefined,
        // Alongside the month card, never instead of it: the month says when
        // this is billed and costed, the project says what it is for.
        retainerProjectId:
          selected.kind === 'MONTH_CARD' && retainerProjectId ? retainerProjectId : undefined,
        // The whole set, first name the lead. Empty means "me", which is
        // what the server already defaults to.
        assigneeIds: assigneeIds.length > 0 ? assigneeIds : undefined,
        assignedById: assignedById || undefined,
        reviewerId: reviewerId || undefined,
        taskType: taskType || undefined,
        dueDate,
        priority,
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
    <Modal open={open} onClose={onClose} title="New task">
      <form onSubmit={submit}>
        <ModalBody className="space-y-4">
          <Field label="What needs doing?" value={title} onChange={setTitle} required />

          {lockedProject ? (
            /*
              Opened from inside a project, so the answer is not a question.
              It asked twice and got it backwards: "Belongs to" offered every
              month card and every one-off project of the company and defaulted
              to "Retainer — 2026-09", and then a second field underneath said
              which project — so standing inside the Diwali campaign, the first
              and larger control said Retainer and invited you to change it.

              The month is still here because it is load-bearing: a task on a
              retainer project sits on the month that pays for it, and that is
              what decides which card its cost and profit land on. It is shown
              as the fact it is rather than asked as a question the screen has
              already answered.
            */
            <div>
              {/* `eyebrow`, like every other label in this form — a read-only
                  field is still a field, and a heavier label on the one that
                  is not editable reads as the most important question. */}
              <span className="eyebrow mb-1.25 block">Belongs to</span>
              <div className="w-full rounded-xl border border-border bg-subtle/40 px-4 py-2.5">
                <p className="text-sm font-medium text-primary">{lockedProject.name}</p>
                <p className="mt-0.5 text-micro text-secondary">
                  {lockedMonth
                    ? `Billed on ${lockedMonth} — a project's work sits on the month that pays for it.`
                    : 'Part of this retainer.'}
                </p>
              </div>
            </div>
          ) : (
            <>
              <FieldSelect
                label="Belongs to"
                value={selectedKey}
                onChange={setSelectedKey}
                required
                placeholder={workOptions.length === 0 ? 'Loading…' : 'Choose…'}
                options={workOptions.map((o) => ({ value: o.key, label: o.label }))}
              />
              {/*
                Which piece of work, on top of which month. Optional — a task
                that belongs to no campaign in particular is a normal thing,
                and the month card still holds it.
              */}
              {selected?.kind === 'MONTH_CARD' && openProjects.length > 0 && (
                <FieldSelect
                  label="Project"
                  value={retainerProjectId}
                  onChange={setRetainerProjectId}
                  placeholder="Not part of one"
                  options={openProjects.map((p) => ({ value: p.id, label: p.name }))}
                />
              )}
            </>
          )}
          {/* The shared control, so the rule about who may assign to whom lives
              in one place rather than in each of the four forms that can create
              a task. */}
          <AssigneeField value={assigneeIds} onChange={setAssigneeIds} />
          <AssignedByField value={assignedById} onChange={setAssignedById} />
          <div className="grid grid-cols-2 gap-4">
            <FieldSelect
              label="Reviewer"
              value={reviewerId}
              onChange={setReviewerId}
              placeholder="Nobody reviews it"
              options={personOptions(team)}
            />
            <FieldSelect label="Priority" value={priority} onChange={setPriority} options={PRIORITY_OPTIONS} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Due date" type="date" value={dueDate} onChange={setDueDate} required />
            <FieldSelect
              label="Type of work"
              value={taskType}
              onChange={setTaskType}
              placeholder="Not set"
              options={TASK_TYPE_OPTIONS}
            />
          </div>
          <Field label="Description" value={description} onChange={setDescription} textarea rows={3} />
          {error && <ErrorNote>{error}</ErrorNote>}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!canSave}>
            Add task
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
