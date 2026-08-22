'use client';

import { useCallback, useEffect, useState, useMemo } from 'react';
import {
  BarChart3,
  TrendingUp,
  FolderKanban,
  CheckCircle2,
  AlertCircle,
  Clock,
  Eye,
  Download,
  RotateCcw,
  Building,
  Users,
  ShieldAlert,
  ArrowUpRight,
  Code,
  Palette,
  PenTool,
  Search,
  Bug,
  Package,
} from 'lucide-react';
import {
  api,
  formatDate,
  type OrgConfig,
  type PmSummaryData,
  type PmProjectReport,
  type PmTeamWorkloadReport,
  type PmTaskTypesData,
} from '@/lib/api-v2';
import { Button } from '@/components/ui/button';
import { Badge, type Tone } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { PageSkeleton } from '@/components/ui/skeleton-loaders';
import { ErrorNote } from '@/components/ui/empty-state';
import { getInitials, getAvatarColor } from '@/lib/utils';

type TimeRange = '7d' | '30d' | '90d' | 'ytd' | 'all';
type ReportTab = 'OVERVIEW' | 'PROJECTS' | 'WORKLOAD' | 'TASK_TYPES';

const HEALTH_CONFIG: Record<
  PmProjectReport['health'],
  { label: string; tone: Tone }
> = {
  ON_TRACK: { label: 'On Track', tone: 'good' },
  AT_RISK: { label: 'At Risk', tone: 'warn' },
  DELAYED: { label: 'Delayed', tone: 'bad' },
  ON_HOLD: { label: 'On Hold', tone: 'neutral' },
  COMPLETED: { label: 'Completed', tone: 'good' },
};

const LOAD_CONFIG: Record<
  PmTeamWorkloadReport['loadStatus'],
  { label: string; tone: Tone }
> = {
  AVAILABLE: { label: 'Available', tone: 'info' },
  BALANCED: { label: 'Balanced', tone: 'good' },
  HIGH: { label: 'High Load', tone: 'warn' },
  OVERLOADED: { label: 'Overloaded', tone: 'bad' },
};

const TASK_TYPE_ICONS: Record<string, React.ReactNode> = {
  DEVELOPMENT: <Code className="h-3.5 w-3.5 text-blue-600" />,
  DESIGN: <Palette className="h-3.5 w-3.5 text-purple-600" />,
  CONTENT: <PenTool className="h-3.5 w-3.5 text-emerald-600" />,
  SEO: <Search className="h-3.5 w-3.5 text-amber-600" />,
  BUG: <Bug className="h-3.5 w-3.5 text-red-600" />,
  MEETING: <Users className="h-3.5 w-3.5 text-indigo-600" />,
  OTHER: <Package className="h-3.5 w-3.5 text-secondary" />,
};

export default function PmReportsPage() {
  const [tab, setTab] = useState<ReportTab>('OVERVIEW');
  const [range, setRange] = useState<TimeRange>('30d');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Data states
  const [config, setConfig] = useState<OrgConfig | null>(null);
  const [summaryData, setSummaryData] = useState<PmSummaryData | null>(null);
  const [projectsData, setProjectsData] = useState<PmProjectReport[]>([]);
  const [workloadData, setWorkloadData] = useState<PmTeamWorkloadReport[]>([]);
  const [taskTypesData, setTaskTypesData] = useState<PmTaskTypesData | null>(null);

  // Filters for projects tab
  const [projectSearch, setProjectSearch] = useState('');
  const [projectHealthFilter, setProjectHealthFilter] = useState<string>('ALL');

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [cfg, summaryRes, projectsRes, workloadRes, taskTypesRes] = await Promise.all([
        api.config.get(),
        api.reports.pmSummary({ range }),
        api.reports.pmProjects({ range }),
        api.reports.pmTeamWorkload({ range }),
        api.reports.pmTaskTypes({ range }),
      ]);

      setConfig(cfg);
      setSummaryData(summaryRes);
      setProjectsData(Array.isArray(projectsRes) ? projectsRes : []);
      setWorkloadData(Array.isArray(workloadRes) ? workloadRes : []);
      setTaskTypesData(taskTypesRes);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load PM reports');
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const tz = config?.organization.timezone ?? 'Asia/Kolkata';
  const locale = config?.organization.locale ?? 'en-IN';

  // Filtered projects
  const filteredProjects = useMemo(() => {
    return projectsData.filter((p) => {
      if (projectSearch.trim()) {
        const q = projectSearch.toLowerCase();
        const matches =
          p.name.toLowerCase().includes(q) ||
          p.company?.name.toLowerCase().includes(q) ||
          p.lead?.name.toLowerCase().includes(q);
        if (!matches) return false;
      }
      if (projectHealthFilter !== 'ALL' && p.health !== projectHealthFilter) {
        return false;
      }
      return true;
    });
  }, [projectsData, projectSearch, projectHealthFilter]);

  // Export CSV
  const exportToCsv = () => {
    if (projectsData.length === 0) return;

    const headers = [
      'Project Name',
      'Client',
      'Lead',
      'Status',
      'Health',
      'Progress %',
      'Total Tasks',
      'Completed Tasks',
      'Open Tasks',
      'Overdue Tasks',
      'Due Date',
    ];

    const rows = projectsData.map((p) => [
      `"${p.name.replace(/"/g, '""')}"`,
      `"${p.company?.name ? p.company.name.replace(/"/g, '""') : '—'}"`,
      `"${p.lead?.name ? p.lead.name.replace(/"/g, '""') : 'Unassigned'}"`,
      p.status,
      p.health,
      `${p.progressPercent}%`,
      p.taskStats.total,
      p.taskStats.completed,
      p.taskStats.open,
      p.taskStats.overdue,
      p.dueDate ? formatDate(p.dueDate, tz, locale) : '—',
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `flowzen_pm_report_${range}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading && !summaryData) {
    return <PageSkeleton />;
  }

  const s = summaryData?.summary;
  const h = summaryData?.projectHealth;
  const funnel = summaryData?.statusFunnel;
  const blockers = summaryData?.blockerRadar;

  return (
    <div className="space-y-6 pb-12">
      {/* Header & Controls Toolbar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">PM Reports</h1>
          <p className="text-xs text-secondary mt-0.5">
            Real-time delivery performance, project health, and team capacity.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Time Range Selector */}
          <div className="flex items-center rounded-xl bg-surface border border-border p-1">
            {(
              [
                { id: '7d', label: '7D' },
                { id: '30d', label: '30D' },
                { id: '90d', label: '90D' },
                { id: 'ytd', label: 'YTD' },
                { id: 'all', label: 'All' },
              ] as const
            ).map((r) => (
              <button
                key={r.id}
                onClick={() => setRange(r.id)}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
                  range === r.id
                    ? 'bg-white text-primary shadow-xs border border-border'
                    : 'text-secondary hover:text-primary'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          <Button
            size="sm"
            variant="secondary"
            icon={Download}
            onClick={exportToCsv}
            className="text-xs h-8.5"
          >
            Export CSV
          </Button>

          <Button
            size="sm"
            variant="ghost"
            icon={RotateCcw}
            onClick={() => void loadData()}
            className="text-xs text-secondary hover:text-primary h-8.5"
          >
            Refresh
          </Button>
        </div>
      </div>

      {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

      {/* 5 Clean KPI Metric Cards (Matching Flowzen Dashboard Aesthetic) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {/* 1. On-Time Delivery */}
        <div className="rounded-xl border border-border bg-white p-4 space-y-1.5">
          <div className="flex items-center justify-between text-secondary">
            <span className="text-[11px] font-semibold uppercase tracking-wider">On-Time Rate</span>
            <CheckCircle2 className="h-4 w-4 text-secondary" />
          </div>
          <p className="text-2xl font-bold tracking-tight text-primary">
            {s?.onTimeDeliveryRate ?? 0}%
          </p>
          <p className="text-[11px] text-secondary">Delivered on schedule</p>
        </div>

        {/* 2. Active Projects */}
        <div className="rounded-xl border border-border bg-white p-4 space-y-1.5">
          <div className="flex items-center justify-between text-secondary">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Active Projects</span>
            <FolderKanban className="h-4 w-4 text-secondary" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold tracking-tight text-primary">
              {s?.activeProjects ?? 0}
            </span>
            <span className="text-xs text-secondary">/ {s?.totalProjects ?? 0}</span>
          </div>
          <p className="text-[11px] text-secondary truncate">
            {h?.onTrack ?? 0} on track · {h?.atRisk ?? 0} at risk
          </p>
        </div>

        {/* 3. Task Velocity */}
        <div className="rounded-xl border border-border bg-white p-4 space-y-1.5">
          <div className="flex items-center justify-between text-secondary">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Tasks Closed</span>
            <TrendingUp className="h-4 w-4 text-secondary" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold tracking-tight text-primary">
              {s?.completedTasks ?? 0}
            </span>
            <span
              className={`text-xs font-semibold ${
                (s?.velocityDeltaPercent ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'
              }`}
            >
              {(s?.velocityDeltaPercent ?? 0) >= 0 ? '+' : ''}
              {s?.velocityDeltaPercent ?? 0}%
            </span>
          </div>
          <p className="text-[11px] text-secondary">vs prior period</p>
        </div>

        {/* 4. Overdue Tasks */}
        <div
          className={`rounded-xl border p-4 space-y-1.5 transition-colors ${
            (s?.overdueTasks ?? 0) > 0 ? 'border-red-200 bg-red-50/40' : 'border-border bg-white'
          }`}
        >
          <div className="flex items-center justify-between text-secondary">
            <span
              className={`text-[11px] font-semibold uppercase tracking-wider ${
                (s?.overdueTasks ?? 0) > 0 ? 'text-red-700' : 'text-secondary'
              }`}
            >
              Overdue Tasks
            </span>
            <AlertCircle
              className={`h-4 w-4 ${
                (s?.overdueTasks ?? 0) > 0 ? 'text-red-600' : 'text-secondary'
              }`}
            />
          </div>
          <p
            className={`text-2xl font-bold tracking-tight ${
              (s?.overdueTasks ?? 0) > 0 ? 'text-red-700' : 'text-primary'
            }`}
          >
            {s?.overdueTasks ?? 0}
          </p>
          <p
            className={`text-[11px] ${
              (s?.overdueTasks ?? 0) > 0 ? 'text-red-600 font-medium' : 'text-secondary'
            }`}
          >
            {(s?.overdueTasks ?? 0) > 0
              ? `${s?.overduePressureRate ?? 0}% of open tasks`
              : 'All tasks on track'}
          </p>
        </div>

        {/* 5. Avg Turnaround */}
        <div className="rounded-xl border border-border bg-white p-4 space-y-1.5">
          <div className="flex items-center justify-between text-secondary">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Avg Turnaround</span>
            <Clock className="h-4 w-4 text-secondary" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold tracking-tight text-primary">
              {s?.avgTurnaroundDays ?? 0}
            </span>
            <span className="text-xs text-secondary">days</span>
          </div>
          <p className="text-[11px] text-secondary">Creation to completion</p>
        </div>
      </div>

      {/* Navigation Underline Tabs */}
      <div className="flex items-center gap-4 border-b border-border text-xs font-semibold">
        <button
          onClick={() => setTab('OVERVIEW')}
          className={`pb-2.5 px-1 border-b-2 transition-colors ${
            tab === 'OVERVIEW'
              ? 'border-primary text-primary'
              : 'border-transparent text-secondary hover:text-primary'
          }`}
        >
          Executive Overview
        </button>
        <button
          onClick={() => setTab('PROJECTS')}
          className={`pb-2.5 px-1 border-b-2 transition-colors ${
            tab === 'PROJECTS'
              ? 'border-primary text-primary'
              : 'border-transparent text-secondary hover:text-primary'
          }`}
        >
          Projects Matrix ({projectsData.length})
        </button>
        <button
          onClick={() => setTab('WORKLOAD')}
          className={`pb-2.5 px-1 border-b-2 transition-colors ${
            tab === 'WORKLOAD'
              ? 'border-primary text-primary'
              : 'border-transparent text-secondary hover:text-primary'
          }`}
        >
          Team Workload ({workloadData.length})
        </button>
        <button
          onClick={() => setTab('TASK_TYPES')}
          className={`pb-2.5 px-1 border-b-2 transition-colors ${
            tab === 'TASK_TYPES'
              ? 'border-primary text-primary'
              : 'border-transparent text-secondary hover:text-primary'
          }`}
        >
          Task Categories & Depts
        </button>
      </div>

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* TAB 1: EXECUTIVE OVERVIEW */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {tab === 'OVERVIEW' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Project Health Breakdown Card */}
            <div className="rounded-xl border border-border bg-white p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-primary">
                    Project Health Breakdown
                  </h2>
                  <p className="text-xs text-secondary mt-0.5">
                    Portfolio status across {s?.totalProjects ?? 0} projects
                  </p>
                </div>
                <span className="rounded-md bg-surface px-2 py-0.5 text-xs font-semibold text-primary border border-border">
                  {s?.activeProjects ?? 0} Active
                </span>
              </div>

              {/* Stack Bar */}
              {(s?.totalProjects ?? 0) > 0 && (
                <div className="h-3 w-full overflow-hidden rounded-full bg-surface flex">
                  <div
                    className="bg-emerald-500 h-full transition-all"
                    style={{
                      width: `${Math.round(((h?.onTrack ?? 0) / (s?.totalProjects ?? 1)) * 100)}%`,
                    }}
                    title={`On Track: ${h?.onTrack}`}
                  />
                  <div
                    className="bg-amber-500 h-full transition-all"
                    style={{
                      width: `${Math.round(((h?.atRisk ?? 0) / (s?.totalProjects ?? 1)) * 100)}%`,
                    }}
                    title={`At Risk: ${h?.atRisk}`}
                  />
                  <div
                    className="bg-red-500 h-full transition-all"
                    style={{
                      width: `${Math.round(((h?.delayed ?? 0) / (s?.totalProjects ?? 1)) * 100)}%`,
                    }}
                    title={`Delayed: ${h?.delayed}`}
                  />
                  <div
                    className="bg-blue-500 h-full transition-all"
                    style={{
                      width: `${Math.round(((h?.completed ?? 0) / (s?.totalProjects ?? 1)) * 100)}%`,
                    }}
                    title={`Completed: ${h?.completed}`}
                  />
                  <div
                    className="bg-zinc-300 h-full transition-all"
                    style={{
                      width: `${Math.round(((h?.onHold ?? 0) / (s?.totalProjects ?? 1)) * 100)}%`,
                    }}
                    title={`On Hold: ${h?.onHold}`}
                  />
                </div>
              )}

              {/* Metric Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-1">
                <div className="rounded-lg border border-border bg-surface/50 p-3">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    <span className="text-xs font-medium text-secondary">On Track</span>
                  </div>
                  <span className="text-lg font-bold text-primary block mt-1">
                    {h?.onTrack ?? 0}
                  </span>
                </div>

                <div className="rounded-lg border border-border bg-surface/50 p-3">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-amber-500" />
                    <span className="text-xs font-medium text-secondary">At Risk</span>
                  </div>
                  <span className="text-lg font-bold text-primary block mt-1">
                    {h?.atRisk ?? 0}
                  </span>
                </div>

                <div className="rounded-lg border border-border bg-surface/50 p-3">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-red-500" />
                    <span className="text-xs font-medium text-secondary">Delayed</span>
                  </div>
                  <span className="text-lg font-bold text-primary block mt-1">
                    {h?.delayed ?? 0}
                  </span>
                </div>

                <div className="rounded-lg border border-border bg-surface/50 p-3">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-blue-500" />
                    <span className="text-xs font-medium text-secondary">Completed</span>
                  </div>
                  <span className="text-lg font-bold text-primary block mt-1">
                    {h?.completed ?? 0}
                  </span>
                </div>

                <div className="rounded-lg border border-border bg-surface/50 p-3">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-zinc-400" />
                    <span className="text-xs font-medium text-secondary">On Hold</span>
                  </div>
                  <span className="text-lg font-bold text-primary block mt-1">
                    {h?.onHold ?? 0}
                  </span>
                </div>
              </div>
            </div>

            {/* Task Throughput Funnel Card */}
            <div className="rounded-xl border border-border bg-white p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-primary">
                    Task Throughput Pipeline
                  </h2>
                  <p className="text-xs text-secondary mt-0.5">
                    Status progression across {s?.totalTasks ?? 0} tasks
                  </p>
                </div>
                <span className="rounded-md bg-surface px-2 py-0.5 text-xs font-semibold text-primary border border-border">
                  {s?.completedTasks ?? 0} Done
                </span>
              </div>

              {/* Funnel Progress Bars */}
              <div className="space-y-3 pt-1">
                <div>
                  <div className="flex items-center justify-between text-xs font-medium mb-1">
                    <span className="text-secondary flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-zinc-400" /> To Do
                    </span>
                    <span className="font-bold text-primary">{funnel?.todo ?? 0}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-surface overflow-hidden">
                    <div
                      className="h-full bg-zinc-400 rounded-full"
                      style={{
                        width: `${Math.round(((funnel?.todo ?? 0) / (s?.totalTasks ?? 1)) * 100)}%`,
                      }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs font-medium mb-1">
                    <span className="text-secondary flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-blue-500" /> In Progress
                    </span>
                    <span className="font-bold text-primary">{funnel?.inProgress ?? 0}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-surface overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{
                        width: `${Math.round(
                          ((funnel?.inProgress ?? 0) / (s?.totalTasks ?? 1)) * 100
                        )}%`,
                      }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs font-medium mb-1">
                    <span className="text-secondary flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-amber-500" /> In Review
                    </span>
                    <span className="font-bold text-primary">{funnel?.inReview ?? 0}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-surface overflow-hidden">
                    <div
                      className="h-full bg-amber-500 rounded-full"
                      style={{
                        width: `${Math.round(
                          ((funnel?.inReview ?? 0) / (s?.totalTasks ?? 1)) * 100
                        )}%`,
                      }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs font-medium mb-1">
                    <span className="text-secondary flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" /> Completed
                    </span>
                    <span className="font-bold text-primary">{funnel?.done ?? 0}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-surface overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full"
                      style={{
                        width: `${Math.round(((funnel?.done ?? 0) / (s?.totalTasks ?? 1)) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Attention & Blocker Indicators */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-center justify-between rounded-xl border border-border bg-white p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-surface p-2 text-primary border border-border">
                  <Eye className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-primary">In-Review Deliverables</h3>
                  <p className="text-xs text-secondary mt-0.5">
                    Tasks awaiting reviewer approval
                  </p>
                </div>
              </div>
              <span className="text-lg font-bold text-primary">
                {blockers?.inReviewCount ?? 0}
              </span>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-border bg-white p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-surface p-2 text-primary border border-border">
                  <ShieldAlert className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-primary">Blocked Tasks</h3>
                  <p className="text-xs text-secondary mt-0.5">
                    Tasks paused on external dependencies
                  </p>
                </div>
              </div>
              <span className="text-lg font-bold text-primary">
                {blockers?.blockedCount ?? 0}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* TAB 2: PROJECTS PERFORMANCE MATRIX */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {tab === 'PROJECTS' && (
        <div className="space-y-4">
          {/* Search and Filters */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-white p-3.5">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
              <input
                type="text"
                value={projectSearch}
                onChange={(e) => setProjectSearch(e.target.value)}
                placeholder="Search project, client, lead..."
                className="w-full rounded-xl border border-border bg-white pl-9 pr-4 py-1.5 text-xs text-body placeholder:text-muted focus:border-primary focus:outline-none"
              />
            </div>

            {/* Health Filter Pills */}
            <div className="flex items-center gap-1 text-xs">
              {(['ALL', 'ON_TRACK', 'AT_RISK', 'DELAYED', 'COMPLETED', 'ON_HOLD'] as const).map(
                (st) => (
                  <button
                    key={st}
                    onClick={() => setProjectHealthFilter(st)}
                    className={`rounded-lg px-2.5 py-1 font-semibold transition-all ${
                      projectHealthFilter === st
                        ? 'bg-primary text-white shadow-xs'
                        : 'bg-surface text-secondary hover:text-primary border border-border'
                    }`}
                  >
                    {st === 'ALL'
                      ? 'All'
                      : st === 'ON_TRACK'
                      ? 'On Track'
                      : st === 'AT_RISK'
                      ? 'At Risk'
                      : st === 'DELAYED'
                      ? 'Delayed'
                      : st === 'COMPLETED'
                      ? 'Completed'
                      : 'On Hold'}
                  </button>
                )
              )}
            </div>
          </div>

          {/* Table */}
          {filteredProjects.length === 0 ? (
            <div className="py-16 text-center text-xs text-secondary italic rounded-xl border border-dashed border-border bg-surface/30">
              No projects match the selected criteria.
            </div>
          ) : (
            <Table>
              <THead>
                <TR className="bg-surface hover:bg-surface">
                  <TH>PROJECT & CLIENT</TH>
                  <TH>LEAD</TH>
                  <TH>HEALTH STATUS</TH>
                  <TH>PROGRESS</TH>
                  <TH>OPEN / REVIEW / OVERDUE</TH>
                  <TH>TARGET DATE</TH>
                  <TH className="text-right">ACTIONS</TH>
                </TR>
              </THead>
              <TBody>
                {filteredProjects.map((p) => {
                  const healthCfg = HEALTH_CONFIG[p.health] ?? HEALTH_CONFIG.ON_TRACK;

                  return (
                    <TR key={p.id} className="hover:bg-subtle transition-colors">
                      {/* 1. Project & Client */}
                      <TD>
                        <div className="min-w-0 max-w-56">
                          <p className="font-semibold text-primary text-xs truncate">{p.name}</p>
                          {p.company && (
                            <p className="text-[11px] text-secondary truncate mt-0.5">
                              {p.company.name}
                            </p>
                          )}
                        </div>
                      </TD>

                      {/* 2. Lead */}
                      <TD>
                        {p.lead ? (
                          <div className="flex items-center gap-2">
                            {p.lead.avatar ? (
                              <img
                                src={p.lead.avatar}
                                alt=""
                                className="h-6 w-6 rounded-full object-cover border border-border"
                              />
                            ) : (
                              <div
                                className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${getAvatarColor(
                                  p.lead.name
                                )}`}
                              >
                                {getInitials(p.lead.name)}
                              </div>
                            )}
                            <span className="text-xs font-medium text-primary truncate max-w-28">
                              {p.lead.name}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </TD>

                      {/* 3. Health Status */}
                      <TD>
                        <Badge tone={healthCfg.tone}>{healthCfg.label}</Badge>
                      </TD>

                      {/* 4. Progress % */}
                      <TD>
                        <div className="w-32 space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-semibold text-primary">
                              {p.progressPercent}%
                            </span>
                            <span className="text-secondary text-[10px]">
                              {p.taskStats.completed}/{p.taskStats.total}
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-surface overflow-hidden">
                            <div
                              className="h-full bg-emerald-500 rounded-full"
                              style={{ width: `${p.progressPercent}%` }}
                            />
                          </div>
                        </div>
                      </TD>

                      {/* 5. Tasks Breakdown */}
                      <TD>
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="px-2 py-0.5 rounded bg-surface border border-border text-primary font-medium">
                            {p.taskStats.open} open
                          </span>
                          {p.taskStats.inReview > 0 && (
                            <span className="px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700 font-medium">
                              {p.taskStats.inReview} review
                            </span>
                          )}
                          {p.taskStats.overdue > 0 && (
                            <span className="px-2 py-0.5 rounded bg-red-50 border border-red-200 text-red-700 font-bold">
                              {p.taskStats.overdue} overdue
                            </span>
                          )}
                        </div>
                      </TD>

                      {/* 6. Target Date */}
                      <TD>
                        {p.dueDate ? (
                          <span
                            className={`text-xs font-medium ${
                              p.isOverdue ? 'text-red-600 font-bold' : 'text-primary'
                            }`}
                          >
                            {formatDate(p.dueDate, tz, locale)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </TD>

                      {/* 7. Actions */}
                      <TD className="text-right">
                        <a
                          href={`/projects/${p.id}`}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                        >
                          View <ArrowUpRight className="h-3.5 w-3.5" />
                        </a>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* TAB 3: TEAM WORKLOAD & CAPACITY */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {tab === 'WORKLOAD' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {workloadData.map((u) => {
              const loadCfg = LOAD_CONFIG[u.loadStatus] ?? LOAD_CONFIG.BALANCED;

              return (
                <div
                  key={u.id}
                  className="rounded-xl border border-border bg-white p-4 space-y-3.5 hover:border-primary/60 transition-colors"
                >
                  {/* Profile */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {u.avatar ? (
                        <img
                          src={u.avatar}
                          alt=""
                          className="h-9 w-9 rounded-full object-cover shrink-0 border border-border"
                        />
                      ) : (
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${getAvatarColor(
                            u.name
                          )}`}
                        >
                          {getInitials(u.name)}
                        </div>
                      )}
                      <div className="min-w-0">
                        <h3 className="text-xs font-bold text-primary truncate">{u.name}</h3>
                        <p className="text-[11px] text-secondary truncate">
                          {u.designation || 'Team Member'}
                          {u.department && ` · ${u.department.name}`}
                        </p>
                      </div>
                    </div>

                    <Badge tone={loadCfg.tone}>{loadCfg.label}</Badge>
                  </div>

                  {/* Workload Stats */}
                  <div className="grid grid-cols-4 gap-1.5 pt-2 border-t border-border/70 text-center">
                    <div className="rounded bg-surface p-1.5">
                      <span className="text-[10px] text-secondary font-medium block">Projects</span>
                      <span className="text-xs font-bold text-primary mt-0.5 block">
                        {u.activeProjectsCount}
                      </span>
                    </div>
                    <div className="rounded bg-surface p-1.5">
                      <span className="text-[10px] text-secondary font-medium block">Open</span>
                      <span className="text-xs font-bold text-primary mt-0.5 block">
                        {u.taskStats.open}
                      </span>
                    </div>
                    <div className="rounded bg-surface p-1.5">
                      <span className="text-[10px] text-secondary font-medium block">Review</span>
                      <span className="text-xs font-bold text-amber-600 mt-0.5 block">
                        {u.taskStats.inReview}
                      </span>
                    </div>
                    <div className="rounded bg-surface p-1.5">
                      <span className="text-[10px] text-secondary font-medium block">Overdue</span>
                      <span
                        className={`text-xs font-bold mt-0.5 block ${
                          u.taskStats.overdue > 0 ? 'text-red-600' : 'text-primary'
                        }`}
                      >
                        {u.taskStats.overdue}
                      </span>
                    </div>
                  </div>

                  {/* Completion Rate */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-secondary font-medium">Completion Rate</span>
                      <span className="font-bold text-primary">{u.completionRate}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-surface overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full"
                        style={{ width: `${u.completionRate}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* TAB 4: TASK CATEGORIES & DEPARTMENTS */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {tab === 'TASK_TYPES' && (
        <div className="space-y-5">
          {/* Categories Grid */}
          <div className="rounded-xl border border-border bg-white p-5 space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-primary">
              Task Categories & Velocity Breakdown
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {(taskTypesData?.taskTypes ?? []).map((t) => (
                <div
                  key={t.type}
                  className="rounded-lg border border-border bg-surface/50 p-3.5 space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="rounded-md bg-white p-1 border border-border">
                        {TASK_TYPE_ICONS[t.type] ?? TASK_TYPE_ICONS.OTHER}
                      </div>
                      <span className="text-xs font-bold text-primary capitalize">
                        {t.type.toLowerCase().replace('_', ' ')}
                      </span>
                    </div>
                    <span className="text-xs font-semibold text-primary bg-white px-2 py-0.5 rounded border border-border">
                      {t.total} tasks
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5 text-center text-xs pt-1 border-t border-border/60">
                    <div>
                      <span className="text-[10px] text-secondary block">Completed</span>
                      <span className="font-bold text-primary">{t.completed}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-secondary block">In Prog</span>
                      <span className="font-bold text-primary">{t.inProgress}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-secondary block">Avg Days</span>
                      <span className="font-bold text-primary">{t.avgDaysToComplete}d</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Department Efficiency */}
          <div className="rounded-xl border border-border bg-white p-5 space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-primary">
              Departmental Delivery Efficiency
            </h2>

            {(taskTypesData?.departments ?? []).length === 0 ? (
              <p className="text-xs text-secondary italic">No department data recorded.</p>
            ) : (
              <Table>
                <THead>
                  <TR className="bg-surface hover:bg-surface">
                    <TH>DEPARTMENT</TH>
                    <TH>TOTAL TASKS</TH>
                    <TH>COMPLETED</TH>
                    <TH>OPEN</TH>
                    <TH>OVERDUE</TH>
                    <TH>COMPLETION RATE</TH>
                  </TR>
                </THead>
                <TBody>
                  {(taskTypesData?.departments ?? []).map((d) => (
                    <TR key={d.id}>
                      <TD className="font-semibold text-primary text-xs">{d.name}</TD>
                      <TD className="text-xs text-primary font-medium">{d.totalTasks}</TD>
                      <TD className="text-xs text-primary font-medium">{d.completedTasks}</TD>
                      <TD className="text-xs text-secondary">{d.openTasks}</TD>
                      <TD className="text-xs">
                        <span
                          className={`font-semibold ${
                            d.overdueTasks > 0 ? 'text-red-600' : 'text-primary'
                          }`}
                        >
                          {d.overdueTasks}
                        </span>
                      </TD>
                      <TD>
                        <div className="w-32 space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-semibold text-primary">{d.completionRate}%</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-surface overflow-hidden">
                            <div
                              className="h-full bg-emerald-500 rounded-full"
                              style={{ width: `${d.completionRate}%` }}
                            />
                          </div>
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
