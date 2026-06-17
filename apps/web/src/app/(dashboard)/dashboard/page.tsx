'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { getSSE } from '@/lib/sse';
import { formatRelativeDate, formatDate, getInitials } from '@/lib/utils';
import { useAuthStore } from '@/stores';
import { useRouter } from 'next/navigation';
import { useDashboardData } from '@/hooks/useQueries';
import toast from 'react-hot-toast';
import { Select } from '@/components/ui/select';
import {
  Users, FolderKanban, CheckSquare, CheckCircle2, Building2, Activity, Zap,
  AlertTriangle, UsersRound, Clock, PieChart as PieIcon, BarChart as BarIcon, BellDot
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar
} from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';

// Strict Monochromatic Palette for Charts
const COLORS = ['#111827', '#4B5563', '#9CA3AF', '#D1D5DB', '#F3F4F6'];

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.03 } } };
const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const } } };

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white/95 backdrop-blur-xl border border-border shadow-md rounded-xl p-3 min-w-30">
        <p className="text-[10px] font-bold text-secondary mb-1.5 uppercase tracking-wider">{label || payload[0].name}</p>
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex justify-between gap-4 text-sm items-center">
            <span className="font-medium text-primary flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color || '#111827' }} />
              {entry.name || 'Value'}
            </span>
            <span className="font-semibold text-accent">{entry.value}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

export default function DashboardPage() {
  const { user } = useAuthStore();
  const router = useRouter();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data, refetch: fetchAll } = useDashboardData(user?.role);
  const { 
    stats, activity = [], deadlines = [], velocity = [], 
    statusDist = [], workload = [], myTasks = [], 
    pendingApprovals = [], clientHealth = [] 
  } = data || {};

  const [updatingTask, setUpdatingTask] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      const sse = getSSE();
      if (sse) {
        const events = ['client:created', 'project:created', 'task:created', 'task:updated', 'project:updated'];
        events.forEach((e) => sse.on(e, fetchAll));
        return () => { events.forEach((e) => sse.off(e)); };
      }
    }
  }, [user, fetchAll]);

  if (!user) return null;

  if (!stats) {
    return (
      <div className="pb-8 max-w-350 mx-auto p-4 md:p-8">
        <Skeleton className="h-8 w-48 mb-8" />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-30 rounded-2xl" />)}
        </div>
        <Skeleton className="h-100 rounded-2xl mb-8" />
      </div>
    );
  }

  const isManager = user.role !== 'TEAM_MEMBER';

  const handleOpenTask = async (taskId: string, readAt: string | null) => {
    if (!readAt) {
      try {
        await api.put(`/tasks/${taskId}`, { readAt: new Date().toISOString() });
        fetchAll();
      } catch (err) {}
    }
    router.push(`/tasks?taskId=${taskId}`);
  };

  const updateTaskStatus = async (taskId: string, status: string) => {
    setUpdatingTask(taskId);
    try {
      await api.put(`/tasks/${taskId}`, { status });
      toast.success('Task status updated');
      fetchAll();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update status');
    } finally {
      setUpdatingTask(null);
    }
  };

  const statusOptions = [
    { label: 'Backlog', value: 'BACKLOG' },
    { label: 'To Do', value: 'TODO' },
    { label: 'In Progress', value: 'IN_PROGRESS' },
    { label: 'In Review', value: 'REVIEW' },
    { label: 'Done', value: 'COMPLETED' },
  ];

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="pb-8 max-w-350 mx-auto p-4 md:p-8 space-y-8">
      
      {/* HEADER */}
      <motion.div variants={item} className="flex items-baseline gap-3">
        <h1 className="text-2xl font-semibold text-primary tracking-tight">Overview</h1>
        <p className="text-sm font-medium text-secondary">{user.role.replace('_', ' ').toLowerCase()}</p>
      </motion.div>

      {/* KPI GRID */}
      {isManager && (
        <motion.div variants={item} className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
          <div className="flex flex-col justify-between p-4 sm:p-5 rounded-2xl bg-white border border-border hover:shadow-sm transition-shadow h-full">
            <div className="flex items-start justify-between gap-2 mb-3"><p className="text-[11px] sm:text-xs font-medium text-secondary uppercase tracking-wide">Active Clients</p><Building2 className="w-4 h-4 shrink-0 text-[#9CA3AF]"/></div>
            <p className="text-3xl font-semibold text-primary">{stats.activeClients}</p>
          </div>
          <div className="flex flex-col justify-between p-4 sm:p-5 rounded-2xl bg-white border border-border hover:shadow-sm transition-shadow h-full">
            <div className="flex items-start justify-between gap-2 mb-3"><p className="text-[11px] sm:text-xs font-medium text-secondary uppercase tracking-wide">Active Projects</p><FolderKanban className="w-4 h-4 shrink-0 text-[#9CA3AF]"/></div>
            <p className="text-3xl font-semibold text-primary">{stats.activeProjects}</p>
          </div>
          <div className="flex flex-col justify-between p-4 sm:p-5 rounded-2xl bg-white border border-border hover:shadow-sm transition-shadow h-full">
            <div className="flex items-start justify-between gap-2 mb-3"><p className="text-[11px] sm:text-xs font-medium text-secondary uppercase tracking-wide">Delayed Projects</p><AlertTriangle className="w-4 h-4 shrink-0 text-[#9CA3AF]"/></div>
            <p className="text-3xl font-semibold text-primary">{stats.delayedProjects}</p>
          </div>
          <div className="flex flex-col justify-between p-4 sm:p-5 rounded-2xl bg-white border border-border hover:shadow-sm transition-shadow h-full">
            <div className="flex items-start justify-between gap-2 mb-3"><p className="text-[11px] sm:text-xs font-medium text-secondary uppercase tracking-wide">Team Members</p><UsersRound className="w-4 h-4 shrink-0 text-[#9CA3AF]"/></div>
            <p className="text-3xl font-semibold text-primary">{stats.totalMembers}</p>
          </div>
          <div onClick={() => router.push('/tasks?filter=overdue')} className="flex flex-col justify-between p-4 sm:p-5 rounded-2xl bg-white border border-border hover:shadow-sm transition-shadow cursor-pointer hover:bg-surface group h-full">
            <div className="flex items-start justify-between gap-2 mb-3"><p className="text-[11px] sm:text-xs font-medium text-secondary uppercase tracking-wide">Overdue Tasks</p><Clock className="w-4 h-4 shrink-0 text-[#9CA3AF]"/></div>
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${stats.overdueTasks > 0 ? 'bg-red-500' : 'bg-border'}`} />
              <p className={`text-3xl font-semibold ${stats.overdueTasks > 0 ? 'text-red-500' : 'text-primary'}`}>{stats.overdueTasks || 0}</p>
            </div>
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* LEFT COLUMN */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* MY TASKS */}
          <motion.div variants={item} className="rounded-2xl bg-white border border-border hover:shadow-sm transition-shadow flex flex-col">
            <div className="p-5 border-b border-border flex justify-between items-center">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-primary"><CheckSquare className="w-4 h-4 text-secondary"/> My Tasks</h2>
              <span className="text-xs font-medium text-secondary bg-surface border border-border px-2 py-0.5 rounded-md">{myTasks.length} Open</span>
            </div>
            <div className="flex-1 overflow-visible max-h-100 overflow-y-auto custom-scrollbar p-2">
              {myTasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <p className="text-sm font-medium text-secondary">You have no open tasks.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {myTasks.map((t: any) => (
                    <div 
                      key={t.id} 
                      className="group flex flex-col sm:flex-row sm:items-center justify-between p-3 hover:bg-surface rounded-xl transition-all border border-transparent hover:border-border"
                    >
                      <div 
                        onClick={() => handleOpenTask(t.id, t.readAt)}
                        className="flex items-start gap-3 min-w-0 flex-1 cursor-pointer"
                      >
                        {!t.readAt ? (
                          <div className="mt-1 shrink-0"><span className="flex h-2 w-2 rounded-full bg-primary" /></div>
                        ) : (
                          <div className="mt-1 shrink-0"><span className="flex h-2 w-2 rounded-full bg-border" /></div>
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-primary truncate">{t.title}</p>
                            {!t.readAt && <span className="text-[10px] font-bold text-primary border border-primary px-1 rounded-sm uppercase">New</span>}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-secondary">
                            <span>{t.project.name}</span>
                            {t.dueDate && (
                              <span className="flex items-center gap-1">
                                {new Date(t.dueDate) < todayStart && t.status !== 'COMPLETED' ? (
                                  <span className="text-red-500 font-semibold">&middot; Overdue ({formatDate(t.dueDate)})</span>
                                ) : (
                                  <span>&middot; {formatDate(t.dueDate)}</span>
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 sm:mt-0 sm:ml-4 shrink-0 flex items-center gap-2 w-35">
                        {updatingTask === t.id ? (
                          <span className="text-xs text-secondary w-full text-center">Updating...</span>
                        ) : (
                          <Select 
                            value={t.status}
                            onChange={(val) => updateTaskStatus(t.id, val)}
                            options={statusOptions}
                            className="w-full text-xs"
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>

          {/* PENDING APPROVALS */}
          {isManager && (
            <motion.div variants={item} className="rounded-2xl bg-white border border-border hover:shadow-sm transition-shadow overflow-hidden flex flex-col h-full">
              <div 
                onClick={() => router.push('/tasks?filter=approval')} 
                className="p-5 border-b border-border flex justify-between items-center cursor-pointer hover:bg-surface transition-colors"
              >
                <h2 className="flex items-center gap-2 text-sm font-semibold text-primary"><CheckCircle2 className="w-4 h-4 text-secondary"/> Pending Approvals</h2>
                {pendingApprovals.length > 0 && <span className="text-xs font-medium text-primary bg-[#F3F4F6] border border-border px-2 py-0.5 rounded-md">{pendingApprovals.length}</span>}
              </div>
              <div className="p-2 max-h-75 overflow-y-auto custom-scrollbar">
                {pendingApprovals.length === 0 ? (
                  <p className="text-sm text-secondary text-center py-6">No tasks waiting for review.</p>
                ) : (
                  <div className="space-y-1">
                    {pendingApprovals.map((t: any) => (
                      <div 
                        key={t.id} 
                        onClick={() => router.push(`/tasks?taskId=${t.id}`)}
                        className="flex items-center justify-between p-3 hover:bg-surface rounded-xl transition-all cursor-pointer border border-transparent hover:border-border"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {t.assignee && (
                            <div className="h-6 w-6 rounded-full bg-[#F3F4F6] text-primary text-[9px] font-bold flex items-center justify-center shrink-0 border border-border">
                              {getInitials(t.assignee.name)}
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-primary truncate">{t.title}</p>
                            <p className="text-xs text-secondary truncate">{t.project.name}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* CLIENT HEALTH SUMMARY */}
          {isManager && (
            <motion.div variants={item} className="rounded-2xl bg-white border border-border hover:shadow-sm transition-shadow overflow-hidden">
              <div className="p-5 border-b border-border">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-primary"><Activity className="w-4 h-4 text-secondary"/> Client Health</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left min-w-150">
                  <thead>
                    <tr className="border-b border-border bg-surface">
                      <th className="px-5 py-3 text-xs font-semibold text-secondary uppercase tracking-wider">Client</th>
                      <th className="px-5 py-3 text-xs font-semibold text-secondary uppercase tracking-wider text-center">Active Projects</th>
                      <th className="px-5 py-3 text-xs font-semibold text-secondary uppercase tracking-wider text-center">Overdue Tasks</th>
                      <th className="px-5 py-3 text-xs font-semibold text-secondary uppercase tracking-wider text-left">Next Deadline</th>
                      <th className="px-5 py-3 text-xs font-semibold text-secondary uppercase tracking-wider text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {clientHealth.map((c: any) => {
                      // Health indicators mapped to plain minimal dots
                      let dotColor = 'bg-emerald-500';
                      if (c.health === 'Amber') dotColor = 'bg-amber-500';
                      if (c.health === 'Red') dotColor = 'bg-red-500';
                      
                      return (
                        <tr key={c.id} onClick={() => router.push('/reports')} className="hover:bg-surface cursor-pointer transition-colors">
                          <td className="px-5 py-3 text-sm font-semibold text-primary">{c.name}</td>
                          <td className="px-5 py-3 text-sm text-primary text-center font-medium">{c.activeProjects}</td>
                          <td className="px-5 py-3 text-sm text-center text-primary">{c.overdueTasks > 0 ? c.overdueTasks : '-'}</td>
                          <td className="px-5 py-3 text-sm text-secondary">{c.nextDueDate ? formatDate(c.nextDueDate) : '-'}</td>
                          <td className="px-5 py-3 text-center">
                            <span className="flex items-center justify-center gap-1.5 text-xs text-primary font-medium">
                              <span className={`h-2 w-2 rounded-full ${dotColor}`} />
                              {c.health}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {clientHealth.length === 0 && (
                      <tr><td colSpan={5} className="px-5 py-6 text-center text-sm text-secondary">No active clients.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-6">
          
          {/* UPCOMING DEADLINES */}
          <motion.div variants={item} className="rounded-2xl bg-white border border-border hover:shadow-sm transition-shadow p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-primary mb-4"><Clock className="w-4 h-4 text-secondary"/> Upcoming Deadlines</h2>
            <div className="space-y-3 max-h-62.5 overflow-y-auto custom-scrollbar pr-1">
              {deadlines.length === 0 ? (
                <p className="text-sm text-secondary py-4">No deadlines in next 7 days.</p>
              ) : (
                deadlines.map((d: any) => (
                  <div key={d.id} onClick={() => router.push(`/projects/${d.project.id}`)} className="flex justify-between items-start p-2.5 hover:bg-surface rounded-xl cursor-pointer border border-border">
                    <div className="min-w-0 pr-3">
                      <p className="text-sm font-semibold text-primary truncate">{d.title}</p>
                      <p className="text-xs text-secondary truncate">{d.project.name}</p>
                    </div>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 border rounded-sm shrink-0 ${new Date(d.dueDate) < todayStart ? 'bg-red-50 text-red-600 border-red-200' : 'bg-[#F3F4F6] text-primary border-border'}`}>
                      {new Date(d.dueDate) < todayStart ? `OVERDUE: ${formatDate(d.dueDate)}` : formatDate(d.dueDate)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </motion.div>

          {/* TEAM WORKLOAD CHART */}
          {isManager && workload.length > 0 && (
            <motion.div variants={item} className="rounded-2xl bg-white border border-border hover:shadow-sm transition-shadow p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-primary mb-6"><BarIcon className="w-4 h-4 text-secondary"/> Team Workload</h2>
              <div className="h-50 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={workload} margin={{ top: 0, right: 0, left: -25, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6B7280' }} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6B7280' }} />
                    <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: '#FAFAFA' }} />
                    <Bar dataKey="activeTasks" name="Active Tasks" radius={[2, 2, 0, 0]}>
                      {workload.map((entry: any, index: number) => (
                        <Cell key={`cell-${index}`} fill={entry.activeTasks > 8 ? '#6B7280' : '#111827'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          )}

          {/* PROJECT STATUS CHART */}
          {isManager && statusDist.length > 0 && (
            <motion.div variants={item} className="rounded-2xl bg-white border border-border hover:shadow-sm transition-shadow p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-primary mb-2"><PieIcon className="w-4 h-4 text-secondary"/> Project Status</h2>
              <div className="h-50 w-full flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusDist} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value">
                      {statusDist.map((entry: any, index: number) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                    </Pie>
                    <RechartsTooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap justify-center gap-3 mt-2">
                {statusDist.map((entry: any, index: number) => (
                  <div key={entry.name} className="flex items-center gap-1.5 text-xs font-medium text-secondary">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                    {entry.name}
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* RECENT ACTIVITY */}
          {isManager && (
            <motion.div variants={item} className="rounded-2xl bg-white border border-border hover:shadow-sm transition-shadow p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-primary"><Zap className="w-4 h-4 text-secondary"/> Activity Feed</h2>
                <span className="flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-1.5 w-1.5 rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary"></span>
                </span>
              </div>
              <div className="space-y-4 max-h-75 overflow-y-auto custom-scrollbar pr-2 relative">
                {activity.length === 0 ? (
                   <p className="text-sm text-secondary">No recent activity.</p>
                ) : (
                  <div className="absolute left-2.5 top-2 bottom-2 w-px bg-border -z-10" />
                )}
                {activity.map((item: any) => (
                  <div key={item.id} className="flex gap-3 relative z-0">
                    <div className="h-5 w-5 rounded-full bg-surface border border-border text-primary text-[8px] font-bold flex items-center justify-center shrink-0">
                      {getInitials(item.user.name)}
                    </div>
                    <div className="pt-0.5">
                      <p className="text-xs text-[#374151] leading-tight">
                        <span className="font-semibold text-primary">{item.user.name}</span> {item.message}
                      </p>
                      <p className="text-[10px] text-[#9CA3AF] mt-0.5">{formatRelativeDate(item.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

        </div>
      </div>
    </motion.div>
  );
}
