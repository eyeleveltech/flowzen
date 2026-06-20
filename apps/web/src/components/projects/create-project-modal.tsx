'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { X } from 'lucide-react';
import { api } from '@/lib/api';
import toast from 'react-hot-toast';
import { Select } from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { TagsInput } from '@/components/ui/tags-input';
import { useMembers, useClients } from '@/hooks/useQueries';
import { getInitials, getAvatarColor, getClientDisplayName } from '@/lib/utils';
import { projectSchema, type ProjectFormValues } from '@/lib/validations';

interface CreateProjectModalProps {
  clientId: string;
  clientName: string;
  onClose: () => void;
  onSuccess: () => void;
}

// Slide-in project creation form opened from the client detail page.
// Field order/sections mirror the main Projects page create form.
export function CreateProjectModal({ clientId, clientName, onClose, onSuccess }: CreateProjectModalProps) {
  const { data: members = [] } = useMembers();
  const { data: clients = [] } = useClients();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Client options — always include the current client (default-selected), even if the
  // clients list hasn't loaded yet or it would otherwise be filtered out.
  const clientOptions = (() => {
    const opts = new Map<string, { label: string; value: string }>();
    opts.set(clientId, { label: clientName, value: clientId });
    clients
      .filter((c: any) => !['INACTIVE', 'CHURNED'].includes(c.status))
      .forEach((c: any) => { if (!opts.has(c.id)) opts.set(c.id, { label: getClientDisplayName(c), value: c.id }); });
    return Array.from(opts.values());
  })();

  const { handleSubmit, watch, setValue, formState: { errors } } = useForm<ProjectFormValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: '', description: '', clientId, ownerId: '',
      type: 'ONE_TIME', scope: '', reportingCadence: 'NONE', clientApprovalRequired: false,
      tags: [], projectNotes: '', folderLink: '', startDate: '', endDate: '',
      priority: 'MEDIUM', budget: '', status: 'PLANNING', memberIds: [], teamIds: [],
    },
  });

  const formValues = watch();

  const onSubmit = handleSubmit(async (data) => {
    setFormError('');
    setSubmitting(true);
    try {
      const payload = {
        ...data,
        budget: data.budget ? parseFloat(data.budget as any) : undefined,
        startDate: data.startDate || undefined,
        endDate: data.endDate || undefined,
      };
      await api.post('/projects', payload);
      toast.success('Project created successfully');
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create project');
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  });

  const inputClass = 'w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary transition-all';

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-100 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        className="fixed right-0 top-0 bottom-0 z-101 w-full max-w-lg bg-white border-l border-border shadow-2xl shadow-black/10 overflow-y-auto"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6] sticky top-0 bg-white z-10">
          <h2 className="text-lg font-semibold text-primary">New Project</h2>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-[#F3F4F6] transition-colors">
            <X className="h-4 w-4 text-secondary" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="p-6 space-y-8">
          {formError && <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-2 text-sm text-red-600">{formError}</div>}

          {/* Basic Info */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-primary border-b border-[#F3F4F6] pb-2">Basic Info</h3>
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Project Name *</label>
              <input value={formValues.name} onChange={(e) => setValue('name', e.target.value, { shouldValidate: true })} className={`w-full rounded-xl border ${errors.name ? 'border-red-500' : 'border-border'} bg-white px-4 py-2.5 text-sm outline-none focus:border-primary transition-all`} />
              {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Description</label>
              <RichTextEditor value={formValues.description || ''} onChange={(val) => setValue('description', val)} placeholder="Project description..." />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#374151] mb-1.5">Project Type</label>
                <Select value={formValues.type} onChange={(val) => setValue('type', val as any, { shouldValidate: true })} options={[
                  { label: 'Retainer', value: 'RETAINER' },
                  { label: 'One-Time Project', value: 'ONE_TIME' },
                  { label: 'Event', value: 'EVENT' },
                  { label: 'Internal', value: 'INTERNAL' },
                ]} />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#374151] mb-1.5">Status</label>
                <Select value={formValues.status} onChange={(val) => setValue('status', val as any)} options={[
                  { label: 'Planning', value: 'PLANNING' },
                  { label: 'In Progress', value: 'IN_PROGRESS' },
                  { label: 'In Review', value: 'REVIEW' },
                  { label: 'Completed', value: 'COMPLETED' },
                  { label: 'On Hold', value: 'ON_HOLD' },
                  { label: 'Cancelled', value: 'CANCELLED' },
                ]} />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#374151] mb-1.5">Priority</label>
                <Select value={formValues.priority} onChange={(val) => setValue('priority', val as any)} options={[
                  { label: 'Low', value: 'LOW' },
                  { label: 'Medium', value: 'MEDIUM' },
                  { label: 'High', value: 'HIGH' },
                  { label: 'Urgent', value: 'CRITICAL' },
                ]} />
              </div>
            </div>
          </div>

          {/* Client & Ownership */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-primary border-b border-[#F3F4F6] pb-2">Client & Ownership</h3>
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-[#374151] mb-1.5">Client</label>
                <Select value={formValues.clientId || ''} onChange={(val) => setValue('clientId', val, { shouldValidate: true })} options={clientOptions} />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#374151] mb-1.5">Project Owner *</label>
                <Select required value={formValues.ownerId} onChange={(val) => setValue('ownerId', val, { shouldValidate: true })} options={[{ label: 'Select owner', value: '' }, ...members.map((m: any) => ({ label: m.name, value: m.id, sublabel: (m as any).designation, avatar: getInitials(m.name) }))]} />
                {errors.ownerId && <p className="mt-1 text-xs text-red-500">{errors.ownerId.message}</p>}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Team Members</label>
              <MultiSelect
                options={members.filter((m: any) => m.id !== formValues.ownerId).map((m: any) => ({ value: m.id, label: m.name, image: getInitials(m.name), colorClass: getAvatarColor(m.name) }))}
                value={formValues.memberIds || []}
                onChange={(val) => setValue('memberIds', val)}
                placeholder="Search and select team members..."
              />
            </div>
          </div>

          {/* Timeline */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-primary border-b border-[#F3F4F6] pb-2">Timeline</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#374151] mb-1.5">Start Date</label>
                <input type="date" value={formValues.startDate || ''} onChange={(e) => setValue('startDate', e.target.value, { shouldValidate: true })} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#374151] mb-1.5">End Date {(formValues.type === 'ONE_TIME' || formValues.type === 'EVENT') ? '*' : ''}</label>
                <input type="date" value={formValues.endDate || ''} onChange={(e) => setValue('endDate', e.target.value, { shouldValidate: true })} className={inputClass} />
                {errors.endDate && <p className="mt-1 text-xs text-red-500">{errors.endDate.message}</p>}
              </div>
            </div>
          </div>

          {/* Scope */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-primary border-b border-[#F3F4F6] pb-2">Scope</h3>
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Scope of Work</label>
              <RichTextEditor value={formValues.scope || ''} onChange={(val) => setValue('scope', val)} placeholder="Enter the scope of work..." />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Budget (₹)</label>
              <input type="number" value={formValues.budget || ''} onChange={(e) => setValue('budget', e.target.value)} className={inputClass} />
            </div>
          </div>

          {/* Workflow */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-primary border-b border-[#F3F4F6] pb-2">Workflow</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#374151] mb-1.5">Reporting Cadence</label>
                <Select value={formValues.reportingCadence} onChange={(val) => setValue('reportingCadence', val as any)} options={[
                  { label: 'None', value: 'NONE' },
                  { label: 'Weekly', value: 'WEEKLY' },
                  { label: 'Fortnightly', value: 'FORTNIGHTLY' },
                  { label: 'Monthly', value: 'MONTHLY' },
                ]} />
              </div>
              <div className="flex items-center gap-3 h-full pt-6">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={formValues.clientApprovalRequired} onChange={(e) => setValue('clientApprovalRequired', e.target.checked)} />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                  <span className="ml-3 text-sm font-medium text-[#374151]">Client approval required</span>
                </label>
              </div>
            </div>
          </div>

          {/* Reference */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-primary border-b border-[#F3F4F6] pb-2">Reference</h3>
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Tags</label>
              <TagsInput value={formValues.tags || []} onChange={(val) => setValue('tags', val)} placeholder="Type and press Enter to add tags..." />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Notes</label>
              <textarea value={formValues.projectNotes || ''} onChange={(e) => setValue('projectNotes', e.target.value)} className={`${inputClass} min-h-[80px]`} placeholder="Internal project notes..." />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Folder Link (URL)</label>
              <input type="url" value={formValues.folderLink || ''} onChange={(e) => setValue('folderLink', e.target.value)} className={inputClass} />
            </div>
          </div>

          <div className="pt-4 flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] transition-all">Cancel</button>
            <button type="submit" disabled={submitting} className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] disabled:opacity-50 transition-all">{submitting ? 'Creating...' : 'Create Project'}</button>
          </div>
        </form>
      </motion.div>
    </>
  );
}
