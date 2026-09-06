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
import { MultiSelect } from '@/components/ui/multi-select';
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
  onClose: () => void;
  onCreated: () => void;
};

const targetKey = (t: Target) => (t.kind === 'PROJECT' ? `p:${t.projectId}` : `m:${t.monthCardId}`);

export function NewWorkTaskModal({ open, team, companyId, defaultTarget, onClose, onCreated }: Props) {
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
  }, [open, companyId, defaultTarget, me?.id]);

  const selected = workOptions.find((o) => o.key === selectedKey);
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
          <FieldSelect
            label="Belongs to"
            value={selectedKey}
            onChange={setSelectedKey}
            required
            placeholder={workOptions.length === 0 ? 'Loading…' : 'Choose…'}
            options={workOptions.map((o) => ({ value: o.key, label: o.label }))}
          />
          <div>
            <label className="eyebrow mb-1.25 block">
              Assign to
            </label>
            {/* Several people, because several people do the work. The first is
                the lead — the one the load and the overload alerts resolve to —
                so the order here is not decoration. */}
            <MultiSelect
              compact={false}
              showSelectAll={false}
              value={assigneeIds}
              onChange={setAssigneeIds}
              ariaLabel="Assign to"
              placeholder="Defaults to you"
              options={personOptions(team)}
            />
            {assigneeIds.length > 1 && (
              <p className="mt-1 text-micro text-secondary">The first is the lead. It counts on all of their desks.</p>
            )}
          </div>
          {/* Who wanted it done, which is not always who is typing it up —
              a manager writing out what a Head asked for in a meeting had
              no way to say so, and the task landed attributed to them. */}
          <FieldSelect
            label="Assigned by"
            value={assignedById}
            onChange={setAssignedById}
            placeholder="Nobody in particular"
            options={personOptions(team)}
          />
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
