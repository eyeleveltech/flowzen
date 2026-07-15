'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import toast from 'react-hot-toast';
import { formatDate } from '@/lib/utils';
import { TASK_STATUSES, TASK_STATUS_LABELS, TASK_STATUS_COLORS } from '@/lib/task-status';
import { useConfirmStore, useTimeTrackingStore } from '@/stores';

const titleCase = (s?: string | null) =>
  s ? s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—';

const priorityDots: Record<string, string> = {
  LOW: 'bg-gray-300', MEDIUM: 'bg-blue-400', HIGH: 'bg-orange-500', URGENT: 'bg-red-500',
};

interface TaskDetailDrawerProps {
  taskId: string;
  onClose: () => void;
  onChanged?: () => void;          // called after status/comment changes so a parent can refresh
  onEdit?: (task: any) => void;    // optional: parent opens its own edit form
  canManage?: boolean;             // base permission (e.g. manager role)
  currentUserId?: string;          // assignees can manage their own task even without canManage
}

function Row({ label, value, highlight, danger }: { label: string; value?: string | null; highlight?: boolean; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-[#F3F4F6]">
      <span className="text-sm text-secondary">{label}</span>
      {highlight ? (
        <span className={`text-sm font-semibold px-2.5 py-1 rounded-lg border ${danger ? 'bg-red-50 text-red-700 border-red-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>{value || '—'}</span>
      ) : (
        <span className="text-sm font-medium text-primary">{value || '—'}</span>
      )}
    </div>
  );
}

export function TaskDetailDrawer({ taskId, onClose, onChanged, onEdit, canManage = true, currentUserId }: TaskDetailDrawerProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [task, setTask] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);
  const { confirm } = useConfirmStore();

  // Managers can always manage; any assignee can manage their own task.
  const manage = canManage || (!!currentUserId && (
    task?.assignee?.id === currentUserId ||
    (task?.assignees || []).some((a: any) => a.id === currentUserId)
  ));
  const dueOverdue = !!(task?.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'COMPLETED' && task.status !== 'ON_HOLD');

  async function deleteTask() {
    const ok = await confirm({
      title: 'Delete Task',
      message: 'Are you sure you want to delete this task? This action cannot be undone.',
      confirmText: 'Delete Task',
      cancelText: 'Cancel',
    });
    if (!ok) return;
    try {
      await api.delete(`/tasks/${taskId}`);
      toast.success('Task deleted');
      onChanged?.();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete task');
    }
  }

  async function fetchTask() {
    try {
      const data = await api.get<any>(`/tasks/${taskId}`);
      setTask(data);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load task');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchTask();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // Lock body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  async function updateStatus(status: string) {
    setTask((prev: any) => (prev ? { ...prev, status } : prev));
    try {
      await api.put(`/tasks/${taskId}`, { status });
      toast.success('Status updated');
      onChanged?.();
      
      if (status === 'COMPLETED') {
        onClose();
        const hours = await useTimeTrackingStore.getState().prompt({ taskId, taskTitle: task?.title || 'Task' });
        if (hours) {
          await api.put(`/tasks/${taskId}`, { loggedHours: hours });
          toast.success('Time logged');
          onChanged?.();
        }
        return;
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to update status');
      fetchTask();
    }
  }

  async function addComment() {
    if (!comment.trim()) return;
    setPosting(true);
    try {
      await api.post(`/tasks/${taskId}/comments`, { content: comment });
      setComment('');
      toast.success('Comment added');
      fetchTask();
      onChanged?.();
    } catch (err: any) {
      toast.error(err.message || 'Failed to add comment');
    } finally {
      setPosting(false);
    }
  }

  if (!mounted) return null;

  return createPortal(
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-100 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        className="fixed right-0 top-0 bottom-0 z-101 w-full max-w-2xl bg-white border-l border-border shadow-2xl shadow-black/10 overflow-y-auto"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6] sticky top-0 bg-white z-10">
          <h2 className="text-lg font-semibold text-primary">Task Details</h2>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-[#F3F4F6] transition-colors"><X className="h-4 w-4 text-secondary" /></button>
        </div>

        {loading || !task ? (
          <div className="p-10 flex justify-center"><div className="h-7 w-7 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
        ) : (
          <div className="p-6 pb-24 md:pb-6">
            <div className="flex items-center justify-between border-b border-[#F3F4F6] pb-4 mb-4">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium ${TASK_STATUS_COLORS[task.status]}`}>{task.status.replace('_', ' ')}</span>
                <span className={`h-2 w-2 rounded-full ${priorityDots[task.priority]}`} />
              </div>
              {manage && (
                <div className="flex items-center gap-2">
                  {onEdit && (
                    <button onClick={() => onEdit(task)} className="rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-[#374151] hover:bg-[#F9FAFB] transition-all">Edit</button>
                  )}
                  <button onClick={deleteTask} className="rounded-xl border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 hover:border-red-300 transition-all flex items-center gap-1.5">
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                </div>
              )}
            </div>

            <h2 className="text-xl font-semibold text-primary mb-2">{task.title}</h2>
            {task.description && <div className="text-sm text-secondary mb-4 prose prose-sm prose-slate max-w-none" dangerouslySetInnerHTML={{ __html: task.description }} />}

            <div className="space-y-1">
              <Row label="Client" value={task.client?.company || task.project?.client?.company || task.client?.name || task.project?.client?.name} />
              <Row label="Project" value={task.project?.name} />
              <Row label="Task Type" value={titleCase(task.type)} />
              <Row label="Assignees" value={(task.assignees?.length ? task.assignees.map((a: any) => a.name) : (task.assignee ? [task.assignee.name] : [])).join(', ') || 'Unassigned'} highlight />
              {task.assignedBy && <Row label="Assigned By" value={task.assignedBy.name} />}
              {task.reviewer && <Row label="Reviewer" value={task.reviewer.name} />}
              <Row label="Priority" value={titleCase(task.priority)} />
              <Row label="Assigned Date" value={formatDate(task.assignedDate)} />
              <Row label="Due Date" value={formatDate(task.dueDate)} highlight danger={dueOverdue} />
              {task.completedAt && <Row label="Completed On" value={formatDate(task.completedAt)} />}
              {(task.loggedHours ?? 0) > 0 && <Row label="Time Spent" value={`⏱ ${task.loggedHours}h`} />}
              {task.driveLink && (
                <div className="flex items-center justify-between py-2 border-b border-[#F3F4F6]">
                  <span className="text-sm text-secondary">Drive Link</span>
                  <a href={task.driveLink} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-blue-600 hover:underline max-w-[220px] truncate">{task.driveLink}</a>
                </div>
              )}
              <Row label="Created" value={formatDate(task.createdAt)} />
            </div>

            {manage && (
              <div className="mt-6">
                <p className="block text-sm font-medium text-[#374151] mb-2">Update Status</p>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Update Status">
                  {TASK_STATUSES.map((s) => (
                    <button key={s} onClick={() => updateStatus(s)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${task.status === s ? 'bg-primary text-white' : 'border border-border text-secondary hover:bg-[#F9FAFB]'}`}>
                      {TASK_STATUS_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Comments */}
            <div className="mt-8 border-t border-[#F3F4F6] pt-6">
              <h3 className="text-sm font-semibold text-primary mb-4">Comments</h3>
              <div className="mb-6">
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Post an update or question..."
                  aria-label="Comment"
                  className="w-full min-h-[80px] rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary transition-all resize-none"
                />
                <div className="mt-2 flex justify-end">
                  <button onClick={addComment} disabled={posting || !comment.trim()} className="bg-primary text-white px-4 py-1.5 rounded-lg text-xs font-medium hover:bg-black transition-colors disabled:opacity-50">{posting ? 'Posting...' : 'Post Comment'}</button>
                </div>
              </div>
              <div className="space-y-4">
                {(!task.comments || task.comments.length === 0) ? (
                  <p className="text-sm text-secondary italic text-center py-4">No comments yet. Be the first to start the discussion!</p>
                ) : (
                  task.comments.map((c: any) => (
                    <div key={c.id} className="flex gap-3">
                      <div className="h-8 w-8 rounded-full bg-[#F3F4F6] text-primary text-xs font-medium flex items-center justify-center shrink-0 border border-border">{c.author.name.charAt(0).toUpperCase()}</div>
                      <div className="flex-1 bg-surface border border-border rounded-xl p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-xs text-primary">{c.author.name}</span>
                          <span className="text-[10px] text-[#9CA3AF]">{new Date(c.createdAt).toLocaleDateString()}</span>
                        </div>
                        <p className="text-sm text-[#374151] whitespace-pre-wrap">{c.content}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </motion.div>
    </>,
    document.body
  );
}
