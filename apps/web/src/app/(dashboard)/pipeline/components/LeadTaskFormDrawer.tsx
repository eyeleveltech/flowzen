'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check } from 'lucide-react';
import { api } from '@/lib/api';
import { useMembers } from '@/hooks/useQueries';
import { getInitials } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import toast from 'react-hot-toast';
import { Icon } from '@/components/ui/icon';

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

interface LeadTaskFormDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  leadId: string;
  onSuccess: () => void;
}

export function LeadTaskFormDrawer({ isOpen, onClose, leadId, onSuccess }: LeadTaskFormDrawerProps) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: '',
    assigneeId: '',
    dueDate: '',
    priority: 'MEDIUM',
    driveLink: '',
  });
  const { data: members } = useMembers();

  const resetForm = () => {
    setForm({ title: '', assigneeId: '', dueDate: '', priority: 'MEDIUM', driveLink: '' });
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
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
        driveLink: form.driveLink || null,
      });
      toast.success('Task added');
      resetForm();
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to add task');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-100 bg-black/20 backdrop-blur-sm"
          />

          {/* Drawer Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 bottom-0 z-101 w-full max-w-lg bg-white border-l border-border shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-border">
              <div>
                <h2 className="text-lg font-semibold text-primary">New Task</h2>
                <p className="text-xs text-secondary mt-0.5">Add a pre-sales task attached to this lead.</p>
              </div>
              <button
                onClick={onClose}
                className="rounded-full p-2 text-secondary hover:bg-gray-100 hover:text-primary transition-colors"
              >
                <Icon as={X} size="lg" />
              </button>
            </div>

            {/* Form Content */}
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
              <div>
                <label className="block text-xs font-semibold text-primary mb-1.5">
                  Task Title <span className="text-red-500">*</span>
                </label>
                <input
                  autoFocus
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Run website audit"
                  className="w-full rounded-xl border border-border px-4 py-2.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-1 transition-colors duration-150 motion-reduce:transition-none placeholder:text-secondary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-primary mb-1.5">Assignee</label>
                <Select
                  value={form.assigneeId}
                  onChange={(val) => setForm({ ...form, assigneeId: val })}
                  options={[
                    { label: 'Unassigned', value: '' },
                    ...(members || []).map((m: any) => ({
                      label: m.name,
                      value: m.id,
                      sublabel: m.designation || undefined,
                      avatar: getInitials(m.name),
                    })),
                  ]}
                  placeholder="Assign to..."
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-primary mb-1.5">Due Date</label>
                <input
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                  className="w-full rounded-xl border border-border px-3.5 py-2.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-1 transition-colors duration-150 motion-reduce:transition-none text-primary bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-primary mb-1.5">Drive Link</label>
                <input
                  type="url"
                  value={form.driveLink}
                  onChange={(e) => setForm({ ...form, driveLink: e.target.value })}
                  placeholder="https://drive.google.com/..."
                  className="w-full rounded-xl border border-border px-3.5 py-2.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-1 transition-colors duration-150 motion-reduce:transition-none text-primary bg-white placeholder:text-secondary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-primary mb-1.5">Priority</label>
                <Select
                  value={form.priority}
                  onChange={(val) => setForm({ ...form, priority: val })}
                  options={PRIORITIES.map((p) => ({
                    label: p.charAt(0) + p.slice(1).toLowerCase() + ' priority',
                    value: p,
                  }))}
                  className="w-full"
                />
              </div>
            </form>

            {/* Footer */}
            <div className="p-6 border-t border-border bg-gray-50/50 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-secondary hover:text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleSubmit()}
                disabled={saving}
                className="rounded-xl bg-primary px-5 py-2.5 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-60 transition-colors duration-150 motion-reduce:transition-none flex items-center gap-1.5 shadow-sm"
              >
                {saving ? 'Creating…' : 'Create Task'}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
