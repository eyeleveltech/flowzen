'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores';
import { useRouter } from 'next/navigation';
import { formatDate, getInitials, getAvatarColor } from '@/lib/utils';

interface ProjectReport {
  total: number; completed: number; active: number; delayed: number; planning: number; onHold: number; completionRate: number;
  statusDistribution: { status: string; count: number }[];
}

interface TeamReport {
  overallCompletionRate: number; totalTasks: number; totalCompleted: number;
  members: { id: string; name: string; avatar?: string | null; totalTasks: number; completedTasks: number; completionRate: number }[];
}

interface ClientReport {
  totalClients: number; totalRevenue: number;
  clients: { id: string; name: string; company?: string | null; contractValue?: number | null; totalProjects: number; completedProjects: number; completionRate: number }[];
}

type Tab = 'projects' | 'team' | 'clients';

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.05 } } };
const item = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } };

export default function ReportsPage() {
  const { user } = useAuthStore();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('projects');
  const [projectReport, setProjectReport] = useState<ProjectReport | null>(null);
  const [teamReport, setTeamReport] = useState<TeamReport | null>(null);
  const [clientReport, setClientReport] = useState<ClientReport | null>(null);

  useEffect(() => {
    if (user && user.role === 'TEAM_MEMBER') {
      router.push('/dashboard');
      return;
    }
    api.get<ProjectReport>('/reports/projects').then(setProjectReport).catch(() => {});
    api.get<TeamReport>('/reports/team').then(setTeamReport).catch(() => {});
    api.get<ClientReport>('/reports/clients').then(setClientReport).catch(() => {});
  }, [user, router]);

  const tabs = [
    { id: 'projects' as Tab, label: 'Projects' },
    { id: 'team' as Tab, label: 'Team' },
    { id: 'clients' as Tab, label: 'Clients' },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#111827] tracking-tight">Reports</h1>
        <p className="text-sm text-[#6B7280] mt-1">Analytics and performance metrics</p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 rounded-xl border border-[#E5E7EB] p-1 w-fit mb-8">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.id ? 'bg-[#111827] text-white' : 'text-[#6B7280] hover:text-[#111827]'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Project Reports */}
      {tab === 'projects' && projectReport && (
        <motion.div variants={container} initial="hidden" animate="show">
          <motion.div variants={item} className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <MetricCard label="Total Projects" value={projectReport.total} />
            <MetricCard label="Completed" value={projectReport.completed} suffix={`(${projectReport.completionRate}%)`} />
            <MetricCard label="Active" value={projectReport.active} />
            <MetricCard label="Delayed" value={projectReport.delayed} danger={projectReport.delayed > 0} />
          </motion.div>

          <motion.div variants={item} className="rounded-2xl border border-[#E5E7EB] bg-white p-6">
            <h3 className="text-sm font-semibold text-[#111827] mb-4">Status Distribution</h3>
            <div className="space-y-3">
              {projectReport.statusDistribution.map((s) => (
                <div key={s.status} className="flex items-center gap-4">
                  <span className="text-sm text-[#374151] w-24">{s.status}</span>
                  <div className="flex-1 h-6 rounded-lg bg-[#F3F4F6] overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${projectReport.total > 0 ? (s.count / projectReport.total) * 100 : 0}%` }}
                      transition={{ duration: 0.6 }}
                      className="h-full rounded-lg bg-[#111827]"
                    />
                  </div>
                  <span className="text-sm font-medium text-[#111827] tabular-nums w-8 text-right">{s.count}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}

      {/* Team Reports */}
      {tab === 'team' && teamReport && (
        <motion.div variants={container} initial="hidden" animate="show">
          <motion.div variants={item} className="grid grid-cols-3 gap-4 mb-8">
            <MetricCard label="Overall Completion" value={`${teamReport.overallCompletionRate}%`} />
            <MetricCard label="Total Tasks" value={teamReport.totalTasks} />
            <MetricCard label="Completed" value={teamReport.totalCompleted} />
          </motion.div>

          <motion.div variants={item} className="rounded-2xl border border-[#E5E7EB] bg-white overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#F3F4F6]">
                  <th className="px-6 py-3.5 text-left text-xs font-medium text-[#6B7280] uppercase">Member</th>
                  <th className="px-6 py-3.5 text-left text-xs font-medium text-[#6B7280] uppercase">Total Tasks</th>
                  <th className="px-6 py-3.5 text-left text-xs font-medium text-[#6B7280] uppercase">Completed</th>
                  <th className="px-6 py-3.5 text-left text-xs font-medium text-[#6B7280] uppercase">Completion Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3F4F6]">
                {teamReport.members.map((m) => (
                  <tr key={m.id} className="hover:bg-[#FAFAFA] transition-colors">
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className={`h-7 w-7 rounded-full text-white text-[10px] font-semibold flex items-center justify-center ${getAvatarColor(m.name)}`}>{getInitials(m.name)}</div>
                        <span className="text-sm font-medium text-[#111827]">{m.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-3.5 text-sm text-[#6B7280] tabular-nums">{m.totalTasks}</td>
                    <td className="px-6 py-3.5 text-sm text-[#6B7280] tabular-nums">{m.completedTasks}</td>
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 rounded-full bg-[#F3F4F6] overflow-hidden">
                          <div className="h-full rounded-full bg-[#111827]" style={{ width: `${m.completionRate}%` }} />
                        </div>
                        <span className="text-xs text-[#6B7280] tabular-nums">{m.completionRate}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>
        </motion.div>
      )}

      {/* Client Reports */}
      {tab === 'clients' && clientReport && (
        <motion.div variants={container} initial="hidden" animate="show">
          <motion.div variants={item} className="grid grid-cols-1 gap-4 mb-8">
            <MetricCard label="Total Clients" value={clientReport.totalClients} />
          </motion.div>

          <motion.div variants={item} className="rounded-2xl border border-[#E5E7EB] bg-white overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#F3F4F6]">
                  <th className="px-6 py-3.5 text-left text-xs font-medium text-[#6B7280] uppercase">Client</th>
                  <th className="px-6 py-3.5 text-left text-xs font-medium text-[#6B7280] uppercase">Projects</th>
                  <th className="px-6 py-3.5 text-left text-xs font-medium text-[#6B7280] uppercase">Completed</th>
                  <th className="px-6 py-3.5 text-left text-xs font-medium text-[#6B7280] uppercase">Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3F4F6]">
                {clientReport.clients.map((c) => (
                  <tr key={c.id} className="hover:bg-[#FAFAFA] transition-colors">
                    <td className="px-6 py-3.5">
                      <p className="text-sm font-medium text-[#111827]">{c.name}</p>
                      {c.company && <p className="text-xs text-[#9CA3AF]">{c.company}</p>}
                    </td>
                    <td className="px-6 py-3.5 text-sm text-[#6B7280] tabular-nums">{c.totalProjects}</td>
                    <td className="px-6 py-3.5 text-sm text-[#6B7280] tabular-nums">{c.completedProjects}</td>
                    <td className="px-6 py-3.5 text-sm font-medium text-[#111827] tabular-nums">{c.completionRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>
        </motion.div>
      )}
    </div>
  );
}

function MetricCard({ label, value, suffix, danger }: { label: string; value: string | number; suffix?: string; danger?: boolean }) {
  return (
    <div className="rounded-2xl border border-[#E5E7EB] bg-white p-5">
      <p className="text-xs text-[#6B7280] mb-1">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${danger ? 'text-[#EF4444]' : 'text-[#111827]'}`}>
        {value}
        {suffix && <span className="text-sm font-normal text-[#6B7280] ml-1">{suffix}</span>}
      </p>
    </div>
  );
}
