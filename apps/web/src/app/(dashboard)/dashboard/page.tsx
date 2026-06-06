'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { formatRelativeDate, formatDate, getInitials, getAvatarColor } from '@/lib/utils';
import { useAuthStore } from '@/stores';
import { useRouter } from 'next/navigation';
import { useDashboardData } from '@/hooks/useQueries';
import {
  Users, FolderKanban, CheckSquare, CheckCircle2,
  AlertTriangle, UsersRound, Clock, Activity as ActivityIcon,
  PieChart as PieIcon, BarChart as BarIcon
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar
} from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';

interface Stats {
  activeClients: number; activeProjects: number; openTasks: number;
  completedTasks: number; delayedProjects: number; totalMembers: number;
}
interface ActivityItem {
  id: string; message: string; createdAt: string;
  user: { id: string; name: string; avatar?: string | null };
}
interface Deadline {
  id: string; title: string; dueDate: string;
  project: { id: string; name: string };
  assignee?: { id: string; name: string } | null;
}
interface Workload { id: string; name: string; activeTasks: number; capacity: number; }
interface Velocity { name: string; tasks: number; }
interface StatusDist { name: string; value: number; }

const COLORS = ['#1D1D1F', '#86868B', '#D2D2D7', '#E5E5EA', '#F5F5F7'];

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.03 } } };
const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const } } };

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white/90 backdrop-blur-xl border border-[#E5E7EB] shadow-sm rounded-xl p-3 min-w-[120px]">
        <p className="text-[10px] font-bold text-[#86868B] mb-1.5 uppercase tracking-wider">{label || payload[0].name}</p>
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex justify-between gap-4 text-sm items-center">
            <span className="font-medium text-[#1D1D1F]">{entry.name || 'Value'}</span>
            <span className="font-semibold text-[#000000]">{entry.value}</span>
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

  const { data, refetch: fetchAll } = useDashboardData(user?.role);
  const { stats, activity = [], deadlines = [], velocity = [], statusDist = [], workload = [] } = data || {};

  useEffect(() => {
    if (user) {
      const socket = getSocket();
      if (socket) {
        const events = ['client:created', 'project:created', 'task:created', 'task:updated', 'project:updated'];
        events.forEach((e) => socket.on(e, fetchAll));
        return () => { events.forEach((e) => socket.off(e)); };
      }
    }
  }, [user, fetchAll]);

  if (!user) return null;

  if (!stats) {
    return (
      <div className="pb-8 max-w-[1400px] mx-auto">
        <div className="mb-6 flex items-baseline gap-3">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="p-4 md:p-5 rounded-2xl bg-white border border-[#E5E7EB]">
              <div className="flex items-center justify-between mb-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-8 rounded-xl" />
              </div>
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div className="lg:col-span-2 p-5 md:p-6 rounded-2xl bg-white border border-[#E5E7EB]">
            <div className="mb-4 flex items-center justify-between">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="h-[220px] w-full" />
          </div>
          <div className="p-5 md:p-6 rounded-2xl bg-white border border-[#E5E7EB]">
             <div className="mb-4 flex items-center justify-between">
               <Skeleton className="h-5 w-32" />
               <Skeleton className="h-4 w-4 rounded-full" />
             </div>
             <div className="space-y-3 mt-4">
               {[1, 2, 3, 4].map(i => (
                 <div key={i} className="flex justify-between items-center">
                   <div>
                     <Skeleton className="h-4 w-32 mb-1" />
                     <Skeleton className="h-3 w-20" />
                   </div>
                   <Skeleton className="h-6 w-16 rounded-md" />
                 </div>
               ))}
             </div>
          </div>
        </div>
      </div>
    );
  }

  const statCards = [];
  if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
    statCards.push(
      { label: 'Active Clients', value: stats.activeClients, icon: Users },
      { label: 'Active Projects', value: stats.activeProjects, icon: FolderKanban },
      { label: 'Delayed Projects', value: stats.delayedProjects, icon: AlertTriangle },
      { label: 'Team Members', value: stats.totalMembers, icon: UsersRound }
    );
  } else if (user.role === 'PROJECT_MANAGER') {
    statCards.push(
      { label: 'Active Projects', value: stats.activeProjects, icon: FolderKanban },
      { label: 'Open Tasks', value: stats.openTasks, icon: CheckSquare },
      { label: 'Completed Tasks', value: stats.completedTasks, icon: CheckCircle2 },
      { label: 'Delayed Projects', value: stats.delayedProjects, icon: AlertTriangle }
    );
  } else {
    statCards.push(
      { label: 'My Open Tasks', value: stats.openTasks, icon: CheckSquare },
      { label: 'My Completed Tasks', value: stats.completedTasks, icon: CheckCircle2 }
    );
  }

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="pb-8 max-w-[1400px] mx-auto">
      
      {/* Compact Header */}
      <motion.div variants={item} className="mb-6 flex items-baseline gap-3">
        <h1 className="text-2xl font-semibold text-[#1D1D1F] tracking-tight">Overview</h1>
        <p className="text-sm text-[#86868B] capitalize">{user.role.replace('_', ' ').toLowerCase()}</p>
      </motion.div>

      {/* KPI Grid */}
      <motion.div variants={item} className={`grid grid-cols-2 gap-4 mb-6 ${statCards.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-2'}`}>
        {statCards.map((card, i) => (
          <div
            key={card.label}
            className="flex flex-col p-4 md:p-5 rounded-2xl bg-white border border-[#E5E7EB] hover:shadow-sm transition-shadow duration-200"
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-[#86868B]">{card.label}</p>
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#F5F5F7]">
                <card.icon className="h-4 w-4 text-[#1D1D1F]" />
              </div>
            </div>
            <p className="text-3xl font-semibold text-[#1D1D1F] tracking-tight leading-none">{card.value}</p>
          </div>
        ))}
      </motion.div>

      {/* Row 1: Velocity & Deadlines */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        
        {/* TEAM_MEMBER Deadlines (Moved to top for Team Members) */}
        {user.role === 'TEAM_MEMBER' && (
          <motion.div variants={item} className="lg:col-span-3 p-5 md:p-6 rounded-2xl bg-white border border-[#E5E7EB] flex flex-col max-h-[300px]">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-[#1D1D1F] tracking-tight">Upcoming Deadlines</h2>
            </div>
            <div className="flex-1 overflow-y-auto pr-1 space-y-1 custom-scrollbar">
              {deadlines.length === 0 ? (
                <p className="text-sm text-[#86868B] py-2 text-center">No upcoming deadlines</p>
              ) : (
                deadlines.map((d) => (
                  <div key={d.id} onClick={() => router.push(`/projects/${d.project.id}`)} className="group flex items-center justify-between py-2 border-b border-[#F3F4F6] last:border-0 hover:bg-[#F9FAFB] -mx-3 px-3 transition-colors cursor-pointer rounded-xl">
                    <div className="flex-1 min-w-0 pr-3">
                      <p className="text-sm font-medium text-[#1D1D1F] truncate">{d.title}</p>
                      <p className="text-xs text-[#86868B] truncate">{d.project.name}</p>
                    </div>
                    <span className="text-xs font-medium text-[#1D1D1F] tabular-nums bg-[#F5F5F7] group-hover:bg-white px-2 py-1 rounded-md shrink-0 border border-[#E5E7EB] transition-colors">{formatDate(d.dueDate)}</span>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}

        {/* Task Velocity Area Chart */}
        <motion.div variants={item} className={`p-5 md:p-6 rounded-2xl bg-white border border-[#E5E7EB] ${user.role === 'TEAM_MEMBER' ? 'lg:col-span-3' : 'lg:col-span-2'}`}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-[#1D1D1F] tracking-tight">Task Velocity</h2>
            <p className="text-xs font-medium text-[#86868B]">Last 30 Days</p>
          </div>
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={velocity} margin={{ top: 5, right: 10, left: -25, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorTasks" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1D1D1F" stopOpacity={0.08}/>
                    <stop offset="95%" stopColor="#1D1D1F" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#86868B' }} dy={10} minTickGap={30} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#86868B' }} />
                <RechartsTooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="tasks" stroke="#1D1D1F" strokeWidth={2} fillOpacity={1} fill="url(#colorTasks)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Upcoming Deadlines (For Non-Team Members) */}
        {user.role !== 'TEAM_MEMBER' && (
          <motion.div variants={item} className="p-5 md:p-6 rounded-2xl bg-white border border-[#E5E7EB] flex flex-col max-h-[300px]">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-[#1D1D1F] tracking-tight">Upcoming Deadlines</h2>
              <Clock className="h-4 w-4 text-[#86868B]" />
            </div>
            <div className="flex-1 overflow-y-auto pr-1 space-y-1 custom-scrollbar">
              {deadlines.length === 0 ? (
                <p className="text-sm text-[#86868B] py-2 text-center">No upcoming deadlines</p>
              ) : (
                deadlines.map((d) => (
                  <div key={d.id} onClick={() => router.push(`/projects/${d.project.id}`)} className="group flex items-center justify-between py-2 border-b border-[#F3F4F6] last:border-0 hover:bg-[#F9FAFB] -mx-3 px-3 transition-colors cursor-pointer rounded-xl">
                    <div className="flex-1 min-w-0 pr-3">
                      <p className="text-sm font-medium text-[#1D1D1F] truncate">{d.title}</p>
                      <p className="text-xs text-[#86868B] truncate">{d.project.name}</p>
                    </div>
                    <span className="text-xs font-medium text-[#1D1D1F] tabular-nums bg-[#F5F5F7] group-hover:bg-white px-2 py-1 rounded-md shrink-0 border border-[#E5E7EB] transition-colors">{formatDate(d.dueDate)}</span>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </div>

      {/* Row 2: Workload & Project Status/Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Team Workload */}
        {(user.role === 'ADMIN' || user.role === 'SUPER_ADMIN' || user.role === 'PROJECT_MANAGER') && (
          <motion.div variants={item} className="p-5 md:p-6 rounded-2xl bg-white border border-[#E5E7EB] lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-[#1D1D1F] tracking-tight">Team Workload</h2>
              <p className="text-xs font-medium text-[#86868B]">Active Tasks</p>
            </div>
            <div className="h-[220px] w-full">
              {workload.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-[#86868B]">No team data available</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={workload} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#F3F4F6" />
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#1D1D1F', fontWeight: 500 }} width={100} />
                    <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: '#F9FAFB' }} />
                    <Bar dataKey="activeTasks" name="Tasks" fill="#1D1D1F" radius={[0, 4, 4, 0]} barSize={20}>
                      {workload.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.activeTasks > 10 ? '#86868B' : entry.activeTasks > 5 ? '#D2D2D7' : '#1D1D1F'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </motion.div>
        )}

        {/* Status & Activity Split (Moved Project Status to Row 2) */}
        {user.role !== 'TEAM_MEMBER' && (
          <div className="grid grid-cols-1 gap-6">
            
            {/* Project Status Donut */}
            <motion.div variants={item} className="p-5 md:p-6 rounded-2xl bg-white border border-[#E5E7EB] flex flex-col">
              <div className="mb-2">
                <h2 className="text-base font-semibold text-[#1D1D1F] tracking-tight">Project Status</h2>
              </div>
              <div className="flex-1 min-h-[160px] relative">
                {statusDist.length === 0 ? (
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-[#86868B]">No active projects</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusDist}
                        cx="50%" cy="50%"
                        innerRadius={55} outerRadius={75}
                        paddingAngle={2}
                        dataKey="value"
                        stroke="none"
                      >
                        {statusDist.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
              {/* Legend */}
              <div className="flex flex-wrap gap-x-3 gap-y-2 justify-center mt-2">
                {statusDist.map((entry, index) => (
                  <div key={entry.name} className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                    <span className="text-[10px] text-[#86868B] font-medium leading-none">{entry.name}</span>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Activity Feed */}
            <motion.div variants={item} className="p-5 md:p-6 rounded-2xl bg-white border border-[#E5E7EB] flex flex-col max-h-[300px]">
              <div className="mb-4">
                <h2 className="text-base font-semibold text-[#1D1D1F] tracking-tight">Recent Activity</h2>
              </div>
              <div className="flex-1 overflow-y-auto pr-1 space-y-4 custom-scrollbar">
                {activity.length === 0 ? (
                  <p className="text-sm text-[#86868B] py-2 text-center">No recent activity</p>
                ) : (
                  activity.map((a) => (
                    <div key={a.id} className="flex items-start gap-3">
                      <div className={`flex h-7 w-7 items-center justify-center rounded-full text-white text-[10px] font-bold shrink-0 ${getAvatarColor(a.user.name)}`}>
                        {getInitials(a.user.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[#1D1D1F] leading-snug">
                          <span className="font-semibold">{a.user.name}</span> {a.message}
                        </p>
                        <p className="text-[11px] text-[#86868B] mt-0.5">{formatRelativeDate(a.createdAt)}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>

          </div>
        )}

      </div>
      
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #D2D2D7; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #86868B; }
      `}} />
    </motion.div>
  );
}
