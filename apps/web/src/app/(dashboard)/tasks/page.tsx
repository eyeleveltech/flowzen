'use client';

import { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { z } from 'zod';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { api } from '@/lib/api';
import { getSSE } from '@/lib/sse';
import { formatDate, getInitials, getAvatarColor, triggerHaptic } from '@/lib/utils';
import { Plus, Search, X, MessageSquare, CheckCircle2, ListChecks, Trash2 } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { Drawer } from '@/components/ui/drawer';
import { SwipeableCard } from '@/components/ui/swipeable-card';
import { Skeleton } from '@/components/ui/skeleton';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import toast from 'react-hot-toast';
import { useAuthStore, useConfirmStore } from '@/stores';
import { useTasks, useProjects, useMembers } from '@/hooks/useQueries';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';

interface Task {
  id: string; title: string; description?: string | null; priority: string; status: string;
  dueDate?: string | null; assignedDate?: string | null; completedAt?: string | null; createdAt: string; projectId: string;
  loggedHours?: number | null;
  type: string; driveLink?: string | null; reviewerId?: string | null;
  project?: { id: string; name: string };
  assignee?: { id: string; name: string; avatar?: string | null } | null;
  reviewer?: { id: string; name: string; avatar?: string | null } | null;
  _count?: { subtasks: number; comments: number };
  comments?: { id: string; content: string; createdAt: string; author: { id: string; name: string; avatar?: string | null } }[];
}

interface Project { id: string; name: string; members?: { user: { id: string; name: string } }[]; teams?: { team: { members: { user: { id: string; name: string } }[] } }[] }
interface Member { id: string; name: string; }

const statusColors: Record<string, string> = {
  BACKLOG: 'bg-gray-100 text-gray-500', TODO: 'bg-slate-100 text-slate-600',
  IN_PROGRESS: 'bg-blue-50 text-blue-700', REVIEW: 'bg-amber-50 text-amber-700',
  APPROVED: 'bg-teal-50 text-teal-700',
  BLOCKED: 'bg-red-50 text-red-700', COMPLETED: 'bg-emerald-50 text-emerald-700',
};

const priorityDots: Record<string, string> = {
  LOW: 'bg-gray-300', MEDIUM: 'bg-blue-400', HIGH: 'bg-orange-500', URGENT: 'bg-red-500',
};

const taskSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  type: z.string().optional(),
  projectId: z.string().min(1, 'Project is required'),
  assigneeId: z.string().optional(),
  reviewerId: z.string().optional(),
  priority: z.string(),
  status: z.string(),
  dueDate: z.string().optional(),
  assignedDate: z.string().optional(),
  loggedHours: z.number().min(0).optional(),
  driveLink: z.string().url('Must be a valid URL').optional().or(z.literal('')),
});
type TaskFormValues = z.infer<typeof taskSchema>;

const kanbanCols = ['TODO', 'IN_PROGRESS', 'REVIEW', 'APPROVED', 'COMPLETED'];
const kanbanLabels: Record<string, string> = {
  TODO: 'To Do', IN_PROGRESS: 'In Progress', REVIEW: 'In Review', APPROVED: 'Approved', COMPLETED: 'Done',
};

function TasksContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuthStore();
  const { confirm } = useConfirmStore();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState(user?.id || '');
  const [priorityFilter, setPriorityFilter] = useState('');
  const filterHydrated = useRef(false);

  useEffect(() => {
    if (user?.id && !filterHydrated.current) {
      setAssigneeFilter(user.id);
      filterHydrated.current = true;
    }
  }, [user?.id]);
  const [view, setView] = useState<'list' | 'board'>('list');

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
  } = useTasks(search, statusFilter, projectFilter, assigneeFilter, priorityFilter, searchParams.get('filter'));

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

  const setSelectedTask = async (task: Task | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (task) params.set('taskId', task.id);
    else params.delete('taskId');
    router.replace(`?${params.toString()}`, { scroll: false });
    setSelectedTaskState(task);
    if (task) {
      try {
        const fullTask = await api.get<Task>(`/tasks/${task.id}`);
        setSelectedTaskState(fullTask);
      } catch (err) {}
    }
  };

  const { register, handleSubmit, control, reset, watch, formState: { errors } } = useForm<TaskFormValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: { title: '', description: '', type: 'OTHER', projectId: '', assigneeId: '', reviewerId: '', priority: 'MEDIUM', status: 'TODO', dueDate: '', assignedDate: '', loggedHours: 0, driveLink: '' },
  });
  const [submitting, setSubmitting] = useState(false);
  const [commentContent, setCommentContent] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  const selectedProjectId = watch('projectId');

  const availableAssignees = useMemo(() => {
    const users = new Map<string, { id: string; name: string }>();
    if (selectedProjectId) {
      const proj = projects.find(p => p.id === selectedProjectId);
      if (proj) {
        proj.members?.forEach((m: any) => {
          if (m.user) users.set(m.user.id, m.user);
        });
        proj.teams?.forEach((t: any) => {
          t.team?.members?.forEach((m: any) => {
            // m is the User object directly in team.members
            if (m.id) users.set(m.id, m);
          });
        });
        // Also add the project owner as a fallback assignee if needed
        if (proj.owner?.id) {
          users.set(proj.owner.id, proj.owner);
        }
      }
    } else {
      members.forEach((m: any) => users.set(m.id, m));
    }
    return Array.from(users.values());
  }, [selectedProjectId, projects, members]);

  async function handleAddComment() {
    if (!selectedTask || !commentContent.trim()) return;
    setSubmittingComment(true);
    try {
      await api.post(`/tasks/${selectedTask.id}/comments`, { content: commentContent });
      setCommentContent('');
      toast.success('Comment added');
      // Refetch full task
      const fullTask = await api.get<Task>(`/tasks/${selectedTask.id}`);
      setSelectedTaskState(fullTask);
      refetchTasks();
    } catch (err: any) {
      toast.error(err.message || 'Failed to add comment');
    } finally {
      setSubmittingComment(false);
    }
  }

  useEffect(() => {
    const sse = getSSE();
    if (sse) {
      sse.on('task:created', refetchTasks);
      sse.on('task:updated', refetchTasks);
      sse.on('task:deleted', refetchTasks);
      sse.on('tasks:reordered', refetchTasks);
      return () => { sse.off('task:created'); sse.off('task:updated'); sse.off('task:deleted'); sse.off('tasks:reordered'); };
    }
  }, [refetchTasks]);

  async function handleCreate(data: TaskFormValues) {
    setSubmitting(true);
    try {
      await api.post('/tasks', {
        ...data,
        assigneeId: data.assigneeId || undefined,
        reviewerId: data.reviewerId || undefined,
        dueDate: data.dueDate || undefined,
        assignedDate: data.assignedDate || undefined,
        driveLink: data.driveLink || undefined,
      });
      toast.success('Task created successfully');
      setShowCreate(false);
      reset();
      refetchTasks();
    } catch (err: any) { toast.error(err.message || 'Failed to create task'); } finally { setSubmitting(false); }
  }

  async function handleEdit(data: TaskFormValues) {
    if (!selectedTask) return;
    setSubmitting(true);
    try {
      await api.put(`/tasks/${selectedTask.id}`, {
        ...data,
        assigneeId: data.assigneeId || undefined,
        reviewerId: data.reviewerId || undefined,
        dueDate: data.dueDate || undefined,
        assignedDate: data.assignedDate || undefined,
        driveLink: data.driveLink || undefined,
      });
      toast.success('Task updated successfully');
      setIsEditing(false);
      setSelectedTask(null);
      reset();
      refetchTasks();
    } catch (err: any) { toast.error(err.message || 'Failed to update task'); } finally { setSubmitting(false); }
  }

  function startEditing() {
    if (!selectedTask) return;
    reset({
      title: selectedTask.title,
      description: selectedTask.description || '',
      type: selectedTask.type || 'OTHER',
      projectId: selectedTask.project?.id || selectedTask.projectId || '',
      assigneeId: selectedTask.assignee?.id || '',
      reviewerId: selectedTask.reviewer?.id || '',
      priority: selectedTask.priority,
      status: selectedTask.status,
      dueDate: selectedTask.dueDate ? new Date(selectedTask.dueDate).toISOString().split('T')[0] : '',
      assignedDate: selectedTask.assignedDate ? new Date(selectedTask.assignedDate).toISOString().split('T')[0] : '',
      loggedHours: selectedTask.loggedHours || 0,
      driveLink: selectedTask.driveLink || '',
    });
    setIsEditing(true);
  }

  async function updateTaskStatus(taskId: string, status: string) {
    try {
      await api.put(`/tasks/${taskId}`, { status });
      toast.success('Task status updated');
      refetchTasks();
    } catch (err: any) { toast.error(err.message || 'Failed to update status'); }
  }

  async function deleteTask() {
    if (!selectedTask) return;

    const isConfirmed = await confirm({
      title: 'Delete Task',
      message: 'Are you sure you want to delete this task? This action cannot be undone.',
      confirmText: 'Delete Task',
      cancelText: 'Cancel',
    });

    if (isConfirmed) {
      try {
        await api.delete(`/tasks/${selectedTask.id}`);
        toast.success('Task deleted successfully');
        setSelectedTask(null);
        refetchTasks();
      } catch (error: any) {
        toast.error(error.message || 'Failed to delete task');
        console.error('Failed to delete task', error);
      }
    }
  }

  const onDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    const newStatus = destination.droppableId;

    // Optimistic UI update
    setBoardTasks(prev => prev.map(t => t.id === draggableId ? { ...t, status: newStatus } : t));
    triggerHaptic('medium');

    try {
      await api.put(`/tasks/${draggableId}`, { status: newStatus });
      toast.success('Task moved successfully');
      refetchTasks();
    } catch (err: any) {
      toast.error(err.message || 'Failed to move task');
      setBoardTasks(tasks);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="h-full flex flex-col space-y-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-primary tracking-tight">Tasks</h1>
          <p className="text-sm text-secondary mt-1">{tasks.length} tasks</p>
        </div>
        <div className="flex items-center gap-3">
          {searchParams.get('filter') === 'overdue' && (
            <button 
              onClick={() => {
                const params = new URLSearchParams(searchParams.toString());
                params.delete('filter');
                router.replace(`?${params.toString()}`);
              }}
              className="flex items-center gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-100 transition-colors border border-red-100"
            >
              Showing Overdue <X className="h-3.5 w-3.5" />
            </button>
          )}
          {searchParams.get('filter') === 'approval' && (
            <button 
              onClick={() => {
                const params = new URLSearchParams(searchParams.toString());
                params.delete('filter');
                router.replace(`?${params.toString()}`);
              }}
              className="flex items-center gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 hover:bg-amber-100 transition-colors border border-amber-100"
            >
              Showing Pending Approvals <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] transition-all">
            <Plus className="h-4 w-4" /> New Task
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks..." className="w-full rounded-xl border border-border bg-white pl-9 pr-4 py-2.5 text-sm outline-none focus:border-primary transition-all" />
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
        <Select
          value={statusFilter}
          onChange={(val) => setStatusFilter(val)}
          options={[
            { label: 'All Statuses', value: '' },
            { label: 'To Do', value: 'TODO' },
            { label: 'In Progress', value: 'IN_PROGRESS' },
            { label: 'In Review', value: 'REVIEW' },
            { label: 'Approved', value: 'APPROVED' },
            { label: 'Done', value: 'COMPLETED' },
          ]}
          className="w-40"
        />
        <Select
          value={priorityFilter}
          onChange={(val) => setPriorityFilter(val)}
          options={[
            { label: 'All Priorities', value: '' },
            { label: 'Low', value: 'LOW' },
            { label: 'Medium', value: 'MEDIUM' },
            { label: 'High', value: 'HIGH' },
            { label: 'Urgent', value: 'URGENT' },
          ]}
          className="w-40"
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
        <div className="flex rounded-xl border border-border p-1">
          <button onClick={() => setView('board')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${view === 'board' ? 'bg-primary text-white' : 'text-secondary'}`}>Board</button>
          <button onClick={() => setView('list')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${view === 'list' ? 'bg-primary text-white' : 'text-secondary'}`}>List</button>
        </div>
      </div>

      {loading ? (
        <div className="flex gap-4 overflow-x-auto pb-4 h-full">
          {kanbanCols.map((col) => (
            <div key={col} className="min-w-[260px] flex-1 flex flex-col">
              <div className="flex items-center gap-2 mb-3 px-1">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-6 rounded-full ml-auto" />
              </div>
              <div className="flex-1 space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="rounded-xl border border-border bg-white p-3.5">
                    <div className="flex items-start gap-2 mb-3">
                      <Skeleton className="h-4 w-32" />
                    </div>
                    <div className="flex justify-between items-center">
                      <Skeleton className="h-3 w-16" />
                      <Skeleton className="h-6 w-6 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
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
                        <span className="text-xs font-medium text-[#374151] uppercase tracking-wide">{kanbanLabels[col]}</span>
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
                                    className={`rounded-xl border border-border bg-white p-3.5 hover:shadow-sm cursor-pointer transition-shadow group ${snapshot.isDragging ? 'shadow-lg rotate-2' : ''}`}
                                    onClick={() => setSelectedTask(t)}
                                  >
                                    <div className="flex items-start gap-2 mb-2">
                                      <div className={`mt-1 h-2 w-2 rounded-full shrink-0 ${priorityDots[t.priority]}`} />
                                      <p className="text-sm font-medium text-primary leading-snug">{t.title}</p>
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
 <div className={`flex h-[26px] w-[26px] items-center justify-center rounded-full text-[10px] font-medium ${getAvatarColor(t.assignee.name)}`}>
                                            {getInitials(t.assignee.name)}
                                          </div>
                                        )}
                                        {(t.loggedHours ?? 0) > 0 && (
                                          <span className="text-[10px] text-secondary bg-[#F3F4F6] px-1.5 py-0.5 rounded-md font-medium tabular-nums border border-border">
                                            ⏱ {t.loggedHours}h
                                          </span>
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
            <>
              {/* Desktop Table View */}
              <div className="hidden md:block rounded-2xl border border-border bg-white overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[800px]">
                    <thead>
                      <tr className="border-b border-[#F3F4F6]">
                        <th className="px-6 py-3.5 text-left text-xs font-medium text-secondary uppercase tracking-wide">Task</th>
                        <th className="px-6 py-3.5 text-left text-xs font-medium text-secondary uppercase tracking-wide">Project</th>
                        <th className="px-6 py-3.5 text-left text-xs font-medium text-secondary uppercase tracking-wide">Assignee</th>
                        <th className="px-6 py-3.5 text-left text-xs font-medium text-secondary uppercase tracking-wide">Priority</th>
                        <th className="px-6 py-3.5 text-left text-xs font-medium text-secondary uppercase tracking-wide">Status</th>
                        <th className="px-6 py-3.5 text-left text-xs font-medium text-secondary uppercase tracking-wide">Due Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F3F4F6]">
                      {tasks.map((t) => (
                        <tr key={t.id} className="hover:bg-surface cursor-pointer transition-colors" onClick={() => setSelectedTask(t)}>
                          <td className="px-6 py-3.5">
                            <div className="flex items-center gap-2">
                              <div className={`h-2 w-2 rounded-full shrink-0 ${priorityDots[t.priority]}`} />
                              <span className="text-sm font-medium text-primary">{t.title}</span>
                            </div>
                          </td>
                          <td className="px-6 py-3.5 text-sm text-secondary">{t.project?.name}</td>
                          <td className="px-6 py-3.5">
                            {t.assignee ? (
                              <div className="flex items-center gap-2">
 <div className={`h-6 w-6 rounded-full text-[10px] font-semibold flex items-center justify-center ${getAvatarColor(t.assignee.name)}`}>{getInitials(t.assignee.name)}</div>
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
                          <td className="px-6 py-3.5 text-sm text-secondary">{formatDate(t.dueDate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mobile Card View (Swipeable) */}
              <div className="md:hidden flex flex-col pb-4">
                {tasks.map((t) => (
                  <SwipeableCard
                    key={t.id}
                    onSwipeLeft={() => {
                      setSelectedTask(t);
                      deleteTask();
                    }}
                    onSwipeRight={() => updateTaskStatus(t.id, 'COMPLETED')}
                  >
                    <div
                      onClick={() => setSelectedTask(t)}
                      className="p-4 cursor-pointer"
                    >
                      <div className="flex items-start gap-2 mb-2">
                        <div className={`mt-1 h-2 w-2 rounded-full shrink-0 ${priorityDots[t.priority]}`} />
                        <p className="text-sm font-medium text-primary leading-snug">{t.title}</p>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className={`inline-flex items-center rounded-lg px-2 py-0.5 text-[10px] font-medium ${statusColors[t.status]}`}>
                          {t.status.replace('_', ' ')}
                        </span>
                        <div className="flex items-center gap-2">
                          {t.assignee && (
 <div className={`flex h-[24px] w-[24px] items-center justify-center rounded-full text-[9px] font-medium ${getAvatarColor(t.assignee.name)}`}>
                              {getInitials(t.assignee.name)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </SwipeableCard>
                ))}
              </div>
            </>
          )}

          {/* Load More Button */}
          {hasNextPage && (
            <div className="mt-6 flex justify-center pb-8">
              <button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="rounded-xl border border-border bg-white px-6 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-50 transition-all"
              >
                {isFetchingNextPage ? 'Loading...' : 'Load More Tasks'}
              </button>
            </div>
          )}
        </>
      )}

      {/* Detail / Edit Modal */}
      {/* Edit Task Modal */}
      <AnimatePresence>
        {!!selectedTask && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-black/20 backdrop-blur-sm" onClick={() => { setSelectedTask(null); setIsEditing(false); }} />
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="fixed right-0 top-0 bottom-0 z-[101] w-full max-w-2xl bg-white border-l border-border shadow-2xl shadow-black/10 overflow-y-auto"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6] sticky top-0 bg-white z-10">
                <h2 className="text-lg font-semibold text-primary">Task Details</h2>
                <button onClick={() => { setSelectedTask(null); setIsEditing(false); }} className="p-2 rounded-xl hover:bg-[#F3F4F6] transition-colors">
                  <X className="h-4 w-4 text-secondary" />
                </button>
              </div>
              <div className="p-6">
                {selectedTask && (
          <div className="flex flex-col">
            <div className="flex items-center justify-between border-b border-[#F3F4F6] pb-4 mb-4">
              <div className="flex items-center gap-2">
                {!isEditing && (
                  <>
                    <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium ${statusColors[selectedTask.status]}`}>{selectedTask.status.replace('_', ' ')}</span>
                    <span className={`h-2 w-2 rounded-full ${priorityDots[selectedTask.priority]}`} />
                  </>
                )}
                {isEditing && <h2 className="text-lg font-semibold text-primary">Edit Task</h2>}
              </div>
              <div className="flex items-center gap-2">
                {!isEditing && (user?.role !== 'TEAM_MEMBER' || selectedTask.assignee?.id === user?.id) && (
                  <>
                    <button onClick={startEditing} className="rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-[#374151] hover:bg-[#F9FAFB] transition-all">
                      Edit
                    </button>
                    <button onClick={deleteTask} className="rounded-xl border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 hover:border-red-300 transition-all flex items-center gap-1.5">
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </button>
                  </>
                )}
              </div>
            </div>
            {isEditing ? (
              <form onSubmit={handleSubmit(handleEdit)} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Title *</label>
                  <input {...register('title')} className={`w-full rounded-xl border ${errors.title ? 'border-red-500' : 'border-border'} bg-white px-4 py-2.5 text-sm outline-none focus:border-primary transition-all`} />
                  {errors.title && <p className="mt-1 text-xs text-red-500">{errors.title.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Description</label>
                  <Controller name="description" control={control} render={({ field }) => (
                    <RichTextEditor value={field.value || ''} onChange={field.onChange} placeholder="Task details..." />
                  )} />
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Task Type</label>
                    <Controller name="type" control={control} render={({ field }) => (
                      <Select
                        value={field.value || 'OTHER'}
                        onChange={field.onChange}
                        options={[
                          { label: 'Design', value: 'DESIGN' },
                          { label: 'Content', value: 'CONTENT' },
                          { label: 'Video', value: 'VIDEO' },
                          { label: 'Digital Marketing', value: 'DIGITAL_MARKETING' },
                          { label: 'Development', value: 'DEVELOPMENT' },
                          { label: 'Strategy', value: 'STRATEGY' },
                          { label: 'Other', value: 'OTHER' },
                        ]}
                      />
                    )} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Assignee</label>
                    <Controller name="assigneeId" control={control} render={({ field }) => (
                      <Select
                        value={field.value || ''}
                        onChange={field.onChange}
                        options={[{ label: 'Unassigned', value: '' }, ...availableAssignees.map((m: any) => ({ label: m.name, value: m.id }))]}
                      />
                    )} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Reviewer</label>
                    <Controller name="reviewerId" control={control} render={({ field }) => (
                      <Select
                        value={field.value || ''}
                        onChange={field.onChange}
                        options={[{ label: 'No Reviewer', value: '' }, ...availableAssignees.map((m: any) => ({ label: m.name, value: m.id }))]}
                      />
                    )} />
                  </div>
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
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Assigned Date</label>
                    <input type="date" {...register('assignedDate')} className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary transition-all" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Due Date</label>
                    <input type="date" {...register('dueDate')} className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary transition-all" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Time Spent (hours)</label>
                    <input type="number" step="0.5" min="0" {...register('loggedHours', { valueAsNumber: true })} className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary transition-all" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Drive Link (Uploads, Drafts)</label>
                  <input type="url" {...register('driveLink')} placeholder="https://drive.google.com/..." className={`w-full rounded-xl border ${errors.driveLink ? 'border-red-500' : 'border-border'} bg-white px-4 py-2.5 text-sm outline-none focus:border-primary transition-all`} />
                  {errors.driveLink && <p className="mt-1 text-xs text-red-500">{errors.driveLink.message}</p>}
                </div>
                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => setIsEditing(false)} className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] transition-all">Cancel</button>
                  <button type="submit" disabled={submitting} className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] disabled:opacity-50 transition-all">{submitting ? 'Saving...' : 'Save Changes'}</button>
                </div>
              </form>
            ) : (
              <div>
                <h2 className="text-xl font-semibold text-primary mb-2">{selectedTask.title}</h2>
                {selectedTask.description && <div className="text-sm text-secondary mb-4 prose prose-sm prose-slate max-w-none" dangerouslySetInnerHTML={{ __html: selectedTask.description }} />}
                <div className="space-y-4">
                  <div className="flex items-center justify-between py-2 border-b border-[#F3F4F6]">
                    <span className="text-sm text-secondary">Project</span>
                    <span className="text-sm font-medium text-primary">{selectedTask.project?.name}</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-[#F3F4F6]">
                    <span className="text-sm text-secondary">Assignee</span>
                    <span className="text-sm font-medium text-primary">{selectedTask.assignee?.name || 'Unassigned'}</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-[#F3F4F6]">
                    <span className="text-sm text-secondary">Created</span>
                    <span className="text-sm font-medium text-primary">{formatDate(selectedTask.createdAt)}</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-[#F3F4F6]">
                    <span className="text-sm text-secondary">Due Date</span>
                    <span className="text-sm font-medium text-primary">{formatDate(selectedTask.dueDate)}</span>
                  </div>
                  {selectedTask.reviewer && (
                    <div className="flex items-center justify-between py-2 border-b border-[#F3F4F6]">
                      <span className="text-sm text-secondary">Reviewer</span>
                      <span className="text-sm font-medium text-primary">{selectedTask.reviewer.name}</span>
                    </div>
                  )}
                  {selectedTask.driveLink && (
                    <div className="flex items-center justify-between py-2 border-b border-[#F3F4F6]">
                      <span className="text-sm text-secondary">Drive Link</span>
                      <a href={selectedTask.driveLink} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-blue-600 hover:underline max-w-[200px] truncate">{selectedTask.driveLink}</a>
                    </div>
                  )}
                  {selectedTask.completedAt && (
                    <div className="flex items-center justify-between py-2 border-b border-[#F3F4F6]">
                      <span className="text-sm text-secondary">Completed On</span>
                      <span className="text-sm font-medium text-primary">{formatDate(selectedTask.completedAt)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between py-2">
                    <span className="text-sm text-secondary">Priority</span>
                    <span className="text-sm font-medium text-primary capitalize">{selectedTask.priority.toLowerCase()}</span>
                  </div>
                  {(selectedTask.loggedHours ?? 0) > 0 && (
                    <div className="flex items-center justify-between py-2 border-t border-[#F3F4F6]">
                      <span className="text-sm text-secondary">Time Spent</span>
                      <span className="text-sm font-medium text-primary">⏱ {selectedTask.loggedHours}h</span>
                    </div>
                  )}
                </div>
                {(user?.role !== 'TEAM_MEMBER' || selectedTask.assignee?.id === user?.id) && (
                  <div className="mt-6">
                    <label className="block text-sm font-medium text-[#374151] mb-2">Update Status</label>
                    <div className="flex flex-wrap gap-2">
                      {kanbanCols.map((s) => (
                        <button
                          key={s}
                          onClick={() => { updateTaskStatus(selectedTask.id, s); setSelectedTask({ ...selectedTask, status: s }); }}
                          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${selectedTask.status === s ? 'bg-primary text-white' : 'border border-border text-secondary hover:bg-[#F9FAFB]'}`}
                        >
                          {kanbanLabels[s]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {/* Comments Section */}
                <div className="mt-8 border-t border-[#F3F4F6] pt-6">
                  <h3 className="text-sm font-semibold text-primary mb-4">Comments</h3>
                  
                  {/* Add Comment */}
                  <div className="mb-6 flex gap-3">
                    <div className="flex-1">
                      <textarea
                        value={commentContent}
                        onChange={(e) => setCommentContent(e.target.value)}
                        placeholder="Ask a question or post an update..."
                        className="w-full min-h-[80px] rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary transition-all resize-none"
                      />
                      <div className="mt-2 flex justify-end">
                        <button
                          onClick={handleAddComment}
                          disabled={submittingComment || !commentContent.trim()}
                          className="bg-primary text-white px-4 py-1.5 rounded-lg text-xs font-medium hover:bg-black transition-colors disabled:opacity-50"
                        >
                          {submittingComment ? 'Posting...' : 'Post Comment'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Comments List */}
                  <div className="space-y-4">
                    {!selectedTask.comments || selectedTask.comments.length === 0 ? (
                      <p className="text-sm text-secondary italic text-center py-4">No comments yet. Be the first to start the discussion!</p>
                    ) : (
                      selectedTask.comments.map((comment) => (
                        <div key={comment.id} className="flex gap-3">
                          <div className="h-8 w-8 rounded-full bg-[#F3F4F6] text-primary text-xs font-medium flex items-center justify-center shrink-0 border border-border">
                            {comment.author.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 bg-surface border border-border rounded-xl p-3">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-semibold text-xs text-primary">{comment.author.name}</span>
                              <span className="text-[10px] text-[#9CA3AF]">{new Date(comment.createdAt).toLocaleDateString()}</span>
                            </div>
                            <p className="text-sm text-[#374151] whitespace-pre-wrap">{comment.content}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                
              </div>
            )}
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Create Modal */}
      <AnimatePresence>
        {showCreate && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-black/20 backdrop-blur-sm" onClick={() => setShowCreate(false)} />
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="fixed right-0 top-0 bottom-0 z-[101] w-full max-w-lg bg-white border-l border-border shadow-2xl shadow-black/10 overflow-y-auto"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6] sticky top-0 bg-white z-10">
                <h2 className="text-lg font-semibold text-primary">New Task</h2>
                <button onClick={() => setShowCreate(false)} className="p-2 rounded-xl hover:bg-[#F3F4F6] transition-colors">
                  <X className="h-4 w-4 text-secondary" />
                </button>
              </div>
              <div className="p-6">
                <form onSubmit={handleSubmit(handleCreate)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#374151] mb-1.5">Title *</label>
            <input {...register('title')} className={`w-full rounded-xl border ${errors.title ? 'border-red-500' : 'border-border'} bg-white px-4 py-2.5 text-sm outline-none focus:border-primary transition-all`} />
            {errors.title && <p className="mt-1 text-xs text-red-500">{errors.title.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-[#374151] mb-1.5">Description</label>
            <Controller name="description" control={control} render={({ field }) => (
              <RichTextEditor value={field.value || ''} onChange={field.onChange} placeholder="Task details..." />
            )} />
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Task Type</label>
              <Controller name="type" control={control} render={({ field }) => (
                <Select
                  value={field.value || 'OTHER'}
                  onChange={field.onChange}
                  options={[
                    { label: 'Design', value: 'DESIGN' },
                    { label: 'Content', value: 'CONTENT' },
                    { label: 'Video', value: 'VIDEO' },
                    { label: 'Digital Marketing', value: 'DIGITAL_MARKETING' },
                    { label: 'Development', value: 'DEVELOPMENT' },
                    { label: 'Strategy', value: 'STRATEGY' },
                    { label: 'Other', value: 'OTHER' },
                  ]}
                />
              )} />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Assignee</label>
              <Controller name="assigneeId" control={control} render={({ field }) => (
                <Select
                  value={field.value || ''}
                  onChange={field.onChange}
                  options={[{ label: 'Unassigned', value: '' }, ...availableAssignees.map((m: any) => ({ label: m.name, value: m.id }))]}
                />
              )} />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Reviewer</label>
              <Controller name="reviewerId" control={control} render={({ field }) => (
                <Select
                  value={field.value || ''}
                  onChange={field.onChange}
                  options={[{ label: 'No Reviewer', value: '' }, ...availableAssignees.map((m: any) => ({ label: m.name, value: m.id }))]}
                />
              )} />
            </div>
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
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Assigned Date</label>
              <input type="date" {...register('assignedDate')} className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary transition-all" />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Due Date</label>
              <input type="date" {...register('dueDate')} className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary transition-all" />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Time Spent (hours)</label>
              <input type="number" step="0.5" min="0" {...register('loggedHours', { valueAsNumber: true })} className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary transition-all" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-[#374151] mb-1.5">Drive Link (Uploads, Drafts)</label>
            <input type="url" {...register('driveLink')} placeholder="https://drive.google.com/..." className={`w-full rounded-xl border ${errors.driveLink ? 'border-red-500' : 'border-border'} bg-white px-4 py-2.5 text-sm outline-none focus:border-primary transition-all`} />
            {errors.driveLink && <p className="mt-1 text-xs text-red-500">{errors.driveLink.message}</p>}
          </div>
          <div className="pt-4 flex gap-3">
            <button type="button" onClick={() => setShowCreate(false)} className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] transition-all">Cancel</button>
            <button type="submit" disabled={submitting} className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] disabled:opacity-50 transition-all">{submitting ? 'Creating...' : 'Create Task'}</button>
          </div>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function TasksPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-100">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    }>
      <TasksContent />
    </Suspense>
  );
}
