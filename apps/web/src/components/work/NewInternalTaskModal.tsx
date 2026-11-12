'use client';

/**
 * Adding work to a piece of the studio's own work.
 *
 * Opened from inside an internal project, so the one question every other task
 * form has to ask — what does this belong to — is already answered by the
 * screen it opened from. What is left is who, when, and what.
 *
 * Deliberately not `NewWorkTaskModal`: that one is built around choosing a
 * client target, and everything it does to work out which month card and which
 * retainer project a task lands on is exactly what does not apply here.
 */

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api, ApiError } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';
import { AssigneeField, AssignedByField } from '@/components/work/AssigneeField';
import { PRIORITY_CONFIG } from '@/lib/priority';
import { TASK_TYPE_OPTIONS } from '@/lib/task-type';
import { useTeamMembers } from '@/hooks/queries';
import { DueTimeField } from '@/components/work/DueTimeField';
import { repeatOptions, REPEAT_HINT } from '@/lib/repeat';

const PRIORITY_OPTIONS = Object.entries(PRIORITY_CONFIG).map(([value, cfg]) => ({ value, label: cfg.label }));

export function NewInternalTaskModal({
  open,
  project,
  onClose,
  onCreated,
}: {
  open: boolean;
  project: { id: string; name: string };
  onClose: () => void;
  onCreated: () => void;
}) {
  const team = useTeamMembers();
  const [title, setTitle] = useState('');
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [assignedById, setAssignedById] = useState('');
  const [taskType, setTaskType] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [dueDate, setDueDate] = useState('');
  // Optional; empty means any time that day.
  const [dueTime, setDueTime] = useState('');
  // Doesn't repeat, unless chosen. The day comes from the due date.
  const [repeat, setRepeat] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A fresh form every time it opens: it stays mounted while closed, so what
  // was typed last time — and its error — used to be waiting the next time.
  useEffect(() => {
    if (!open) return;
    setTitle('');
    setAssigneeIds([]);
    setAssignedById('');
    setTaskType('');
    setPriority('MEDIUM');
    setDueDate('');
    setDueTime('');
    setRepeat('');
    setDescription('');
    setError(null);
  }, [open]);

  // Nobody picked means you, as on every other task form. It used to need a
  // name here, and somebody who may only add their own work sees no picker —
  // so this form could never be saved by them.
  const canSave = Boolean(title.trim()) && Boolean(dueDate) && Boolean(taskType) && !saving;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await api.tasks.create({
        title: title.trim(),
        workType: 'INTERNAL',
        internalProjectId: project.id,
        assigneeIds: assigneeIds.length > 0 ? assigneeIds : undefined,
        assignedById: assignedById || undefined,
        taskType: taskType || undefined,
        dueDate,
        dueTime: dueTime || undefined,
        repeat: repeat || undefined,
        priority,
        notes: description.trim() || undefined,
      });
      toast.success('Task added');
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add that task');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <Modal open onClose={onClose} title="New task" description={project.name} size="md">
      <form onSubmit={submit}>
        <ModalBody className="space-y-4">
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

          <Field label="What needs doing?" value={title} onChange={setTitle} required disabled={saving} />

          {/* The shared control, so the rule about who may assign to whom lives
              in one place rather than in each form that can create a task. */}
          <AssigneeField value={assigneeIds} onChange={setAssigneeIds} />
          <AssignedByField value={assignedById} onChange={setAssignedById} />

          <FieldSelect
            label="Type of work"
            value={taskType}
            onChange={setTaskType}
            required
            placeholder="Choose…"
            options={TASK_TYPE_OPTIONS}
            disabled={saving}
          />

          <div className="grid grid-cols-2 gap-4">
            <Field label="Due date" type="date" value={dueDate} onChange={setDueDate} required disabled={saving} />
            <DueTimeField value={dueTime} onChange={setDueTime} disabled={saving} />
            <FieldSelect label="Priority" value={priority} onChange={setPriority} options={PRIORITY_OPTIONS} disabled={saving} />
          </div>
          <FieldSelect
            label="Repeat"
            value={repeat}
            onChange={setRepeat}
            options={repeatOptions(dueDate)}
            hint={repeat ? REPEAT_HINT : undefined}
            disabled={saving}
          />

          <Field label="Description" value={description} onChange={setDescription} textarea rows={3} disabled={saving} />
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
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
