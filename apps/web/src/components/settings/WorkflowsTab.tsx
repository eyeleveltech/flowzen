import { useState } from 'react';
import { api } from '@/lib/api';
import toast from 'react-hot-toast';
import { Plus, X, Edit2, Trash2, Zap } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '@/stores';

export function WorkflowsTab({ workflows, fetchWorkflows, users }: { workflows: any[], fetchWorkflows: () => void, users: any[] }) {
  const { user } = useAuthStore();
  const [showModal, setShowModal] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: '',
    trigger: 'TASK_STATUS_CHANGE',
    condition: {},
    action: 'NOTIFY',
    targets: [] as string[],
    isActive: true
  });

  const triggerOptions = [
    { label: 'Task status changes', value: 'TASK_STATUS_CHANGE' },
    { label: 'Task is overdue', value: 'TASK_OVERDUE' },
    { label: 'Task is assigned', value: 'TASK_ASSIGNED' },
    { label: 'New task is created', value: 'TASK_CREATED' },
    { label: 'Project status changes', value: 'PROJECT_STATUS_CHANGE' },
    { label: 'Due date is approaching', value: 'TASK_DEADLINE_APPROACHING' },
  ];

  const actionOptions = [
    { label: 'Send notification', value: 'NOTIFY' },
    { label: 'Change task status', value: 'CHANGE_TASK_STATUS' },
    { label: 'Reassign task', value: 'REASSIGN_TASK' },
    { label: 'Send email', value: 'EMAIL' },
  ];

  const userOptions = users.map(u => ({ label: u.name, value: u.id }));

  const openModal = (workflow: any = null) => {
    if (workflow) {
      setEditingWorkflow(workflow);
      setForm({
        name: workflow.name,
        trigger: workflow.trigger,
        condition: workflow.condition || {},
        action: workflow.action,
        targets: workflow.targets || [],
        isActive: workflow.isActive
      });
    } else {
      setEditingWorkflow(null);
      setForm({
        name: '', trigger: 'TASK_STATUS_CHANGE', condition: {}, action: 'NOTIFY', targets: [], isActive: true
      });
    }
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingWorkflow) {
        await api.put(`/settings/workflows/${editingWorkflow.id}`, form);
        toast.success('Workflow updated');
      } else {
        await api.post('/settings/workflows', form);
        toast.success('Workflow created');
      }
      setShowModal(false);
      fetchWorkflows();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save workflow');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this workflow rule?')) return;
    try {
      await api.delete(`/settings/workflows/${id}`);
      toast.success('Workflow deleted');
      fetchWorkflows();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete workflow');
    }
  };

  const handleToggleActive = async (workflow: any) => {
    try {
      await api.put(`/settings/workflows/${workflow.id}`, { ...workflow, isActive: !workflow.isActive });
      fetchWorkflows();
    } catch (err: any) {
      toast.error('Failed to toggle workflow');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-primary">Workflows & Automation</h2>
          <p className="text-sm text-secondary">Automate tasks, notifications, and status updates.</p>
        </div>
        <button
          onClick={() => openModal()}
          className="bg-primary text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-black transition-colors flex items-center justify-center gap-2 shrink-0 self-start sm:self-auto"
        >
          <Plus className="h-4 w-4" /> Add Rule
        </button>
      </div>

      <div className="bg-white border border-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm min-w-190">
            <thead className="bg-surface border-b border-border">
              <tr>
                <th className="px-5 py-3 font-semibold text-secondary uppercase tracking-wide text-xs">Rule Name</th>
                <th className="px-5 py-3 font-semibold text-secondary uppercase tracking-wide text-xs">Trigger</th>
                <th className="px-5 py-3 font-semibold text-secondary uppercase tracking-wide text-xs">Action</th>
                <th className="px-5 py-3 font-semibold text-secondary uppercase tracking-wide text-xs">Creator</th>
                <th className="px-5 py-3 font-semibold text-secondary uppercase tracking-wide text-xs text-right">Status & Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {workflows.map((w) => (
                <tr key={w.id} className="hover:bg-surface transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
                        <Zap className="h-4 w-4" />
                      </div>
                      <span className="font-semibold text-primary">{w.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-secondary">
                    {triggerOptions.find(t => t.value === w.trigger)?.label || w.trigger}
                  </td>
                  <td className="px-5 py-3 text-secondary">
                    {actionOptions.find(a => a.value === w.action)?.label || w.action}
                  </td>
                  <td className="px-5 py-3 text-secondary text-xs">
                    {w.creator?.name || 'System'} <br />
                    <span className="opacity-70">{w.creator?.role || ''}</span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-4">
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" className="sr-only peer" checked={w.isActive} onChange={() => handleToggleActive(w)} />
                        <div className="w-9 h-5 bg-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-[#D1D5DB] after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                      </label>
                      <button onClick={() => openModal(w)} className="p-1.5 text-secondary hover:text-primary hover:bg-[#F3F4F6] rounded-md transition-colors">
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button onClick={() => handleDelete(w.id)} className="p-1.5 text-secondary hover:text-red-600 hover:bg-red-50 rounded-md transition-colors">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {workflows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-secondary text-sm">
                    No workflow rules created yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl shadow-black/10 w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
              <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-border bg-surface shrink-0">
                <h3 className="text-base font-semibold text-primary">{editingWorkflow ? 'Edit Workflow' : 'Create Workflow Rule'}</h3>
                <button onClick={() => setShowModal(false)} className="text-secondary hover:text-primary"><X className="h-5 w-5" /></button>
              </div>
              <div className="p-4 sm:p-6 overflow-y-auto">
                <form id="workflow-form" onSubmit={handleSave} className="space-y-5">
                  <div className="space-y-1.5">
                    <label htmlFor="wf-name" className="text-xs font-medium text-secondary uppercase tracking-wide">Rule Name</label>
                    <input id="wf-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Notify Manager on Review" className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-primary focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" />
                  </div>
                  
                  <div className="space-y-1.5 z-40 relative">
                    <label htmlFor="wf-trigger" className="text-xs font-medium text-secondary uppercase tracking-wide">Trigger (When this happens)</label>
                    <Select id="wf-trigger" ariaLabel="Trigger" value={form.trigger} onChange={(val) => setForm({ ...form, trigger: val })} options={triggerOptions} />
                  </div>

                  <div className="space-y-1.5 z-30 relative">
                    <label htmlFor="wf-action" className="text-xs font-medium text-secondary uppercase tracking-wide">Action (Then do this)</label>
                    <Select id="wf-action" ariaLabel="Action" value={form.action} onChange={(val) => setForm({ ...form, action: val })} options={actionOptions} />
                  </div>

                  <div className="space-y-1.5 z-20 relative">
                    <label htmlFor="wf-targets" className="text-xs font-medium text-secondary uppercase tracking-wide">Who to notify (Targets)</label>
                    <MultiSelect
                      id="wf-targets"
                      compact={false}
                      options={userOptions}
                      value={form.targets}
                      onChange={(targets) => setForm({ ...form, targets })}
                      placeholder="Select team members..."
                    />
                  </div>

                  {!editingWorkflow && (
                    <div className="space-y-1.5">
                      <label htmlFor="wf-creator-role" className="text-xs font-medium text-secondary uppercase tracking-wide">Creator Role</label>
                      <input id="wf-creator-role" disabled value={user?.role || ''} className="w-full bg-[#F9FAFB] border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-secondary outline-none" />
                    </div>
                  )}
                </form>
              </div>
              <div className="p-4 sm:p-6 pt-4 border-t border-border bg-surface shrink-0 flex gap-3">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-border text-[#374151] font-medium hover:bg-surface transition-colors">Cancel</button>
                <button type="submit" form="workflow-form" disabled={saving} className="flex-1 bg-primary text-white px-4 py-2.5 rounded-xl font-medium hover:bg-black transition-colors disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save Rule'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
