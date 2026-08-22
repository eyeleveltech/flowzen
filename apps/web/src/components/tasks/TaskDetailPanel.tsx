'use client';

import React, { useEffect, useState } from 'react';
import { Drawer } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { Toggle } from '@/components/ui/toggle';
import { api, ApiError, formatDate } from '@/lib/api-v2';
import { Pencil, Trash2, CheckCircle2, AlertTriangle, X, Clock, Check } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';

interface TaskDetailPanelProps {
  task: any | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdate?: () => void;
  timezone?: string;
  locale?: string;
}

const STATUS_BUTTONS: { value: string; label: string }[] = [
  { value: 'BACKLOG', label: 'Backlog' },
  { value: 'TODO', label: 'To Do' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'IN_REVIEW', label: 'In Review' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'BLOCKED', label: 'Blocked' },
  { value: 'ON_HOLD', label: 'On Hold' },
  { value: 'DONE', label: 'Done' },
];

const TASK_TYPE_OPTIONS = [
  { value: 'CONTENT', label: 'Content & Copy' },
  { value: 'DESIGN', label: 'Design Work' },
  { value: 'DEVELOPMENT', label: 'Development' },
  { value: 'SEO', label: 'SEO & Marketing' },
  { value: 'BUG', label: 'Bug Fix' },
  { value: 'MEETING', label: 'Meeting / Call' },
  { value: 'OTHER', label: 'Other' },
];

const STATUS_DOT_COLOR: Record<string, string> = {
  TODO: 'bg-amber-500',
  BACKLOG: 'bg-gray-400',
  IN_PROGRESS: 'bg-blue-500',
  IN_REVIEW: 'bg-purple-500',
  APPROVED: 'bg-emerald-500',
  BLOCKED: 'bg-red-500',
  ON_HOLD: 'bg-orange-500',
  DONE: 'bg-green-500',
};

const STATUS_LABEL: Record<string, string> = {
  TODO: 'To Do',
  BACKLOG: 'Backlog',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW: 'In Review',
  APPROVED: 'Approved',
  BLOCKED: 'Blocked',
  ON_HOLD: 'On Hold',
  DONE: 'Done',
};

export function TaskDetailPanel({
  task,
  isOpen,
  onClose,
  onUpdate,
  timezone = 'Asia/Kolkata',
  locale = 'en-IN',
}: TaskDetailPanelProps) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form edit fields
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [taskType, setTaskType] = useState('CONTENT');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [reviewerId, setReviewerId] = useState('');
  const [assignedById, setAssignedById] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);

  const [team, setTeam] = useState<{ value: string; label: string }[]>([]);

  // Sync state when task changes
  useEffect(() => {
    if (!task) return;
    setTitle(task.title ?? '');
    setStatus(task.status ?? 'TODO');
    setPriority(task.priority ?? 'MEDIUM');
    setTaskType(task.taskType ?? 'CONTENT');
    setDueDate(task.dueDate ? task.dueDate.slice(0, 10) : '');
    setDueTime(task.dueDate ? new Date(task.dueDate).toTimeString().slice(0, 5) : '');
    setDescription(task.description ?? '');
    setAssigneeId(task.assigneeId ?? task.assignee?.id ?? '');
    setReviewerId(task.reviewerId ?? task.reviewer?.id ?? '');
    setAssignedById(task.reviewerId ?? task.reviewer?.id ?? task.assigneeId ?? task.assignee?.id ?? '');
    setIsRecurring(Boolean(task.recurrence));
    setEditing(false);
    setError(null);
  }, [task]);

  useEffect(() => {
    if (!isOpen) return;
    void api.users
      .list()
      .then((list) =>
        setTeam(list.filter((u) => u.status === 'ACTIVE').map((u) => ({ value: u.id, label: u.name })))
      )
      .catch(() => {});
  }, [isOpen]);

  if (!task) return null;

  const currentStatus = status || task.status || 'TODO';

  const handleStatusChange = async (newStatusValue: string) => {
    let dbStatus = newStatusValue;
    if (newStatusValue === 'BACKLOG') dbStatus = 'TODO';
    if (newStatusValue === 'APPROVED') dbStatus = 'APPROVED';
    if (newStatusValue === 'ON_HOLD') dbStatus = 'ON_HOLD';

    setError(null);
    setStatus(dbStatus);
    try {
      await api.projects.updateTask(task.id, { status: dbStatus });
      onUpdate?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update status');
      setStatus(task.status);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      let finalDueDate: string | null = null;
      if (dueDate) {
        const dateObj = new Date(dueDate);
        if (dueTime) {
          const [hours, minutes] = dueTime.split(':');
          dateObj.setHours(parseInt(hours, 10), parseInt(minutes, 10));
        }
        finalDueDate = dateObj.toISOString();
      }

      await api.projects.updateTask(task.id, {
        title,
        status,
        priority,
        taskType,
        description: description || null,
        dueDate: finalDueDate,
        assigneeId: assigneeId || null,
        reviewerId: reviewerId || null,
        recurrence: isRecurring ? { frequency: 'DAILY', interval: 1 } : null,
      });
      setEditing(false);
      onUpdate?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save task');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await api.projects.deleteTask(task.id);
      setConfirmDelete(false);
      onUpdate?.();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete task');
    } finally {
      setDeleting(false);
    }
  };

  const formattedDueDate = task.dueDate
    ? formatDate(task.dueDate, timezone, locale)
    : 'No due date';

  const formattedCreatedDate = task.createdAt
    ? formatDate(task.createdAt, timezone, locale)
    : 'Aug 18';

  const NONE = { value: '', label: '— None —' };

  return (
    <>
      <Drawer isOpen={isOpen} onClose={onClose} variant="slideover" title="Task Details">
        <div className="flex h-full flex-col bg-white">
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            {error && (
              <div className="rounded-xl bg-red-50 p-3.5 text-sm text-red-700 border border-red-200 font-medium">
                {error}
              </div>
            )}

            {/* In-Review Reviewer Banner & Action */}
            {task.awaitingMyReview && currentStatus === 'IN_REVIEW' && (
              <div className="flex items-center justify-between rounded-xl bg-amber-500/10 border border-amber-500/30 p-4">
                <div className="flex items-center gap-2.5">
                  <span className="h-3 w-3 rounded-full bg-amber-400 shrink-0 animate-pulse" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">Ready for your Review</p>
                    <p className="text-xs text-amber-700">You are the designated reviewer for this task.</p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="primary"
                  className="bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5 font-semibold"
                  onClick={() => handleStatusChange('APPROVED')}
                >
                  <Check className="h-4 w-4" /> Approve Task
                </Button>
              </div>
            )}

            {/* Header Actions Bar: Status Badge + Edit / Delete buttons */}
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-1 text-xs font-semibold text-primary">
                <span>{STATUS_LABEL[currentStatus] ?? currentStatus}</span>
                <span className={`h-2 w-2 rounded-full ${STATUS_DOT_COLOR[currentStatus] ?? 'bg-amber-500'}`} />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(!editing)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1 text-xs font-medium text-secondary hover:text-primary hover:bg-subtle transition-colors"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  {editing ? 'Cancel' : 'Edit'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-100 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            </div>

            {/* Editing Mode */}
            {editing ? (
              <div className="space-y-4 bg-surface p-4 rounded-xl border border-border">
                <Field label="Task Title" value={title} onChange={setTitle} required />

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Due Date" type="date" value={dueDate} onChange={setDueDate} />
                  <Field label="Due Time" type="time" value={dueTime} onChange={setDueTime} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <FieldSelect label="Task Type" value={taskType} onChange={setTaskType} options={TASK_TYPE_OPTIONS} />
                  <FieldSelect
                    label="Priority"
                    value={priority}
                    onChange={setPriority}
                    options={[
                      { value: 'LOW', label: 'Low' },
                      { value: 'MEDIUM', label: 'Medium' },
                      { value: 'HIGH', label: 'High' },
                      { value: 'URGENT', label: 'Urgent' },
                    ]}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <FieldSelect label="Assignee" value={assigneeId} onChange={setAssigneeId} options={[NONE, ...team]} />
                  <FieldSelect label="Reviewer" value={reviewerId} onChange={setReviewerId} options={[NONE, ...team]} />
                </div>

                {/* Repeat Task Daily Toggle */}
                <div className="flex items-center justify-between rounded-xl border border-border bg-white p-3">
                  <div>
                    <p className="text-xs font-semibold text-primary">Repeat Task Daily</p>
                    <p className="text-[11px] text-secondary">Automatically repeats daily</p>
                  </div>
                  <Toggle checked={isRecurring} onChange={setIsRecurring} />
                </div>

                {/* Description Editor */}
                <div>
                  <label className="block text-xs font-semibold text-secondary mb-1">Description</label>
                  <div className="min-h-32 border rounded-xl border-border bg-white overflow-hidden">
                    <RichTextEditor value={description} onChange={setDescription} />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="primary" onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </div>
            ) : (
              /* View Mode */
              <>
                {/* Title */}
                <h2 className="text-xl font-bold text-primary tracking-tight">{task.title}</h2>

                {/* Key-Value Property Rows */}
                <div className="divide-y divide-border text-sm">
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-secondary font-medium">Client</span>
                    <span className="font-semibold text-primary">
                      {task.project?.company?.name ?? 'Heaven Elix'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-secondary font-medium">Project</span>
                    <span className="font-semibold text-primary">
                      {task.project?.name ?? task.deal?.title ?? '—'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-secondary font-medium">Task Type</span>
                    <span className="font-semibold text-primary">
                      {task.taskType ?? 'Content'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-secondary font-medium">Assignees</span>
                    <span className="inline-flex items-center rounded-lg bg-blue-50 border border-blue-200 px-3 py-1 text-xs font-semibold text-blue-600">
                      {task.assignee?.name ?? 'Harish Saravanan'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-secondary font-medium">Reviewer / Assigned By</span>
                    <span className="font-semibold text-primary">
                      {task.reviewer?.name ?? task.assignee?.name ?? 'Harish Saravanan'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-secondary font-medium">Priority</span>
                    <span className="font-semibold text-primary capitalize">
                      {task.priority ? task.priority.toLowerCase() : 'High'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-secondary font-medium">Assigned Date</span>
                    <span className="font-medium text-primary">{formattedCreatedDate}</span>
                  </div>

                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-secondary font-medium">Due Date</span>
                    <span className="inline-flex items-center rounded-lg bg-blue-50 border border-blue-200 px-3 py-1 text-xs font-semibold text-blue-600">
                      {formattedDueDate}
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-secondary font-medium">Repeat Status</span>
                    <span className="font-semibold text-primary">
                      {task.recurrence ? 'Repeats Daily' : 'One-time Task'}
                    </span>
                  </div>
                </div>

                {/* Update Status Section */}
                <div className="pt-3 space-y-3">
                  <h3 className="text-sm font-bold text-primary">Update Status</h3>
                  <div className="flex flex-wrap gap-2">
                    {STATUS_BUTTONS.map((btn) => {
                      const isActive = currentStatus === btn.value;

                      return (
                        <button
                          key={btn.value}
                          type="button"
                          onClick={() => handleStatusChange(btn.value)}
                          className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition-all ${
                            isActive
                              ? btn.value === 'APPROVED'
                                ? 'bg-emerald-600 text-white font-bold'
                                : 'bg-[#111827] text-white font-semibold'
                              : 'bg-white text-body border border-border hover:bg-subtle'
                          }`}
                        >
                          {btn.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Optional Task Description */}
                {task.description && (
                  <div className="pt-2">
                    <p className="text-xs font-semibold text-secondary mb-1.5 uppercase tracking-wider">
                      Description
                    </p>
                    <div
                      className="prose prose-sm max-w-none text-body rounded-xl border border-border bg-surface/50 p-4"
                      dangerouslySetInnerHTML={{ __html: task.description }}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </Drawer>

      {/* Delete Confirmation Modal */}
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete Task">
        <ModalBody>
          <p className="text-sm text-body">
            Are you sure you want to delete <strong>"{task.title}"</strong>? This action cannot be undone.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete} loading={deleting}>
            Delete Task
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
