'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import { getSSE } from '@/lib/sse';
import { formatDate, formatShortDate, getInitials, getAvatarColor, triggerHaptic, getClientDisplayName } from '@/lib/utils';
import { TASK_STATUSES, TASK_STATUS_LABELS, TASK_STATUS_COLORS, TASK_STATUS_OPTIONS } from '@/lib/task-status';
import { Search, Plus, Filter, MessageSquare, X, Trash2, Settings, Check, ChevronRight, LayoutList, Kanban } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { Skeleton } from '@/components/ui/skeleton';
import { ViewSettingsPanel } from '@/components/ui/view-settings-panel';
import toast from 'react-hot-toast';
import { useAuthStore, useConfirmStore, useTimeTrackingStore } from '@/stores';
import { useTasks, useProjects, useMembers, useTeams, useClients } from '@/hooks/useQueries';
import { useQueryClient } from '@tanstack/react-query';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { TaskDetailDrawer } from '@/components/tasks/task-detail-drawer';
import { TaskFormDrawer } from '@/components/tasks/task-form-drawer';
import { ColumnDropdown } from '@/components/ui/column-dropdown';
import { SwipeableCard } from '@/components/ui/swipeable-card';

interface Task {
  id: string; title: string; description?: string | null; priority: string; status: string;
  dueDate?: string | null; assignedDate?: string | null; completedAt?: string | null; createdAt: string; projectId: string;
  loggedHours?: number | null;
  type: string; driveLink?: string | null; reviewerId?: string | null;
  project?: { id: string; name: string; client?: { name: string } };
  assignee?: { id: string; name: string; avatar?: string | null } | null;
  assignees?: { id: string; name: string; avatar?: string | null }[];
  assignedBy?: { id: string; name: string; avatar?: string | null } | null;
  reviewer?: { id: string; name: string; avatar?: string | null } | null;
  isRecurring?: boolean | null;
  recurrenceFrequency?: string | null;
  _count?: { subtasks: number; comments: number };
  comments?: { id: string; content: string; createdAt: string; author: { id: string; name: string; avatar?: string | null } }[];
}

interface Project { id: string; name: string; members?: { user: { id: string; name: string } }[]; teams?: { team: { members: { user: { id: string; name: string } }[] } }[] }
interface Member { id: string; name: string; }

const isTaskOverdue = (task: Task) => {
  if (!task.dueDate || task.status === 'COMPLETED' || task.status === 'ON_HOLD') return false;
  const due = new Date(task.dueDate);
  due.setHours(23, 59, 59, 999);
  return due < new Date();
};

const getDaysLate = (task: Task) => {
  if (!task.dueDate || task.status === 'COMPLETED') return 0;
  const due = new Date(task.dueDate);
  due.setHours(23, 59, 59, 999);
  const now = new Date();
  if (due >= now) return 0;
  const diffTime = Math.abs(now.getTime() - due.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

const priorityDots: Record<string, string> = {
  LOW: 'bg-gray-300', MEDIUM: 'bg-blue-400', HIGH: 'bg-orange-500', URGENT: 'bg-red-500',
};

type AssigneePerson = { id: string; name: string; avatar?: string | null };
function taskAssignees(task: { assignees?: AssigneePerson[]; assignee?: AssigneePerson | null }): AssigneePerson[] {
  return task.assignees && task.assignees.length ? task.assignees : (task.assignee ? [task.assignee] : []);
}
function assigneeLabel(task: { assignees?: AssigneePerson[]; assignee?: AssigneePerson | null }): string {
  const people = taskAssignees(task);
  if (!people.length) return 'Unassigned';
  return people.length === 1 ? people[0].name : `${people[0].name} +${people.length - 1}`;
}
function AssigneeAvatars({ task, size = 26 }: { task: { assignees?: AssigneePerson[]; assignee?: AssigneePerson | null }; size?: number }) {
  const people = taskAssignees(task);
  if (!people.length) return null;
  const shown = people.slice(0, 3);
  const extra = people.length - shown.length;
  return (
    <div className="flex -space-x-1.5">
      {shown.map((p) => (
        <div key={p.id} title={p.name} style={{ height: size, width: size }} className={`flex items-center justify-center rounded-full text-[10px] font-medium ring-2 ring-white ${getAvatarColor(p.name)}`}>
          {getInitials(p.name)}
        </div>
      ))}
      {extra > 0 && (
        <div style={{ height: size, width: size }} className="flex items-center justify-center rounded-full text-[10px] font-medium ring-2 ring-white bg-[#F3F4F6] text-secondary">+{extra}</div>
      )}
    </div>
  );
}

function TasksContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuthStore();
  const { confirm } = useConfirmStore();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>(() => {
    const val = searchParams.get('statuses');
    if (val) return val.split(',');
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('flowzen_tasks_filters');
      if (saved) {
        try {
          return JSON.parse(saved).statuses || [];
        } catch { /* ignore */ }
      }
    }
    return [];
  });
  const [clientFilter, setClientFilter] = useState<string[]>(() => {
    const val = searchParams.get('clients');
    if (val) return val.split(',');
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('flowzen_tasks_filters');
      if (saved) {
        try {
          return JSON.parse(saved).clients || [];
        } catch { /* ignore */ }
      }
    }
    return [];
  });
  const [projectFilter, setProjectFilter] = useState<string[]>(() => {
    const val = searchParams.get('projects');
    if (val) return val.split(',');
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('flowzen_tasks_filters');
      if (saved) {
        try {
          return JSON.parse(saved).projects || [];
        } catch { /* ignore */ }
      }
    }
    return [];
  });
  // Default to all tasks. Team members are scoped to their own tasks by the API
  // (the assignee filter isn't shown to them); admins/managers see everyone and
  // can narrow with the people filter.
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>(() => {
    const val = searchParams.get('assignees');
    if (val) return val.split(',');
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('flowzen_tasks_filters');
      if (saved) {
        try {
          return JSON.parse(saved).assignees || [];
        } catch { /* ignore */ }
      }
    }
    return [];
  });
  const [hasSetDefaultAssignee, setHasSetDefaultAssignee] = useState(() => {
    const hasUrl = !!searchParams.get('assignees');
    if (hasUrl) return true;
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('flowzen_tasks_filters');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          return !!(parsed.assignees && parsed.assignees.length > 0);
        } catch { /* ignore */ }
      }
    }
    return false;
  });

  useEffect(() => {
    if (user?.id && user.role !== 'TEAM_MEMBER' && !hasSetDefaultAssignee) {
      setAssigneeFilter([user.id]);
      setHasSetDefaultAssignee(true);
    }
  }, [user, hasSetDefaultAssignee]);

  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);
  const [teamFilter, setTeamFilter] = useState<string[]>(() => {
    const val = searchParams.get('teams');
    if (val) return val.split(',');
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('flowzen_tasks_filters');
      if (saved) {
        try {
          return JSON.parse(saved).teams || [];
        } catch { /* ignore */ }
      }
    }
    return [];
  });
  const [showCompleted, setShowCompleted] = useState(false);
  const [sort, setSort] = useState<string>('createdAt_desc');
  const [dueDateFrom, setDueDateFrom] = useState('');
  const [dueDateTo, setDueDateTo] = useState('');

  // Sync filter states with URL query parameters and localStorage
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());

    if (clientFilter.length > 0) params.set('clients', clientFilter.join(','));
    else params.delete('clients');

    if (projectFilter.length > 0) params.set('projects', projectFilter.join(','));
    else params.delete('projects');

    if (statusFilter.length > 0) params.set('statuses', statusFilter.join(','));
    else params.delete('statuses');

    if (assigneeFilter.length > 0) params.set('assignees', assigneeFilter.join(','));
    else params.delete('assignees');

    if (teamFilter.length > 0) params.set('teams', teamFilter.join(','));
    else params.delete('teams');

    if (typeof window !== 'undefined') {
      localStorage.setItem('flowzen_tasks_filters', JSON.stringify({
        clients: clientFilter,
        projects: projectFilter,
        statuses: statusFilter,
        assignees: assigneeFilter,
        teams: teamFilter
      }));
    }

    const currentQuery = searchParams.toString();
    const newQuery = params.toString();
    if (currentQuery !== newQuery) {
      router.replace(`?${newQuery}`, { scroll: false });
    }
  }, [clientFilter, projectFilter, statusFilter, assigneeFilter, teamFilter, router, searchParams]);

  const ALL_TASK_COLUMNS = [
    { id: 'task', label: 'Task' },
    { id: 'client', label: 'Company' },
    { id: 'project', label: 'Project' },
    { id: 'assignee', label: 'Assignee' },
    { id: 'priority', label: 'Priority' },
    { id: 'status', label: 'Status' },
    { id: 'dueDate', label: 'Due Date' },
  ];
  const [visibleColumns, setVisibleColumns] = useState<string[]>(ALL_TASK_COLUMNS.map(c => c.id));
  const [showColumnDropdown, setShowColumnDropdown] = useState(false);
  const [showViewSettings, setShowViewSettings] = useState(false);
  const [viewName, setViewName] = useState('All Tasks');

  const LOCAL_STORAGE_KEY = 'flowzen_view_tasks';

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.name) setViewName(parsed.name);
          if (parsed.visibleColumns) setVisibleColumns(parsed.visibleColumns);
          if (parsed.viewType) setView(parsed.viewType);
        } catch (e) {
          console.error(e);
        }
      }
    }
  }, []);

  const [view, setView] = useState<'list' | 'board'>('list');
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setView('list');
    }
  }, []);

  const showCreate = searchParams.get('create') === 'true';
  const setShowCreate = (open: boolean) => {
    const params = new URLSearchParams(searchParams.toString());
    if (open) params.set('create', 'true');
    else params.delete('create');
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const currentFilter = searchParams.get('filter') || '';
  const setQuickFilter = (val: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (val) params.set('filter', val);
    else params.delete('filter');
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const taskIdParam = searchParams.get('taskId');
  const [selectedTask, setSelectedTaskState] = useState<Task | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // Lock body scroll when create or edit drawer is open on mobile
  useEffect(() => {
    const shouldLock = showCreate || (selectedTask && isEditing);
    if (shouldLock) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [showCreate, selectedTask, isEditing]);

  const statusParam = useMemo(() => {
    if (statusFilter.length > 0) return statusFilter.join(',');
    if (!showCompleted) return TASK_STATUSES.filter(s => s !== 'COMPLETED').join(',');
    return '';
  }, [statusFilter, showCompleted]);

  const { data: clients = [] } = useClients();

  const {
    data,
    isLoading: isLoadingTasks,
    refetch: refetchTasks,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage
  } = useTasks(search, statusParam, projectFilter.join(','), assigneeFilter.join(','), priorityFilter.join(','), teamFilter.join(','), searchParams.get('filter'), sort, dueDateFrom, dueDateTo, clientFilter.join(','));

  const tasks = useMemo(() => {
    const rawTasks = data?.pages.flatMap((page) => page.tasks) || [];
    if (sort === 'createdAt_desc') {
      const statusOrder: Record<string, number> = {
        IN_PROGRESS: 1,
        REVIEW: 2,
        TODO: 3,
        APPROVED: 4,
        BACKLOG: 5,
        BLOCKED: 6,
        ON_HOLD: 7,
        COMPLETED: 8
      };
      return [...rawTasks].sort((a, b) => {
        const orderA = statusOrder[a.status] ?? 99;
        const orderB = statusOrder[b.status] ?? 99;
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    }
    return rawTasks;
  }, [data, sort]);
  const { data: projectsData } = useProjects();
  const projects = useMemo(() => projectsData?.pages.flatMap((page) => page.projects) || [], [projectsData]);
  const filteredProjectsForDropdown = useMemo(() => {
    if (clientFilter.length === 0) return projects;
    return projects.filter((p: any) => clientFilter.includes(p.client?.id || p.clientId));
  }, [projects, clientFilter]);
  const { data: members = [] } = useMembers();
  const { data: teams = [] } = useTeams();
  const loading = isLoadingTasks;

  const [boardTasks, setBoardTasks] = useState<Task[]>([]);
  useEffect(() => {
    setBoardTasks(tasks);
  }, [tasks]);

  useEffect(() => {
    if (taskIdParam) {
      const t = tasks.find((x) => x.id === taskIdParam);
      if (t) {
        if (t.id !== selectedTask?.id) {
          setSelectedTaskState(t);
          api.get<Task>(`/tasks/${t.id}`).then((fullTask) => {
            setSelectedTaskState(prev => prev?.id === fullTask.id ? fullTask : prev);
          }).catch(() => { });
        }
      } else if (!selectedTask || selectedTask.id !== taskIdParam) {
        // Not in the current list (e.g. from a notification), fetch it directly
        api.get<Task>(`/tasks/${taskIdParam}`).then((fullTask) => {
          setSelectedTaskState(fullTask);
        }).catch(() => { });
      }
    } else {
      setSelectedTaskState(null);
    }
  }, [taskIdParam, tasks, selectedTask?.id]);

  const setSelectedTask = async (task: Task | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (task) params.set('taskId', task.id);
    else params.delete('taskId');
    router.replace(`?${params.toString()}`, { scroll: false });

    // Immediate UI update
    if (task && task.id !== selectedTask?.id) {
      setSelectedTaskState(task);
      api.get<Task>(`/tasks/${task.id}`).then((fullTask) => {
        setSelectedTaskState(prev => prev?.id === fullTask.id ? fullTask : prev);
      }).catch(() => { });
    } else if (!task) {
      setSelectedTaskState(null);
    }
  };

  function startEditing(taskArg?: Task) {
    const t = taskArg || selectedTask;
    if (!t) return;
    if (taskArg) {
      setSelectedTask(taskArg);
    }
    setIsEditing(true);
  }

  async function updateTaskStatus(taskId: string, status: string) {
    // Optimistic update so the UI reflects the change immediately (list, board, and panel).
    queryClient.setQueriesData({ queryKey: ['tasks'] }, (old: any) => {
      if (!old?.pages) return old;
      return {
        ...old,
        pages: old.pages.map((page: any) => ({
          ...page,
          tasks: page.tasks.map((t: any) => (t.id === taskId ? { ...t, status } : t)),
        })),
      };
    });
    setBoardTasks(prev => prev.map(t => (t.id === taskId ? { ...t, status } : t)));
    setSelectedTaskState(prev => (prev?.id === taskId ? { ...prev, status } : prev));
    try {
      await api.put(`/tasks/${taskId}`, { status });
      toast.success('Task status updated');
      refetchTasks();

    } catch (err: any) {
      toast.error(err.message || 'Failed to update status');
      refetchTasks(); // revert optimistic change on failure
    }
  }

  async function deleteTask(target?: Task) {
    const t = target ?? selectedTask;
    if (!t) return;

    const isConfirmed = await confirm({
      title: 'Delete Task',
      message: 'Are you sure you want to delete this task? This action cannot be undone.',
      confirmText: 'Delete Task',
      cancelText: 'Cancel',
    });

    if (isConfirmed) {
      try {
        await api.delete(`/tasks/${t.id}`);
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

  const isCustomSortActive = sort && sort !== 'createdAt_desc';
  const isDefaultAssigneeActive = !!(user?.id && user.role !== 'TEAM_MEMBER' && assigneeFilter.length === 1 && assigneeFilter[0] === user.id);
  const isAssigneeCustom = assigneeFilter.length > 0 && !isDefaultAssigneeActive;
  const isAssigneeCleared = assigneeFilter.length === 0 && !!(user?.id && user.role !== 'TEAM_MEMBER');

  const hasActiveFilters = !!(
    search ||
    clientFilter.length > 0 ||
    projectFilter.length > 0 ||
    statusFilter.length > 0 ||
    priorityFilter.length > 0 ||
    teamFilter.length > 0 ||
    isCustomSortActive ||
    showCompleted ||
    searchParams.get('filter') ||
    isAssigneeCustom ||
    isAssigneeCleared
  );

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="h-full flex flex-col space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-primary tracking-tight flex items-center gap-2">
            Tasks
            <span className="text-xs font-normal text-secondary bg-[#F3F4F6] px-2 py-0.5 rounded-lg border border-border">
              {viewName}
            </span>
          </h1>
          <p className="text-sm text-secondary mt-1">{tasks.length} tasks</p>
        </div>
      </div>

      {/* Redesigned Clean Tasks Toolbar */}
      <div className="bg-white border border-border rounded-2xl p-4 shadow-sm flex flex-col gap-4 w-full mb-6">
        {/* Row 1: Search + Active Filter Pills */}
        <div className="flex flex-wrap items-center gap-2 w-full">
          {/* Search Box */}
          <div className="relative w-full sm:w-64 md:w-80 shrink-0">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks..."
              className="w-full h-9 rounded-xl border border-border bg-white pl-10 pr-4 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder:text-[#9CA3AF]"
            />
          </div>

          {/* Filter Pills */}
          <div className="shrink-0">
            <MultiSelect
              showSelectAll
              value={clientFilter}
              onChange={(val) => {
                setClientFilter(val);
                // Clear any selected projects that don't belong to the newly selected companies
                if (val.length > 0) {
                  setProjectFilter(prev => prev.filter(projId => {
                    const p = projects.find(proj => proj.id === projId);
                    return val.includes(p?.client?.id || p?.clientId);
                  }));
                }
              }}
              placeholder="Companies"
              triggerClassName={clientFilter.length > 0 ? "border-primary bg-primary/[0.02] text-primary h-9 rounded-xl px-3 text-xs font-semibold" : "h-9 rounded-xl border border-dashed border-gray-300 text-secondary px-3 text-xs"}
              options={clients.map((c: any) => ({ label: getClientDisplayName(c), value: c.id }))}
            />
          </div>

          <div className="shrink-0">
            <MultiSelect
              showSelectAll
              value={projectFilter}
              onChange={setProjectFilter}
              placeholder="Projects"
              triggerClassName={projectFilter.length > 0 ? "border-primary bg-primary/[0.02] text-primary h-9 rounded-xl px-3 text-xs font-semibold" : "h-9 rounded-xl border border-dashed border-gray-300 text-secondary px-3 text-xs"}
              options={filteredProjectsForDropdown.map((p) => ({ label: p.name, value: p.id }))}
            />
          </div>

          <div className="shrink-0">
            <MultiSelect
              showSelectAll
              value={statusFilter}
              onChange={setStatusFilter}
              placeholder="Status"
              triggerClassName={statusFilter.length > 0 ? "border-primary bg-primary/[0.02] text-primary h-9 rounded-xl px-3 text-xs font-semibold" : "h-9 rounded-xl border border-dashed border-gray-300 text-secondary px-3 text-xs"}
              options={TASK_STATUS_OPTIONS}
            />
          </div>

          <div className="shrink-0">
            <MultiSelect
              showSelectAll
              value={teamFilter}
              onChange={setTeamFilter}
              placeholder="Departments"
              triggerClassName={teamFilter.length > 0 ? "border-primary bg-primary/[0.02] text-primary h-9 rounded-xl px-3 text-xs font-semibold" : "h-9 rounded-xl border border-dashed border-gray-300 text-secondary px-3 text-xs"}
              options={teams.map((t: any) => ({ label: t.name, value: t.id }))}
            />
          </div>

          {user?.role !== 'TEAM_MEMBER' && (
            <div className="shrink-0">
              <MultiSelect
                showSelectAll
                value={assigneeFilter}
                onChange={setAssigneeFilter}
                placeholder="Assignees"
                triggerClassName={assigneeFilter.length > 0 ? "border-primary bg-primary/[0.02] text-primary h-9 rounded-xl px-3 text-xs font-semibold" : "h-9 rounded-xl border border-dashed border-gray-300 text-secondary px-3 text-xs"}
                options={members.map((m: any) => ({ label: m.name, value: m.id, image: getInitials(m.name), colorClass: getAvatarColor(m.name), capacity: m.capacity, isOverloaded: m.activeTasks > (m.overloadThreshold ?? 25) }))}
              />
            </div>
          )}

          <div className="shrink-0">
            <MultiSelect
              showSelectAll
              value={priorityFilter}
              onChange={setPriorityFilter}
              placeholder="Priority"
              triggerClassName={priorityFilter.length > 0 ? "border-primary bg-primary/[0.02] text-primary h-9 rounded-xl px-3 text-xs font-semibold" : "h-9 rounded-xl border border-dashed border-gray-300 text-secondary px-3 text-xs"}
              options={[
                { label: 'Low', value: 'LOW' },
                { label: 'Medium', value: 'MEDIUM' },
                { label: 'High', value: 'HIGH' },
                { label: 'Critical', value: 'CRITICAL' },
                { label: 'Urgent', value: 'URGENT' },
              ]}
            />
          </div>

          {view === 'list' && (
            <div className="shrink-0">
              <Select
                ariaLabel="Sort Tasks"
                value={sort}
                onChange={setSort}
                buttonClassName="px-3 h-9 rounded-xl border border-border bg-white text-secondary text-xs font-medium focus:ring-1 focus:ring-primary shadow-none"
                options={[
                  { label: 'Sort: Created (New)', value: 'createdAt_desc' },
                  { label: 'Sort: Project A-Z', value: 'project_asc' },
                  { label: 'Sort: Project Z-A', value: 'project_desc' },
                  { label: 'Sort: Priority (Low-High)', value: 'priority_asc' },
                  { label: 'Sort: Priority (High-Low)', value: 'priority_desc' },
                  { label: 'Sort: Status (To Do-Done)', value: 'status_asc' },
                  { label: 'Sort: Status (Done-To Do)', value: 'status_desc' },
                  { label: 'Sort: Name A-Z', value: 'title_asc' },
                  { label: 'Sort: Name Z-A', value: 'title_desc' },
                  { label: 'Sort: Created (Old)', value: 'createdAt_asc' },
                  { label: 'Sort: Due Date', value: 'dueDate_desc' },
                  { label: 'Sort: Updated', value: 'updatedAt_desc' },
                ]}
              />
            </div>
          )}

          <div className="flex items-center gap-1.5 border border-border rounded-xl px-3 h-9 bg-white shadow-sm shrink-0">
            <label htmlFor="show-completed" className="text-xs font-semibold text-[#4B5563] cursor-pointer select-none">Show Done</label>
            <button
              id="show-completed"
              type="button"
              role="switch"
              aria-checked={showCompleted}
              onClick={() => setShowCompleted(!showCompleted)}
              className={`relative inline-flex h-4.5 w-8 shrink-0 items-center rounded-full border transition-colors ${showCompleted ? 'bg-primary border-primary' : 'bg-gray-200 border-gray-300'}`}
            >
              <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow-sm transition-transform ${showCompleted ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
            </button>
          </div>
        </div>

        {/* Separator line */}
        <div className="h-px bg-border/60 w-full" />

        {/* Row 2: Tabs + Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 w-full">
          {/* Left Side: Segmented tabs */}
          <div className="flex bg-[#F3F4F6] p-1 rounded-xl gap-0.5 border border-border/50 self-start shrink-0 overflow-x-auto no-scrollbar">
            {[
              { id: '', label: 'All', activeColor: 'bg-white text-primary shadow-sm border border-black/5' },
              { id: 'today', label: 'Today', activeColor: 'bg-white text-primary shadow-sm border border-black/5' },
              { id: 'overdue', label: 'Overdue', activeColor: 'bg-red-500 text-white shadow-sm' },
              { id: 'approval', label: 'Approval', activeColor: 'bg-amber-500 text-white shadow-sm' }
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setQuickFilter(tab.id)}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${currentFilter === tab.id
                  ? tab.activeColor
                  : 'text-secondary hover:text-primary'
                  }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Right Side: View toggle, settings, new task, and clear filters */}
          <div className="flex items-center justify-end gap-2.5 ml-auto sm:ml-0">
            {hasActiveFilters && (
              <button
                onClick={() => {
                  setSearch('');
                  setClientFilter([]);
                  setProjectFilter([]);
                  setStatusFilter([]);
                  setPriorityFilter([]);
                  setTeamFilter([]);
                  setSort('createdAt_desc');
                  if (user?.id && user.role !== 'TEAM_MEMBER') {
                    setAssigneeFilter([user.id]);
                  } else {
                    setAssigneeFilter([]);
                  }
                  setShowCompleted(false);
                  if (typeof window !== 'undefined') {
                    localStorage.removeItem('flowzen_tasks_filters');
                  }
                  router.replace('/tasks', { scroll: false });
                }}
                className="flex items-center gap-1.5 h-8.5 rounded-xl bg-red-50 px-3 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors border border-red-100"
              >
                <X className="h-3.5 w-3.5" /> Clear Filters
              </button>
            )}

            {/* List / Board Toggle Buttons */}
            <div className="flex bg-[#F3F4F6] p-1 rounded-xl gap-0.5 border border-border/50 shrink-0 h-8.5 items-center">
              <button
                type="button"
                onClick={() => setView('list')}
                className={`p-1.5 rounded-lg transition-all ${view === 'list' ? 'bg-white text-primary shadow-sm' : 'text-secondary hover:text-primary'}`}
                title="List View"
              >
                <LayoutList className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setView('board')}
                className={`p-1.5 rounded-lg transition-all ${view === 'board' ? 'bg-white text-primary shadow-sm' : 'text-secondary hover:text-primary'}`}
                title="Board View"
              >
                <Kanban className="h-3.5 w-3.5" />
              </button>
            </div>

            <button onClick={() => setShowViewSettings(true)} className="p-2 rounded-xl border border-border bg-white hover:bg-gray-50 transition-colors text-secondary hover:text-primary h-8.5 w-8.5 flex items-center justify-center" title="View settings">
              <Settings className="h-3.5 w-3.5" />
            </button>

            <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-[#1F2937] transition-all h-8.5">
              <Plus className="h-3.5 w-3.5" /> New Task
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex gap-4 overflow-x-auto pb-4 h-full">
          {TASK_STATUSES.map((col) => (
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
                {TASK_STATUSES.map((col) => {
                  const colTasks = boardTasks.filter((t) => t.status === col);
                  return (
                    <div key={col} className="min-w-[260px] flex-1 flex flex-col">
                      <div className="flex items-center gap-2 mb-3 px-1">
                        <div className={`h-2 w-2 rounded-full ${TASK_STATUS_COLORS[col]?.split(' ')[0] || 'bg-gray-200'}`} />
                        <span className="text-xs font-medium text-[#374151] uppercase tracking-wide">{TASK_STATUS_LABELS[col]}</span>
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
                                      <span className="text-[11px] text-[#9CA3AF]">
                                        {t.project?.client?.name ? `${t.project.client.name} • ` : ''}{t.project?.name}
                                      </span>
                                      <div className="flex items-center gap-2">
                                        {(t._count?.comments ?? 0) > 0 && (
                                          <span className="flex items-center gap-0.5 text-[10px] text-[#9CA3AF]">
                                            <MessageSquare className="h-3 w-3" /> {t._count?.comments}
                                          </span>
                                        )}
                                        <span className="text-[11px] font-medium text-[#4B5563]">{assigneeLabel(t)}</span>
                                        {(t.loggedHours ?? 0) > 0 && (
                                          <span className="text-[10px] text-secondary bg-[#F3F4F6] px-1.5 py-0.5 rounded-md font-medium tabular-nums border border-border">
                                            ⏱ {t.loggedHours}h
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    {t.dueDate && (
                                      <div className="flex items-center gap-2 mt-2">
                                        <p className={`text-[10px] ${isTaskOverdue(t) ? 'text-red-500 font-medium' : 'text-[#9CA3AF]'}`}>
                                          {isTaskOverdue(t) ? `Overdue (${getDaysLate(t)} days late)` : formatShortDate(t.dueDate)}
                                        </p>
                                      </div>
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
                        {visibleColumns.includes('task') && <th className="px-6 py-3.5 text-left text-xs font-medium text-secondary uppercase tracking-wide">Task</th>}
                        {visibleColumns.includes('client') && <th className="px-6 py-3.5 text-left text-xs font-medium text-secondary uppercase tracking-wide">Company</th>}
                        {visibleColumns.includes('project') && (
                          <th className="px-6 py-3.5 text-left text-xs font-medium text-secondary uppercase tracking-wide">
                            <ColumnDropdown
                              title="Project"
                              sortAscValue="project_asc"
                              sortDescValue="project_desc"
                              sortAscLabel="Sort A to Z"
                              sortDescLabel="Sort Z to A"
                              currentSort={sort}
                              onSortChange={setSort}
                            />
                          </th>
                        )}
                        {visibleColumns.includes('assignee') && <th className="px-6 py-3.5 text-left text-xs font-medium text-secondary uppercase tracking-wide">Assignee</th>}
                        {visibleColumns.includes('priority') && (
                          <th className="px-6 py-3.5 text-left text-xs font-medium text-secondary uppercase tracking-wide">
                            <ColumnDropdown
                              title="Priority"
                              sortAscValue="priority_asc"
                              sortDescValue="priority_desc"
                              sortAscLabel="Low to Urgent"
                              sortDescLabel="Urgent to Low"
                              currentSort={sort}
                              onSortChange={setSort}
                            />
                          </th>
                        )}
                        {visibleColumns.includes('status') && (
                          <th className="px-6 py-3.5 text-left text-xs font-medium text-secondary uppercase tracking-wide">
                            <ColumnDropdown
                              title="Status"
                              sortAscValue="status_asc"
                              sortDescValue="status_desc"
                              sortAscLabel="To Do to Done"
                              sortDescLabel="Done to To Do"
                              currentSort={sort}
                              onSortChange={setSort}
                            />
                          </th>
                        )}
                        {visibleColumns.includes('dueDate') && (
                          <th className="px-6 py-3.5 text-left text-xs font-medium text-secondary uppercase tracking-wide">
                            <ColumnDropdown
                              title="Due Date"
                              sortDescValue="dueDate_desc"
                              sortDescLabel="Latest First"
                              currentSort={sort}
                              onSortChange={setSort}
                            />
                          </th>
                        )}
                        <th className="px-6 py-3.5 w-10 text-center relative select-none">
                          <button
                            onClick={(e) => { e.stopPropagation(); setShowColumnDropdown(!showColumnDropdown); }}
                            className="inline-flex items-center justify-center h-6 w-6 rounded-md text-[#9CA3AF] hover:bg-gray-100 hover:text-primary transition-all text-sm font-bold border border-transparent hover:border-gray-200"
                            title="Toggle visible columns"
                          >
                            +
                          </button>
                          <AnimatePresence>
                            {showColumnDropdown && (
                              <>
                                <div className="fixed inset-0 z-40" onClick={() => setShowColumnDropdown(false)} />
                                <motion.div
                                  initial={{ opacity: 0, y: 5 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: 5 }}
                                  className="absolute right-0 top-full mt-2 w-48 bg-white border border-border rounded-xl shadow-lg z-50 overflow-hidden py-1"
                                >
                                  <div className="px-3 py-2 border-b border-[#F3F4F6] text-[10px] font-semibold text-secondary uppercase tracking-wider text-left">
                                    Visible Columns
                                  </div>
                                  {ALL_TASK_COLUMNS.map(col => (
                                    <button
                                      key={col.id}
                                      onClick={() => {
                                        setVisibleColumns(prev =>
                                          prev.includes(col.id)
                                            ? prev.filter(c => c !== col.id)
                                            : [...prev, col.id]
                                        )
                                      }}
                                      className="w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-[#F9FAFB] transition-colors"
                                    >
                                      <span className="text-[#374151]">{col.label}</span>
                                      {visibleColumns.includes(col.id) && <Check className="w-4 h-4 text-primary" />}
                                    </button>
                                  ))}
                                </motion.div>
                              </>
                            )}
                          </AnimatePresence>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F3F4F6]">
                      {tasks.map((t) => (
                        <tr key={t.id} className="hover:bg-surface cursor-pointer transition-colors" onClick={() => setSelectedTask(t)}>
                          {visibleColumns.includes('task') && (
                            <td className="px-6 py-3.5">
                              <div className="flex items-center gap-2">
                                <div className={`h-2 w-2 rounded-full shrink-0 ${priorityDots[t.priority]}`} />
                                <span className="text-sm font-medium text-primary">{t.title}</span>
                              </div>
                            </td>
                          )}
                          {visibleColumns.includes('client') && <td className="px-6 py-3.5 text-sm text-secondary">{t.project?.client?.company || '-'}</td>}
                          {visibleColumns.includes('project') && <td className="px-6 py-3.5 text-sm text-secondary">{t.project?.name}</td>}
                          {visibleColumns.includes('assignee') && (
                            <td className="px-6 py-3.5">
                              {taskAssignees(t).length ? (
                                <div className="flex items-center gap-2">
                                  <AssigneeAvatars task={t} size={24} />
                                  <span className="text-sm text-[#374151]">{assigneeLabel(t)}</span>
                                </div>
                              ) : <span className="text-sm text-[#9CA3AF]">Unassigned</span>}
                            </td>
                          )}
                          {visibleColumns.includes('priority') && (
                            <td className="px-6 py-3.5">
                              <span className="text-xs font-medium text-[#374151] capitalize">{t.priority.toLowerCase()}</span>
                            </td>
                          )}
                          {visibleColumns.includes('status') && (
                            <td className="px-6 py-3.5" onClick={(e) => e.stopPropagation()}>
                              <div className="w-36">
                                <Select
                                  value={t.status}
                                  onChange={(val) => updateTaskStatus(t.id, val)}
                                  options={TASK_STATUS_OPTIONS}
                                  buttonClassName={`py-1 px-2.5 text-xs font-medium border-transparent shadow-none ${TASK_STATUS_COLORS[t.status] || ''}`}
                                />
                              </div>
                            </td>
                          )}
                          {visibleColumns.includes('dueDate') && (
                            <td className="px-6 py-3.5 text-sm">
                              {t.dueDate ? (
                                <div className="flex items-center gap-2">
                                  <span className={isTaskOverdue(t) ? 'text-red-500 font-medium' : 'text-secondary'}>
                                    {isTaskOverdue(t) ? `Overdue (${getDaysLate(t)} ${getDaysLate(t) === 1 ? 'day' : 'days'} late)` : formatShortDate(t.dueDate)}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-[#9CA3AF]">-</span>
                              )}
                            </td>
                          )}
                          <td className="px-6 py-3.5 text-right w-10 text-secondary">
                            <ChevronRight className="h-4 w-4 inline-block" />
                          </td>
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
                      deleteTask(t);
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
                        <span className={`inline-flex items-center rounded-lg px-2 py-0.5 text-[10px] font-medium ${TASK_STATUS_COLORS[t.status]}`}>
                          {t.status.replace('_', ' ')}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-medium text-[#4B5563]">{assigneeLabel(t)}</span>
                        </div>
                      </div>
                      {t.dueDate && (
                        <div className="flex items-center gap-2 mt-2">
                          <p className={`text-[10px] ${isTaskOverdue(t) ? 'text-red-500 font-medium' : 'text-[#9CA3AF]'}`}>{formatShortDate(t.dueDate)}</p>
                        </div>
                      )}
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

      {/* Task detail preview (shared component) */}
      <AnimatePresence>
        {selectedTask && !isEditing && (
          <TaskDetailDrawer
            taskId={selectedTask.id}
            onClose={() => setSelectedTask(null)}
            onChanged={refetchTasks}
            onEdit={(t) => startEditing(t)}
            canManage={user?.role !== 'TEAM_MEMBER'}
            currentUserId={user?.id}
          />
        )}
      </AnimatePresence>

      {/* Shared Task Create/Edit Drawer */}
      <TaskFormDrawer
        isOpen={showCreate || (isEditing && !!selectedTask)}
        taskToEdit={isEditing ? selectedTask : null}
        onClose={() => {
          if (showCreate) setShowCreate(false);
          if (isEditing) {
            setIsEditing(false);
            setSelectedTask(null);
          }
        }}
        onSuccess={() => {
          refetchTasks();
        }}
      />

      <ViewSettingsPanel
        isOpen={showViewSettings}
        onClose={() => setShowViewSettings(false)}
        viewName={viewName}
        onViewNameChange={setViewName}
        viewType={view}
        onViewTypeChange={setView}
        columns={ALL_TASK_COLUMNS}
        visibleColumns={visibleColumns}
        onVisibleColumnsChange={setVisibleColumns}
        onSave={() => {
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ viewType: view, visibleColumns, name: viewName }));
          setShowViewSettings(false);
          toast.success('View saved successfully');
        }}
        onReset={() => {
          setView('list');
          setVisibleColumns(ALL_TASK_COLUMNS.map(c => c.id));
          setViewName('All Tasks');
          localStorage.removeItem(LOCAL_STORAGE_KEY);
          toast.success('View reset to default');
        }}
      />
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
