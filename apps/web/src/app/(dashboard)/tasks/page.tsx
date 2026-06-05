'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { z } from 'zod';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { formatDate, getInitials, getAvatarColor } from '@/lib/utils';
import { Plus, Search, X, MessageSquare, CheckCircle2, ListChecks } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { useAuthStore } from '@/stores';
import { useTasks, useProjects, useMembers } from '@/hooks/useQueries';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';

interface Task {
  id: string; title: string; description?: string | null; priority: string; status: string;
  dueDate?: string | null; completedAt?: string | null; projectId: string;
  project?: { id: string; name: string };
  assignee?: { id: string; name: string; avatar?: string | null } | null;
  _count?: { subtasks: number; comments: number };
}

interface Project { id: string; name: string; members?: { user: { id: string; name: string } }[]; teams?: { team: { members: { user: { id: string; name: string } }[] } }[] }
interface Member { id: string; name: string; }

const statusColors: Record<string, string> = {
  BACKLOG: 'bg-gray-100 text-gray-500', TODO: 'bg-slate-100 text-slate-600',
  IN_PROGRESS: 'bg-blue-50 text-blue-700', REVIEW: 'bg-amber-50 text-amber-700',
  BLOCKED: 'bg-red-50 text-red-700', COMPLETED: 'bg-emerald-50 text-emerald-700',
};

const priorityDots: Record<string, string> = {
  LOW: 'bg-gray-300', MEDIUM: 'bg-blue-400', HIGH: 'bg-orange-500', URGENT: 'bg-red-500',
};

const taskSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  projectId: z.string().min(1, 'Project is required'),
  assigneeId: z.string().optional(),
  priority: z.string(),
  status: z.string(),
  dueDate: z.string().optional(),
});
type TaskFormValues = z.infer<typeof taskSchema>;

const kanbanCols = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'BLOCKED', 'COMPLETED'];
const kanbanLabels: Record<string, string> = {
  BACKLOG: 'Backlog', TODO: 'To Do', IN_PROGRESS: 'In Progress', REVIEW: 'Review', BLOCKED: 'Blocked', COMPLETED: 'Done',
};

export default function TasksPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuthStore();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState(user?.id || '');
  const filterHydrated = useRef(false);

  useEffect(() => {
    if (user?.id && !filterHydrated.current) {
      setAssigneeFilter(user.id);
      filterHydrated.current = true;
    }
  }, [user?.id]);
  const [view, setView] = useState<'list' | 'board'>('board');
  
  const showCreate = searchParams.get('create') === 'true';
  const setShowCreate = (open: boolean) => {
    const params = new URLSearchParams(searchParams.toString());
    if (open) params.set('create', 'true');
    else params.delete('create');
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const taskIdParam = searchParams.get('taskId');
  const [selectedTask, setSelectedTaskState] = useState<Task | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const {
    data,
    isLoading: isLoadingTasks,
    refetch: refetchTasks,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage
  } = useTasks(search, statusFilter, projectFilter, assigneeFilter);

  const tasks = useMemo(() => data?.pages.flatMap((page) => page.tasks) || [], [data]);
  const { data: projectsData } = useProjects();
  const projects = useMemo(() => projectsData?.pages.flatMap((page) => page.projects) || [], [projectsData]);
  const { data: members = [] } = useMembers();
  const loading = isLoadingTasks;

  const [boardTasks, setBoardTasks] = useState<Task[]>([]);
  useEffect(() => {
    setBoardTasks(tasks);
  }, [tasks]);

  useEffect(() => {
    if (taskIdParam && tasks.length > 0) {
      const t = tasks.find((x) => x.id === taskIdParam);
      if (t && t.id !== selectedTask?.id) setSelectedTaskState(t);
    } else if (!taskIdParam && selectedTask) {
      setSelectedTaskState(null);
    }
  }, [taskIdParam, tasks, selectedTask]);

  const setSelectedTask = (task: Task | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (task) params.set('taskId', task.id);
    else params.delete('taskId');
    router.replace(`?${params.toString()}`, { scroll: false });
    setSelectedTaskState(task);
  };

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<TaskFormValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: { title: '', description: '', projectId: '', assigneeId: '', priority: 'MEDIUM', status: 'TODO', dueDate: '' },
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const socket = getSocket();
    if (socket) {
      socket.on('task:created', refetchTasks);
      socket.on('task:updated', refetchTasks);
      socket.on('task:deleted', refetchTasks);
      socket.on('tasks:reordered', refetchTasks);
      return () => { socket.off('task:created'); socket.off('task:updated'); socket.off('task:deleted'); socket.off('tasks:reordered'); };
    }
  }, [refetchTasks]);

  async function handleCreate(data: TaskFormValues) {
    setSubmitting(true);
    try {
      await api.post('/tasks', {
        ...data,
        assigneeId: data.assigneeId || undefined,
        dueDate: data.dueDate || undefined,
      });
      setShowCreate(false);
      reset();
      refetchTasks();
    } catch {} finally { setSubmitting(false); }
  }

  async function handleEdit(data: TaskFormValues) {
    if (!selectedTask) return;
    setSubmitting(true);
    try {
      await api.put(`/tasks/${selectedTask.id}`, {
        ...data,
        assigneeId: data.assigneeId || undefined,
        dueDate: data.dueDate || undefined,
      });
      setIsEditing(false);
      setSelectedTask(null);
      reset();
      refetchTasks();
    } catch {} finally { setSubmitting(false); }
  }

  function startEditing() {
    if (!selectedTask) return;
    reset({
      title: selectedTask.title,
      description: selectedTask.description || '',
      projectId: selectedTask.project?.id || selectedTask.projectId || '',
      assigneeId: selectedTask.assignee?.id || '',
      priority: selectedTask.priority,
      status: selectedTask.status,
      dueDate: selectedTask.dueDate ? new Date(selectedTask.dueDate).toISOString().split('T')[0] : '',
    });
    setIsEditing(true);
  }

  async function updateTaskStatus(taskId: string, status: string) {
    try {
      await api.put(`/tasks/${taskId}`, { status });
      refetchTasks();
    } catch {}
  }

  const onDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;
    
    const newStatus = destination.droppableId;
    
    // Optimistic UI update
    setBoardTasks(prev => prev.map(t => t.id === draggableId ? { ...t, status: newStatus } : t));
    
    try {
      await api.put(`/tasks/${draggableId}`, { status: newStatus });
      refetchTasks();
    } catch {
      setBoardTasks(tasks);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#111827] tracking-tight">Tasks</h1>
          <p className="text-sm text-[#6B7280] mt-1">{tasks.length} tasks</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 rounded-xl bg-[#111827] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] transition-all">
          <Plus className="h-4 w-4" /> New Task
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks..." className="w-full rounded-xl border border-[#E5E7EB] bg-white pl-9 pr-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all" />
        </div>
        <Select
          value={projectFilter}
          onChange={(val) => setProjectFilter(val)}
          options={[
            { label: 'All Projects', value: '' },
            ...projects.map((p) => ({ label: p.name, value: p.id }))
          ]}
          className="w-48"
        />
        {user?.role !== 'TEAM_MEMBER' && (
          <Select
            value={assigneeFilter}
            onChange={(val) => setAssigneeFilter(val)}
            options={[
              { label: 'All Assignees', value: '' },
              ...members.map((m: any) => ({ label: m.name, value: m.id }))
            ]}
            className="w-48"
          />
        )}
        <div className="flex rounded-xl border border-[#E5E7EB] p-1">
          <button onClick={() => setView('board')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${view === 'board' ? 'bg-[#111827] text-white' : 'text-[#6B7280]'}`}>Board</button>
          <button onClick={() => setView('list')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${view === 'list' ? 'bg-[#111827] text-white' : 'text-[#6B7280]'}`}>List</button>
        </div>
      </div>

      {/* Board View */}
      {view === 'board' && (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex gap-4 overflow-x-auto pb-4 h-full">
            {kanbanCols.map((col) => {
              const colTasks = boardTasks.filter((t) => t.status === col);
              return (
                <div key={col} className="min-w-[260px] flex-1 flex flex-col">
                  <div className="flex items-center gap-2 mb-3 px-1">
                    <div className={`h-2 w-2 rounded-full ${statusColors[col]?.split(' ')[0] || 'bg-gray-200'}`} />
                    <span className="text-xs font-semibold text-[#374151] uppercase tracking-wider">{kanbanLabels[col]}</span>
                    <span className="ml-auto text-xs text-[#9CA3AF] bg-[#F3F4F6] rounded-full px-2 py-0.5 tabular-nums">{colTasks.length}</span>
                  </div>
                  <Droppable droppableId={col}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={`flex-1 space-y-2 rounded-xl transition-colors ${snapshot.isDraggingOver ? 'bg-gray-50/50' : ''}`}
                        style={{ minHeight: '150px' }}
                      >
                        {colTasks.map((t, index) => (
                          <Draggable key={t.id} draggableId={t.id} index={index}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                style={{ ...provided.draggableProps.style }}
                                className={`rounded-xl border border-[#E5E7EB] bg-white p-3.5 hover:shadow-sm cursor-pointer transition-shadow group ${snapshot.isDragging ? 'shadow-lg rotate-2' : ''}`}
                                onClick={() => setSelectedTask(t)}
                              >
                                <div className="flex items-start gap-2 mb-2">
                                  <div className={`mt-1 h-2 w-2 rounded-full shrink-0 ${priorityDots[t.priority]}`} />
                                  <p className="text-sm font-medium text-[#111827] leading-snug">{t.title}</p>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] text-[#9CA3AF]">{t.project?.name}</span>
                                  <div className="flex items-center gap-2">
                                    {(t._count?.comments ?? 0) > 0 && (
                                      <span className="flex items-center gap-0.5 text-[10px] text-[#9CA3AF]">
                                        <MessageSquare className="h-3 w-3" /> {t._count?.comments}
                                      </span>
                                    )}
                                    {t.assignee && (
                                      <div className={`flex h-[26px] w-[26px] items-center justify-center rounded-full text-white text-[10px] font-medium border-2 border-white shadow-sm ${getAvatarColor(t.assignee.name)}`}>
                                        {getInitials(t.assignee.name)}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                {t.dueDate && (
                                  <p className="text-[10px] text-[#9CA3AF] mt-2">{formatDate(t.dueDate)}</p>
                                )}
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </div>
              );
            })}
          </div>
        </DragDropContext>
      )}

      {/* List View */}
      {view === 'list' && (
        <div className="rounded-2xl border border-[#E5E7EB] bg-white overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#F3F4F6]">
                <th className="px-6 py-3.5 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Task</th>
                <th className="px-6 py-3.5 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Project</th>
                <th className="px-6 py-3.5 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Assignee</th>
                <th className="px-6 py-3.5 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Priority</th>
                <th className="px-6 py-3.5 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Status</th>
                <th className="px-6 py-3.5 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Due Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F3F4F6]">
              {tasks.map((t) => (
                <tr key={t.id} className="hover:bg-[#FAFAFA] cursor-pointer transition-colors" onClick={() => setSelectedTask(t)}>
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-2">
                      <div className={`h-2 w-2 rounded-full shrink-0 ${priorityDots[t.priority]}`} />
                      <span className="text-sm font-medium text-[#111827]">{t.title}</span>
                    </div>
                  </td>
                  <td className="px-6 py-3.5 text-sm text-[#6B7280]">{t.project?.name}</td>
                  <td className="px-6 py-3.5">
                    {t.assignee ? (
                      <div className="flex items-center gap-2">
                        <div className={`h-6 w-6 rounded-full text-white text-[10px] font-semibold flex items-center justify-center ${getAvatarColor(t.assignee.name)}`}>{getInitials(t.assignee.name)}</div>
                        <span className="text-sm text-[#374151]">{t.assignee.name}</span>
                      </div>
                    ) : <span className="text-sm text-[#9CA3AF]">Unassigned</span>}
                  </td>
                  <td className="px-6 py-3.5">
                    <span className="text-xs font-medium text-[#374151] capitalize">{t.priority.toLowerCase()}</span>
                  </td>
                  <td className="px-6 py-3.5">
                    <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium ${statusColors[t.status]}`}>
                      {t.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 text-sm text-[#6B7280]">{formatDate(t.dueDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Load More Button */}
      {hasNextPage && (
        <div className="mt-6 flex justify-center pb-8">
          <button
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="rounded-xl border border-[#E5E7EB] bg-white px-6 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-50 transition-all"
          >
            {isFetchingNextPage ? 'Loading...' : 'Load More Tasks'}
          </button>
        </div>
      )}

      {/* Task Detail Slide-over */}
      <AnimatePresence>
        {selectedTask && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={() => { setSelectedTask(null); setIsEditing(false); }} />
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg bg-white border-l border-[#E5E7EB] shadow-2xl overflow-y-auto">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6]">
                <div className="flex items-center gap-2">
                  {!isEditing && (
                    <>
                      <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium ${statusColors[selectedTask.status]}`}>{selectedTask.status.replace('_', ' ')}</span>
                      <span className={`h-2 w-2 rounded-full ${priorityDots[selectedTask.priority]}`} />
                    </>
                  )}
                  {isEditing && <h2 className="text-lg font-semibold text-[#111827]">Edit Task</h2>}
                </div>
                <div className="flex items-center gap-2">
                  {!isEditing && (user?.role !== 'TEAM_MEMBER' || selectedTask.assignee?.id === user?.id) && (
                    <button onClick={startEditing} className="rounded-xl border border-[#E5E7EB] px-3 py-1.5 text-xs font-medium text-[#374151] hover:bg-[#F9FAFB] transition-all">
                      Edit
                    </button>
                  )}
                  <button onClick={() => { setSelectedTask(null); setIsEditing(false); }} className="p-2 rounded-xl hover:bg-[#F3F4F6]"><X className="h-4 w-4 text-[#6B7280]" /></button>
                </div>
              </div>
              {isEditing ? (
                <form onSubmit={handleSubmit(handleEdit)} className="p-6 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Title *</label>
                    <input {...register('title')} className={`w-full rounded-xl border ${errors.title ? 'border-red-500' : 'border-[#E5E7EB]'} bg-white px-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all`} />
                    {errors.title && <p className="mt-1 text-xs text-red-500">{errors.title.message}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Description</label>
                    <textarea {...register('description')} rows={3} className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all resize-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Project *</label>
                    <Controller name="projectId" control={control} render={({ field }) => (
                      <Select
                        value={field.value}
                        onChange={field.onChange}
                        options={[{ label: 'Select project', value: '' }, ...projects.map((p) => ({ label: p.name, value: p.id }))]}
                      />
                    )} />
                    {errors.projectId && <p className="mt-1 text-xs text-red-500">{errors.projectId.message}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Assignee</label>
                    <Controller name="assigneeId" control={control} render={({ field }) => (
                      <Select
                        value={field.value || ''}
                        onChange={field.onChange}
                        options={[{ label: 'Unassigned', value: '' }, ...Array.from(new Map([...(members), ...(projects.flatMap(p => p.teams?.flatMap((t: any) => t.team?.members?.map((tm: any) => tm.user) || []) || []))].filter(Boolean).map(item => [item.id, item])).values()).map((m: any) => ({ label: m.name, value: m.id }))]}
                      />
                    )} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-[#374151] mb-1.5">Priority</label>
                      <Controller name="priority" control={control} render={({ field }) => (
                        <Select
                          value={field.value}
                          onChange={field.onChange}
                          options={[{ label: 'Low', value: 'LOW' }, { label: 'Medium', value: 'MEDIUM' }, { label: 'High', value: 'HIGH' }, { label: 'Urgent', value: 'URGENT' }]}
                        />
                      )} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[#374151] mb-1.5">Due Date</label>
                      <input type="date" {...register('dueDate')} className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all" />
                    </div>
                  </div>
                  <div className="pt-4 flex gap-3">
                    <button type="button" onClick={() => setIsEditing(false)} className="flex-1 rounded-xl border border-[#E5E7EB] px-4 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] transition-all">Cancel</button>
                    <button type="submit" disabled={submitting} className="flex-1 rounded-xl bg-[#111827] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] disabled:opacity-50 transition-all">{submitting ? 'Saving...' : 'Save Changes'}</button>
                  </div>
                </form>
              ) : (
                <div className="p-6">
                  <h2 className="text-lg font-semibold text-[#111827] mb-2">{selectedTask.title}</h2>
                  {selectedTask.description && <p className="text-sm text-[#6B7280] mb-4">{selectedTask.description}</p>}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between py-2 border-b border-[#F3F4F6]">
                      <span className="text-sm text-[#6B7280]">Project</span>
                      <span className="text-sm font-medium text-[#111827]">{selectedTask.project?.name}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-[#F3F4F6]">
                      <span className="text-sm text-[#6B7280]">Assignee</span>
                      <span className="text-sm font-medium text-[#111827]">{selectedTask.assignee?.name || 'Unassigned'}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-[#F3F4F6]">
                      <span className="text-sm text-[#6B7280]">Due Date</span>
                      <span className="text-sm font-medium text-[#111827]">{formatDate(selectedTask.dueDate)}</span>
                    </div>
                    {selectedTask.completedAt && (
                      <div className="flex items-center justify-between py-2 border-b border-[#F3F4F6]">
                        <span className="text-sm text-[#6B7280]">Completed On</span>
                        <span className="text-sm font-medium text-[#111827]">{formatDate(selectedTask.completedAt)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between py-2">
                      <span className="text-sm text-[#6B7280]">Priority</span>
                      <span className="text-sm font-medium text-[#111827] capitalize">{selectedTask.priority.toLowerCase()}</span>
                    </div>
                  </div>
                  {(user?.role !== 'TEAM_MEMBER' || selectedTask.assignee?.id === user?.id) && (
                    <div className="mt-6">
                      <label className="block text-sm font-medium text-[#374151] mb-2">Update Status</label>
                      <div className="flex flex-wrap gap-2">
                        {kanbanCols.map((s) => (
                          <button
                            key={s}
                            onClick={() => { updateTaskStatus(selectedTask.id, s); setSelectedTask({ ...selectedTask, status: s }); }}
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${selectedTask.status === s ? 'bg-[#111827] text-white' : 'border border-[#E5E7EB] text-[#6B7280] hover:bg-[#F9FAFB]'}`}
                          >
                            {kanbanLabels[s]}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Create Modal */}
      <AnimatePresence>
        {showCreate && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={() => setShowCreate(false)} />
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg bg-white border-l border-[#E5E7EB] shadow-2xl overflow-y-auto">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6]">
                <h2 className="text-lg font-semibold text-[#111827]">New Task</h2>
                <button onClick={() => setShowCreate(false)} className="p-2 rounded-xl hover:bg-[#F3F4F6]"><X className="h-4 w-4 text-[#6B7280]" /></button>
              </div>
              <form onSubmit={handleSubmit(handleCreate)} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Title *</label>
                  <input {...register('title')} className={`w-full rounded-xl border ${errors.title ? 'border-red-500' : 'border-[#E5E7EB]'} bg-white px-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all`} />
                  {errors.title && <p className="mt-1 text-xs text-red-500">{errors.title.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Description</label>
                  <textarea {...register('description')} rows={3} className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all resize-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Project *</label>
                  <Controller name="projectId" control={control} render={({ field }) => (
                    <Select
                      value={field.value}
                      onChange={field.onChange}
                      options={[{ label: 'Select project', value: '' }, ...projects.map((p) => ({ label: p.name, value: p.id }))]}
                    />
                  )} />
                  {errors.projectId && <p className="mt-1 text-xs text-red-500">{errors.projectId.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Assignee</label>
                  <Controller name="assigneeId" control={control} render={({ field }) => (
                    <Select
                      value={field.value || ''}
                      onChange={field.onChange}
                      options={[{ label: 'Unassigned', value: '' }, ...Array.from(new Map([...(members), ...(projects.flatMap(p => p.teams?.flatMap((t: any) => t.team?.members?.map((tm: any) => tm.user) || []) || []))].filter(Boolean).map(item => [item.id, item])).values()).map((m: any) => ({ label: m.name, value: m.id }))]}
                    />
                  )} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Priority</label>
                    <Controller name="priority" control={control} render={({ field }) => (
                      <Select
                        value={field.value}
                        onChange={field.onChange}
                        options={[{ label: 'Low', value: 'LOW' }, { label: 'Medium', value: 'MEDIUM' }, { label: 'High', value: 'HIGH' }, { label: 'Urgent', value: 'URGENT' }]}
                      />
                    )} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Due Date</label>
                    <input type="date" {...register('dueDate')} className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all" />
                  </div>
                </div>
                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => setShowCreate(false)} className="flex-1 rounded-xl border border-[#E5E7EB] px-4 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] transition-all">Cancel</button>
                  <button type="submit" disabled={submitting} className="flex-1 rounded-xl bg-[#111827] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] disabled:opacity-50 transition-all">{submitting ? 'Creating...' : 'Create Task'}</button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
