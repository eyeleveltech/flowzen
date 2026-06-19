'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import { getSSE } from '@/lib/sse';
import { formatDate, getInitials, getAvatarColor, getClientDisplayName } from '@/lib/utils';
import { Plus, LayoutList, GanttChartSquare, Calendar, ChevronRight, BarChart3, Clock, LayoutGrid, Search, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/stores';
import { Select } from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { Skeleton } from '@/components/ui/skeleton';
import { TagsInput } from '@/components/ui/tags-input';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useProjects, useClients, useMembers, useTeams, useTemplates } from '@/hooks/useQueries';
import { projectSchema, type ProjectFormValues } from '@/lib/validations';
import { CalendarView } from '@/components/projects/calendar-view';

interface Project {
  id: string; name: string; description?: string | null; status: string; priority: string; progress: number;
  type: string; scope?: string | null; reportingCadence: string; clientApprovalRequired: boolean;
  tags: string[]; projectNotes?: string | null; folderLink?: string | null;
  startDate?: string | null; endDate?: string | null; budget?: number | null;
  client?: { id: string; name: string };
  owner?: { id: string; name: string; avatar?: string | null };
  _count?: { tasks: number };
}

interface Client { id: string; name: string; }
interface Member { id: string; name: string; }
interface Team { id: string; name: string; }

type ViewMode = 'list' | 'timeline' | 'calendar';

const statusColors: Record<string, string> = {
  PLANNING: 'bg-violet-50 text-violet-700', IN_PROGRESS: 'bg-blue-50 text-blue-700',
  REVIEW: 'bg-amber-50 text-amber-700', COMPLETED: 'bg-emerald-50 text-emerald-700',
  ON_HOLD: 'bg-orange-50 text-orange-700', CANCELLED: 'bg-red-50 text-red-700',
};

const priorityColors: Record<string, string> = {
  LOW: 'text-gray-400', MEDIUM: 'text-blue-500', HIGH: 'text-orange-500', CRITICAL: 'text-red-500',
};



function ProjectsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuthStore();
  const [search, setSearch] = useState('');
  const [view, setView] = useState<ViewMode>('list');
  const urlStatus = searchParams.get('status');
  const [statusFilter, setStatusFilter] = useState(urlStatus || '');
  
  useEffect(() => {
    if (urlStatus) setStatusFilter(urlStatus);
  }, [urlStatus]);
  
  const [clientFilter, setClientFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const showCreate = searchParams.get('create') === 'true';
  const setShowCreate = (open: boolean) => {
    const params = new URLSearchParams(searchParams.toString());
    if (open) params.set('create', 'true');
    else params.delete('create');
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const { handleSubmit, formState: { errors }, reset, setValue, watch } = useForm<ProjectFormValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: '', description: '', clientId: '', ownerId: '',
      type: 'ONE_TIME', scope: '', reportingCadence: 'NONE', clientApprovalRequired: false, tags: [], projectNotes: '', folderLink: '',
      startDate: '', endDate: '', priority: 'MEDIUM', budget: '', status: 'PLANNING', memberIds: [], teamIds: [],
    }
  });
  const formValues = watch();

  const {
    data,
    isLoading: isLoadingProjects,
    refetch: refetchProjects,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage
  } = useProjects(search, view === 'calendar', statusFilter, clientFilter, ownerFilter);

  const projects = data?.pages.flatMap((page) => page.projects) || [];
  const { data: clients = [] } = useClients();
  const { data: members = [] } = useMembers();
  const { data: teams = [] } = useTeams();
  const { data: templates = [] } = useTemplates();
  const loading = isLoadingProjects;

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const sse = getSSE();
    if (sse) {
      sse.on('project:created', refetchProjects);
      sse.on('project:updated', refetchProjects);
      sse.on('project:deleted', refetchProjects);
      return () => { sse.off('project:created'); sse.off('project:updated'); sse.off('project:deleted'); };
    }
  }, [refetchProjects]);

  const handleCreate = handleSubmit(async (data) => {
    setFormError('');
    setSubmitting(true);
    try {
      const payload = {
        ...data,
        budget: data.budget ? parseFloat(data.budget as any) : undefined,
        startDate: data.startDate || undefined,
        endDate: data.endDate || undefined,
      };

      if (selectedTemplateId) {
        await api.post('/projects/from-template', { ...payload, templateId: selectedTemplateId });
      } else {
        await api.post('/projects', payload);
      }
      toast.success('Project created successfully');
      setShowCreate(false);
      reset();
      setSelectedTemplateId('');
      refetchProjects();
    } catch (err: any) { 
      toast.error(err.message || 'Failed to create project');
      setFormError(err.message); 
    } finally { setSubmitting(false); }
  });

  const viewButtons = [
    { mode: 'list' as ViewMode, icon: LayoutList, label: 'List' },
    { mode: 'timeline' as ViewMode, icon: GanttChartSquare, label: 'Timeline' },
    { mode: 'calendar' as ViewMode, icon: Calendar, label: 'Calendar' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-primary tracking-tight">Projects</h1>
          <p className="text-sm text-secondary mt-1">{projects.length} projects</p>
        </div>
        <div className="flex items-center gap-3">
          {(search || statusFilter || clientFilter || ownerFilter) && (
            <button
              onClick={() => {
                setSearch('');
                setStatusFilter('');
                setClientFilter('');
                setOwnerFilter('');
                router.replace('/projects', { scroll: false });
              }}
              className="flex items-center gap-1.5 rounded-xl bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-100 transition-colors border border-red-100"
            >
              <X className="h-4 w-4" /> Clear Filters
            </button>
          )}
          {user?.role !== 'TEAM_MEMBER' && (
            <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] transition-all">
              <Plus className="h-4 w-4" /> New Project
            </button>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3 mb-6">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
          <div className="relative w-full sm:w-64 shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search projects..." className="w-full rounded-xl border border-border bg-white pl-9 pr-4 py-2 text-sm outline-none focus:border-primary transition-all" />
          </div>
          
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-32">
              <Select
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { label: 'All Statuses', value: '' },
                  { label: 'Active', value: 'ACTIVE' },
                  { label: 'Delayed', value: 'DELAYED' },
                  { label: 'Planning', value: 'PLANNING' },
                  { label: 'In Progress', value: 'IN_PROGRESS' },
                  { label: 'In Review', value: 'REVIEW' },
                  { label: 'Completed', value: 'COMPLETED' },
                  { label: 'On Hold', value: 'ON_HOLD' },
                  { label: 'Cancelled', value: 'CANCELLED' }
                ]}
              />
            </div>
            <div className="w-40">
              <Select
                value={clientFilter}
                onChange={setClientFilter}
                options={[
                  { label: 'All Clients', value: '' },
                  ...clients.filter(c => c._count?.projects > 0).map(c => ({ label: getClientDisplayName(c), value: c.id }))
                ]}
              />
            </div>
            {user?.role !== 'TEAM_MEMBER' && (
              <div className="w-40">
                <Select
                  value={ownerFilter}
                  onChange={setOwnerFilter}
                  options={[
                    { label: 'All Owners', value: '' },
                    ...members.filter(m => m.totalProjects > 0).map(m => ({ label: m.name, value: m.id }))
                  ]}
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center shrink-0 rounded-xl border border-border p-1 bg-white">
          {viewButtons.map((v) => (
            <button
              key={v.mode}
              onClick={() => setView(v.mode)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${view === v.mode ? 'bg-primary text-white' : 'text-secondary hover:text-primary'}`}
            >
              <v.icon className="h-3.5 w-3.5" /> {v.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-border bg-white p-6 space-y-4">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="flex items-center gap-4 py-3 border-b border-[#F3F4F6] last:border-0">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-24 ml-auto" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-6 w-20 rounded-lg" />
              <Skeleton className="h-6 w-6 rounded-full" />
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Views */}
          {view === 'list' && (
            <>
              {/* Desktop Table View */}
              <div className="hidden md:block rounded-2xl border border-border bg-white overflow-hidden">
                <div className="overflow-x-auto">
                <table className="w-full min-w-[800px]">
                  <thead>
                    <tr className="border-b border-[#F3F4F6]">
                      <th className="px-6 py-3.5 text-left text-xs font-medium text-secondary uppercase tracking-wide">Project</th>
                      <th className="px-6 py-3.5 text-left text-xs font-medium text-secondary uppercase tracking-wide">Client</th>
                      <th className="px-6 py-3.5 text-left text-xs font-medium text-secondary uppercase tracking-wide">Progress</th>
                      <th className="px-6 py-3.5 text-left text-xs font-medium text-secondary uppercase tracking-wide">Status</th>
                      <th className="px-6 py-3.5 text-left text-xs font-medium text-secondary uppercase tracking-wide">Owner</th>
                      <th className="px-6 py-3.5 text-left text-xs font-medium text-secondary uppercase tracking-wide">Due Date</th>
                      <th className="px-6 py-3.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F3F4F6]">
                    {projects.map((p) => (
                      <motion.tr key={p.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="hover:bg-surface cursor-pointer transition-colors" onClick={() => router.push(`/projects/${p.id}`)}>
                        <td className="px-6 py-4">
                          <p className="text-sm font-medium text-primary">{p.name}</p>
                          <p className="text-xs text-[#9CA3AF]">{p._count?.tasks ?? 0} tasks</p>
                        </td>
                        <td className="px-6 py-4 text-sm text-secondary">{p.client ? getClientDisplayName(p.client) : '—'}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-20 rounded-full bg-[#F3F4F6] overflow-hidden">
                              <div className="h-full rounded-full bg-primary" style={{ width: `${p.progress}%` }} />
                            </div>
                            <span className="text-xs text-secondary tabular-nums">{p.progress}%</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium ${statusColors[p.status] || 'bg-gray-50 text-gray-500'}`}>
                            {p.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          {p.owner && (
                            <div className="flex items-center gap-2">
 <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ${getAvatarColor(p.owner.name)}`}>
                                {getInitials(p.owner.name)}
                              </div>
                              <span className="text-sm text-[#374151]">{p.owner.name}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-secondary">{formatDate(p.endDate)}</td>
                        <td className="px-6 py-4"><ChevronRight className="h-4 w-4 text-[#D1D5DB]" /></td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden flex flex-col gap-3">
              {projects.length === 0 ? (
                <div className="p-8 text-center text-sm text-[#9CA3AF] bg-white rounded-xl border border-border">
                  No projects found.
                </div>
              ) : (
                projects.map((p) => (
                  <motion.div
                    key={p.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    onClick={() => router.push(`/projects/${p.id}`)}
                    className="p-4 rounded-xl border border-border bg-white hover:shadow-sm cursor-pointer transition-all"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="text-sm font-medium text-primary leading-tight">{p.name}</p>
                        <p className="text-xs text-secondary mt-0.5">{p.client ? getClientDisplayName(p.client) : 'Internal Project'}</p>
                      </div>
                      <span className={`shrink-0 inline-flex items-center whitespace-nowrap rounded-lg px-2 py-0.5 text-[10px] font-medium ${statusColors[p.status] || 'bg-gray-50 text-gray-500'}`}>
                        {p.status.replace('_', ' ')}
                      </span>
                    </div>

                    <div className="mb-4">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded-full bg-[#F3F4F6] overflow-hidden">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${p.progress}%` }} />
                        </div>
                        <span className="text-xs text-secondary tabular-nums shrink-0">{p.progress}%</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {p.owner ? (
                          <>
 <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ${getAvatarColor(p.owner.name)}`}>
                              {getInitials(p.owner.name)}
                            </div>
                            <span className="text-xs font-medium text-[#374151]">{p.owner.name}</span>
                          </>
                        ) : (
                          <span className="text-xs text-[#9CA3AF]">Unassigned</span>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-2 text-xs font-medium text-secondary">
                        <span className="bg-[#F3F4F6] px-1.5 py-0.5 rounded">
                          {p._count?.tasks ?? 0} tasks
                        </span>
                        {p.endDate && (
                          <span className="bg-[#F3F4F6] px-1.5 py-0.5 rounded">
                            {formatDate(p.endDate)}
                          </span>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
            </>
          )}



      {view === 'timeline' && (
        <div className="rounded-2xl border border-border bg-white p-6">
          <div className="space-y-3">
            {projects.filter((p) => p.startDate && p.endDate).map((p) => {
              const start = new Date(p.startDate!);
              const end = new Date(p.endDate!);
              const now = new Date();
              const totalDays = Math.max(1, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
              const elapsed = Math.max(0, (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
              const pct = Math.min(100, (elapsed / totalDays) * 100);

              return (
                <div key={p.id} className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4 py-3 md:py-2 cursor-pointer hover:bg-surface rounded-xl px-3 -mx-3 transition-colors border-b border-[#F3F4F6] last:border-0 md:border-0" onClick={() => router.push(`/projects/${p.id}`)}>
                  <div className="w-full md:w-48 shrink-0">
                    <p className="text-sm font-medium text-primary truncate">{p.name}</p>
                    <p className="text-xs text-[#9CA3AF]">{p.client ? getClientDisplayName(p.client) : 'Internal Project'}</p>
                  </div>
                  <div className="flex-1 w-full">
                    <div className="relative h-8 rounded-lg bg-[#F3F4F6] overflow-hidden">
                      <div className="absolute inset-y-0 left-0 rounded-lg bg-primary/10" style={{ width: `${pct}%` }} />
                      <div className="absolute inset-y-0 left-0 rounded-lg bg-primary" style={{ width: `${p.progress}%`, maxWidth: `${pct}%` }} />
                      <div className="absolute inset-0 flex items-center px-3">
                        <span className="text-xs font-medium text-white mix-blend-difference">{p.progress}%</span>
                      </div>
                    </div>
                    <div className="flex justify-between mt-1.5">
                      <span className="text-[10px] text-[#9CA3AF]">{formatDate(p.startDate)}</span>
                      <span className="text-[10px] text-[#9CA3AF]">{formatDate(p.endDate)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view === 'calendar' && (
        <CalendarView projects={projects} />
      )}

          {/* Load More Button */}
          {hasNextPage && (
            <div className="mt-6 flex justify-center pb-8">
              <button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="rounded-xl border border-border bg-white px-6 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-50 transition-all"
              >
                {isFetchingNextPage ? 'Loading...' : 'Load More Projects'}
              </button>
            </div>
          )}
        </>
      )}

      {/* Create Modal */}
      <AnimatePresence>
        {showCreate && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={() => setShowCreate(false)} />
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg bg-white border-l border-border shadow-2xl shadow-black/10 overflow-y-auto">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6]">
                <h2 className="text-lg font-semibold text-primary">New Project</h2>
                <button onClick={() => setShowCreate(false)} className="p-2 rounded-xl hover:bg-[#F3F4F6]"><X className="h-4 w-4 text-secondary" /></button>
              </div>
              <form onSubmit={handleCreate} className="relative p-6 space-y-8">
                {formError && <div className="absolute top-0 left-6 right-6 -mt-2 z-10 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 border border-red-100">{formError}</div>}
                
                {templates.length > 0 && (
                  <div className="mb-2 pb-4 border-b border-[#F3F4F6]">
                    <label className="block text-sm font-medium text-[#374151] mb-1.5 flex items-center gap-2">
                      Start from a Template <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">New</span>
                    </label>
                    <Select
                      value={selectedTemplateId}
                      onChange={(val) => {
                        setSelectedTemplateId(val);
                        if (val) {
                           const t = templates.find(x => x.id === val);
                           if (t && !formValues.name) setValue('name', t.name, { shouldValidate: true });
                        }
                      }}
                      options={[
                        { label: 'Start from scratch', value: '' },
                        ...templates.map((t) => ({ label: t.name, value: t.id }))
                      ]}
                    />
                  </div>
                )}

                {/* Basic Info */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-primary border-b border-[#F3F4F6] pb-2">Basic Info</h3>
                  <div>
                    <Field label="Project Name *" value={formValues.name} onChange={(v) => setValue('name', v, { shouldValidate: true })} required />
                    {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name.message}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Description</label>
                    <RichTextEditor value={formValues.description || ''} onChange={(val) => setValue('description', val, { shouldValidate: true })} placeholder="Project description..." />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-[#374151] mb-1.5">Project Type</label>
                      <Select
                        value={formValues.type}
                        onChange={(val) => setValue('type', val as any, { shouldValidate: true })}
                        options={[
                          { label: 'Retainer', value: 'RETAINER' },
                          { label: 'One-Time Project', value: 'ONE_TIME' },
                          { label: 'Event', value: 'EVENT' },
                          { label: 'Internal', value: 'INTERNAL' },
                        ]}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[#374151] mb-1.5">Status</label>
                      <Select
                        value={formValues.status}
                        onChange={(val) => setValue('status', val as any)}
                        options={[
                          { label: 'Planning', value: 'PLANNING' },
                          { label: 'In Progress', value: 'IN_PROGRESS' },
                          { label: 'In Review', value: 'REVIEW' },
                          { label: 'Completed', value: 'COMPLETED' },
                          { label: 'On Hold', value: 'ON_HOLD' },
                          { label: 'Cancelled', value: 'CANCELLED' },
                        ]}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[#374151] mb-1.5">Priority</label>
                      <Select
                        value={formValues.priority}
                        onChange={(val) => setValue('priority', val as any)}
                        options={[
                          { label: 'Low', value: 'LOW' },
                          { label: 'Medium', value: 'MEDIUM' },
                          { label: 'High', value: 'HIGH' },
                          { label: 'Urgent', value: 'CRITICAL' },
                        ]}
                      />
                    </div>
                  </div>
                </div>
                
                {/* Client & Ownership */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-primary border-b border-[#F3F4F6] pb-2">Client & Ownership</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-[#374151] mb-1.5">Client</label>
                      <Select
                        value={formValues.clientId || ''}
                        onChange={(val) => setValue('clientId', val, { shouldValidate: true })}
                        options={[
                          { label: 'Select a client...', value: '' },
                          ...clients.map((c) => ({ label: getClientDisplayName(c), value: c.id }))
                        ]}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[#374151] mb-1.5">Project Owner *</label>
                      <Select
                        required
                        value={formValues.ownerId}
                        onChange={(val) => setValue('ownerId', val, { shouldValidate: true })}
                        options={[
                          { label: 'Select owner', value: '' },
                          ...members.map((m) => ({ label: m.name, value: m.id }))
                        ]}
                      />
                      {errors.ownerId && <p className="mt-1 text-xs text-red-500">{errors.ownerId.message}</p>}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Team Members</label>
                    <MultiSelect
 options={members.filter(m => m.id !== formValues.ownerId).map(m => ({ value: m.id, label: m.name, image: getInitials(m.name), colorClass: getAvatarColor(m.name) }))}
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
                      <Field label="Start Date" type="date" value={formValues.startDate || ''} onChange={(v) => setValue('startDate', v, { shouldValidate: true })} />
                    </div>
                    <div>
                      <Field 
                        label={`End Date ${(formValues.type === 'ONE_TIME' || formValues.type === 'EVENT') ? '*' : ''}`} 
                        type="date" 
                        value={formValues.endDate || ''} 
                        onChange={(v) => setValue('endDate', v, { shouldValidate: true })} 
                        required={formValues.type === 'ONE_TIME' || formValues.type === 'EVENT'} 
                      />
                      {errors.endDate && <p className="mt-1 text-xs text-red-500">{errors.endDate.message}</p>}
                    </div>
                  </div>
                </div>

                {/* Scope */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-primary border-b border-[#F3F4F6] pb-2">Scope</h3>
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Scope of Work</label>
                    <RichTextEditor
                      value={formValues.scope || ''}
                      onChange={(val) => setValue('scope', val)}
                      placeholder="Enter the scope of work..."
                    />
                  </div>
                  <div>
                    <Field label="Budget" type="number" value={formValues.budget || ''} onChange={(v) => setValue('budget', v)} />
                  </div>
                </div>

                {/* Workflow */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-primary border-b border-[#F3F4F6] pb-2">Workflow</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-[#374151] mb-1.5">Reporting Cadence</label>
                      <Select
                        value={formValues.reportingCadence}
                        onChange={(val) => setValue('reportingCadence', val as any)}
                        options={[
                          { label: 'None', value: 'NONE' },
                          { label: 'Weekly', value: 'WEEKLY' },
                          { label: 'Fortnightly', value: 'FORTNIGHTLY' },
                          { label: 'Monthly', value: 'MONTHLY' },
                        ]}
                      />
                    </div>
                    <div className="flex items-center gap-3 h-full pt-6">
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input 
                          type="checkbox" 
                          className="sr-only peer" 
                          checked={formValues.clientApprovalRequired} 
                          onChange={(e) => setValue('clientApprovalRequired', e.target.checked)} 
                        />
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
                    <TagsInput 
                      value={formValues.tags || []} 
                      onChange={(val) => setValue('tags', val)} 
                      placeholder="Type and press Enter to add tags..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Notes</label>
                    <textarea
                      value={formValues.projectNotes || ''}
                      onChange={(e) => setValue('projectNotes', e.target.value)}
                      className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary transition-all min-h-[80px]"
                      placeholder="Internal project notes..."
                    />
                  </div>
                  <div>
                    <Field label="Folder Link (URL)" type="url" value={formValues.folderLink || ''} onChange={(v) => setValue('folderLink', v)} />
                  </div>
                </div>

                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => setShowCreate(false)} className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] transition-all">Cancel</button>
                  <button type="submit" disabled={submitting} className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] disabled:opacity-50 transition-all">{submitting ? 'Creating...' : 'Create Project'}</button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-100">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    }>
      <ProjectsContent />
    </Suspense>
  );
}

function Field({ label, value, onChange, type = 'text', required = false }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-[#374151] mb-1.5">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required} className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all" />
    </div>
  );
}
