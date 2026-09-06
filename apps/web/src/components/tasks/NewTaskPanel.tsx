'use client';

/**
 * Quick-add a task from ⌘K, always against a project someone just searched
 * for (see lib/actions.ts — the "task" command only ever `applies: ['project']`).
 * Same finalized field set as every other task-creation form in the app
 * (NewWorkTaskModal, AssignTaskModal, My Work's own): title, assignee,
 * priority, description, due date. This used to also collect Task Type,
 * Reviewer, Recurrence and multiple assignees — none of which the backend's
 * create schema has ever accepted, so every one of those fields was silently
 * discarded on save. Removed rather than wired up; see the plan doc for why.
 */

import { useEffect, useState } from 'react';
import { Drawer } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { api, ApiError } from '@/lib/api-v2';
import { PRIORITY_CONFIG } from '@/lib/priority';
import { personOptions } from '@/lib/people';
import { useAuthStore } from '@/stores';

interface NewTaskPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  projectId: string;
  projectName: string;
}

const PRIORITY_OPTIONS = Object.entries(PRIORITY_CONFIG).map(([value, cfg]) => ({ value, label: cfg.label }));

export function NewTaskPanel({ isOpen, onClose, onSuccess, projectId, projectName }: NewTaskPanelProps) {
  const [title, setTitle] = useState('');
  const me = useAuthStore((s) => s.user);
  const [assigneeId, setAssigneeId] = useState('');
  const [assignedById, setAssignedById] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [team, setTeam] = useState<{ id: string; name: string; dept: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setTitle('');
    setAssigneeId('');
    setAssignedById(me?.id ?? '');
    setPriority('MEDIUM');
    setDescription('');
    setDueDate('');
    setError(null);
    void api.team.members().then((res) => setTeam(res.members)).catch(() => {});
  }, [isOpen, me?.id]);

  const canSave = Boolean(title.trim()) && Boolean(dueDate);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await api.tasks.create({
        title: title.trim(),
        workType: 'PROJECT',
        projectId,
        assigneeId: assigneeId || undefined,
        assignedById: assignedById || undefined,
        dueDate,
        priority,
        notes: description.trim() || undefined,
      });
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the task');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer isOpen={isOpen} onClose={onClose} variant="slideover" title="New task">
      <form onSubmit={handleSubmit} className="flex h-full flex-col bg-white">
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div>
            <span className="block text-sm font-medium text-body mb-1.5">Project</span>
            <div className="w-full rounded-xl border border-border bg-subtle/40 px-4 py-2.5 text-sm text-primary font-medium">
              {projectName}
            </div>
          </div>

          <Field label="What needs doing?" value={title} onChange={setTitle} required />

          <div className="grid grid-cols-2 gap-4">
            <FieldSelect
              label="Assign to"
              value={assigneeId}
              onChange={setAssigneeId}
              placeholder="Defaults to you"
              options={personOptions(team)}
            />
            <FieldSelect label="Priority" value={priority} onChange={setPriority} options={PRIORITY_OPTIONS} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Due date" type="date" value={dueDate} onChange={setDueDate} required />
            {/* Who wanted it done — not always the person typing it up. */}
            <FieldSelect
              label="Assigned by"
              value={assignedById}
              onChange={setAssignedById}
              placeholder="Nobody in particular"
              options={personOptions(team)}
            />
          </div>

          <Field label="Description" value={description} onChange={setDescription} textarea rows={4} />

          {error && (
            <div className="rounded-xl bg-danger-tint p-3.5 text-sm text-danger border border-danger/30 font-medium">
              {error}
            </div>
          )}
        </div>

        <div className="border-t border-border bg-surface px-6 py-4">
          <div className="flex justify-end gap-3">
            <Button type="button" onClick={onClose} disabled={saving} variant="ghost">
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={saving} disabled={!canSave}>
              Add task
            </Button>
          </div>
        </div>
      </form>
    </Drawer>
  );
}
