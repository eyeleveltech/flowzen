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

import { useState } from 'react';
import toast from 'react-hot-toast';
import { api, ApiError } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';
import { AssigneeField, AssignedByField } from '@/components/work/AssigneeField';
import { PRIORITY_CONFIG } from '@/lib/priority';
import { TASK_TYPE_OPTIONS } from '@/lib/task-type';
import { personOptions } from '@/lib/people';
import { useTeamMembers } from '@/hooks/queries';

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
  const [reviewerId, setReviewerId] = useState('');
  const [taskType, setTaskType] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [dueDate, setDueDate] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = Boolean(title.trim()) && Boolean(dueDate) && assigneeIds.length > 0 && !saving;

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
        assigneeIds,
        assigneeId: assigneeIds[0],
        assignedById: assignedById || undefined,
        reviewerId: reviewerId || undefined,
        taskType: taskType || undefined,
        dueDate,
        priority,
        notes: description.trim() || undefined,
      });
      toast.success('Task added');
      setTitle('');
      setAssigneeIds([]);
      setDueDate('');
      setDescription('');
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

          <div className="grid grid-cols-2 gap-4">
            <FieldSelect
              label="Reviewer"
              value={reviewerId}
              onChange={setReviewerId}
              placeholder="Nobody reviews it"
              options={personOptions(team)}
              disabled={saving}
            />
            <FieldSelect
              label="Type of work"
              value={taskType}
              onChange={setTaskType}
              placeholder="Not set"
              options={TASK_TYPE_OPTIONS}
              disabled={saving}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Due date" type="date" value={dueDate} onChange={setDueDate} required disabled={saving} />
            <FieldSelect label="Priority" value={priority} onChange={setPriority} options={PRIORITY_OPTIONS} disabled={saving} />
          </div>

          <Field
            label="Description"
            value={description}
            onChange={setDescription}
            textarea
            rows={3}
            disabled={saving}
            placeholder="Anything whoever picks this up needs to know"
          />
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
