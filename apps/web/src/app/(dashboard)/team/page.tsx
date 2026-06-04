'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import { getInitials, getAvatarColor } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import { 
  Search, Mail, Phone, Calendar, Briefcase, 
  CheckCircle2, Clock, X, ChevronRight, Shield, 
  Activity, FileText, Sparkles, AlertCircle, Folder, User, Zap, Leaf
} from 'lucide-react';

interface TeamMember {
  id: string; name: string; email: string; avatar?: string | null;
  role: string; department?: string | null; phone?: string | null;
  totalTasks: number; totalProjects: number; activeTasks: number; capacity: number;
}

interface TaskDetail {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate?: string | null;
  project: { id: string; name: string };
}

interface ProjectDetail {
  id: string;
  name: string;
  status: string;
  client?: { id: string; name: string } | null;
  _count: { tasks: number };
}

interface MemberDetail {
  id: string;
  name: string;
  email: string;
  avatar?: string | null;
  role: string;
  department?: string | null;
  phone?: string | null;
  joiningDate?: string | null;
  assignedTasks: TaskDetail[];
  ownedProjects: ProjectDetail[];
  stats: {
    totalTasks: number;
    activeTasks: number;
    completedTasks: number;
    totalProjects: number;
    capacity: number;
  };
}

const roleLabels: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin', 
  ADMIN: 'Admin', 
  PROJECT_MANAGER: 'Project Manager', 
  TEAM_MEMBER: 'Team Member',
};

const statusColors: Record<string, string> = {
  BACKLOG: 'bg-gray-100 text-gray-600',
  TODO: 'bg-slate-100 text-slate-700',
  IN_PROGRESS: 'bg-blue-50 text-blue-700 border-blue-100',
  REVIEW: 'bg-amber-50 text-amber-700 border-amber-100',
  BLOCKED: 'bg-red-50 text-red-700 border-red-100',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-100',
};

export default function TeamPage() {
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Search and Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRole, setSelectedRole] = useState('');
  const [selectedDept, setSelectedDept] = useState('');

  // Selected Member Details
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [memberDetail, setMemberDetail] = useState<MemberDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'tasks' | 'profile'>('tasks');

  // Fetch Team List
  const fetchTeam = useCallback(() => {
    setLoading(true);
    api.get<TeamMember[]>('/team')
      .then(setTeam)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchTeam();
  }, [fetchTeam]);

  // Fetch Member Details on Selection
  useEffect(() => {
    if (!selectedId) {
      setMemberDetail(null);
      return;
    }
    setDetailLoading(true);
    api.get<MemberDetail>(`/team/${selectedId}`)
      .then((data) => {
        setMemberDetail(data);
        setActiveTab('tasks'); // reset to tasks tab on new select
      })
      .catch(() => setSelectedId(null))
      .finally(() => setDetailLoading(false));
  }, [selectedId]);

  // Filtered members list
  const filteredTeam = team.filter((m) => {
    const matchesSearch = m.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          m.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (m.department && m.department.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesRole = selectedRole ? m.role === selectedRole : true;
    const matchesDept = selectedDept ? m.department === selectedDept : true;
    return matchesSearch && matchesRole && matchesDept;
  });

  // Extract unique departments for dropdown
  const departments = Array.from(
    new Set(team.map((m) => m.department).filter(Boolean))
  ) as string[];

  // Render detail inspector content
  const renderInspector = () => {
    if (detailLoading) return <SidebarSkeleton />;
    if (!memberDetail) {
      return (
        <div className="h-[550px] flex flex-col items-center justify-center text-center p-8 bg-gray-50/50 rounded-3xl border border-dashed border-[#E5E7EB]">
          <div className="h-14 w-14 rounded-2xl bg-white flex items-center justify-center shadow-xs border border-[#E5E7EB]/60 text-[#9CA3AF] mb-5">
            <Sparkles className="h-6 w-6 text-indigo-500" />
          </div>
          <h3 className="text-sm font-semibold text-[#111827]">Workload Inspector</h3>
          <p className="text-xs text-[#86868B] max-w-[260px] mt-2 leading-relaxed">
            Select a team member from the dashboard to inspect their active assignments, led projects, and performance statistics.
          </p>
        </div>
      );
    }

    const { name, email, role, department, phone, joiningDate, assignedTasks, ownedProjects, stats } = memberDetail;
    const activeTasks = assignedTasks.filter((t) => t.status !== 'COMPLETED');

    return (
      <div className="space-y-6">
        {/* Profile Card Header */}
        <div className="flex items-center gap-4">
          <div className={`h-16 w-16 rounded-2xl text-white flex items-center justify-center font-bold text-2xl shadow-md border border-white shrink-0 ${getAvatarColor(name)}`}>
            {getInitials(name)}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-[#111827] truncate leading-5">{name}</h2>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-0.5 rounded-md bg-gray-100 text-gray-800 border border-gray-200">
                <Shield className="h-3 w-3" />
                {roleLabels[role] || role}
              </span>
              {department && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-100">
                  <Briefcase className="h-3 w-3" />
                  {department}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Tab Buttons */}
        <div className="flex bg-[#F3F4F6] p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('tasks')}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
              activeTab === 'tasks' 
                ? 'bg-white text-[#111827] shadow-xs' 
                : 'text-[#6B7280] hover:text-[#111827]'
            }`}
          >
            Tasks & Projects ({activeTasks.length + ownedProjects.length})
          </button>
          <button
            onClick={() => setActiveTab('profile')}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
              activeTab === 'profile' 
                ? 'bg-white text-[#111827] shadow-xs' 
                : 'text-[#6B7280] hover:text-[#111827]'
            }`}
          >
            Bio & Statistics
          </button>
        </div>

        {/* Dynamic Tab Contents */}
        <AnimatePresence mode="wait">
          {activeTab === 'tasks' ? (
            <motion.div
              key="tasks-tab"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.15 }}
              className="space-y-6"
            >
              {/* Capacity Bar */}
              <div className="bg-[#FAFAFA] p-5 rounded-2xl border border-[#E5E7EB]/80">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-[#111827]">Workload Allocation</span>
                  <span className="text-xs font-extrabold text-[#111827] tabular-nums">{stats.capacity}%</span>
                </div>
                <div className="h-2 w-full rounded-full bg-[#E5E7EB] overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      stats.capacity > 80 ? 'bg-red-500' : stats.capacity > 50 ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${stats.capacity}%` }}
                  />
                </div>
                <div className="flex items-center text-[10px] text-[#86868B] mt-2.5 font-medium">
                  {stats.capacity > 80 ? (
                    <><AlertCircle className="w-3.5 h-3.5 text-red-500 mr-1.5" /> Critical capacity. Nearing overload, consider offloading.</>
                  ) : stats.capacity > 50 ? (
                    <><Zap className="w-3.5 h-3.5 text-amber-500 mr-1.5" /> Active workload. Capable of handling smaller tasks.</>
                  ) : (
                    <><Leaf className="w-3.5 h-3.5 text-emerald-500 mr-1.5" /> High availability. Ready for assignments.</>
                  )}
                </div>
              </div>

              {/* Active Tasks List */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Activity className="h-4 w-4 text-[#111827]" />
                  <h3 className="text-xs font-bold text-[#111827] uppercase tracking-wider">Active Tasks ({activeTasks.length})</h3>
                </div>
                <div className="space-y-2.5 max-h-[220px] overflow-y-auto pr-1">
                  {activeTasks.map((t) => (
                    <div 
                      key={t.id} 
                      className="p-3.5 bg-white border border-[#E5E7EB] rounded-xl hover:border-gray-300 transition-colors shadow-xs"
                    >
                      <div className="flex justify-between items-start gap-2 mb-2">
                        <h4 className="text-xs font-bold text-[#111827] line-clamp-1">{t.title}</h4>
                        <span className={`shrink-0 text-[9px] font-bold px-2 py-0.5 rounded-sm border ${statusColors[t.status] || ''}`}>
                          {t.status.replace('_', ' ')}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-[10px] text-[#9CA3AF]">
                        <span className="truncate max-w-[170px] font-semibold text-[#6B7280] flex items-center gap-1.5">
                          <Folder className="h-3 w-3" />
                          {t.project.name}
                        </span>
                        {t.dueDate && (
                          <span className="tabular-nums font-medium text-[#86868B] flex items-center gap-1.5">
                            <Calendar className="h-3 w-3" />
                            {new Date(t.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  {activeTasks.length === 0 && (
                    <p className="text-xs text-[#9CA3AF] italic text-center py-6 bg-gray-50/50 rounded-xl border border-dashed border-[#E5E7EB]">
                      No active tasks assigned
                    </p>
                  )}
                </div>
              </div>

              {/* Led Projects List */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <FileText className="h-4 w-4 text-[#111827]" />
                  <h3 className="text-xs font-bold text-[#111827] uppercase tracking-wider">Led Projects ({ownedProjects.length})</h3>
                </div>
                <div className="space-y-2.5 max-h-[180px] overflow-y-auto pr-1">
                  {ownedProjects.map((p) => (
                    <div 
                      key={p.id}
                      className="p-3.5 bg-white border border-[#E5E7EB] rounded-xl hover:border-gray-300 transition-colors shadow-xs"
                    >
                      <h4 className="text-xs font-bold text-[#111827] line-clamp-1">{p.name}</h4>
                      <div className="flex justify-between items-center text-[10px] text-[#9CA3AF] mt-2">
                        <span className="truncate max-w-[170px] font-medium flex items-center gap-1.5">
                          <User className="h-3 w-3" />
                          {p.client?.name || 'Internal'}
                        </span>
                        <span className="font-semibold text-[#6B7280]">
                          {p._count.tasks} tasks
                        </span>
                      </div>
                    </div>
                  ))}
                  {ownedProjects.length === 0 && (
                    <p className="text-xs text-[#9CA3AF] italic text-center py-6 bg-gray-50/50 rounded-xl border border-dashed border-[#E5E7EB]">
                      No led projects assigned
                    </p>
                  )}
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="profile-tab"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.15 }}
              className="space-y-6"
            >
              {/* Contact Info Card */}
              <div className="bg-[#FAFAFA] rounded-2xl p-5 border border-[#E5E7EB]/80 space-y-3.5 text-xs text-[#4B5563]">
                <h4 className="text-[10px] text-[#86868B] font-bold uppercase tracking-wider mb-1">Contact Information</h4>
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-[#9CA3AF]" />
                  <a href={`mailto:${email}`} className="hover:underline hover:text-[#111827] font-medium truncate">{email}</a>
                </div>
                {phone && (
                  <div className="flex items-center gap-3">
                    <Phone className="h-4 w-4 text-[#9CA3AF]" />
                    <span className="tabular-nums font-medium">{phone}</span>
                  </div>
                )}
                {joiningDate && (
                  <div className="flex items-center gap-3">
                    <Calendar className="h-4 w-4 text-[#9CA3AF]" />
                    <span className="font-medium">Joined {new Date(joiningDate).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                  </div>
                )}
              </div>

              {/* Statistics Panel */}
              <div>
                <h3 className="text-xs font-bold text-[#111827] uppercase tracking-wider mb-3">Overall Performance</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white p-4 rounded-2xl border border-[#E5E7EB] shadow-xs">
                    <span className="text-[10px] text-[#86868B] font-bold uppercase tracking-wider block mb-1">Active Tasks</span>
                    <p className="text-2xl font-black text-[#111827] tabular-nums">{stats.activeTasks}</p>
                  </div>
                  <div className="bg-white p-4 rounded-2xl border border-[#E5E7EB] shadow-xs">
                    <span className="text-[10px] text-[#86868B] font-bold uppercase tracking-wider block mb-1">Completed</span>
                    <p className="text-2xl font-black text-emerald-600 tabular-nums">{stats.completedTasks}</p>
                  </div>
                  <div className="bg-white p-4 rounded-2xl border border-[#E5E7EB] shadow-xs">
                    <span className="text-[10px] text-[#86868B] font-bold uppercase tracking-wider block mb-1">Total Assigned</span>
                    <p className="text-2xl font-black text-[#111827] tabular-nums">{stats.totalTasks}</p>
                  </div>
                  <div className="bg-white p-4 rounded-2xl border border-[#E5E7EB] shadow-xs">
                    <span className="text-[10px] text-[#86868B] font-bold uppercase tracking-wider block mb-1">Led Projects</span>
                    <p className="text-2xl font-black text-blue-600 tabular-nums">{stats.totalProjects}</p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <div className="max-w-[1400px] mx-auto p-4 md:p-8">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#111827] tracking-tight">Team Workspace</h1>
        <p className="text-sm text-[#6B7280] mt-1">Monitor capacity, active workloads, and individual output of your team.</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-8 items-start">
        {/* Left Side: Members Card Grid (2 Columns on Desktop for Spacing) */}
        <div className="flex-1 min-w-0 w-full space-y-6">
          {/* Controls Bar */}
          <div className="flex flex-col sm:flex-row gap-4 bg-[#FAFAFA] p-4 rounded-2xl border border-[#E5E7EB]/80">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
              <input
                type="text"
                placeholder="Search team by name, email, department..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 text-sm bg-white rounded-xl border border-[#E5E7EB] outline-none focus:border-[#111827] focus:ring-1 focus:ring-[#111827] transition-all"
              />
            </div>

            {/* Department Filter */}
            <Select
              value={selectedDept}
              onChange={setSelectedDept}
              placeholder="All Departments"
              options={[
                { label: 'All Departments', value: '' },
                ...departments.map((d) => ({ label: d, value: d }))
              ]}
              className="w-full sm:w-48 font-semibold z-20"
            />

            {/* Role Filter */}
            <Select
              value={selectedRole}
              onChange={setSelectedRole}
              placeholder="All Roles"
              options={[
                { label: 'All Roles', value: '' },
                ...Object.entries(roleLabels).map(([val, label]) => ({ label, value: val }))
              ]}
              className="w-full sm:w-48 font-semibold z-10"
            />
          </div>

          {/* Grid Loading State */}
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="h-56 w-full bg-gray-50 border border-gray-100 rounded-3xl animate-pulse" />
              ))}
            </div>
          ) : (
            /* Members Card Grid */
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {filteredTeam.map((m) => {
                const isSelected = selectedId === m.id;
                return (
                  <div
                    key={m.id}
                    onClick={() => setSelectedId(m.id)}
                    className={`group relative flex flex-col p-6 rounded-[1.5rem] bg-white cursor-pointer transition-all duration-300 ${
                      isSelected 
                        ? 'shadow-[0_0_0_2px_#111827]' 
                        : 'shadow-[0_2px_10px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.04] hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)] hover:-translate-y-0.5'
                    }`}
                  >
                    <div className="flex items-center gap-4 mb-5">
                      {/* Avatar */}
                      <div className={`h-12 w-12 rounded-[1rem] text-white flex items-center justify-center font-medium text-lg shadow-inner shrink-0 ${getAvatarColor(m.name)}`}>
                        {getInitials(m.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-[15px] font-semibold text-[#111827] truncate leading-snug group-hover:text-black transition-colors">{m.name}</h3>
                        <p className="text-[13px] text-[#86868B] truncate mt-0.5">
                          {roleLabels[m.role] || m.role}
                          {m.department && <span className="mx-1.5 opacity-50">·</span>}
                          {m.department && m.department}
                        </p>
                      </div>
                    </div>

                    <div className="mt-auto pt-4 border-t border-[#F3F4F6] flex items-center justify-between text-[13px]">
                      <div className="flex items-center gap-3 text-[#86868B]">
                        <span className="flex items-center gap-1">
                           <span className="font-semibold text-[#111827]">{m.activeTasks}</span> 
                           <span className="opacity-80">tasks</span>
                        </span>
                        <span className="w-0.5 h-0.5 rounded-full bg-[#D1D5DB]"></span>
                        <span className="flex items-center gap-1">
                           <span className="font-semibold text-[#111827]">{m.totalProjects}</span> 
                           <span className="opacity-80">projects</span>
                        </span>
                      </div>
                      
                      {/* Minimal Capacity Dot */}
                      <div className="flex items-center gap-1.5" title={`Capacity: ${m.capacity}%`}>
                        <div className={`w-2 h-2 rounded-full shadow-sm ${
                          m.capacity > 80 ? 'bg-red-500' : m.capacity > 50 ? 'bg-amber-500' : 'bg-emerald-500'
                        }`} />
                        <span className="text-[#86868B] font-medium">{m.capacity}%</span>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Empty State Grid */}
              {filteredTeam.length === 0 && (
                <div className="col-span-full py-20 text-center bg-white rounded-3xl border border-dashed border-[#E5E7EB]">
                  <AlertCircle className="h-10 w-10 text-[#9CA3AF] mx-auto mb-4" />
                  <p className="text-sm font-semibold text-[#111827]">No members match search query</p>
                  <p className="text-xs text-[#86868B] mt-1.5">Try resetting the department or role filters.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Slide-over sheet Drawer (Universal) */}
      <AnimatePresence>
        {selectedId && (
          <div className="fixed inset-0 z-50 flex justify-end">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedId(null)}
              className="absolute inset-0 bg-black/30 backdrop-blur-xs"
            />

            {/* Panel */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              className="relative w-full max-w-md bg-white h-full shadow-2xl p-6 overflow-y-auto flex flex-col z-10"
            >
              {/* Close Button overlay */}
              <button 
                onClick={() => setSelectedId(null)}
                className="absolute right-4 top-4 p-2 text-[#9CA3AF] hover:bg-[#F3F4F6] rounded-xl transition-colors"
              >
                <X className="h-5 w-5" />
              </button>

              <div className="flex-1 mt-6">
                {renderInspector()}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Sidebar Loading Skeleton
function SidebarSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 rounded-2xl bg-gray-200" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-32 bg-gray-200 rounded" />
          <div className="h-3.5 w-24 bg-gray-200 rounded" />
        </div>
      </div>
      <div className="h-10 w-full bg-gray-150 rounded-xl" />
      <div className="h-20 w-full bg-gray-100 rounded-2xl" />
      <div className="space-y-3">
        <div className="h-3.5 w-28 bg-gray-200 rounded" />
        <div className="h-16 w-full bg-gray-100 rounded-xl" />
        <div className="h-16 w-full bg-gray-100 rounded-xl" />
      </div>
    </div>
  );
}
