'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { useAuthStore, useModuleStore } from '@/stores';
import { useRouter } from 'next/navigation';
import { formatDate, formatCurrency, getAvatarColor, getInitials, getClientDisplayName } from '@/lib/utils';
import { PieChart, ListTodo, Users, FolderKanban, Clock, AlertTriangle, TrendingUp, LayoutDashboard, IndianRupee, Target, Trophy, Download } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { useExecutiveReport } from '@/hooks/useQueries';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, PieChart as RPieChart, Pie, Cell, AreaChart, Area } from 'recharts';

const COLORS = ['#111827', '#4B5563', '#9CA3AF', '#D1D5DB', '#F3F4F6'];

const datePresetOptions = [
  { label: 'This Month', value: 'this_month' },
  { label: 'This Quarter', value: 'this_quarter' },
  { label: 'This Year', value: 'this_year' },
  { label: 'All Time', value: 'all_time' },
  { label: 'Custom Range', value: 'custom' },
];

// End-of-day / start-of-period dates → stable ISO strings within a day (avoids refetch loops).
function computeRange(preset: string, custom: { start: string; end: string }): { startDate?: string; endDate?: string } {
  if (preset === 'custom') {
    if (!custom.start || !custom.end) return {};
    const s = new Date(custom.start); s.setHours(0, 0, 0, 0);
    const e = new Date(custom.end); e.setHours(23, 59, 59, 999);
    return { startDate: s.toISOString(), endDate: e.toISOString() };
  }
  if (preset === 'all_time') return {};
  const end = new Date(); end.setHours(23, 59, 59, 999);
  const now = new Date();
  let start: Date;
  if (preset === 'this_month') start = new Date(now.getFullYear(), now.getMonth(), 1);
  else if (preset === 'this_quarter') start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  else start = new Date(now.getFullYear(), 0, 1); // this_year
  return { startDate: start.toISOString(), endDate: end.toISOString() };
}

interface ProjectReport {
  total: number; completed: number; active: number; delayed: number; planning: number; onHold: number; completionRate: number;
  statusDistribution: { status: string; count: number }[];
  projectsByClient: { client: string; count: number }[];
  projectsByType: { type: string; count: number }[];
}

interface TaskReport {
  total: number; completed: number; overdue: number; completionRate: number;
  tasksByType: { type: string; count: number }[];
  tasksByAssignee: { assignee: string; count: number }[];
}

interface TeamReport {
  overallCompletionRate: number; totalTasks: number; totalCompleted: number;
  members: { id: string; name: string; avatar?: string | null; totalTasks: number; completedTasks: number; activeTasks: number; completionRate: number; loggedHours: number }[];
}

interface ClientReport {
  totalClients: number; totalRevenue: number;
  clients: {
    id: string; name: string; company?: string | null; contractValue?: number | null;
    totalProjects: number; completedProjects: number; completionRate: number;
    totalTasks: number; completedTasks: number; deliverablesRate: number;
    overdueTasks: number; nextDueDate: string | null
  }[];
}

type Tab = 'executive' | 'projects' | 'tasks' | 'team' | 'clients';

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.05 } } };
const item = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } };

export default function ReportsPage() {
  const { user } = useAuthStore();
  const { activeModule } = useModuleStore();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(activeModule === 'CRM' ? 'executive' : 'projects');

  useEffect(() => {
    if (activeModule === 'CRM' && !['executive', 'clients'].includes(tab)) {
      setTab('executive');
    } else if (activeModule === 'PM' && !['projects', 'tasks', 'team', 'clients'].includes(tab)) {
      setTab('projects');
    }
  }, [activeModule, tab]);

  const [datePreset, setDatePreset] = useState('this_quarter');
  const [customRange, setCustomRange] = useState({ start: '', end: '' });
  const dateRange = computeRange(datePreset, customRange);
  const { data: exec } = useExecutiveReport(dateRange);

  const [projectReport, setProjectReport] = useState<ProjectReport | null>(null);
  const [taskReport, setTaskReport] = useState<TaskReport | null>(null);
  const [teamReport, setTeamReport] = useState<TeamReport | null>(null);
  const [clientReport, setClientReport] = useState<ClientReport | null>(null);

  useEffect(() => {
    if (user && user.role === 'TEAM_MEMBER') {
      router.push('/dashboard');
      return;
    }

    // Fetch all reports
    api.get<ProjectReport>('/reports/projects').then(setProjectReport).catch(() => { });
    api.get<TaskReport>('/reports/tasks').then(setTaskReport).catch(() => { });
    api.get<TeamReport>('/reports/team').then(setTeamReport).catch(() => { });
    api.get<ClientReport>('/reports/clients').then(setClientReport).catch(() => { });
  }, [user, router]);

  const allTabs = [
    { id: 'executive' as Tab, label: 'Executive', icon: LayoutDashboard, module: 'CRM' },
    { id: 'projects' as Tab, label: 'Projects', icon: FolderKanban, module: 'PM' },
    { id: 'tasks' as Tab, label: 'Tasks', icon: ListTodo, module: 'PM' },
    { id: 'team' as Tab, label: 'Team', icon: Users, module: 'PM' },
    { id: 'clients' as Tab, label: 'Clients', icon: PieChart, module: 'ALL' },
  ];

  const tabs = allTabs.filter(t => t.module === 'ALL' || t.module === activeModule);

  const periodLabel = datePresetOptions.find(o => o.value === datePreset)?.label || '';

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-primary tracking-tight">Reports & Analytics</h1>
        <p className="text-sm text-secondary mt-1">Deep operational visibility and performance metrics</p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-2 w-max max-w-full">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all border ${active
                ? 'bg-primary text-white border-primary shadow-sm'
                : 'bg-white text-secondary border-border hover:text-primary hover:bg-[#F9FAFB] hover:border-[#D1D5DB]'
                }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ---------------- EXECUTIVE (BOSS VIEW) ---------------- */}
      {tab === 'executive' && (
        <div id="exec-report">
          <div className="no-print flex flex-wrap items-center justify-between gap-3 mb-6">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={datePreset} onChange={setDatePreset} options={datePresetOptions} className="w-44" />
              {datePreset === 'custom' && (
                <div className="flex items-center gap-2">
                  <input type="date" value={customRange.start} onChange={(e) => setCustomRange({ ...customRange, start: e.target.value })} className="rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary" />
                  <span className="text-secondary">–</span>
                  <input type="date" value={customRange.end} onChange={(e) => setCustomRange({ ...customRange, end: e.target.value })} className="rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary" />
                </div>
              )}
            </div>
            <button onClick={() => window.print()} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] transition-all">
              <Download className="h-4 w-4" /> Export PDF
            </button>
          </div>

          {/* Print-only header */}
          <div className="hidden print:block mb-4">
            <h1 className="text-2xl font-bold text-primary">Executive Report</h1>
            <p className="text-sm text-secondary">Period: {periodLabel}</p>
          </div>

          {!exec ? <ReportSkeleton /> : <ExecutiveTab data={exec} periodLabel={periodLabel} />}
        </div>
      )}

      {/* ---------------- PROJECT REPORTS ---------------- */}
      {tab === 'projects' && !projectReport && <ReportSkeleton />}
      {tab === 'projects' && projectReport && (
        <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
          <motion.div variants={item} className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard label="Total Projects" value={projectReport.total} icon={FolderKanban} />
            <MetricCard label="Completed" value={projectReport.completed} suffix={`(${projectReport.completionRate}%)`} icon={TrendingUp} />
            <MetricCard label="Active" value={projectReport.active} icon={Clock} />
            <MetricCard label="Overdue / Delayed" value={projectReport.delayed} danger={projectReport.delayed > 0} icon={AlertTriangle} />
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <motion.div variants={item} className="rounded-2xl border border-border bg-white p-6 hover:shadow-sm transition-shadow">
              <h3 className="text-sm font-semibold text-primary mb-6">Status Distribution</h3>
              <div className="space-y-4">
                {projectReport.statusDistribution.map((s) => (
                  <div key={s.status} className="flex items-center gap-4">
                    <span className="text-sm text-secondary font-medium w-24">{s.status}</span>
                    <div className="flex-1 h-2 rounded-full bg-[#F3F4F6] overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${projectReport.total > 0 ? (s.count / projectReport.total) * 100 : 0}%` }}
                        transition={{ duration: 0.6 }}
                        className={`h-full rounded-full ${s.status === 'Delayed' ? 'bg-red-500' : 'bg-primary'}`}
                      />
                    </div>
                    <span className="text-sm font-semibold text-primary tabular-nums w-8 text-right">{s.count}</span>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div variants={item} className="rounded-2xl border border-border bg-white p-6 hover:shadow-sm transition-shadow flex flex-col gap-6">
              <div>
                <h3 className="text-sm font-semibold text-primary mb-4">Projects by Type</h3>
                <div className="flex flex-wrap gap-2">
                  {projectReport.projectsByType.map(t => (
                    <div key={t.type} className="px-3 py-1.5 bg-[#F9FAFB] border border-border rounded-lg text-xs font-medium text-[#374151]">
                      {t.type.replace('_', ' ')}: <span className="text-primary ml-1 font-semibold">{t.count}</span>
                    </div>
                  ))}
                  {projectReport.projectsByType.length === 0 && <span className="text-sm text-[#9CA3AF]">No data available.</span>}
                </div>
              </div>

              <div className="flex-1 border-t border-[#F3F4F6] pt-6">
                <h3 className="text-sm font-semibold text-primary mb-4">Active Projects by Client</h3>
                <div className="space-y-3 max-h-50 overflow-y-auto pr-2">
                  {projectReport.projectsByClient.map(c => (
                    <div key={c.client} className="flex items-center justify-between">
                      <span className="text-sm text-secondary truncate">{c.client}</span>
                      <span className="text-sm font-semibold text-primary px-2 py-0.5 bg-[#F3F4F6] rounded-md">{c.count}</span>
                    </div>
                  ))}
                  {projectReport.projectsByClient.length === 0 && <span className="text-sm text-[#9CA3AF]">No active projects.</span>}
                </div>
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}

      {/* ---------------- TASK REPORTS ---------------- */}
      {tab === 'tasks' && !taskReport && <ReportSkeleton />}
      {tab === 'tasks' && taskReport && (
        <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
          <motion.div variants={item} className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard label="Total Tasks" value={taskReport.total} icon={ListTodo} />
            <MetricCard label="Completed" value={taskReport.completed} suffix={`(${taskReport.completionRate}%)`} icon={TrendingUp} />
            <MetricCard label="Open" value={taskReport.total - taskReport.completed} icon={Clock} />
            <MetricCard label="Overdue" value={taskReport.overdue} danger={taskReport.overdue > 0} icon={AlertTriangle} />
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <motion.div variants={item} className="rounded-2xl border border-border bg-white p-6 hover:shadow-sm transition-shadow">
              <h3 className="text-sm font-semibold text-primary mb-6">Open Tasks Workload by Assignee</h3>
              <div className="space-y-4">
                {taskReport.tasksByAssignee.map((a) => (
                  <div key={a.assignee} className="flex items-center gap-4">
                    <span className="text-sm text-secondary font-medium w-32 truncate">{a.assignee}</span>
                    <div className="flex-1 h-2 rounded-full bg-[#F3F4F6] overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${taskReport.total > 0 ? (a.count / taskReport.total) * 100 : 0}%` }}
                        transition={{ duration: 0.6 }}
                        className="h-full rounded-full bg-[#3B82F6]"
                      />
                    </div>
                    <span className="text-sm font-semibold text-primary tabular-nums w-8 text-right">{a.count}</span>
                  </div>
                ))}
                {taskReport.tasksByAssignee.length === 0 && <span className="text-sm text-[#9CA3AF]">No open assigned tasks.</span>}
              </div>
            </motion.div>

            <motion.div variants={item} className="rounded-2xl border border-border bg-white p-6 hover:shadow-sm transition-shadow">
              <h3 className="text-sm font-semibold text-primary mb-6">Tasks by Type (Open)</h3>
              <div className="flex flex-wrap gap-3">
                {taskReport.tasksByType.map(t => (
                  <div key={t.type} className="px-4 py-2 bg-[#F9FAFB] border border-border rounded-xl text-sm font-medium text-[#374151] flex items-center gap-2">
                    <span className="capitalize">{t.type.toLowerCase().replace('_', ' ')}</span>
                    <span className="bg-primary text-white text-[10px] px-1.5 py-0.5 rounded-md font-semibold">{t.count}</span>
                  </div>
                ))}
                {taskReport.tasksByType.length === 0 && <span className="text-sm text-[#9CA3AF]">No open tasks.</span>}
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}

      {/* ---------------- TEAM REPORTS ---------------- */}
      {tab === 'team' && !teamReport && <ReportSkeleton />}
      {tab === 'team' && teamReport && (
        <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
          <motion.div variants={item} className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard label="Overall Completion" value={`${teamReport.overallCompletionRate}%`} icon={TrendingUp} />
            <MetricCard label="Total Tasks" value={teamReport.totalTasks} icon={ListTodo} />
            <MetricCard label="Completed" value={teamReport.totalCompleted} icon={Clock} />
            <MetricCard label="Active Workload" value={teamReport.totalTasks - teamReport.totalCompleted} icon={Users} />
          </motion.div>

          <motion.div variants={item} className="rounded-2xl border border-border bg-white overflow-hidden hover:shadow-sm transition-shadow">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr className="border-b border-[#F3F4F6] bg-surface">
                    <th className="px-6 py-4 text-left text-xs font-medium text-secondary uppercase tracking-wide">Member</th>
                    <th className="px-6 py-4 text-center text-xs font-medium text-secondary uppercase tracking-wide">Active Workload</th>
                    <th className="px-6 py-4 text-center text-xs font-medium text-secondary uppercase tracking-wide">Time Logged</th>
                    <th className="px-6 py-4 text-center text-xs font-medium text-secondary uppercase tracking-wide">Completion Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3F4F6]">
                  {teamReport.members.map((m) => (
                    <tr key={m.id} className="hover:bg-[#F9FAFB] transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`h-8 w-8 rounded-full text-[11px] font-semibold flex items-center justify-center ${getAvatarColor(m.name)}`}>{getInitials(m.name)}</div>
                          <span className="text-sm font-semibold text-primary">{m.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-sm font-semibold bg-blue-50 text-blue-700 border border-blue-100">
                          {m.activeTasks} tasks
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center text-sm font-medium text-secondary">
                        {m.loggedHours} hrs
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center gap-3">
                          <div className="h-2 w-24 rounded-full bg-[#F3F4F6] overflow-hidden">
                            <div className="h-full rounded-full bg-[#10B981]" style={{ width: `${m.completionRate}%` }} />
                          </div>
                          <span className="text-sm font-semibold text-primary tabular-nums w-10">{m.completionRate}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {teamReport.members.length === 0 && (
                    <tr><td colSpan={4} className="px-6 py-8 text-center text-sm text-secondary">No team members found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>
        </motion.div>
      )}

      {/* ---------------- CLIENT REPORTS ---------------- */}
      {tab === 'clients' && !clientReport && <ReportSkeleton />}
      {tab === 'clients' && clientReport && (
        <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
          <motion.div variants={item} className="grid grid-cols-2 gap-4">
            <MetricCard label="Total Clients" value={clientReport.totalClients} icon={Users} />
            <MetricCard label="Avg Completion Rate" value={`${Math.round(clientReport.clients.reduce((sum, c) => sum + c.completionRate, 0) / (clientReport.totalClients || 1))}%`} icon={TrendingUp} />
          </motion.div>

          <motion.div variants={item} className="rounded-2xl border border-border bg-white overflow-hidden hover:shadow-sm transition-shadow">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead>
                  <tr className="border-b border-[#F3F4F6] bg-surface">
                    <th className="px-6 py-4 text-left text-xs font-medium text-secondary uppercase tracking-wide">Client</th>
                    <th className="px-6 py-4 text-center text-xs font-medium text-secondary uppercase tracking-wide">Projects Health</th>
                    <th className="px-6 py-4 text-center text-xs font-medium text-secondary uppercase tracking-wide">Deliverables Tracker</th>
                    <th className="px-6 py-4 text-center text-xs font-medium text-secondary uppercase tracking-wide">Overdue Tasks</th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-secondary uppercase tracking-wide">Next Deadline</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3F4F6]">
                  {clientReport.clients.map((c) => (
                    <tr key={c.id} className="hover:bg-[#F9FAFB] transition-colors">
                      <td className="px-6 py-4">
                        <p className="text-sm font-semibold text-primary">{getClientDisplayName(c)}</p>
                        {c.name !== 'Internal' && c.company ? (
                          <p className="text-xs text-secondary mt-0.5">{c.name}</p>
                        ) : null}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex flex-col items-center">
                          <span className="text-sm font-semibold text-primary">{c.completedProjects} / {c.totalProjects}</span>
                          <span className="text-[10px] font-medium text-[#9CA3AF] uppercase">Completed</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col items-center">
                          <div className="flex items-center gap-2 mb-1">
                            <div className="h-2 w-20 rounded-full bg-[#F3F4F6] overflow-hidden">
                              <div className="h-full rounded-full bg-[#8B5CF6]" style={{ width: `${c.deliverablesRate}%` }} />
                            </div>
                            <span className="text-xs font-semibold text-primary w-8">{c.deliverablesRate}%</span>
                          </div>
                          <span className="text-[10px] font-medium text-secondary">{c.completedTasks} of {c.totalTasks} tasks</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        {c.overdueTasks > 0 ? (
                          <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-semibold bg-red-50 text-red-700 border border-red-100">
                            {c.overdueTasks} Overdue
                          </span>
                        ) : (
                          <span className="text-sm text-[#9CA3AF]">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-left">
                        {c.nextDueDate ? (
                          <span className="text-sm font-medium text-primary">{formatDate(c.nextDueDate)}</span>
                        ) : (
                          <span className="text-sm text-[#9CA3AF] italic">No upcoming</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {clientReport.clients.length === 0 && (
                    <tr><td colSpan={5} className="px-6 py-8 text-center text-sm text-secondary">No clients found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>
        </motion.div>
      )}
    </div>
  );
}

function MetricCard({ label, value, suffix, danger, icon: Icon }: { label: string; value: string | number; suffix?: string; danger?: boolean; icon?: any }) {
  return (
    <div className={`flex flex-col p-4 sm:p-5 rounded-2xl border ${danger ? 'border-red-200 bg-red-50' : 'border-border bg-white'} hover:shadow-sm transition-shadow`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <p className={`text-[11px] sm:text-xs font-medium uppercase tracking-wide ${danger ? 'text-red-600' : 'text-secondary'}`}>{label}</p>
        {Icon && <Icon className={`w-4 h-4 shrink-0 ${danger ? 'text-red-500' : 'text-[#9CA3AF]'}`} />}
      </div>
      <p title={String(value)} className={`${String(value).length > 12 ? 'text-lg sm:text-xl' : String(value).length > 8 ? 'text-xl sm:text-2xl' : 'text-2xl sm:text-3xl'} font-semibold tabular-nums tracking-tight ${danger ? 'text-red-600' : 'text-primary'}`}>
        {value}
        {suffix && <span className={`text-sm font-medium ml-2 ${danger ? 'text-red-400' : 'text-[#9CA3AF]'}`}>{suffix}</span>}
      </p>
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="p-4 sm:p-5 rounded-2xl border border-border bg-white h-[104px]">
            <div className="h-3 w-24 bg-[#F3F4F6] rounded mb-4" />
            <div className="h-8 w-16 bg-[#F3F4F6] rounded" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-border bg-white p-6 h-[300px]">
          <div className="h-4 w-32 bg-[#F3F4F6] rounded mb-6" />
          <div className="space-y-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex gap-4">
                <div className="h-4 w-24 bg-[#F3F4F6] rounded" />
                <div className="h-4 flex-1 bg-[#F3F4F6] rounded" />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-white p-6 h-[300px]">
          <div className="h-4 w-32 bg-[#F3F4F6] rounded mb-6" />
          <div className="flex gap-2 flex-wrap">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-8 w-24 bg-[#F3F4F6] rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const titleCase = (s?: string) => s ? s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '';

function SectionTitle({ icon: Icon, title, subtitle }: { icon: any; title: string; subtitle?: string }) {
  return (
    <div className="flex items-end justify-between mb-4">
      <h2 className="flex items-center gap-2 text-base font-semibold text-primary"><Icon className="h-4 w-4 text-secondary" /> {title}</h2>
      {subtitle && <span className="text-xs text-secondary">{subtitle}</span>}
    </div>
  );
}

function StatRow({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'green' | 'red' }) {
  const color = tone === 'green' ? 'text-emerald-600' : tone === 'red' ? 'text-red-600' : 'text-primary';
  return (
    <div className="rounded-2xl border border-border bg-white p-4 flex items-center justify-between">
      <div>
        <p className="text-xs font-medium text-secondary uppercase tracking-wide">{label}</p>
        {sub && <p className="text-[11px] text-[#9CA3AF] mt-0.5">{sub}</p>}
      </div>
      <p className={`text-lg font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

function MiniLegend({ dot, label }: { dot: string; label: string }) {
  return <span className="flex items-center gap-1.5 text-secondary"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: dot }} />{label}</span>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="h-[180px] flex items-center justify-center text-sm text-secondary">{children}</div>;
}

function ExecutiveTab({ data, periodLabel }: { data: any; periodLabel: string }) {
  const { revenue, delivery, team, clients } = data;
  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-8">

      {/* KPI ROW */}
      <motion.div variants={item} className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <MetricCard label="Active Revenue" value={formatCurrency(revenue.activeRevenue)} icon={IndianRupee} />
        <MetricCard label="Pipeline Value" value={formatCurrency(revenue.pipelineValue)} icon={TrendingUp} />
        <MetricCard label="Win Rate" value={`${revenue.winRate}%`} icon={Trophy} />
        <MetricCard label="On-Time Delivery" value={`${delivery.onTimeRate}%`} icon={Target} danger={delivery.onTimeRate < 70} />
        <MetricCard label="Overdue Tasks" value={delivery.overdueTasks} icon={AlertTriangle} danger={delivery.overdueTasks > 0} />
        <MetricCard label="Churned (period)" value={clients.churnedInPeriod} icon={Users} danger={clients.churnedInPeriod > 0} />
      </motion.div>

      {/* REVENUE & SALES */}
      <motion.div variants={item}>
        <SectionTitle icon={IndianRupee} title="Revenue & Sales" subtitle={periodLabel} />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-3">
            <StatRow label="Won deals" value={formatCurrency(revenue.wonValue)} sub={`${revenue.wonCount} deals`} tone="green" />
            <StatRow label="Lost deals" value={formatCurrency(revenue.lostValue)} sub={`${revenue.lostCount} deals`} tone="red" />
            <StatRow label="Open pipeline" value={formatCurrency(revenue.pipelineValue)} sub="active leads" />
          </div>
          <div className="lg:col-span-2 rounded-2xl border border-border bg-white p-5">
            <h3 className="text-sm font-semibold text-primary mb-4">Reasons for Loss</h3>
            {revenue.lostReasons.length ? (
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={revenue.lostReasons.map((r: any) => ({ name: titleCase(r.reason), count: r.count }))} layout="vertical" margin={{ left: 10, right: 12 }}>
                    <XAxis type="number" hide allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={120} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#6B7280' }} />
                    <RTooltip cursor={{ fill: '#FAFAFA' }} />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]} fill="#dc2626" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : <Empty>No lost deals in this period.</Empty>}
          </div>
        </div>
      </motion.div>

      {/* DELIVERY & OPERATIONS */}
      <motion.div variants={item}>
        <SectionTitle icon={Target} title="Delivery & Operations" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 rounded-2xl border border-border bg-white p-5">
            <h3 className="text-sm font-semibold text-primary mb-4">Completion Velocity</h3>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={delivery.velocity} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="execVel" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#111827" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="#111827" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6B7280' }} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6B7280' }} allowDecimals={false} />
                  <RTooltip cursor={{ stroke: '#E5E7EB' }} />
                  <Area type="monotone" dataKey="tasks" name="Completed" stroke="#111827" strokeWidth={2} fill="url(#execVel)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-white p-5 flex flex-col">
            <h3 className="text-sm font-semibold text-primary mb-2">Project Health</h3>
            <div className="h-[160px]">
              <ResponsiveContainer width="100%" height="100%">
                <RPieChart>
                  <Pie
                    data={[
                      { name: 'On Track', value: delivery.projectHealth.onTrack },
                      { name: 'At Risk', value: delivery.projectHealth.atRisk },
                      { name: 'Delayed', value: delivery.projectHealth.delayed },
                    ]}
                    dataKey="value" innerRadius={42} outerRadius={66} paddingAngle={2}
                  >
                    <Cell fill="#22C55E" /><Cell fill="#F59E0B" /><Cell fill="#EF4444" />
                  </Pie>
                  <RTooltip />
                </RPieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap justify-center gap-3 mt-2 text-xs">
              <MiniLegend dot="#22C55E" label={`On track ${delivery.projectHealth.onTrack}`} />
              <MiniLegend dot="#F59E0B" label={`At risk ${delivery.projectHealth.atRisk}`} />
              <MiniLegend dot="#EF4444" label={`Delayed ${delivery.projectHealth.delayed}`} />
            </div>
          </div>
        </div>
      </motion.div>

      {/* TEAM & UTILIZATION */}
      <motion.div variants={item}>
        <SectionTitle icon={Users} title="Team & Utilization" subtitle={`Avg utilization ${team.avgUtilization}% · ${Math.round(team.totalLoggedHours)}h logged`} />
        <div className="rounded-2xl border border-border bg-white p-5">
          {team.members.length ? (
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={team.members.slice(0, 10).map((m: any) => ({ name: (m.name || '').split(' ')[0], capacity: m.capacity }))} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6B7280' }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6B7280' }} domain={[0, 100]} />
                  <RTooltip cursor={{ fill: '#FAFAFA' }} />
                  <Bar dataKey="capacity" name="Utilization %" radius={[2, 2, 0, 0]}>
                    {team.members.slice(0, 10).map((m: any, i: number) => (<Cell key={i} fill={m.capacity >= 90 ? '#6B7280' : '#111827'} />))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <Empty>No active team members.</Empty>}
        </div>
      </motion.div>

      {/* CLIENT PORTFOLIO */}
      <motion.div variants={item}>
        <SectionTitle icon={PieChart} title="Client Portfolio" subtitle={`${clients.active} active · ${clients.churned} churned · ${clients.inactive} completed`} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-border bg-white p-5">
            <h3 className="text-sm font-semibold text-primary mb-4 flex items-center gap-2"><Trophy className="h-4 w-4 text-secondary" /> Top Clients by Value</h3>
            {clients.topClients.length ? clients.topClients.map((c: any, i: number) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-[#F3F4F6] last:border-0">
                <span className="text-sm text-primary truncate pr-3">{c.name}</span>
                <span className="text-sm font-semibold text-primary tabular-nums shrink-0">{formatCurrency(c.contractValue)}</span>
              </div>
            )) : <Empty>No client revenue recorded.</Empty>}
          </div>
          <div className="rounded-2xl border border-border bg-white p-5">
            <h3 className="text-sm font-semibold text-primary mb-4 flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-secondary" /> At-Risk Clients</h3>
            {clients.atRisk.length ? clients.atRisk.map((c: any, i: number) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-[#F3F4F6] last:border-0">
                <span className="flex items-center gap-2 text-sm text-primary truncate pr-3"><span className={`h-2 w-2 rounded-full shrink-0 ${c.health === 'Red' ? 'bg-red-500' : 'bg-amber-500'}`} />{c.name}</span>
                <span className="text-xs text-secondary shrink-0">{c.overdueTasks} overdue</span>
              </div>
            )) : <Empty>All clients healthy.</Empty>}
          </div>
        </div>
      </motion.div>

    </motion.div>
  );
}
