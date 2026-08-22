'use client';

import React, { useEffect, useState } from 'react';
import { Drawer } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { MultiSelect } from '@/components/ui/multi-select';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { Toggle } from '@/components/ui/toggle';
import { api, ApiError } from '@/lib/api-v2';

interface NewTaskPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  /** Pre-set projectId when opened from inside a project page */
  defaultProjectId?: string;
}

type OptionItem = { value: string; label: string };

const TASK_TYPE_OPTIONS = [
  { value: 'CONTENT', label: 'Content & Copy' },
  { value: 'DESIGN', label: 'Design Work' },
  { value: 'DEVELOPMENT', label: 'Development' },
  { value: 'SEO', label: 'SEO & Marketing' },
  { value: 'BUG', label: 'Bug Fix' },
  { value: 'MEETING', label: 'Meeting / Call' },
  { value: 'OTHER', label: 'Other' },
];

const PRIORITY_OPTIONS = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
];

const CREATE_STATUS_OPTIONS = [
  { value: 'TODO', label: 'To Do (Default)' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'IN_REVIEW', label: 'In Review' },
  { value: 'ON_HOLD', label: 'On Hold' },
  { value: 'BLOCKED', label: 'Blocked' },
];

export function NewTaskPanel({ isOpen, onClose, onSuccess, defaultProjectId }: NewTaskPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dropdown options (loaded on open)
  const [companies, setCompanies] = useState<OptionItem[]>([]);
  const [projects, setProjects] = useState<OptionItem[]>([]);
  const [departments, setDepartments] = useState<OptionItem[]>([]);
  const [team, setTeam] = useState<OptionItem[]>([]);

  // Form state
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [description, setDescription] = useState('');
  const [taskType, setTaskType] = useState('CONTENT');
  const [reviewerId, setReviewerId] = useState('');
  const [assignedById, setAssignedById] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>([]);
  const [assignedDate, setAssignedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [isRecurring, setIsRecurring] = useState(false);
  const [status, setStatus] = useState('TODO');

  const [companyId, setCompanyId] = useState('');
  const [projectId, setProjectId] = useState(defaultProjectId ?? '');
  const [departmentId, setDepartmentId] = useState('');

  // Load dropdown data when drawer opens
  useEffect(() => {
    if (!isOpen) return;
    setTitle('');
    setDueDate('');
    setDueTime('');
    setDescription('');
    setTaskType('CONTENT');
    setReviewerId('');
    setAssignedById('');
    setPriority('MEDIUM');
    setSelectedAssigneeIds([]);
    setAssignedDate(new Date().toISOString().slice(0, 10));
    setIsRecurring(false);
    setStatus('TODO');
    setCompanyId('');
    setProjectId(defaultProjectId ?? '');
    setDepartmentId('');
    setError(null);

    void Promise.all([
      api.companies.list().then((list) =>
        setCompanies(
          (list as { id: string; name: string }[]).map((c) => ({ value: c.id, label: c.name }))
        )
      ).catch(() => {}),
      api.projects.list().then((list) =>
        setProjects(
          (list as { id: string; name: string }[]).map((p) => ({ value: p.id, label: p.name }))
        )
      ).catch(() => {}),
      api.departments.list().then((list) =>
        setDepartments(
          (list as { id: string; name: string }[]).map((d) => ({ value: d.id, label: d.name }))
        )
      ).catch(() => {}),
      api.users.list().then((list) =>
        setTeam(list.filter((u) => u.status === 'ACTIVE').map((u) => ({ value: u.id, label: u.name })))
      ).catch(() => {}),
    ]);
  }, [isOpen, defaultProjectId]);

  const hasParent = Boolean(projectId || departmentId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    if (!hasParent) {
      setError('Please select a Project or Department to assign this task to.');
      return;
    }
    setError(null);
    setLoading(true);

    try {
      let finalDueDate: string | undefined = undefined;
      if (dueDate) {
        const dateObj = new Date(dueDate);
        if (dueTime) {
          const [hours, minutes] = dueTime.split(':');
          dateObj.setHours(parseInt(hours, 10), parseInt(minutes, 10));
        }
        finalDueDate = dateObj.toISOString();
      }

      // If multiple assignees are selected, create task for each selected assignee
      const assigneesToCreate = selectedAssigneeIds.length > 0 ? selectedAssigneeIds : [null];

      for (const assigneeId of assigneesToCreate) {
        await api.projects.createTask({
          title,
          description: description || null,
          taskType,
          status: status as any,
          priority,
          dueDate: finalDueDate,
          projectId: projectId || null,
          dealId: null,
          departmentId: departmentId || null,
          assigneeId: assigneeId || null,
          reviewerId: reviewerId || null,
          ...(isRecurring ? { recurrence: { frequency: 'DAILY', interval: 1 } } : {}),
        });
      }

      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create task');
    } finally {
      setLoading(false);
    }
  };

  const NONE = { value: '', label: '— None —' };

  return (
    <Drawer isOpen={isOpen} onClose={onClose} variant="slideover" title="New Task">
      <form onSubmit={handleSubmit} className="flex h-full flex-col bg-white">
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {error && (
            <div className="rounded-xl bg-red-50 p-3.5 text-sm text-red-700 border border-red-200 font-medium">
              {error}
            </div>
          )}

          {/* 1. Title */}
          <Field
            label="Task Title"
            value={title}
            onChange={setTitle}
            placeholder="e.g. Design Landing Page Hero Section"
            required
          />

          {/* 2 & 3. Due Date & Due Time */}
          <div className="grid grid-cols-2 gap-4">
            <Field type="date" label="Due Date" value={dueDate} onChange={setDueDate} />
            <Field type="time" label="Due Time (Optional)" value={dueTime} onChange={setDueTime} />
          </div>

          {/* 4. Description */}
          <div>
            <label className="block text-sm font-medium text-body mb-1.5">Description</label>
            <RichTextEditor
              value={description}
              onChange={setDescription}
              placeholder="Add task details, links, or instructions..."
            />
          </div>

          {/* 5 & 6. Task Type & Reviewer */}
          <div className="grid grid-cols-2 gap-4">
            <FieldSelect
              label="Task Type"
              value={taskType}
              onChange={setTaskType}
              options={TASK_TYPE_OPTIONS}
            />
            <FieldSelect
              label="Reviewer"
              value={reviewerId}
              onChange={setReviewerId}
              options={[{ value: '', label: 'No Reviewer' }, ...team]}
            />
          </div>

          {/* 7 & 8. Assigned By & Assignees (MultiSelect) */}
          <div className="grid grid-cols-2 gap-4">
            <FieldSelect
              label="Assigned By"
              value={assignedById}
              onChange={setAssignedById}
              options={[{ value: '', label: 'Self (Default)' }, ...team]}
            />
            <FieldSelect
              label="Priority"
              value={priority}
              onChange={setPriority}
              options={PRIORITY_OPTIONS}
            />
          </div>

          {/* Multiple Assignees */}
          <div>
            <label className="block text-sm font-medium text-body mb-1.5">Assigned To (Assignees)</label>
            <MultiSelect
              options={team}
              value={selectedAssigneeIds}
              onChange={setSelectedAssigneeIds}
              placeholder="Select assignees..."
              compact={false}
            />
          </div>

          {/* 9 & 10. Assigned Date & Initial Status */}
          <div className="grid grid-cols-2 gap-4">
            <Field type="date" label="Assigned Date" value={assignedDate} onChange={setAssignedDate} />
            <FieldSelect
              label="Initial Status"
              value={status}
              onChange={setStatus}
              options={CREATE_STATUS_OPTIONS}
            />
          </div>

          {/* 11. Repeated Date (Daily Recurrence Toggle) */}
          <div className="flex items-center justify-between rounded-xl border border-border bg-surface p-4">
            <div>
              <p className="text-sm font-semibold text-primary">Repeat Task Daily</p>
              <p className="text-xs text-secondary">Automatically recreate this task every day upon completion</p>
            </div>
            <Toggle
              checked={isRecurring}
              onChange={setIsRecurring}
            />
          </div>

          {/* Context Fields */}
          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border">
            <FieldSelect
              label="Project"
              value={projectId}
              onChange={(v) => { setProjectId(v); if (v) setDepartmentId(''); }}
              options={[NONE, ...projects]}
            />
            <FieldSelect
              label="Department"
              value={departmentId}
              onChange={(v) => { setDepartmentId(v); if (v) setProjectId(''); }}
              options={[NONE, ...departments]}
            />
          </div>

          <FieldSelect
            label="Company / Client (Optional)"
            value={companyId}
            onChange={setCompanyId}
            options={[NONE, ...companies]}
          />
        </div>

        {/* Action Footer */}
        <div className="border-t border-border bg-surface px-6 py-4">
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              onClick={onClose}
              disabled={loading}
              variant="ghost"
              className="bg-white text-secondary border border-border hover:bg-subtle"
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={loading || !title || !hasParent}>
              {loading ? 'Creating...' : 'Create Task'}
            </Button>
          </div>
        </div>
      </form>
    </Drawer>
  );
}
