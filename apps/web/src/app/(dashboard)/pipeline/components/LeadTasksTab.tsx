'use client';

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Loader2, Trash2, Check, X, CalendarDays, User } from 'lucide-react';
import { api } from '@/lib/api';
import { useMembers } from '@/hooks/useQueries';
import { getInitials, getAvatarColor } from '@/lib/utils';
import toast from 'react-hot-toast';

// Pre-sales work (audits, research, follow-up prep) hangs off the Lead itself — there is no
// Client or Project yet at this point in the pipeline, and creating one just to hold a task
// is what used to produce duplicate company records.

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

const priorityClass = (p: string) =>
  p === 'URGENT' || p === 'HIGH'
    ? 'bg-red-50 text-red-700 border-red-200'
    : p === 'MEDIUM'
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-green-50 text-green-700 border-green-200';

export function LeadTasksTab({ leadId }: { leadId: string }) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: '', assigneeId: '', dueDate: '', priority: 'MEDIUM' });
  const { data: members } = useMembers();

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ tasks: any[] }>(`/tasks?leadId=${leadId}&limit=100`);
      setTasks(r.tasks || []);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => setForm({ title: '', assigneeId: '', dueDate: '', priority: 'MEDIUM' });

  const create = async () => {
    if (!form.title.trim()) {
      toast.error('Give the task a title');
      return;
    }
    setSaving(true);
    try {
      await api.post('/tasks', {
        title: form.title.trim(),
        leadId,
        priority: form.priority,
        assigneeId: form.assigneeId || null,
        dueDate: form.dueDate || null,
      });
      toast.success('Task added');
      resetForm();
      setAdding(false);
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to add task');
    } finally {
      setSaving(false);
    }
  };

  const toggleDone = async (t: any) => {
    const next = t.status === 'COMPLETED' ? 'TODO' : 'COMPLETED';
    // Optimistic — the row flips immediately, and reverts if the request fails.
    setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, status: next } : x)));
    try {
      await api.put(`/tasks/${t.id}/status`, { status: next });
    } catch (e: any) {
      setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, status: t.status } : x)));
      toast.error(e?.message || 'Failed to update task');
    }
  };

  const remove = async (t: any) => {
    if (!window.confirm(`Delete "${t.title}"?`)) return;
    try {
      await api.delete(`/tasks/${t.id}`);
      toast.success('Task deleted');
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to delete task');
    }
  };

  const open = tasks.filter((t) => t.status !== 'COMPLETED');
  const done = tasks.filter((t) => t.status === 'COMPLETED');

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-secondary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-primary">Tasks</h3>
          <p className="text-xs text-secondary mt-0.5">
            Pre-sales work on this lead — audits, research, prep. Carries over when the deal is won.
          </p>
        </div>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1F2937] transition-all"
          >
            <Plus className="h-3.5 w-3.5" /> Add Task
          </button>
        )}
      </div>

      <AnimatePresence>
        {adding && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-white rounded-2xl border border-border p-4 space-y-3">
              <input
                autoFocus
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
                placeholder="e.g. Run website audit"
                className="w-full rounded-xl border border-border px-4 py-2.5 text-sm outline-none focus:border-primary transition-all"
              />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <select
                  value={form.assigneeId}
                  onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}
                  className="rounded-xl border border-border px-3 py-2.5 text-sm outline-none focus:border-primary transition-all"
                >
                  <option value="">Unassigned</option>
                  {(members || []).map((m: any) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                <input
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                  className="rounded-xl border border-border px-3 py-2.5 text-sm outline-none focus:border-primary transition-all"
                />
                <select
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  className="rounded-xl border border-border px-3 py-2.5 text-sm outline-none focus:border-primary transition-all"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()} priority</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={create}
                  disabled={saving}
                  className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-[#1F2937] disabled:opacity-60 transition-all"
                >
                  {saving ? 'Adding…' : 'Add Task'}
                </button>
                <button
                  onClick={() => { setAdding(false); resetForm(); }}
                  className="rounded-xl border border-border px-4 py-2 text-xs font-medium text-secondary hover:bg-gray-50 transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {tasks.length === 0 && !adding && (
        <div className="bg-white rounded-2xl border border-border p-10 text-center">
          <p className="text-sm font-medium text-primary">No tasks yet</p>
          <p className="text-xs text-secondary mt-1">
            Add the audit or research work your team needs to do before this deal moves forward.
          </p>
        </div>
      )}

      {[{ label: 'Open', items: open }, { label: 'Completed', items: done }].map(({ label, items }) =>
        items.length === 0 ? null : (
          <div key={label} className="space-y-2">
            {done.length > 0 && (
              <p className="text-[11px] font-semibold uppercase tracking-wider text-secondary/70 px-1">
                {label} ({items.length})
              </p>
            )}
            {items.map((t) => {
              const isDone = t.status === 'COMPLETED';
              return (
                <div
                  key={t.id}
                  className="group bg-white rounded-2xl border border-border p-4 flex items-start gap-3 hover:border-gray-300 transition-all"
                >
                  <button
                    onClick={() => toggleDone(t)}
                    aria-label={isDone ? 'Mark as not done' : 'Mark as done'}
                    className={`mt-0.5 h-5 w-5 shrink-0 rounded-md border flex items-center justify-center transition-all ${
                      isDone ? 'bg-green-600 border-green-600 text-white' : 'border-gray-300 hover:border-primary'
                    }`}
                  >
                    {isDone && <Check className="h-3.5 w-3.5" />}
                  </button>

                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium ${isDone ? 'text-secondary line-through' : 'text-primary'}`}>
                      {t.title}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-1.5">
                      {t.assignee ? (
                        <span className="flex items-center gap-1.5 text-xs text-secondary">
                          <span className={`h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold ${getAvatarColor(t.assignee.name || '?')}`}>
                            {getInitials(t.assignee.name || '?')}
                          </span>
                          {t.assignee.name}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-xs text-secondary/70">
                          <User className="h-3.5 w-3.5" /> Unassigned
                        </span>
                      )}
                      {t.dueDate && (
                        <span className="flex items-center gap-1.5 text-xs text-secondary">
                          <CalendarDays className="h-3.5 w-3.5" />
                          {new Date(t.dueDate).toLocaleDateString()}
                        </span>
                      )}
                      {t.priority && (
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${priorityClass(t.priority)}`}>
                          {t.priority}
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => remove(t)}
                    aria-label="Delete task"
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-secondary hover:text-red-600 transition-all"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
