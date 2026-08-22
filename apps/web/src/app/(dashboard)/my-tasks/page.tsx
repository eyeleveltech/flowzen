'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  CheckCircle2,
  Search,
  Plus,
  X,
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
import { api, formatDate, type OrgConfig } from '@/lib/api-v2';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { EmptyState, ErrorNote } from '@/components/ui/empty-state';
import { PageSkeleton } from '@/components/ui/skeleton-loaders';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { MultiSelect, type Option } from '@/components/ui/multi-select';
import { NewTaskPanel } from '@/components/tasks/NewTaskPanel';
import { TaskDetailPanel } from '@/components/tasks/TaskDetailPanel';

type Task = {
  id: string;
  title: string;
  taskType?: string | null;
  status: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'APPROVED' | 'DONE' | 'BLOCKED' | 'ON_HOLD';
  priority: string;
  createdAt: string;
  dueDate: string | null;
  isOverdue: boolean;
  awaitingMyReview: boolean;
  project: { id: string; name: string; company: { id?: string; name: string } | null } | null;
  deal: { id: string; title: string | null } | null;
  assignee?: { id: string; name: string; avatar: string | null } | null;
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

export default function MyTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [config, setConfig] = useState<OrgConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isNewTaskOpen, setIsNewTaskOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedPriorities, setSelectedPriorities] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [onlyAwaitingReview, setOnlyAwaitingReview] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const cfg = await api.config.get();
      setConfig(cfg);
      const list = (await api.projects.myTasks()) as unknown as Task[];
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

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      // 1. Search
      if (search.trim()) {
        const q = search.toLowerCase();
        const matches =
          t.title.toLowerCase().includes(q) ||
          (t.project?.name && t.project.name.toLowerCase().includes(q)) ||
          (t.project?.company?.name && t.project.company.name.toLowerCase().includes(q)) ||
          (t.department?.name && t.department.name.toLowerCase().includes(q));
        if (!matches) return false;
      }

      // 2. Status
      if (selectedStatuses.length > 0) {
        if (!selectedStatuses.includes(t.status)) return false;
      } else if (!showDone && t.status === 'DONE') {
        return false;
      }

      // 3. Priority
      if (selectedPriorities.length > 0 && !selectedPriorities.includes(t.priority)) {
        return false;
      }

      // 4. Type
      if (selectedTypes.length > 0) {
        if (!t.taskType || !selectedTypes.includes(t.taskType)) return false;
      }

      // 5. Quick Toggles
      if (onlyOverdue && !isTaskOverdue(t)) {
        return false;
      }

      if (onlyAwaitingReview && !t.awaitingMyReview) {
        return false;
      }

      return true;
    });
  }, [tasks, search, selectedStatuses, selectedPriorities, selectedTypes, showDone, onlyOverdue, onlyAwaitingReview]);

  // Metric counts
  const openTasksCount = tasks.filter((t) => t.status !== 'DONE').length;
  const overdueCount = tasks.filter(isTaskOverdue).length;
  const reviewCount = tasks.filter((t) => t.awaitingMyReview).length;
  const doneCount = tasks.filter((t) => t.status === 'DONE').length;

  const hasFilters =
    Boolean(search) ||
    selectedStatuses.length > 0 ||
    selectedPriorities.length > 0 ||
    selectedTypes.length > 0 ||
    showDone ||
    onlyOverdue ||
    onlyAwaitingReview;

  const clearFilters = () => {
    setSearch('');
    setSelectedStatuses([]);
    setSelectedPriorities([]);
    setSelectedTypes([]);
    setShowDone(false);
    setOnlyOverdue(false);
    setOnlyAwaitingReview(false);
  };

  return (
    <div className="space-y-5 pb-10">
      {/* Page Title & Quick Metric Chips */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-primary">My Tasks</h1>

          {/* Quick Metric Filter Chips */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-surface border border-border text-primary">
              <span className="h-2 w-2 rounded-full bg-primary" />
              {openTasksCount} Active
            </span>

            {overdueCount > 0 && (
              <button
                onClick={() => setOnlyOverdue(!onlyOverdue)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                  onlyOverdue
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
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                  onlyAwaitingReview
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                }`}
              >
                <Eye className="h-3.5 w-3.5" />
                {reviewCount} Awaiting My Review
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
      <div className="rounded-xl border border-border bg-white p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search your tasks, project, client..."
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

          {/* Task Type Filter */}
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
          title={onlyAwaitingReview ? 'Nothing awaiting review' : 'No tasks found'}
          hint={
            onlyAwaitingReview
              ? 'No tasks are currently waiting for your review.'
              : 'Tasks appear here when they are assigned to you or waiting for your review.'
          }
        />
      ) : (
        <Table>
          <THead>
            <TR className="bg-surface hover:bg-surface">
              <TH>DATE</TH>
              <TH>TASK</TH>
              <TH>TYPE</TH>
              <TH>PROJECT / CLIENT</TH>
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

                {/* 5. Priority */}
                <TD>
                  <Badge tone={PRIORITY_TONE[task.priority] ?? 'neutral'}>
                    {task.priority ?? 'MEDIUM'}
                  </Badge>
                </TD>

                {/* 6. Status Dropdown */}
                <TD onClick={(e) => e.stopPropagation()}>
                  <Select
                    value={task.status}
                    onChange={(v) => complete(task, v as Task['status'])}
                    options={STATUS_OPTIONS}
                    ariaLabel={`Status for ${task.title}`}
                    buttonClassName="px-2 py-1 text-xs w-28 bg-white border-border rounded-lg"
                  />
                </TD>

                {/* 7. Due Date */}
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
