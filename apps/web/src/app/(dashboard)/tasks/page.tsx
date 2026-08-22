'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  CheckCircle2,
  Search,
  Plus,
  X,
  List,
  LayoutDashboard,
  Calendar as CalendarIcon,
  Filter,
  RotateCcw,
  AlertCircle,
  Eye,
  Check,
  Code,
  Palette,
  PenTool,
  Bug,
  Users,
  Package,
} from 'lucide-react';
import { api, formatDate, type OrgConfig, type Member } from '@/lib/api-v2';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { EmptyState, ErrorNote } from '@/components/ui/empty-state';
import { PageSkeleton } from '@/components/ui/skeleton-loaders';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { MultiSelect, type Option } from '@/components/ui/multi-select';
import { NewTaskPanel } from '@/components/tasks/NewTaskPanel';
import { TaskDetailPanel } from '@/components/tasks/TaskDetailPanel';
import { CalendarView } from '@/components/ui/calendar-view';

type Task = {
  id: string;
  title: string;
  taskType?: string | null;
  status: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'APPROVED' | 'DONE' | 'BLOCKED' | 'ON_HOLD';
  priority: string;
  createdAt: string;
  startDate?: string | null;
  dueDate: string | null;
  dueTime?: string | null;
  isOverdue: boolean;
  awaitingMyReview: boolean;
  project: { id: string; name: string; company: { id?: string; name: string } | null } | null;
  deal: { id: string; title: string | null } | null;
  assignee?: { id: string; name: string; avatar: string | null; designation?: string | null } | null;
  reviewer?: { id: string; name: string; avatar: string | null; designation?: string | null } | null;
  department?: { id: string; name: string } | null;
};

const STATUS_OPTIONS: Option[] = [
  { value: 'TODO', label: 'To do' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'IN_REVIEW', label: 'In review' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'BLOCKED', label: 'Blocked' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'DONE', label: 'Done' },
];

const COLUMNS: { status: Task['status']; label: string }[] = [
  { status: 'TODO', label: 'To Do' },
  { status: 'IN_PROGRESS', label: 'In Progress' },
  { status: 'IN_REVIEW', label: 'In Review' },
  { status: 'APPROVED', label: 'Approved' },
  { status: 'BLOCKED', label: 'Blocked' },
  { status: 'ON_HOLD', label: 'On Hold' },
  { status: 'DONE', label: 'Done' },
];

const PRIORITY_OPTIONS: Option[] = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
];

const PRIORITY_TONE: Record<string, 'good' | 'neutral' | 'bad' | 'info' | 'warn'> = {
  LOW: 'info',
  MEDIUM: 'neutral',
  HIGH: 'warn',
  URGENT: 'bad',
};

const TASK_TYPE_OPTIONS: Option[] = [
  { value: 'DEVELOPMENT', label: 'Development', icon: <Code className="h-3.5 w-3.5 text-blue-500" /> },
  { value: 'DESIGN', label: 'Design', icon: <Palette className="h-3.5 w-3.5 text-purple-500" /> },
  { value: 'CONTENT', label: 'Content', icon: <PenTool className="h-3.5 w-3.5 text-emerald-500" /> },
  { value: 'SEO', label: 'SEO', icon: <Search className="h-3.5 w-3.5 text-amber-500" /> },
  { value: 'BUG', label: 'Bug Fix', icon: <Bug className="h-3.5 w-3.5 text-red-500" /> },
  { value: 'MEETING', label: 'Meeting', icon: <Users className="h-3.5 w-3.5 text-indigo-500" /> },
  { value: 'OTHER', label: 'Other', icon: <Package className="h-3.5 w-3.5 text-gray-500" /> },
];

const TASK_TYPE_LABELS: Record<string, { label: string; tone: 'info' | 'neutral' | 'bad' | 'good' | 'warn' }> = {
  DEVELOPMENT: { label: 'Development', tone: 'info' },
  DESIGN: { label: 'Design', tone: 'warn' },
  CONTENT: { label: 'Content', tone: 'good' },
  SEO: { label: 'SEO', tone: 'warn' },
  BUG: { label: 'Bug Fix', tone: 'bad' },
  MEETING: { label: 'Meeting', tone: 'info' },
  OTHER: { label: 'Other', tone: 'neutral' },
};

const isTaskOverdue = (t: { isOverdue?: boolean; status: string }) => {
  if (t.status === 'DONE' || t.status === 'ON_HOLD' || t.status === 'BLOCKED') return false;
  return Boolean(t.isOverdue);
};

function UserChip({
  user,
}: {
  user?: { id: string; name: string; avatar?: string | null } | null;
}) {
  if (!user) return <span className="text-muted text-xs">—</span>;
  return (
    <div className="flex items-center gap-2 min-w-0">
      {user.avatar ? (
        <img src={user.avatar} alt="" className="h-6 w-6 rounded-full object-cover shrink-0 border border-border" />
      ) : (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface border border-border text-[11px] font-semibold text-primary">
          {user.name.charAt(0)}
        </div>
      )}
      <span className="text-xs font-semibold text-primary truncate">
        {user.name}
      </span>
    </div>
  );
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [config, setConfig] = useState<OrgConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<'LIST' | 'BOARD' | 'CALENDAR'>('LIST');
  const [draggingTask, setDraggingTask] = useState<Task | null>(null);

  const [isNewTaskOpen, setIsNewTaskOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  // Dynamic filter options
  const [companyOptions, setCompanyOptions] = useState<Option[]>([]);
  const [projectOptions, setProjectOptions] = useState<Option[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<Option[]>([]);
  const [assigneeOptions, setAssigneeOptions] = useState<Option[]>([]);

  // Multi-select filters
  const [search, setSearch] = useState('');
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedPriorities, setSelectedPriorities] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [onlyAwaitingReview, setOnlyAwaitingReview] = useState(false);

  // Load filter option lists once
  useEffect(() => {
    void Promise.all([
      api.companies.list().then((list) =>
        setCompanyOptions(
          (list as { id: string; name: string }[]).map((c) => ({ value: c.id, label: c.name }))
        )
      ).catch(() => { }),
      api.projects.list().then((list) =>
        setProjectOptions(
          (list as { id: string; name: string }[]).map((p) => ({ value: p.id, label: p.name }))
        )
      ).catch(() => { }),
      api.departments.list().then((list) =>
        setDepartmentOptions(
          (list as { id: string; name: string }[]).map((d) => ({ value: d.id, label: d.name }))
        )
      ).catch(() => { }),
      api.users.list().then((list) =>
        setAssigneeOptions(
          (list as Member[]).filter((u) => u.status === 'ACTIVE').map((u) => ({
            value: u.id,
            label: u.name,
          }))
        )
      ).catch(() => { }),
    ]);
  }, []);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const cfg = await api.config.get();
      setConfig(cfg);

      // Fetch tasks without restrictive status filter so all KPI counts are live & accurate
      const list = (await api.projects.allTasks({})) as unknown as Task[];
      setTasks(Array.isArray(list) ? list : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const complete = async (task: Task, newStatus: Task['status'] = 'DONE') => {
    setTasks((t) => t.map((x) => (x.id === task.id ? { ...x, status: newStatus } : x)));
    try {
      await api.projects.updateTask(task.id, { status: newStatus });
    } finally {
      void load();
    }
  };

  const timezone = config?.organization.timezone ?? 'Asia/Kolkata';
  const locale = config?.organization.locale ?? 'en-IN';

  // Comprehensive client-side filtering logic
  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      // 1. Text Search
      if (search.trim()) {
        const q = search.toLowerCase();
        const matches =
          t.title.toLowerCase().includes(q) ||
          (t.project?.name && t.project.name.toLowerCase().includes(q)) ||
          (t.project?.company?.name && t.project.company.name.toLowerCase().includes(q)) ||
          (t.department?.name && t.department.name.toLowerCase().includes(q)) ||
          (t.assignee?.name && t.assignee.name.toLowerCase().includes(q));
        if (!matches) return false;
      }

      // 2. Status Filter
      if (selectedStatuses.length > 0) {
        if (!selectedStatuses.includes(t.status)) return false;
      } else if (!showDone && t.status === 'DONE') {
        return false;
      }

      // 3. Priority Filter
      if (selectedPriorities.length > 0 && !selectedPriorities.includes(t.priority)) {
        return false;
      }

      // 4. Task Type Filter
      if (selectedTypes.length > 0) {
        if (!t.taskType || !selectedTypes.includes(t.taskType)) return false;
      }

      // 5. Department Filter
      if (selectedDepartments.length > 0) {
        if (!t.department?.id || !selectedDepartments.includes(t.department.id)) return false;
      }

      // 6. Client / Company Filter
      if (selectedCompanies.length > 0) {
        const compId = t.project?.company?.id;
        const compName = t.project?.company?.name;
        const matchesCompany =
          (compId && selectedCompanies.includes(compId)) ||
          (compName && selectedCompanies.includes(compName));
        if (!matchesCompany) return false;
      }

      // 7. Project Filter
      if (selectedProjects.length > 0) {
        if (!t.project?.id || !selectedProjects.includes(t.project.id)) return false;
      }

      // 8. Assignee Filter
      if (selectedAssignees.length > 0) {
        if (!t.assignee?.id || !selectedAssignees.includes(t.assignee.id)) return false;
      }

      // 9. Quick KPI Toggles
      if (onlyOverdue && !isTaskOverdue(t)) {
        return false;
      }

      if (onlyAwaitingReview && t.status !== 'IN_REVIEW') {
        return false;
      }

      return true;
    });
  }, [
    tasks,
    search,
    selectedStatuses,
    selectedPriorities,
    selectedTypes,
    selectedDepartments,
    selectedCompanies,
    selectedProjects,
    selectedAssignees,
    showDone,
    onlyOverdue,
    onlyAwaitingReview,
  ]);

  // Metric counts (live across all tasks)
  const openTasksCount = tasks.filter((t) => t.status !== 'DONE').length;
  const overdueCount = tasks.filter(isTaskOverdue).length;
  const reviewCount = tasks.filter((t) => t.status === 'IN_REVIEW').length;
  const doneCount = tasks.filter((t) => t.status === 'DONE').length;

  const hasFilters =
    Boolean(search) ||
    selectedStatuses.length > 0 ||
    selectedPriorities.length > 0 ||
    selectedTypes.length > 0 ||
    selectedCompanies.length > 0 ||
    selectedProjects.length > 0 ||
    selectedDepartments.length > 0 ||
    selectedAssignees.length > 0 ||
    showDone ||
    onlyOverdue ||
    onlyAwaitingReview;

  const clearFilters = () => {
    setSearch('');
    setSelectedStatuses([]);
    setSelectedPriorities([]);
    setSelectedTypes([]);
    setSelectedCompanies([]);
    setSelectedProjects([]);
    setSelectedDepartments([]);
    setSelectedAssignees([]);
    setShowDone(false);
    setOnlyOverdue(false);
    setOnlyAwaitingReview(false);
  };

  return (
    <div className="space-y-5 pb-10">
      {/* Page Title & KPI Metric Chips */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between shrink-0">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-primary">All Tasks</h1>

          {/* Quick Filter Metric Chips */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-surface border border-border text-primary">
              <span className="h-2 w-2 rounded-full bg-primary" />
              {openTasksCount} Active
            </span>

            {overdueCount > 0 && (
              <button
                onClick={() => setOnlyOverdue(!onlyOverdue)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${onlyOverdue
                  ? 'bg-red-600 text-white border-red-600'
                  : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                  }`}
              >
                <AlertCircle className="h-3.5 w-3.5" />
                {overdueCount} Overdue
              </button>
            )}

            {reviewCount > 0 && (
              <button
                onClick={() => setOnlyAwaitingReview(!onlyAwaitingReview)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${onlyAwaitingReview
                  ? 'bg-amber-500 text-white border-amber-500'
                  : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                  }`}
              >
                <Eye className="h-3.5 w-3.5" />
                {reviewCount} In Review
              </button>
            )}

            {doneCount > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 border border-emerald-200 text-emerald-700">
                <Check className="h-3.5 w-3.5" />
                {doneCount} Done
              </span>
            )}
          </div>
        </div>

        <Button className="gap-2 shrink-0" onClick={() => setIsNewTaskOpen(true)}>
          <Plus className="h-4 w-4" />
          Add Task
        </Button>
      </div>

      {/* Filter Toolbar */}
      <div className="rounded-xl border border-border bg-white p-3.5 space-y-3 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search task, project, client, assignee..."
              className="w-full rounded-xl border border-border bg-white pl-9 pr-8 py-1.5 text-sm text-body placeholder:text-muted focus:border-primary focus:outline-none"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-2.5 text-muted hover:text-primary"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* View Mode Switcher */}
          <div className="flex items-center gap-1 rounded-xl border border-border bg-surface p-1">
            <button
              onClick={() => setView('LIST')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${view === 'LIST'
                ? 'bg-white shadow-xs text-primary font-semibold'
                : 'text-secondary hover:text-primary'
                }`}
            >
              <List className="h-3.5 w-3.5" /> List
            </button>
            <button
              onClick={() => setView('BOARD')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${view === 'BOARD'
                ? 'bg-white shadow-xs text-primary font-semibold'
                : 'text-secondary hover:text-primary'
                }`}
            >
              <LayoutDashboard className="h-3.5 w-3.5" /> Board
            </button>
            <button
              onClick={() => setView('CALENDAR')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${view === 'CALENDAR'
                ? 'bg-white shadow-xs text-primary font-semibold'
                : 'text-secondary hover:text-primary'
                }`}
            >
              <CalendarIcon className="h-3.5 w-3.5" /> Calendar
            </button>
          </div>
        </div>

        {/* Custom MultiSelect Filter Dropdowns */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-subtle">
          <div className="flex items-center gap-1 text-xs font-medium text-muted mr-1">
            <Filter className="h-3.5 w-3.5" /> Filters:
          </div>

          {/* Status Filter */}
          <div className="w-34">
            <MultiSelect
              compact={true}
              placeholder="All Statuses"
              options={STATUS_OPTIONS}
              value={selectedStatuses}
              onChange={setSelectedStatuses}
              triggerClassName="h-8.5 px-3 py-1 text-xs rounded-lg bg-surface border-border"
            />
          </div>

          {/* Priority Filter */}
          <div className="w-32">
            <MultiSelect
              compact={true}
              placeholder="All Priorities"
              options={PRIORITY_OPTIONS}
              value={selectedPriorities}
              onChange={setSelectedPriorities}
              triggerClassName="h-8.5 px-3 py-1 text-xs rounded-lg bg-surface border-border"
            />
          </div>

          {/* Task Type Filter (with SVG Icons!) */}
          <div className="w-36">
            <MultiSelect
              compact={true}
              placeholder="All Task Types"
              options={TASK_TYPE_OPTIONS}
              value={selectedTypes}
              onChange={setSelectedTypes}
              triggerClassName="h-8.5 px-3 py-1 text-xs rounded-lg bg-surface border-border"
            />
          </div>

          {/* Department Filter */}
          {departmentOptions.length > 0 && (
            <div className="w-38">
              <MultiSelect
                compact={true}
                placeholder="All Departments"
                options={departmentOptions}
                value={selectedDepartments}
                onChange={setSelectedDepartments}
                triggerClassName="h-8.5 px-3 py-1 text-xs rounded-lg bg-surface border-border"
              />
            </div>
          )}

          {/* Company / Client Filter */}
          {companyOptions.length > 0 && (
            <div className="w-38">
              <MultiSelect
                compact={true}
                placeholder="All Clients"
                options={companyOptions}
                value={selectedCompanies}
                onChange={setSelectedCompanies}
                triggerClassName="h-8.5 px-3 py-1 text-xs rounded-lg bg-surface border-border"
              />
            </div>
          )}

          {/* Project Filter */}
          {projectOptions.length > 0 && (
            <div className="w-38">
              <MultiSelect
                compact={true}
                placeholder="All Projects"
                options={projectOptions}
                value={selectedProjects}
                onChange={setSelectedProjects}
                triggerClassName="h-8.5 px-3 py-1 text-xs rounded-lg bg-surface border-border"
              />
            </div>
          )}

          {/* Assignee Filter */}
          {assigneeOptions.length > 0 && (
            <div className="w-38">
              <MultiSelect
                compact={true}
                placeholder="All Assignees"
                options={assigneeOptions}
                value={selectedAssignees}
                onChange={setSelectedAssignees}
                triggerClassName="h-8.5 px-3 py-1 text-xs rounded-lg bg-surface border-border"
              />
            </div>
          )}

          {/* Show Done Toggle */}
          <label className="flex items-center gap-1.5 text-xs text-secondary cursor-pointer select-none bg-surface border border-border px-2.5 py-1.5 rounded-lg hover:bg-subtle transition-colors">
            <input
              type="checkbox"
              checked={showDone}
              onChange={(e) => setShowDone(e.target.checked)}
              className="rounded border-border text-primary focus:ring-primary"
            />
            Show Done
          </label>

          {/* Clear Filters */}
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg transition-colors ml-auto"
            >
              <RotateCcw className="h-3 w-3" /> Clear filters
            </button>
          )}
        </div>
      </div>

      {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

      {loading ? (
        <PageSkeleton />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="No tasks found"
          hint={hasFilters ? 'Try adjusting the filters.' : 'There are no active tasks.'}
        />
      ) : view === 'BOARD' ? (
        /* KANBAN BOARD VIEW */
        <div className="flex gap-4 overflow-x-auto pb-4 max-w-full min-h-0 max-h-[calc(100vh-230px)]">
          {COLUMNS.map((col) => {
            const colTasks = filtered.filter((t) => t.status === col.status);
            return (
              <div
                key={col.status}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (draggingTask && draggingTask.status !== col.status) {
                    void complete(draggingTask, col.status);
                    setDraggingTask(null);
                  }
                }}
                className="flex w-80 shrink-0 flex-col rounded-2xl border border-border bg-surface max-h-[calc(100vh-230px)] overflow-hidden"
              >
                {/* Column Header */}
                <div className="sticky top-0 z-10 border-b border-border p-3 bg-white shrink-0 flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                    {col.label}
                    <span className="rounded-full bg-surface border border-border px-2 py-0.5 text-[10px] text-secondary tabular-nums">
                      {colTasks.length}
                    </span>
                  </h3>
                </div>

                {/* Internal Scrollable Cards Body */}
                <div className="flex flex-1 flex-col gap-2.5 p-3 overflow-y-auto min-h-0">
                  {colTasks.map((t) => (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={() => setDraggingTask(t)}
                      onDragEnd={() => setDraggingTask(null)}
                      onClick={() => setSelectedTask(t)}
                      className={`cursor-grab rounded-xl border border-border bg-white p-3.5 hover:border-primary transition-all space-y-2.5 shrink-0 active:cursor-grabbing ${draggingTask?.id === t.id ? 'opacity-40' : ''
                        }`}
                    >
                      {/* Card Tags: Type & Priority */}
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {t.taskType && TASK_TYPE_LABELS[t.taskType] && (
                            <Badge tone={TASK_TYPE_LABELS[t.taskType].tone}>
                              {TASK_TYPE_LABELS[t.taskType].label}
                            </Badge>
                          )}
                          <Badge tone={PRIORITY_TONE[t.priority] ?? 'neutral'}>
                            {t.priority}
                          </Badge>
                        </div>
                        {isTaskOverdue(t) && (
                          <span className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded">
                            Overdue
                          </span>
                        )}
                      </div>

                      {/* Task Title */}
                      <p className="text-sm font-semibold text-primary line-clamp-2 leading-snug">
                        {t.title}
                      </p>

                      {/* Project / Client Context */}
                      {(t.project?.name || t.project?.company?.name || t.department?.name) && (
                        <p className="text-xs text-secondary truncate">
                          {t.project?.company?.name ? `${t.project.company.name} · ` : ''}
                          {t.project?.name ?? t.department?.name ?? '—'}
                        </p>
                      )}

                      {/* Assignee Footer */}
                      <div className="border-t border-subtle pt-2.5 flex items-center justify-between gap-2">
                        <div className="max-w-[65%] truncate">
                          <UserChip user={t.assignee} />
                        </div>
                        {t.dueDate && (
                          <span className={`text-[11px] shrink-0 ${isTaskOverdue(t) ? 'text-red-600 font-bold' : 'text-secondary font-medium'}`}>
                            {formatDate(t.dueDate, timezone, locale)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  {colTasks.length === 0 && (
                    <div className="py-10 text-center text-xs text-secondary italic">No tasks</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : view === 'CALENDAR' ? (
        /* CALENDAR VIEW */
        <CalendarView
          events={filtered.map((t) => ({
            id: t.id,
            title: t.title,
            subtitle: t.project?.name ?? t.department?.name ?? undefined,
            date: t.dueDate,
            status: t.status,
            priority: t.priority,
            onClick: () => setSelectedTask(t),
          }))}
        />
      ) : (
        /* TABLE LIST VIEW */
        <Table>
          <THead>
            <TR className="bg-surface hover:bg-surface">
              <TH>DATE</TH>
              <TH>TASK</TH>
              <TH>TYPE</TH>
              <TH>PROJECT / CLIENT</TH>
              <TH>ASSIGNEE</TH>
              <TH>PRIORITY</TH>
              <TH>STATUS</TH>
              <TH>DUE DATE</TH>
            </TR>
          </THead>
          <TBody>
            {filtered.map((task) => (
              <TR
                key={task.id}
                onClick={() => setSelectedTask(task)}
                className="cursor-pointer hover:bg-subtle transition-colors group"
              >
                {/* 1. Assigned Date (First Column) */}
                <TD className="text-secondary whitespace-nowrap text-xs font-medium">
                  {formatDate(task.createdAt, timezone, locale)}
                </TD>

                {/* 2. Task Title */}
                <TD className="font-medium text-primary">
                  <div className="flex items-center gap-2">
                    {task.awaitingMyReview && (
                      <span
                        className="h-2 w-2 rounded-full bg-amber-400 shrink-0"
                        title="Awaiting your review"
                      />
                    )}
                    <span className={`truncate max-w-64 block font-semibold ${task.status === 'DONE' ? 'line-through text-muted' : 'text-primary'}`}>
                      {task.title}
                    </span>
                  </div>
                </TD>

                {/* 3. Task Type */}
                <TD>
                  {task.taskType && TASK_TYPE_LABELS[task.taskType] ? (
                    <Badge tone={TASK_TYPE_LABELS[task.taskType].tone}>
                      {TASK_TYPE_LABELS[task.taskType].label}
                    </Badge>
                  ) : (
                    <span className="text-muted text-xs">—</span>
                  )}
                </TD>

                {/* 4. Project & Client */}
                <TD className="text-secondary">
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-semibold text-primary truncate max-w-44">
                      {task.project?.name ?? task.deal?.title ?? task.department?.name ?? '—'}
                    </span>
                    {task.project?.company?.name && (
                      <span className="text-[11px] text-secondary truncate max-w-44">
                        {task.project.company.name}
                      </span>
                    )}
                  </div>
                </TD>

                {/* 5. Assignee (Avatar + Name) */}
                <TD>
                  <UserChip user={task.assignee} />
                </TD>

                {/* 6. Priority */}
                <TD>
                  <Badge tone={PRIORITY_TONE[task.priority] ?? 'neutral'}>
                    {task.priority ?? 'MEDIUM'}
                  </Badge>
                </TD>

                {/* 7. Status Dropdown */}
                <TD onClick={(e) => e.stopPropagation()}>
                  <Select
                    value={task.status}
                    onChange={(v) => complete(task, v as Task['status'])}
                    options={STATUS_OPTIONS}
                    ariaLabel={`Status for ${task.title}`}
                    buttonClassName="px-2 py-1 text-xs w-28 bg-white border-border rounded-lg"
                  />
                </TD>

                {/* 8. Due Date */}
                <TD>
                  {task.dueDate ? (
                    <div className="flex flex-col">
                      <span className={`text-xs font-medium ${isTaskOverdue(task) ? 'text-red-600 font-bold' : 'text-primary'}`}>
                        {formatDate(task.dueDate, timezone, locale)}
                      </span>
                      {isTaskOverdue(task) && (
                        <span className="text-[10px] font-bold text-red-600">
                          Overdue
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted text-xs">—</span>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <NewTaskPanel
        isOpen={isNewTaskOpen}
        onClose={() => setIsNewTaskOpen(false)}
        onSuccess={load}
      />

      <TaskDetailPanel
        task={selectedTask}
        isOpen={selectedTask !== null}
        onClose={() => setSelectedTask(null)}
        onUpdate={load}
        timezone={timezone}
        locale={locale}
      />
    </div>
  );
}
