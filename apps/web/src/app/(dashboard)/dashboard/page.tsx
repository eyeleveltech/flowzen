'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { getSSE } from '@/lib/sse';
import { formatRelativeDate, formatDate, formatShortDate, getInitials } from '@/lib/utils';
import { useAuthStore } from '@/stores';
import { useRouter } from 'next/navigation';
import { useDashboardData } from '@/hooks/useQueries';
import toast from 'react-hot-toast';
import { Select } from '@/components/ui/select';
import { ActivityFeedWidget } from '@/components/dashboard/activity-feed';
import {
  Users, FolderKanban, CheckSquare, CheckCircle2, Building2, Activity, Zap,
  AlertTriangle, UsersRound, Clock, PieChart as PieIcon, BarChart as BarIcon, BellDot, ChevronRight
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

const PendingApprovalItem = ({ task, onRefresh }: { task: any; onRefresh: () => void }) => {
  const router = useRouter();
  const [isRequestingChanges, setIsRequestingChanges] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleApprove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setSubmitting(true);
      await api.put(`/tasks/${task.id}`, { status: 'APPROVED' });
      toast.success('Task approved!');
      onRefresh();
    } catch (err: any) {
      toast.error(err.message || 'Failed to approve task');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestChangesClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsRequestingChanges(!isRequestingChanges);
  };

  const handleSubmitChanges = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!commentText.trim()) {
      toast.error('Please enter your feedback');
      return;
    }
    try {
      setSubmitting(true);
      // Move task to IN PROGRESS
      await api.put(`/tasks/${task.id}`, { status: 'IN_PROGRESS' });
      // Leave comment
      await api.post(`/tasks/${task.id}/comments`, { content: commentText.trim() });
      toast.success('Changes requested');
      setIsRequestingChanges(false);
      setCommentText('');
      onRefresh();
    } catch (err: any) {
      toast.error(err.message || 'Failed to request changes');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col border border-transparent hover:border-border rounded-xl transition-all hover:bg-surface mb-1">
      <div 
        onClick={() => router.push(`/tasks?taskId=${task.id}`)}
        className="flex flex-col p-3 cursor-pointer"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            {task.assignee && (
              <div className="h-8 w-8 rounded-full bg-[#F3F4F6] text-primary text-[10px] font-bold flex items-center justify-center shrink-0 border border-border mt-0.5">
                {getInitials(task.assignee.name)}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-primary truncate" title={task.title}>{task.title}</p>
              <div className="flex items-center gap-2 text-xs text-secondary mt-0.5">
                <span className="truncate max-w-[120px]" title={task.project?.name}>{task.project?.name}</span>
                <span>•</span>
                <span className="whitespace-nowrap">{formatRelativeDate(task.updatedAt)}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button 
              disabled={submitting}
              onClick={handleApprove}
              className="flex items-center justify-center h-8 w-8 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors"
              title="Approve"
            >
              <CheckCircle2 className="w-4 h-4" />
            </button>
            <button 
              disabled={submitting}
              onClick={handleRequestChangesClick}
              className={`flex items-center justify-center h-8 w-8 rounded-lg transition-colors ${isRequestingChanges ? 'bg-amber-100 text-amber-700' : 'bg-amber-50 text-amber-600 hover:bg-amber-100'}`}
              title="Request Changes"
            >
              <AlertTriangle className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
      
      {isRequestingChanges && (
        <div className="px-3 pb-3 pt-1" onClick={(e) => e.stopPropagation()}>
          <textarea
            autoFocus
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="What needs to be changed?"
            className="w-full text-sm border border-border rounded-lg p-2.5 outline-none focus:border-primary resize-none h-20 bg-white"
          />
          <div className="flex justify-end gap-2 mt-2">
            <button 
              disabled={submitting}
              onClick={() => setIsRequestingChanges(false)}
              className="px-3 py-1.5 text-xs font-medium text-secondary hover:text-primary transition-colors"
            >
              Cancel
            </button>
            <button 
              disabled={submitting || !commentText.trim()}
              onClick={handleSubmitChanges}
              className="px-3 py-1.5 text-xs font-medium text-white bg-primary rounded-lg hover:bg-[#1F2937] transition-colors disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Submit Feedback'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default function DashboardPage() {
  const { user } = useAuthStore();
  const router = useRouter();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [datePreset, setDatePreset] = useState('all_time');
  const [customRange, setCustomRange] = useState({ start: '', end: '' });

  // Calculate actual startDate and endDate based on preset
  const getDateRange = () => {
    if (datePreset === 'all_time') {
      return { startDate: undefined, endDate: undefined };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    if (datePreset === 'today') {
      return { startDate: today.toISOString(), endDate: endOfToday.toISOString() };
    }
    if (datePreset === 'this_week') {
      const start = new Date(today);
      start.setDate(today.getDate() - today.getDay());
      return { startDate: start.toISOString(), endDate: endOfToday.toISOString() };
    }
    if (datePreset === 'this_month') {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { startDate: start.toISOString(), endDate: endOfToday.toISOString() };
    }
    if (datePreset === 'last_30') {
      const start = new Date(today);
      start.setDate(today.getDate() - 29);
      return { startDate: start.toISOString(), endDate: endOfToday.toISOString() };
    }
    if (datePreset === 'last_quarter') {
      const start = new Date(today);
      start.setMonth(today.getMonth() - 3);
      return { startDate: start.toISOString(), endDate: endOfToday.toISOString() };
    }
    if (datePreset === 'custom' && customRange.start && customRange.end) {
      const start = new Date(customRange.start);
      start.setHours(0, 0, 0, 0);
      const end = new Date(customRange.end);
      end.setHours(23, 59, 59, 999);
      return { startDate: start.toISOString(), endDate: end.toISOString() };
    }
    
    // Default fallback
    return { startDate: undefined, endDate: undefined };
  };

  const { data, refetch: fetchAll } = useDashboardData(user?.role, getDateRange());
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
    { label: 'Approved', value: 'APPROVED' },
    { label: 'Blocked', value: 'BLOCKED' },
    { label: 'Done', value: 'COMPLETED' },
  ];

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="px-4 pt-4 md:px-8 md:pt-8 w-full max-w-7xl mx-auto space-y-8 pb-10">
      
      {/* HEADER */}
      <motion.div variants={item} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold text-primary tracking-tight">Overview</h1>
          <p className="text-sm font-medium text-secondary">{user.role.replace('_', ' ').toLowerCase()}</p>
        </div>
        
        {/* DATE RANGE FILTER */}
        <div className="flex items-center gap-3">
          {datePreset === 'custom' && (
            <div className="flex items-center gap-2">
              <input 
                type="date" 
                value={customRange.start} 
                onChange={(e) => setCustomRange(prev => ({ ...prev, start: e.target.value }))}
                className="text-sm px-3 py-2 border border-border rounded-lg bg-white outline-none focus:border-primary"
              />
              <span className="text-secondary">-</span>
              <input 
                type="date" 
                value={customRange.end} 
                onChange={(e) => setCustomRange(prev => ({ ...prev, end: e.target.value }))}
                className="text-sm px-3 py-2 border border-border rounded-lg bg-white outline-none focus:border-primary"
              />
            </div>
          )}
          <Select 
            value={datePreset} 
            onChange={setDatePreset} 
            options={[
              { label: 'All Time', value: 'all_time' },
              { label: 'Today', value: 'today' },
              { label: 'This Week', value: 'this_week' },
              { label: 'This Month', value: 'this_month' },
              { label: 'Last 30 Days', value: 'last_30' },
              { label: 'Last Quarter', value: 'last_quarter' },
              { label: 'Custom Range', value: 'custom' },
            ]}
            className="w-44"
          />
        </div>
      </motion.div>

      {/* KPI GRID */}
      {isManager && (
        <motion.div variants={item} className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
          <div onClick={() => router.push('/clients?status=ACTIVE')} className="flex flex-col justify-between p-4 sm:p-5 rounded-2xl bg-white border border-border hover:shadow-sm transition-shadow h-full cursor-pointer hover:bg-surface group">
            <div className="flex items-start justify-between gap-2 mb-3"><p className="text-[11px] sm:text-xs font-medium text-secondary uppercase tracking-wide group-hover:text-primary transition-colors">Active Clients</p><Building2 className="w-4 h-4 shrink-0 text-[#9CA3AF] group-hover:text-primary transition-colors"/></div>
            <p className="text-3xl font-semibold text-primary">{stats.activeClients}</p>
          </div>
          <div onClick={() => router.push('/projects?status=ACTIVE')} className="flex flex-col justify-between p-4 sm:p-5 rounded-2xl bg-white border border-border hover:shadow-sm transition-shadow h-full cursor-pointer hover:bg-surface group">
            <div className="flex items-start justify-between gap-2 mb-3"><p className="text-[11px] sm:text-xs font-medium text-secondary uppercase tracking-wide group-hover:text-primary transition-colors">Active Projects</p><FolderKanban className="w-4 h-4 shrink-0 text-[#9CA3AF] group-hover:text-primary transition-colors"/></div>
            <p className="text-3xl font-semibold text-primary">{stats.activeProjects}</p>
          </div>
          <div onClick={() => router.push('/projects?status=DELAYED')} className="flex flex-col justify-between p-4 sm:p-5 rounded-2xl bg-white border border-border hover:shadow-sm transition-shadow h-full cursor-pointer hover:bg-surface group">
            <div className="flex items-start justify-between gap-2 mb-3"><p className="text-[11px] sm:text-xs font-medium text-secondary uppercase tracking-wide group-hover:text-primary transition-colors">Delayed Projects</p><AlertTriangle className="w-4 h-4 shrink-0 text-[#9CA3AF] group-hover:text-primary transition-colors"/></div>
            <p className="text-3xl font-semibold text-primary">{stats.delayedProjects}</p>
          </div>
          <div onClick={() => router.push('/team')} className="flex flex-col justify-between p-4 sm:p-5 rounded-2xl bg-white border border-border hover:shadow-sm transition-shadow h-full cursor-pointer hover:bg-surface group">
            <div className="flex items-start justify-between gap-2 mb-3"><p className="text-[11px] sm:text-xs font-medium text-secondary uppercase tracking-wide group-hover:text-primary transition-colors">Team Members</p><UsersRound className="w-4 h-4 shrink-0 text-[#9CA3AF] group-hover:text-primary transition-colors"/></div>
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
                            <span>{t.project?.name || 'No project'}</span>
                            {t.dueDate && (
                              <span className="flex items-center gap-1">
                                {new Date(t.dueDate) < todayStart && t.status !== 'COMPLETED' ? (
                                  <span className="text-red-500 font-semibold">&middot; Overdue ({formatShortDate(t.dueDate)})</span>
                                ) : (
                                  <span>&middot; {formatShortDate(t.dueDate)}</span>
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
            <motion.div variants={item} className="rounded-2xl bg-white border border-border hover:shadow-sm transition-shadow overflow-hidden flex flex-col">
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
                      <PendingApprovalItem key={t.id} task={t} onRefresh={fetchAll} />
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

          {/* VELOCITY TREND CHART */}
          {isManager && velocity.length > 0 && (
            <motion.div variants={item} className="rounded-2xl bg-white border border-border hover:shadow-sm transition-shadow p-5">
              <div className="flex items-center justify-between mb-6">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-primary"><Activity className="w-4 h-4 text-secondary"/> Task Completion Velocity</h2>
                <span className="text-xs font-medium text-secondary">Last 30 Days</span>
              </div>
              <div className="w-full relative" style={{ height: 256 }}>
                <ResponsiveContainer width="100%" height={256}>
                  <AreaChart data={velocity} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorTasks" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#111827" stopOpacity={0.1}/>
                        <stop offset="95%" stopColor="#111827" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                    <XAxis 
                      dataKey="name" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 10, fill: '#9CA3AF' }} 
                      dy={10} 
                      minTickGap={20}
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 10, fill: '#9CA3AF' }} 
                      allowDecimals={false}
                    />
                    <RechartsTooltip content={<CustomTooltip />} cursor={{ stroke: '#D1D5DB', strokeWidth: 1, strokeDasharray: '4 4' }} />
                    <Area 
                      type="monotone" 
                      dataKey="tasks" 
                      name="Completed Tasks" 
                      stroke="#111827" 
                      strokeWidth={2}
                      fillOpacity={1} 
                      fill="url(#colorTasks)" 
                      activeDot={{ r: 4, strokeWidth: 0, fill: '#111827' }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          )}

        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-6">
          
          {/* UPCOMING DEADLINES */}
          <motion.div variants={item} className="rounded-2xl bg-white border border-border hover:shadow-sm transition-shadow p-5 flex flex-col">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-primary mb-4"><Clock className="w-4 h-4 text-secondary"/> Upcoming Deadlines</h2>
            <div className="space-y-3 max-h-62.5 overflow-y-auto custom-scrollbar pr-1 flex-1">
              {deadlines.length === 0 ? (
                <p className="text-sm text-secondary py-4">No deadlines in next 7 days.</p>
              ) : (
                deadlines.map((d: any) => {
                  const daysRemaining = Math.ceil((new Date(d.dueDate).getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24));
                  let dotColor = 'bg-[#9CA3AF]'; // Grey for 4+ days
                  if (daysRemaining <= 1) dotColor = 'bg-[#EF4444] animate-pulse'; // Red for <= 1 day
                  else if (daysRemaining <= 3) dotColor = 'bg-[#F59E0B]'; // Orange for <= 3 days

                  return (
                    <div 
                      key={d.id} 
                      onClick={() => handleOpenTask(d.id, null)} 
                      title={`${d.title} (${d.project?.name || 'No project'})`}
                      className="flex justify-between items-start p-2.5 hover:bg-surface rounded-xl cursor-pointer border border-border group transition-all"
                    >
                      <div className="min-w-0 pr-3 flex gap-2.5 items-start">
                        <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${dotColor}`} />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-primary truncate group-hover:text-black transition-colors">{d.title}</p>
                          <p className="text-xs text-secondary truncate">{d.project?.name || 'No project'}</p>
                        </div>
                      </div>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 border rounded-sm shrink-0 ${new Date(d.dueDate) < todayStart ? 'bg-red-50 text-red-600 border-red-200' : 'bg-[#F3F4F6] text-primary border-border'}`}>
                        {new Date(d.dueDate) < todayStart ? `OVERDUE: ${formatShortDate(d.dueDate)}` : formatShortDate(d.dueDate)}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
            {deadlines.length > 0 && (
              <div className="mt-4 pt-3 border-t border-border flex justify-center">
                <button onClick={() => router.push('/calendar')} className="text-xs font-semibold text-secondary hover:text-primary transition-colors flex items-center gap-1">
                  View All in Calendar <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            )}
          </motion.div>

          {/* TEAM WORKLOAD CHART */}
          {isManager && workload.length > 0 && (
            <motion.div variants={item} className="rounded-2xl bg-white border border-border hover:shadow-sm transition-shadow p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-primary mb-6"><BarIcon className="w-4 h-4 text-secondary"/> Team Workload</h2>
              <div className="h-50 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={workload} margin={{ top: 10, right: 10, left: 25, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                    <XAxis 
                      dataKey="name" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 10, fill: '#6B7280' }} 
                      dy={10} 
                      tickFormatter={(name) => typeof name === 'string' ? name.split(' ')[0] : name} 
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 10, fill: '#6B7280' }} 
                      label={{ value: 'Active Tasks', angle: -90, position: 'insideLeft', offset: -10, style: { fontSize: 10, fill: '#6B7280' } }}
                    />
                    <RechartsTooltip 
                      cursor={{ fill: '#FAFAFA' }} 
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="bg-white/95 backdrop-blur-xl border border-border shadow-md rounded-xl p-3 min-w-30">
                              <p className="text-[10px] font-bold text-secondary mb-1.5 uppercase tracking-wider">{data.name}</p>
                              <div className="flex justify-between gap-4 text-sm items-center mb-1">
                                <span className="font-medium text-primary">Active Tasks</span>
                                <span className="font-semibold text-accent">{data.activeTasks}</span>
                              </div>
                              <div className="flex justify-between gap-4 text-sm items-center">
                                <span className="font-medium text-primary">Completion Rate</span>
                                <span className="font-semibold text-accent">{data.completionRate}%</span>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Bar 
                      dataKey="activeTasks" 
                      name="Active Tasks" 
                      radius={[2, 2, 0, 0]}
                      maxBarSize={50}
                      onClick={(data) => router.push(`/team?memberId=${data.id}`)}
                      className="cursor-pointer"
                    >
                      {workload.map((entry: any, index: number) => (
                        <Cell key={`cell-${index}`} fill={entry.activeTasks > 8 ? '#6B7280' : '#111827'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          )}

          {/* TASK STATUS CHART */}
          {isManager && statusDist.length > 0 && (
            <motion.div variants={item} className="rounded-2xl bg-white border border-border hover:shadow-sm transition-shadow p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-primary mb-2"><PieIcon className="w-4 h-4 text-secondary"/> Task Status Distribution</h2>
              <div className="h-50 w-full flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusDist} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value">
                      {statusDist.map((entry: any, index: number) => <Cell key={`cell-${index}`} fill={entry.color || COLORS[index % COLORS.length]} />)}
                    </Pie>
                    <RechartsTooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap justify-center gap-3 mt-2">
                {statusDist.map((entry: any, index: number) => (
                  <div key={entry.name} className="flex items-center gap-1.5 text-xs font-medium text-secondary">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color || COLORS[index % COLORS.length] }} />
                    {entry.name} — {entry.value}
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* RECENT ACTIVITY */}
          {isManager && (
            <ActivityFeedWidget itemVariants={item} />
          )}

        </div>
      </div>
      
      {/* EXPLICIT BOTTOM SPACER */}
      <div className="h-24 md:h-32 w-full shrink-0" aria-hidden="true" />
    </motion.div>
  );
}
