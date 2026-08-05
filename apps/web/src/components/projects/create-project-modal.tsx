'use client';

import { useState, useEffect } from 'react';
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
import { useModalSafety } from '@/hooks/useModalSafety';
import { getInitials, getAvatarColor, getClientDisplayName, getProjectStatusFromClient } from '@/lib/utils';
import { projectSchema, type ProjectFormValues } from '@/lib/validations';
import { Icon } from '@/components/ui/icon';

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
      .filter((c: any) => !['PROJECT_COMPLETED', 'CHURNED'].includes(c.status))
      .forEach((c: any) => { if (!opts.has(c.id)) opts.set(c.id, { label: getClientDisplayName(c), value: c.id }); });
    return Array.from(opts.values());
  })();

  const { handleSubmit, watch, setValue, formState: { errors, isDirty } } = useForm<ProjectFormValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: '', description: '', clientId, ownerId: '',
      type: 'ONE_TIME', scope: '', reportingCadence: 'NONE', clientApprovalRequired: false,
      tags: [], projectNotes: '', folderLink: '', startDate: '', endDate: '',
      priority: 'MEDIUM', status: 'PLANNING', memberIds: [], teamIds: [],
    },
  });

  const { guardedClose, panelRef } = useModalSafety({ onClose, isDirty: () => isDirty });

  const formValues = watch();

  const selectedClientId = watch('clientId');
  useEffect(() => {
    if (selectedClientId && clients.length > 0) {
      const selectedClient = clients.find((c: any) => c.id === selectedClientId);
      if (selectedClient) {
        setValue('status', getProjectStatusFromClient(selectedClient) as any);
      }
    }
  }, [selectedClientId, clients, setValue]);

  const onSubmit = handleSubmit(async (data) => {
    setFormError('');
    setSubmitting(true);
    try {
      const payload = {
        ...data,

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

  const inputClass = 'w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-1 transition-colors duration-150 motion-reduce:transition-none';

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-100 bg-black/20 backdrop-blur-sm" onClick={guardedClose} />
      <motion.div
        ref={panelRef}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        className="fixed right-0 top-0 bottom-0 z-101 w-full max-w-lg bg-white border-l border-border shadow-modal shadow-black/10 overflow-y-auto"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6] sticky top-0 bg-white z-10">
          <h2 className="text-lg font-semibold text-primary">New Project</h2>
          <button onClick={guardedClose} className="p-2 rounded-xl hover:bg-[#F3F4F6] transition-colors">
            <Icon as={X} size="md" className="text-secondary" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="p-6 space-y-8">
          {formError && <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-2 text-sm text-red-600">{formError}</div>}

          {/* Basic Info */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-primary border-b border-[#F3F4F6] pb-2">Basic Info</h3>
            <div>
              <label htmlFor="cp-name" className="block text-sm font-medium text-[#374151] mb-1.5">Project Name *</label>
              <input id="cp-name" value={formValues.name} onChange={(e) => setValue('name', e.target.value, { shouldValidate: true })} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'cp-name-error' : undefined} className={`w-full rounded-xl border ${errors.name ? 'border-red-500' : 'border-border'} bg-white px-4 py-2.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-1 transition-colors duration-150 motion-reduce:transition-none`} />
              {errors.name && <p id="cp-name-error" aria-live="polite" className="mt-1 text-xs text-red-500">{errors.name.message}</p>}
            </div>
            <div>
              <label htmlFor="cp-description" className="block text-sm font-medium text-[#374151] mb-1.5">Description</label>
              <RichTextEditor value={formValues.description || ''} onChange={(val) => setValue('description', val)} placeholder="Project description..." />
            </div>
            {/* Two columns, never four. Tailwind breakpoints measure the VIEWPORT, but this form
                lives in a fixed max-w-lg (512px) slide-over — so `md:grid-cols-4` fired on any
                normal monitor and squeezed four dropdowns into ~115px each, truncating their
                values to "One-…", "In Pro…" and "Medi…". The panel width is what matters here,
                and it never changes. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#374151] mb-1.5">Project Type</label>
                <Select ariaLabel="Project Type" value={formValues.type} onChange={(val) => setValue('type', val as any, { shouldValidate: true })} options={[
                  { label: 'Retainer', value: 'RETAINER' },
                  { label: 'One-Time Project', value: 'ONE_TIME' },
                  { label: 'Event', value: 'EVENT' },
                  { label: 'Internal', value: 'INTERNAL' },
                ]} />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#374151] mb-1.5">Reporting Cadence</label>
                <Select ariaLabel="Reporting Cadence" value={formValues.reportingCadence || (formValues.type === 'RETAINER' ? 'MONTHLY' : 'NONE')} onChange={(val) => setValue('reportingCadence', val as any)} options={[
                  { label: 'None', value: 'NONE' },
                  { label: 'Weekly', value: 'WEEKLY' },
                  { label: 'Fortnightly (Biweekly)', value: 'FORTNIGHTLY' },
                  { label: 'Monthly', value: 'MONTHLY' },
                ]} />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#374151] mb-1.5">Status</label>
                <Select ariaLabel="Status" value={formValues.status} onChange={(val) => setValue('status', val as any)} options={[
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
                <Select ariaLabel="Priority" value={formValues.priority} onChange={(val) => setValue('priority', val as any)} options={[
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
                <Select ariaLabel="Client" value={formValues.clientId || ''} onChange={(val) => setValue('clientId', val, { shouldValidate: true })} options={clientOptions} />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#374151] mb-1.5">Project Owner *</label>
                <Select ariaLabel="Project Owner" required value={formValues.ownerId} onChange={(val) => setValue('ownerId', val, { shouldValidate: true })} options={[{ label: 'Select owner', value: '' }, ...members.map((m: any) => ({ label: m.name, value: m.id, sublabel: (m as any).designation, avatar: getInitials(m.name) }))]} />
                {errors.ownerId && <p aria-live="polite" className="mt-1 text-xs text-red-500">{errors.ownerId.message}</p>}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Team Members</label>
              <MultiSelect
                compact={false}
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
                <label htmlFor="cp-startDate" className="block text-sm font-medium text-[#374151] mb-1.5">Start Date</label>
                <input id="cp-startDate" type="date" value={formValues.startDate || ''} onChange={(e) => setValue('startDate', e.target.value, { shouldValidate: true })} className={inputClass} />
              </div>
              <div>
                <label htmlFor="cp-endDate" className="block text-sm font-medium text-[#374151] mb-1.5">End Date {(formValues.type === 'ONE_TIME' || formValues.type === 'EVENT') ? '*' : ''}</label>
                <input id="cp-endDate" type="date" value={formValues.endDate || ''} onChange={(e) => setValue('endDate', e.target.value, { shouldValidate: true })} aria-invalid={!!errors.endDate} aria-describedby={errors.endDate ? 'cp-endDate-error' : undefined} className={inputClass} />
                {errors.endDate && <p id="cp-endDate-error" aria-live="polite" className="mt-1 text-xs text-red-500">{errors.endDate.message}</p>}
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

            </div>
          </div>


          <div className="pt-4 flex gap-3">
            <button type="button" onClick={guardedClose} className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] transition-colors duration-150 motion-reduce:transition-none">Cancel</button>
            <button type="submit" disabled={submitting} className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] disabled:opacity-50 transition-colors duration-150 motion-reduce:transition-none">{submitting ? 'Creating...' : 'Create Project'}</button>
          </div>
        </form>
      </motion.div>
    </>
  );
}
