'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { formatDate, getInitials, getAvatarColor } from '@/lib/utils';
import {
  Plus, Search, LayoutList, Columns3, Calendar, GanttChartSquare, X, ChevronRight,
} from 'lucide-react';
import { useAuthStore } from '@/stores';
import { Select } from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { Skeleton } from '@/components/ui/skeleton';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useProjects, useClients, useMembers, useTeams, useTemplates } from '@/hooks/useQueries';
import { projectSchema, type ProjectFormValues } from '@/lib/validations';
import { CalendarView } from '@/components/projects/calendar-view';

interface Project {
  id: string; name: string; description?: string | null; status: string; priority: string; progress: number;
  startDate?: string | null; endDate?: string | null; budget?: number | null;
  client?: { id: string; name: string };
  owner?: { id: string; name: string; avatar?: string | null };
  _count?: { tasks: number };
}

interface Client { id: string; name: string; }
interface Member { id: string; name: string; }
interface Team { id: string; name: string; }

type ViewMode = 'list' | 'kanban' | 'timeline' | 'calendar';

const statusColors: Record<string, string> = {
  PLANNING: 'bg-violet-50 text-violet-700', IN_PROGRESS: 'bg-blue-50 text-blue-700',
  REVIEW: 'bg-amber-50 text-amber-700', COMPLETED: 'bg-emerald-50 text-emerald-700',
  ON_HOLD: 'bg-orange-50 text-orange-700', CANCELLED: 'bg-red-50 text-red-700',
};

const priorityColors: Record<string, string> = {
  LOW: 'text-gray-400', MEDIUM: 'text-blue-500', HIGH: 'text-orange-500', CRITICAL: 'text-red-500',
};

const kanbanColumns = ['PLANNING', 'IN_PROGRESS', 'REVIEW', 'COMPLETED'];
const kanbanLabels: Record<string, string> = {
  PLANNING: 'Planning', IN_PROGRESS: 'In Progress', REVIEW: 'Review', COMPLETED: 'Completed',
};

function ProjectsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuthStore();
  const [search, setSearch] = useState('');
  const [view, setView] = useState<ViewMode>('list');
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
  } = useProjects(search, view === 'calendar');

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
    const socket = getSocket();
    if (socket) {
      socket.on('project:created', refetchProjects);
      socket.on('project:updated', refetchProjects);
      socket.on('project:deleted', refetchProjects);
      return () => { socket.off('project:created'); socket.off('project:updated'); socket.off('project:deleted'); };
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
      setShowCreate(false);
      reset();
      setSelectedTemplateId('');
      refetchProjects();
    } catch (err: any) { setFormError(err.message); } finally { setSubmitting(false); }
  });

  const viewButtons = [
    { mode: 'list' as ViewMode, icon: LayoutList, label: 'List' },
    { mode: 'kanban' as ViewMode, icon: Columns3, label: 'Board' },
    { mode: 'timeline' as ViewMode, icon: GanttChartSquare, label: 'Timeline' },
    { mode: 'calendar' as ViewMode, icon: Calendar, label: 'Calendar' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#111827] tracking-tight">Projects</h1>
          <p className="text-sm text-[#6B7280] mt-1">{projects.length} projects</p>
        </div>
        {user?.role !== 'TEAM_MEMBER' && (
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 rounded-xl bg-[#111827] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] transition-all">
            <Plus className="h-4 w-4" /> New Project
          </button>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-6">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search projects..." className="w-full rounded-xl border border-[#E5E7EB] bg-white pl-9 pr-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all" />
        </div>
        <div className="flex items-center rounded-xl border border-[#E5E7EB] p-1">
          {viewButtons.map((v) => (
            <button
              key={v.mode}
              onClick={() => setView(v.mode)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${view === v.mode ? 'bg-[#111827] text-white' : 'text-[#6B7280] hover:text-[#111827]'}`}
            >
              <v.icon className="h-3.5 w-3.5" /> {v.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 space-y-4">
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
        <div className="rounded-2xl border border-[#E5E7EB] bg-white overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#F3F4F6]">
                <th className="px-6 py-3.5 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Project</th>
                <th className="px-6 py-3.5 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Client</th>
                <th className="px-6 py-3.5 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Progress</th>
                <th className="px-6 py-3.5 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Status</th>
                <th className="px-6 py-3.5 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Owner</th>
                <th className="px-6 py-3.5 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Due Date</th>
                <th className="px-6 py-3.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F3F4F6]">
              {projects.map((p) => (
                <motion.tr key={p.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="hover:bg-[#FAFAFA] cursor-pointer transition-colors" onClick={() => router.push(`/projects/${p.id}`)}>
                  <td className="px-6 py-4">
                    <p className="text-sm font-medium text-[#111827]">{p.name}</p>
                    <p className="text-xs text-[#9CA3AF]">{p._count?.tasks ?? 0} tasks</p>
                  </td>
                  <td className="px-6 py-4 text-sm text-[#6B7280]">{p.client?.name || '—'}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 rounded-full bg-[#F3F4F6] overflow-hidden">
                        <div className="h-full rounded-full bg-[#111827]" style={{ width: `${p.progress}%` }} />
                      </div>
                      <span className="text-xs text-[#6B7280] tabular-nums">{p.progress}%</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium ${statusColors[p.status] || 'bg-gray-50 text-gray-500'}`}>
                      {p.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {p.owner && (
                      <div className="flex items-center gap-2">
                        <div className={`flex h-6 w-6 items-center justify-center rounded-full text-white text-[10px] font-semibold ${getAvatarColor(p.owner.name)}`}>
                          {getInitials(p.owner.name)}
                        </div>
                        <span className="text-sm text-[#374151]">{p.owner.name}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-[#6B7280]">{formatDate(p.endDate)}</td>
                  <td className="px-6 py-4"><ChevronRight className="h-4 w-4 text-[#D1D5DB]" /></td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'kanban' && (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {kanbanColumns.map((col) => {
            const colProjects = projects.filter((p) => p.status === col);
            return (
              <div key={col} className="min-w-[280px] flex-1">
                <div className="flex items-center gap-2 mb-3">
                  <div className={`h-2 w-2 rounded-full ${statusColors[col]?.split(' ')[0] || 'bg-gray-200'}`} />
                  <span className="text-sm font-medium text-[#374151]">{kanbanLabels[col]}</span>
                  <span className="ml-auto text-xs text-[#9CA3AF] tabular-nums">{colProjects.length}</span>
                </div>
                <div className="space-y-3">
                  {colProjects.map((p) => (
                    <motion.div key={p.id} layout className="rounded-2xl border border-[#E5E7EB] bg-white p-4 hover:shadow-sm cursor-pointer transition-all" onClick={() => router.push(`/projects/${p.id}`)}>
                      <p className="text-sm font-medium text-[#111827] mb-1">{p.name}</p>
                      <p className="text-xs text-[#9CA3AF] mb-3">{p.client?.name}</p>
                      <div className="flex items-center justify-between">
                        <div className="h-1 w-16 rounded-full bg-[#F3F4F6] overflow-hidden">
                          <div className="h-full rounded-full bg-[#111827]" style={{ width: `${p.progress}%` }} />
                        </div>
                        {p.owner && (
                          <div className={`flex h-5 w-5 items-center justify-center rounded-full text-white text-[8px] font-semibold border-2 border-white shadow-sm -ml-1.5 first:ml-0 ${getAvatarColor(p.owner.name)}`} title={p.owner.name}>
                            {getInitials(p.owner.name)}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === 'timeline' && (
        <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6">
          <div className="space-y-3">
            {projects.filter((p) => p.startDate && p.endDate).map((p) => {
              const start = new Date(p.startDate!);
              const end = new Date(p.endDate!);
              const now = new Date();
              const totalDays = Math.max(1, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
              const elapsed = Math.max(0, (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
              const pct = Math.min(100, (elapsed / totalDays) * 100);

              return (
                <div key={p.id} className="flex items-center gap-4 py-2 cursor-pointer hover:bg-[#FAFAFA] rounded-xl px-3 -mx-3 transition-colors" onClick={() => router.push(`/projects/${p.id}`)}>
                  <div className="w-48 shrink-0">
                    <p className="text-sm font-medium text-[#111827] truncate">{p.name}</p>
                    <p className="text-xs text-[#9CA3AF]">{p.client?.name}</p>
                  </div>
                  <div className="flex-1">
                    <div className="relative h-8 rounded-lg bg-[#F3F4F6] overflow-hidden">
                      <div className="absolute inset-y-0 left-0 rounded-lg bg-[#111827]/10" style={{ width: `${pct}%` }} />
                      <div className="absolute inset-y-0 left-0 rounded-lg bg-[#111827]" style={{ width: `${p.progress}%`, maxWidth: `${pct}%` }} />
                      <div className="absolute inset-0 flex items-center px-3">
                        <span className="text-xs font-medium text-white mix-blend-difference">{p.progress}%</span>
                      </div>
                    </div>
                    <div className="flex justify-between mt-1">
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
                className="rounded-xl border border-[#E5E7EB] bg-white px-6 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-50 transition-all"
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
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg bg-white border-l border-[#E5E7EB] shadow-2xl overflow-y-auto">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6]">
                <h2 className="text-lg font-semibold text-[#111827]">New Project</h2>
                <button onClick={() => setShowCreate(false)} className="p-2 rounded-xl hover:bg-[#F3F4F6]"><X className="h-4 w-4 text-[#6B7280]" /></button>
              </div>
              <form onSubmit={handleCreate} className="relative p-6 space-y-4">
                {formError && <div className="absolute top-0 left-6 right-6 -mt-2 z-10 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 shadow-sm border border-red-100">{formError}</div>}
                
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

                <div>
                  <Field label="Project Name *" value={formValues.name} onChange={(v) => setValue('name', v, { shouldValidate: true })} required />
                  {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name.message}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Description</label>
                  <textarea value={formValues.description || ''} onChange={(e) => setValue('description', e.target.value)} rows={3} className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all resize-none" />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Client (Leave empty for Internal)</label>
                  <Select
                    value={formValues.clientId || ''}
                    onChange={(val) => setValue('clientId', val, { shouldValidate: true })}
                    options={[
                      { label: 'Internal Project', value: '' },
                      ...clients.map((c) => ({ label: c.name, value: c.id }))
                    ]}
                  />
                  {errors.clientId && <p className="mt-1 text-xs text-red-500">{errors.clientId.message}</p>}
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Owner *</label>
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
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Field label="Start Date" type="date" value={formValues.startDate || ''} onChange={(v) => setValue('startDate', v, { shouldValidate: true })} />
                    {errors.startDate && <p className="mt-1 text-xs text-red-500">{errors.startDate.message}</p>}
                  </div>
                  <div>
                    <Field label="End Date" type="date" value={formValues.endDate || ''} onChange={(v) => setValue('endDate', v, { shouldValidate: true })} />
                    {errors.endDate && <p className="mt-1 text-xs text-red-500">{errors.endDate.message}</p>}
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Assigned Teams</label>
                  <MultiSelect
                    options={teams.map(t => ({ value: t.id, label: t.name }))}
                    value={formValues.teamIds || []}
                    onChange={(val) => setValue('teamIds', val)}
                    placeholder="Search and select teams..."
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Additional Members</label>
                  <MultiSelect
                    options={members.filter(m => m.id !== formValues.ownerId).map(m => ({ value: m.id, label: m.name, image: getInitials(m.name), colorClass: getAvatarColor(m.name) }))}
                    value={formValues.memberIds || []}
                    onChange={(val) => setValue('memberIds', val)}
                    placeholder="Search and select members..."
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Priority</label>
                    <Select
                      value={formValues.priority}
                      onChange={(val) => setValue('priority', val as any)}
                      options={[
                        { label: 'Low', value: 'LOW' },
                        { label: 'Medium', value: 'MEDIUM' },
                        { label: 'High', value: 'HIGH' },
                        { label: 'Critical', value: 'CRITICAL' },
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
                        { label: 'Review', value: 'REVIEW' },
                        { label: 'Completed', value: 'COMPLETED' },
                        { label: 'On Hold', value: 'ON_HOLD' },
                        { label: 'Cancelled', value: 'CANCELLED' },
                      ]}
                    />
                  </div>
                </div>

                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => setShowCreate(false)} className="flex-1 rounded-xl border border-[#E5E7EB] px-4 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] transition-all">Cancel</button>
                  <button type="submit" disabled={submitting} className="flex-1 rounded-xl bg-[#111827] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] disabled:opacity-50 transition-all">{submitting ? 'Creating...' : 'Create Project'}</button>
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
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#111827] border-t-transparent" />
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
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required} className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm text-[#111827] outline-none focus:border-[#111827] focus:ring-1 focus:ring-[#111827] transition-all" />
    </div>
  );
}
