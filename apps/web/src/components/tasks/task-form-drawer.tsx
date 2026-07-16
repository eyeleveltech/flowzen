'use client';

import { useState, useEffect, useMemo } from 'react';
import { z } from 'zod';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { getInitials, getAvatarColor } from '@/lib/utils';
import { TASK_STATUS_OPTIONS } from '@/lib/task-status';
import { Select } from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { useAuthStore, useTimeTrackingStore } from '@/stores';
import { useProjects, useMembers, useClients } from '@/hooks/useQueries';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { getClientDisplayName } from '@/lib/utils';

const taskSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  type: z.string().optional(),
  clientId: z.string().optional(),
  projectId: z.string().min(1, 'Project is required'),
  assigneeId: z.string().optional(),
  assigneeIds: z.array(z.string()).optional(),
  reviewerId: z.string().optional(),
  assignedById: z.string().optional(),
  priority: z.string(),
  status: z.string(),
  dueDate: z.string().optional(),
  dueDateOnly: z.string().optional(),
  dueTimeOnly: z.string().optional(),
  assignedDate: z.string().optional(),
  isRecurring: z.boolean().optional(),
  recurrenceFrequency: z.string().optional(),
});

type TaskFormValues = z.infer<typeof taskSchema>;

const formatForDateTimeLocal = (dateString?: string | null) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const blankTaskValues = (defaultProjectId = ''): TaskFormValues => ({
  title: '',
  description: '',
  type: 'OTHER',
  clientId: '',
  projectId: defaultProjectId,
  assigneeId: '',
  assigneeIds: [],
  assignedById: '',
  reviewerId: '',
  priority: 'MEDIUM',
  status: 'TODO',
  dueDate: '',
  dueDateOnly: new Date().toISOString().split('T')[0],
  dueTimeOnly: '',
  assignedDate: new Date().toISOString().split('T')[0],
  isRecurring: false,
  recurrenceFrequency: 'WEEKLY',
});

interface TaskFormDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  taskToEdit?: any | null;
  projectId?: string; // Scopes the form to a specific project (hides project selector)
  onSuccess: (task: any) => void;
}

export function TaskFormDrawer({ isOpen, onClose, taskToEdit, projectId: propProjectId, onSuccess }: TaskFormDrawerProps) {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  const { data: projectsData } = useProjects();
  const projects = useMemo(() => projectsData?.pages.flatMap((page) => page.projects) || [], [projectsData]);
  const { data: members = [] } = useMembers();
  const { data: clients = [] } = useClients();

  const clientOptions = useMemo(() => {
    return clients
      .filter((c: any) => c.status !== 'CHURNED')
      .map((c: any) => ({ label: getClientDisplayName(c), value: c.id }));
  }, [clients]);

  const isEditing = !!taskToEdit;

  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<TaskFormValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: blankTaskValues(propProjectId || ''),
  });

  const selectedProjectId = watch('projectId') || propProjectId;
  const selectedClientId = watch('clientId');

  const filteredProjectOptions = useMemo(() => {
    let filtered = projects;
    if (selectedClientId) {
      filtered = projects.filter((p: any) => (p.client?.id || p.clientId) === selectedClientId);
    }
    return filtered.map((p: any) => ({ label: p.name, value: p.id }));
  }, [projects, selectedClientId]);

  const handleCompanyChange = (val: string, onChange: (v: string) => void) => {
    onChange(val);
    
    // If selected Project doesn't belong to the newly selected Company, clear it
    if (val) {
      const currentProjId = watch('projectId');
      if (currentProjId) {
        const proj = projects.find((p: any) => p.id === currentProjId);
        const projClientId = proj?.client?.id || proj?.clientId;
        if (projClientId !== val) {
          setValue('projectId', '');
        }
      }
    } else {
      setValue('projectId', '');
    }
  };

  const handleProjectChange = (val: string, onChange: (v: string) => void) => {
    onChange(val);
    
    if (val) {
      const proj = projects.find((p: any) => p.id === val);
      const projClientId = proj?.client?.id || proj?.clientId || '';
      setValue('clientId', projClientId);
    }
  };

  // Initialize/Reset form on open or taskToEdit change
  useEffect(() => {
    if (isOpen) {
      if (taskToEdit) {
        let dateStr = '';
        let timeStr = '';
        if (taskToEdit.dueDate) {
          const d = new Date(taskToEdit.dueDate);
          if (!isNaN(d.getTime())) {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const hours = String(d.getHours()).padStart(2, '0');
            const minutes = String(d.getMinutes()).padStart(2, '0');
            dateStr = `${year}-${month}-${day}`;
            timeStr = (hours === '23' && minutes === '59') ? '' : `${hours}:${minutes}`;
          }
        }
        const tProjId = taskToEdit.project?.id || taskToEdit.projectId || propProjectId || '';
        const tProj = projects.find((p: any) => p.id === tProjId);
        const tClientId = tProj?.client?.id || tProj?.clientId || taskToEdit.project?.client?.id || taskToEdit.project?.clientId || '';

        reset({
          title: taskToEdit.title,
          description: taskToEdit.description || '',
          type: taskToEdit.type || 'OTHER',
          clientId: tClientId,
          projectId: tProjId,
          assigneeIds: taskToEdit.assignees?.length
            ? taskToEdit.assignees.map((a: any) => a.id)
            : taskToEdit.assignee
            ? [taskToEdit.assignee.id]
            : [],
          reviewerId: taskToEdit.reviewer?.id || '',
          priority: taskToEdit.priority,
          status: taskToEdit.status,
          dueDate: taskToEdit.dueDate ? formatForDateTimeLocal(taskToEdit.dueDate) : '',
          dueDateOnly: dateStr,
          dueTimeOnly: timeStr,
          assignedDate: taskToEdit.assignedDate ? new Date(taskToEdit.assignedDate).toISOString().split('T')[0] : '',
          assignedById: taskToEdit.assignedBy?.id || '',
          isRecurring: taskToEdit.isRecurring || false,
          recurrenceFrequency: taskToEdit.recurrenceFrequency || 'WEEKLY',
        });
      } else {
        const defaultClientId = propProjectId ? (projects.find((p: any) => p.id === propProjectId)?.client?.id || projects.find((p: any) => p.id === propProjectId)?.clientId || '') : '';
        reset({
          ...blankTaskValues(propProjectId || ''),
          clientId: defaultClientId,
        });
      }
    }
  }, [isOpen, taskToEdit, propProjectId, reset, projects]);

  const availableAssignees = useMemo(() => {
    const addUser = (u: any, enrichedUsers: Map<string, any>) => {
      if (!u || enrichedUsers.has(u.id)) return;
      const mem = members.find((m) => m.id === u.id);
      const activeTasks = mem?.activeTasks ?? 0;
      const capacity = mem?.capacity ?? 100;
      const overloadThreshold = mem?.overloadThreshold ?? 25;
      const enriched = {
        ...u,
        capacity,
        activeTasks,
        overloadThreshold,
        designation: u.designation || mem?.designation || '',
      };
      enrichedUsers.set(u.id, enriched);
    };

    const users = new Map<string, any>();
    if (selectedProjectId) {
      const proj = projects.find((p) => p.id === selectedProjectId);
      if (proj) {
        proj.members?.forEach((m: any) => {
          if (m.user) addUser(m.user, users);
        });
        proj.teams?.forEach((t: any) => {
          t.team?.members?.forEach((m: any) => {
            if (m.id) addUser(m, users);
          });
        });
        if (proj.owner?.id) addUser(proj.owner, users);
      }
    } else {
      members.forEach((m: any) => users.set(m.id, m));
    }
    return Array.from(users.values());
  }, [selectedProjectId, projects, members]);

  const onInvalid = (formErrors: any) => {
    console.log('Form validation failed:', formErrors);
    const drawer = document.getElementById('task-form-drawer-container');
    if (drawer) {
      drawer.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const onSubmitForm = async (data: TaskFormValues) => {
    setSubmitting(true);
    let combinedDueDate: string | undefined = undefined;
    if (data.dueDateOnly) {
      const timeStr = data.dueTimeOnly || '23:59';
      const localDate = new Date(`${data.dueDateOnly}T${timeStr}`);
      if (!isNaN(localDate.getTime())) {
        combinedDueDate = localDate.toISOString();
      }
    }

    try {
      const { clientId, ...rest } = data;
      const payload = {
        ...rest,
        projectId: propProjectId || data.projectId,
        assigneeIds: data.assigneeIds || [],
        reviewerId: data.reviewerId || undefined,
        dueDate: combinedDueDate,
        assignedDate: data.assignedDate || undefined,
        assignedById: data.assignedById || undefined,
      };

      let result;
      if (isEditing) {
        result = await api.put(`/tasks/${taskToEdit.id}`, payload);
        toast.success('Task updated successfully');
      } else {
        result = await api.post('/tasks', payload);
        toast.success('Task created successfully');
      }

      // Re-fetch caches
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      if (selectedProjectId) {
        queryClient.invalidateQueries({ queryKey: ['project', selectedProjectId] });
      }

      onSuccess(result);
      onClose();
    } catch (err: any) {
      toast.error(err.message || (isEditing ? 'Failed to update task' : 'Failed to create task'));
    } finally {
      setSubmitting(false);
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
            className="fixed inset-0 z-100 bg-black/20 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Drawer Panel */}
          <motion.div
            id="task-form-drawer-container"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="fixed right-0 top-0 bottom-0 z-101 w-full max-w-lg bg-white border-l border-border shadow-2xl shadow-black/10 overflow-y-auto"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6] sticky top-0 bg-white z-10">
              <h2 className="text-lg font-semibold text-primary">{isEditing ? 'Edit Task' : 'New Task'}</h2>
              <button onClick={onClose} className="p-2 rounded-xl hover:bg-[#F3F4F6] transition-colors">
                <X className="h-4 w-4 text-secondary" />
              </button>
            </div>

            <div className="p-6 pb-24 md:pb-6">
              <form onSubmit={handleSubmit(onSubmitForm, onInvalid)} className="space-y-4">
                {/* Title */}
                <div>
                  <label htmlFor="tfd-title" className="block text-sm font-medium text-[#374151] mb-1.5">
                    Title *
                  </label>
                  <input
                    id="tfd-title"
                    {...register('title')}
                    aria-invalid={!!errors.title}
                    aria-describedby={errors.title ? 'tfd-title-error' : undefined}
                    className={`w-full rounded-xl border ${
                      errors.title ? 'border-red-500' : 'border-border'
                    } bg-white px-4 py-2.5 text-sm outline-none focus:border-primary transition-all`}
                  />
                  {errors.title && (
                    <p id="tfd-title-error" aria-live="polite" className="mt-1 text-xs text-red-500">
                      {errors.title.message}
                    </p>
                  )}
                </div>

                {/* Due Date & Time */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="tfd-dueDateOnly" className="block text-sm font-medium text-[#374151] mb-1.5">
                      Due Date
                    </label>
                    <input
                      id="tfd-dueDateOnly"
                      type="date"
                      {...register('dueDateOnly')}
                      className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary transition-all"
                    />
                  </div>
                  <div>
                    <label htmlFor="tfd-dueTimeOnly" className="block text-sm font-medium text-[#374151] mb-1.5">
                      Due Time (Optional)
                    </label>
                    <input
                      id="tfd-dueTimeOnly"
                      type="time"
                      {...register('dueTimeOnly')}
                      className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary transition-all"
                    />
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Description</label>
                  <Controller
                    name="description"
                    control={control}
                    render={({ field }) => (
                      <RichTextEditor
                        value={field.value || ''}
                        onChange={field.onChange}
                        placeholder="Task details..."
                      />
                    )}
                  />
                </div>

                {/* Company & Project Selection (Hidden/Disabled if propProjectId is supplied) */}
                {!propProjectId && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-[#374151] mb-1.5">Company</label>
                      <Controller
                        name="clientId"
                        control={control}
                        render={({ field }) => (
                          <Select
                            ariaLabel="Company"
                            value={field.value || ''}
                            onChange={(val) => handleCompanyChange(val, field.onChange)}
                            options={[
                              { label: 'Select company', value: '' },
                              ...clientOptions,
                            ]}
                          />
                        )}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[#374151] mb-1.5">Project *</label>
                      <Controller
                        name="projectId"
                        control={control}
                        render={({ field }) => (
                          <Select
                            ariaLabel="Project"
                            value={field.value || ''}
                            onChange={(val) => handleProjectChange(val, field.onChange)}
                            buttonClassName={errors.projectId ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}
                            options={[
                              { label: 'Select project', value: '' },
                              ...filteredProjectOptions,
                            ]}
                          />
                        )}
                      />
                      {errors.projectId && (
                        <p aria-live="polite" className="mt-1 text-xs text-red-500">
                          {errors.projectId.message}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Task Type, Reviewer & Assigned By */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Task Type</label>
                    <Controller
                      name="type"
                      control={control}
                      render={({ field }) => (
                        <Select
                          ariaLabel="Task Type"
                          value={field.value || 'OTHER'}
                          onChange={field.onChange}
                          options={[
                            { label: 'Design', value: 'DESIGN' },
                            { label: 'Content', value: 'CONTENT' },
                            { label: 'Video', value: 'VIDEO' },
                            { label: 'Digital Marketing', value: 'DIGITAL_MARKETING' },
                            { label: 'Social Media', value: 'SOCIAL_MEDIA' },
                            { label: 'Development', value: 'DEVELOPMENT' },
                            { label: 'Strategy', value: 'STRATEGY' },
                            { label: 'Business', value: 'BUSINESS' },
                            { label: 'Other', value: 'OTHER' },
                          ]}
                        />
                      )}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Reviewer</label>
                    <Controller
                      name="reviewerId"
                      control={control}
                      render={({ field }) => (
                        <Select
                          ariaLabel="Reviewer"
                          value={field.value || ''}
                          onChange={field.onChange}
                          options={[
                            { label: 'No Reviewer', value: '' },
                            ...availableAssignees.map((m: any) => ({
                              label: m.name,
                              value: m.id,
                              sublabel: m.designation,
                              avatar: getInitials(m.name),
                            })),
                          ]}
                        />
                      )}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Assigned By</label>
                    <Controller
                      name="assignedById"
                      control={control}
                      render={({ field }) => (
                        <Select
                          ariaLabel="Assigned By"
                          value={field.value || ''}
                          onChange={field.onChange}
                          options={[
                            { label: 'Self (Default)', value: '' },
                            ...availableAssignees.map((m: any) => ({
                              label: m.name,
                              value: m.id,
                              sublabel: m.designation,
                              avatar: getInitials(m.name),
                            })),
                          ]}
                        />
                      )}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Priority</label>
                    <Controller
                      name="priority"
                      control={control}
                      render={({ field }) => (
                        <Select
                          ariaLabel="Priority"
                          value={field.value}
                          onChange={field.onChange}
                          options={[
                            { label: 'Low', value: 'LOW' },
                            { label: 'Medium', value: 'MEDIUM' },
                            { label: 'High', value: 'HIGH' },
                            { label: 'Urgent', value: 'URGENT' },
                          ]}
                        />
                      )}
                    />
                  </div>

                  {/* Assignees */}
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Assignees</label>
                    <Controller
                      name="assigneeIds"
                      control={control}
                      render={({ field }) => (
                        <MultiSelect
                          compact={false}
                          value={field.value || []}
                          onChange={field.onChange}
                          placeholder="Add assignees..."
                          options={availableAssignees.map((m: any) => ({
                            value: m.id,
                            label: m.name,
                            image: getInitials(m.name),
                            colorClass: getAvatarColor(m.name),
                            capacity: m.capacity,
                            isOverloaded: m.activeTasks > (m.overloadThreshold ?? 25),
                          }))}
                        />
                      )}
                    />
                  </div>

                  {/* Dates, log hours */}
                  <div>
                    <label htmlFor="tfd-assignedDate" className="block text-sm font-medium text-[#374151] mb-1.5">
                      Assigned Date
                    </label>
                    <input
                      id="tfd-assignedDate"
                      type="date"
                      {...register('assignedDate')}
                      className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary transition-all"
                    />
                  </div>


                  {/* Recurring options */}
                  <div className="flex flex-col justify-end">
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Repeat Task</label>
                    <Controller
                      name="isRecurring"
                      control={control}
                      render={({ field }) => (
                        <div className="flex items-center justify-between py-2 border border-border rounded-xl px-4 bg-white h-[46px] shadow-sm">
                          <span className="text-sm font-medium text-[#374151]">Repeat Task</span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={field.value}
                            onClick={() => field.onChange(!field.value)}
                            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
                              field.value ? 'bg-primary border-primary' : 'bg-gray-200 border-gray-300'
                            }`}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                                field.value ? 'translate-x-6' : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </div>
                      )}
                    />
                  </div>

                  {watch('isRecurring') && (
                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-[#374151] mb-1.5">Repeat Frequency</label>
                      <Controller
                        name="recurrenceFrequency"
                        control={control}
                        render={({ field }) => (
                          <Select
                            ariaLabel="Repeat Frequency"
                            value={field.value || 'WEEKLY'}
                            onChange={field.onChange}
                            options={[
                              { label: 'Daily', value: 'DAILY' },
                              { label: 'Weekly', value: 'WEEKLY' },
                              { label: 'Monthly', value: 'MONTHLY' },
                              { label: 'Yearly', value: 'YEARLY' },
                            ]}
                          />
                        )}
                      />
                    </div>
                  )}

                  {/* Status selection */}
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Task Status</label>
                    <Controller
                      name="status"
                      control={control}
                      render={({ field }) => (
                        <Select
                          ariaLabel="Status"
                          value={field.value}
                          onChange={field.onChange}
                          options={TASK_STATUS_OPTIONS}
                        />
                      )}
                    />
                  </div>
                </div>

                {/* Submit Buttons */}
                <div className="pt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] disabled:opacity-50 transition-all"
                  >
                    {submitting ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Task'}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
