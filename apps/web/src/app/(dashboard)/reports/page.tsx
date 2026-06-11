'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores';
import { useRouter } from 'next/navigation';
import { formatDate, getInitials, getAvatarColor } from '@/lib/utils';
import { PieChart, ListTodo, Users, FolderKanban, Clock, AlertTriangle, TrendingUp } from 'lucide-react';

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

type Tab = 'projects' | 'tasks' | 'team' | 'clients';

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.05 } } };
const item = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } };

export default function ReportsPage() {
  const { user } = useAuthStore();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('projects');

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

  const tabs = [
    { id: 'projects' as Tab, label: 'Projects', icon: FolderKanban },
    { id: 'tasks' as Tab, label: 'Tasks', icon: ListTodo },
    { id: 'team' as Tab, label: 'Team', icon: Users },
    { id: 'clients' as Tab, label: 'Clients', icon: PieChart },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[#111827] tracking-tight">Reports & Analytics</h1>
        <p className="text-sm text-[#6B7280] mt-1">Deep operational visibility and performance metrics</p>
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
                ? 'bg-[#111827] text-white border-[#111827] shadow-sm'
                : 'bg-white text-[#6B7280] border-[#E5E7EB] hover:text-[#111827] hover:bg-[#F9FAFB] hover:border-[#D1D5DB]'
                }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

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
            <motion.div variants={item} className="rounded-2xl border border-[#E5E7EB] bg-white p-6 hover:shadow-sm transition-shadow">
              <h3 className="text-sm font-semibold text-[#111827] mb-6">Status Distribution</h3>
              <div className="space-y-4">
                {projectReport.statusDistribution.map((s) => (
                  <div key={s.status} className="flex items-center gap-4">
                    <span className="text-sm text-[#6B7280] font-medium w-24">{s.status}</span>
                    <div className="flex-1 h-2 rounded-full bg-[#F3F4F6] overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${projectReport.total > 0 ? (s.count / projectReport.total) * 100 : 0}%` }}
                        transition={{ duration: 0.6 }}
                        className={`h-full rounded-full ${s.status === 'Delayed' ? 'bg-red-500' : 'bg-[#111827]'}`}
                      />
                    </div>
                    <span className="text-sm font-semibold text-[#111827] tabular-nums w-8 text-right">{s.count}</span>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div variants={item} className="rounded-2xl border border-[#E5E7EB] bg-white p-6 hover:shadow-sm transition-shadow flex flex-col gap-6">
              <div>
                <h3 className="text-sm font-semibold text-[#111827] mb-4">Projects by Type</h3>
                <div className="flex flex-wrap gap-2">
                  {projectReport.projectsByType.map(t => (
                    <div key={t.type} className="px-3 py-1.5 bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg text-xs font-medium text-[#374151]">
                      {t.type.replace('_', ' ')}: <span className="text-[#111827] ml-1 font-semibold">{t.count}</span>
                    </div>
                  ))}
                  {projectReport.projectsByType.length === 0 && <span className="text-sm text-[#9CA3AF]">No data available.</span>}
                </div>
              </div>

              <div className="flex-1 border-t border-[#F3F4F6] pt-6">
                <h3 className="text-sm font-semibold text-[#111827] mb-4">Active Projects by Client</h3>
                <div className="space-y-3 max-h-[200px] overflow-y-auto pr-2">
                  {projectReport.projectsByClient.map(c => (
                    <div key={c.client} className="flex items-center justify-between">
                      <span className="text-sm text-[#6B7280] truncate">{c.client}</span>
                      <span className="text-sm font-semibold text-[#111827] px-2 py-0.5 bg-[#F3F4F6] rounded-md">{c.count}</span>
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
            <motion.div variants={item} className="rounded-2xl border border-[#E5E7EB] bg-white p-6 hover:shadow-sm transition-shadow">
              <h3 className="text-sm font-semibold text-[#111827] mb-6">Open Tasks Workload by Assignee</h3>
              <div className="space-y-4">
                {taskReport.tasksByAssignee.map((a) => (
                  <div key={a.assignee} className="flex items-center gap-4">
                    <span className="text-sm text-[#6B7280] font-medium w-32 truncate">{a.assignee}</span>
                    <div className="flex-1 h-2 rounded-full bg-[#F3F4F6] overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${taskReport.total > 0 ? (a.count / taskReport.total) * 100 : 0}%` }}
                        transition={{ duration: 0.6 }}
                        className="h-full rounded-full bg-[#3B82F6]"
                      />
                    </div>
                    <span className="text-sm font-semibold text-[#111827] tabular-nums w-8 text-right">{a.count}</span>
                  </div>
                ))}
                {taskReport.tasksByAssignee.length === 0 && <span className="text-sm text-[#9CA3AF]">No open assigned tasks.</span>}
              </div>
            </motion.div>

            <motion.div variants={item} className="rounded-2xl border border-[#E5E7EB] bg-white p-6 hover:shadow-sm transition-shadow">
              <h3 className="text-sm font-semibold text-[#111827] mb-6">Tasks by Type (Open)</h3>
              <div className="flex flex-wrap gap-3">
                {taskReport.tasksByType.map(t => (
                  <div key={t.type} className="px-4 py-2 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl text-sm font-medium text-[#374151] flex items-center gap-2">
                    <span className="capitalize">{t.type.toLowerCase().replace('_', ' ')}</span>
                    <span className="bg-[#111827] text-white text-[10px] px-1.5 py-0.5 rounded-md font-semibold">{t.count}</span>
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

          <motion.div variants={item} className="rounded-2xl border border-[#E5E7EB] bg-white overflow-hidden hover:shadow-sm transition-shadow">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr className="border-b border-[#F3F4F6] bg-[#FAFAFA]">
                    <th className="px-6 py-4 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wide">Member</th>
                    <th className="px-6 py-4 text-center text-xs font-medium text-[#6B7280] uppercase tracking-wide">Active Workload</th>
                    <th className="px-6 py-4 text-center text-xs font-medium text-[#6B7280] uppercase tracking-wide">Time Logged</th>
                    <th className="px-6 py-4 text-center text-xs font-medium text-[#6B7280] uppercase tracking-wide">Completion Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3F4F6]">
                  {teamReport.members.map((m) => (
                    <tr key={m.id} className="hover:bg-[#F9FAFB] transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`h-8 w-8 rounded-full text-[11px] font-semibold flex items-center justify-center ${getAvatarColor(m.name)}`}>{getInitials(m.name)}</div>
                          <span className="text-sm font-semibold text-[#111827]">{m.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-sm font-semibold bg-blue-50 text-blue-700 border border-blue-100">
                          {m.activeTasks} tasks
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center text-sm font-medium text-[#6B7280]">
                        {m.loggedHours} hrs
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center gap-3">
                          <div className="h-2 w-24 rounded-full bg-[#F3F4F6] overflow-hidden">
                            <div className="h-full rounded-full bg-[#10B981]" style={{ width: `${m.completionRate}%` }} />
                          </div>
                          <span className="text-sm font-semibold text-[#111827] tabular-nums w-10">{m.completionRate}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {teamReport.members.length === 0 && (
                    <tr><td colSpan={4} className="px-6 py-8 text-center text-sm text-[#6B7280]">No team members found.</td></tr>
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

          <motion.div variants={item} className="rounded-2xl border border-[#E5E7EB] bg-white overflow-hidden hover:shadow-sm transition-shadow">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead>
                  <tr className="border-b border-[#F3F4F6] bg-[#FAFAFA]">
                    <th className="px-6 py-4 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wide">Client</th>
                    <th className="px-6 py-4 text-center text-xs font-medium text-[#6B7280] uppercase tracking-wide">Projects Health</th>
                    <th className="px-6 py-4 text-center text-xs font-medium text-[#6B7280] uppercase tracking-wide">Deliverables Tracker</th>
                    <th className="px-6 py-4 text-center text-xs font-medium text-[#6B7280] uppercase tracking-wide">Overdue Tasks</th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wide">Next Deadline</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3F4F6]">
                  {clientReport.clients.map((c) => (
                    <tr key={c.id} className="hover:bg-[#F9FAFB] transition-colors">
                      <td className="px-6 py-4">
                        <p className="text-sm font-semibold text-[#111827]">{c.name}</p>
                        {c.company && <p className="text-xs text-[#6B7280] mt-0.5">{c.company}</p>}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex flex-col items-center">
                          <span className="text-sm font-semibold text-[#111827]">{c.completedProjects} / {c.totalProjects}</span>
                          <span className="text-[10px] font-medium text-[#9CA3AF] uppercase">Completed</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col items-center">
                          <div className="flex items-center gap-2 mb-1">
                            <div className="h-2 w-20 rounded-full bg-[#F3F4F6] overflow-hidden">
                              <div className="h-full rounded-full bg-[#8B5CF6]" style={{ width: `${c.deliverablesRate}%` }} />
                            </div>
                            <span className="text-xs font-semibold text-[#111827] w-8">{c.deliverablesRate}%</span>
                          </div>
                          <span className="text-[10px] font-medium text-[#6B7280]">{c.completedTasks} of {c.totalTasks} tasks</span>
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
                          <span className="text-sm font-medium text-[#111827]">{formatDate(c.nextDueDate)}</span>
                        ) : (
                          <span className="text-sm text-[#9CA3AF] italic">No upcoming</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {clientReport.clients.length === 0 && (
                    <tr><td colSpan={5} className="px-6 py-8 text-center text-sm text-[#6B7280]">No clients found.</td></tr>
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
    <div className={`flex flex-col p-4 sm:p-5 rounded-2xl border ${danger ? 'border-red-200 bg-red-50' : 'border-[#E5E7EB] bg-white'} hover:shadow-sm transition-shadow`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <p className={`text-[11px] sm:text-xs font-medium uppercase tracking-wide ${danger ? 'text-red-600' : 'text-[#6B7280]'}`}>{label}</p>
        {Icon && <Icon className={`w-4 h-4 shrink-0 ${danger ? 'text-red-500' : 'text-[#9CA3AF]'}`} />}
      </div>
      <p className={`text-3xl font-semibold tabular-nums tracking-tight ${danger ? 'text-red-600' : 'text-[#111827]'}`}>
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
          <div key={i} className="p-4 sm:p-5 rounded-2xl border border-[#E5E7EB] bg-white h-[104px]">
            <div className="h-3 w-24 bg-[#F3F4F6] rounded mb-4" />
            <div className="h-8 w-16 bg-[#F3F4F6] rounded" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 h-[300px]">
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
        <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 h-[300px]">
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
