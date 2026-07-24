'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import { formatDate, getInitials, getAvatarColor, getClientDisplayName } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { 
  Search, Mail, Phone, Calendar, Briefcase, 
  CheckCircle2, Clock, X, ChevronRight, Shield, 
  Activity, FileText, Sparkles, AlertCircle, Folder, User, Zap, Leaf
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

interface TeamMember {
  id: string; name: string; email: string; avatar?: string | null;
  role: string; department?: string | null; designation?: string | null; phone?: string | null;
  totalTasks: number; totalProjects: number; activeTasks: number; capacity: number;
  overloadThreshold?: number;
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
  designation?: string | null;
  phone?: string | null;
  joiningDate?: string | null;
  assignedTasks: TaskDetail[];
  ownedProjects: ProjectDetail[];
  overloadThreshold?: number;
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
  TODO: 'bg-slate-100 text-slate-700',
  IN_PROGRESS: 'bg-blue-50 text-blue-700 border-blue-100',
  REVIEW: 'bg-amber-50 text-amber-700 border-amber-100',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-100',
};

export default function TeamPage() {
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Search and Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRole, setSelectedRole] = useState<string[]>([]);
  const [selectedDept, setSelectedDept] = useState<string[]>([]);

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

  // Read memberId from URL on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const mId = params.get('memberId');
      if (mId) {
        setSelectedId(mId);
      }
    }
  }, []);

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
    const matchesRole = selectedRole.length === 0 || selectedRole.includes(m.role);
    const matchesDept = selectedDept.length === 0 || (m.department ? selectedDept.includes(m.department) : false);
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
        <div className="h-[550px] flex flex-col items-center justify-center text-center p-8 bg-gray-50/50 rounded-3xl border border-dashed border-border">
          <div className="h-14 w-14 rounded-2xl bg-white flex items-center justify-center border border-border text-muted mb-5">
            <Sparkles className="h-6 w-6 text-indigo-500" />
          </div>
          <h3 className="text-sm font-semibold text-primary">Workload Inspector</h3>
          <p className="text-xs text-[#86868B] max-w-[260px] mt-2 leading-relaxed">
            Select a team member from the dashboard to inspect their active assignments, led projects, and performance statistics.
          </p>
        </div>
      );
    }

    const { name, email, role, department, designation, phone, joiningDate, assignedTasks, ownedProjects, stats, overloadThreshold = 25 } = memberDetail;
    const activeTasks = assignedTasks.filter((t) => t.status !== 'COMPLETED');
    const isOverloaded = activeTasks.length > overloadThreshold;

    return (
      <div className="space-y-6">
        {/* Profile Card Header */}
        <div className="flex items-center gap-4">
          <div className={`h-16 w-16 rounded-2xl flex items-center justify-center font-semibold text-2xl shrink-0 ${getAvatarColor(name)}`}>
            {getInitials(name)}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-primary truncate leading-5">{name}</h2>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-0.5 rounded-md bg-gray-100 text-gray-800 border border-gray-200">
                <Shield className="h-3 w-3" />
                {roleLabels[role] || role}
              </span>
              {designation && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-100">
                  <Briefcase className="h-3 w-3" />
                  {designation}
                </span>
              )}
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
                ? 'bg-white text-primary shadow-xs' 
                : 'text-secondary hover:text-primary'
            }`}
          >
            Tasks & Projects ({activeTasks.length + ownedProjects.length})
          </button>
          <button
            onClick={() => setActiveTab('profile')}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
              activeTab === 'profile' 
                ? 'bg-white text-primary shadow-xs' 
                : 'text-secondary hover:text-primary'
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
              <div className={`p-5 rounded-2xl border transition-colors ${isOverloaded ? 'bg-red-50/30 border-red-100' : 'bg-surface border-border/80'}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-primary flex items-center gap-1.5">
                    Workload Allocation
                    {isOverloaded && (
                      <span className="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                        Overloaded
                      </span>
                    )}
                  </span>
                  <span className="text-xs font-bold text-primary tabular-nums">{stats.capacity}%</span>
                </div>
                <div className="h-2 w-full rounded-full bg-border overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      isOverloaded ? 'bg-red-500' : stats.capacity > 80 ? 'bg-red-500' : stats.capacity > 50 ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${stats.capacity}%` }}
                  />
                </div>
                <div className="flex items-center text-[10px] text-[#86868B] mt-2.5 font-medium">
                  {isOverloaded ? (
                    <><AlertCircle className="w-3.5 h-3.5 text-red-500 mr-1.5 animate-bounce" /> Overloaded: active tasks ({activeTasks.length}) exceeds threshold ({overloadThreshold}).</>
                  ) : stats.capacity > 80 ? (
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
                  <Activity className="h-4 w-4 text-primary" />
                  <h3 className="text-xs font-bold text-primary uppercase tracking-wider">Active Tasks ({activeTasks.length})</h3>
                </div>
                <div className="space-y-2.5 max-h-[220px] overflow-y-auto pr-1">
                  {activeTasks.map((t) => (
                    <div 
                      key={t.id} 
                      className="p-3.5 bg-white border border-border rounded-xl hover:border-gray-300 transition-colors shadow-xs"
                    >
                      <div className="flex justify-between items-start gap-2 mb-2">
                        <h4 className="text-xs font-semibold text-primary line-clamp-1">{t.title}</h4>
                        <span className={`shrink-0 text-[9px] font-bold px-2 py-0.5 rounded-sm border ${statusColors[t.status] || ''}`}>
                          {t.status.replace('_', ' ')}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-[10px] text-muted">
                        <span className="truncate max-w-[170px] font-semibold text-secondary flex items-center gap-1.5">
                          <Folder className="h-3 w-3" />
                          {t.project?.name || 'No project'}
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
                    <p className="text-xs text-muted italic text-center py-6 bg-gray-50/50 rounded-xl border border-dashed border-border">
                      No active tasks assigned
                    </p>
                  )}
                </div>
              </div>

              {/* Led Projects List */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <FileText className="h-4 w-4 text-primary" />
                  <h3 className="text-xs font-bold text-primary uppercase tracking-wider">Led Projects ({ownedProjects.length})</h3>
                </div>
                <div className="space-y-2.5 max-h-[180px] overflow-y-auto pr-1">
                  {ownedProjects.map((p) => (
                    <div 
                      key={p.id}
                      className="p-3.5 bg-white border border-border rounded-xl hover:border-gray-300 transition-colors shadow-xs"
                    >
                      <h4 className="text-xs font-semibold text-primary line-clamp-1">{p.name}</h4>
                      <div className="flex justify-between items-center text-[10px] text-muted mt-2">
                        <span className="truncate max-w-[170px] font-medium flex items-center gap-1.5">
                          <User className="h-3 w-3" />
                          {p.client ? getClientDisplayName(p.client) : 'Internal'}
                        </span>
                        <span className="font-semibold text-secondary">
                          {p._count.tasks} tasks
                        </span>
                      </div>
                    </div>
                  ))}
                  {ownedProjects.length === 0 && (
                    <p className="text-xs text-muted italic text-center py-6 bg-gray-50/50 rounded-xl border border-dashed border-border">
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
              <div className="bg-surface rounded-2xl p-5 border border-border/80 space-y-3.5 text-xs text-[#4B5563]">
                <h4 className="text-[10px] text-[#86868B] font-medium uppercase tracking-wide mb-1">Contact Information</h4>
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-muted" />
                  <a href={`mailto:${email}`} className="hover:underline hover:text-primary font-medium truncate">{email}</a>
                </div>
                {phone && (
                  <div className="flex items-center gap-3">
                    <Phone className="h-4 w-4 text-muted" />
                    <span className="tabular-nums font-medium">{phone}</span>
                  </div>
                )}
                {joiningDate && (
                  <div className="flex items-center gap-3">
                    <Calendar className="h-4 w-4 text-muted" />
                    <span className="font-medium">Joined {new Date(joiningDate).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                  </div>
                )}
              </div>

              {/* Statistics Panel */}
              <div>
                <h3 className="text-xs font-bold text-primary uppercase tracking-wider mb-3">Overall Performance</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white p-4 rounded-2xl border border-border">
                    <span className="text-[10px] text-[#86868B] font-medium uppercase tracking-wide block mb-1">Active Tasks</span>
                    <p className="text-2xl font-bold text-primary tabular-nums">{stats.activeTasks}</p>
                  </div>
                  <div className="bg-white p-4 rounded-2xl border border-border">
                    <span className="text-[10px] text-[#86868B] font-medium uppercase tracking-wide block mb-1">Completed</span>
                    <p className="text-2xl font-bold text-emerald-600 tabular-nums">{stats.completedTasks}</p>
                  </div>
                  <div className="bg-white p-4 rounded-2xl border border-border">
                    <span className="text-[10px] text-[#86868B] font-medium uppercase tracking-wide block mb-1">Total Assigned</span>
                    <p className="text-2xl font-bold text-primary tabular-nums">{stats.totalTasks}</p>
                  </div>
                  <div className="bg-white p-4 rounded-2xl border border-border">
                    <span className="text-[10px] text-[#86868B] font-medium uppercase tracking-wide block mb-1">Led Projects</span>
                    <p className="text-2xl font-bold text-blue-600 tabular-nums">{stats.totalProjects}</p>
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
    <div className="max-w-350 mx-auto p-4 md:p-8">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-primary tracking-tight">Team Workspace</h1>
        <p className="text-sm text-secondary mt-1">Monitor capacity, active workloads, and individual output of your team.</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-8 items-start">
        {/* Left Side: Members Card Grid (2 Columns on Desktop for Spacing) */}
        <div className="flex-1 min-w-0 w-full space-y-6">
          {/* Controls Bar */}
          <div className="bg-white border border-border rounded-2xl p-4 shadow-sm flex flex-wrap items-center gap-2 w-full">
            {/* Search Input */}
            <div className="relative w-full sm:w-64 md:w-80 shrink-0">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
              <input
                type="text"
                placeholder="Search team by name, email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-9 rounded-xl border border-border bg-white pl-10 pr-4 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder:text-muted"
              />
            </div>

            {/* Department Filter */}
            <div className="shrink-0 z-20">
              <MultiSelect
                value={selectedDept}
                onChange={setSelectedDept}
                placeholder="Departments"
                triggerClassName={selectedDept.length > 0 ? "border-primary bg-primary/[0.02] text-primary h-9 rounded-xl px-3 text-xs font-semibold" : "h-9 rounded-xl border border-border bg-white hover:bg-gray-50 hover:border-gray-300 text-secondary px-3 text-xs transition-all"}
                options={departments.map((d) => ({ label: d, value: d }))}
              />
            </div>

            {/* Role Filter */}
            <div className="shrink-0 z-10">
              <MultiSelect
                value={selectedRole}
                onChange={setSelectedRole}
                placeholder="Roles"
                triggerClassName={selectedRole.length > 0 ? "border-primary bg-primary/[0.02] text-primary h-9 rounded-xl px-3 text-xs font-semibold" : "h-9 rounded-xl border border-border bg-white hover:bg-gray-50 hover:border-gray-300 text-secondary px-3 text-xs transition-all"}
                options={Object.entries(roleLabels).map(([val, label]) => ({ label, value: val }))}
              />
            </div>

            {/* Clear Filters (if active) */}
            {(!!searchQuery || selectedDept.length > 0 || selectedRole.length > 0) && (
              <div className="ml-auto shrink-0">
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedDept([]);
                    setSelectedRole([]);
                  }}
                  className="flex items-center gap-1.5 h-9 rounded-xl bg-red-50 px-3 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors border border-red-100 whitespace-nowrap"
                >
                  <X className="h-3.5 w-3.5" /> Clear Filters
                </button>
              </div>
            )}
          </div>

          {/* Grid Loading State */}
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {[...Array(8)].map((_, i) => (
                <Skeleton key={i} className="h-56 w-full rounded-3xl" />
              ))}
            </div>
          ) : (
            /* Members Card Grid */
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {filteredTeam.map((m) => {
                const isSelected = selectedId === m.id;
                const isOverloaded = m.activeTasks > (m.overloadThreshold ?? 25);
                return (
                  <div
                    key={m.id}
                    onClick={() => setSelectedId(m.id)}
                    className={`group relative flex flex-col p-6 rounded-3xl bg-white cursor-pointer transition-all duration-300 border ${
                      isSelected 
                        ? 'border-primary ring-1 ring-primary' 
                        : 'border-border hover:shadow-sm'
                    }`}
                  >
                    <div className="flex items-center gap-4 mb-5">
                      {/* Avatar */}
                      <div className={`h-12 w-12 rounded-2xl flex items-center justify-center font-medium text-lg shrink-0 ${getAvatarColor(m.name)}`}>
                        {getInitials(m.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1.5">
                          <h3 className="text-[15px] font-semibold text-primary truncate leading-snug group-hover:text-black transition-colors">{m.name}</h3>
                          {isOverloaded && (
                            <span className="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-100 animate-pulse shrink-0">
                              Overloaded
                            </span>
                          )}
                        </div>
                        <p className="text-[13px] text-[#86868B] truncate mt-0.5">
                          {m.designation || roleLabels[m.role] || m.role}
                          {m.department && <span className="mx-1.5 opacity-50">·</span>}
                          {m.department && m.department}
                        </p>
                      </div>
                    </div>

                    <div className="mt-auto pt-4 border-t border-[#F3F4F6] flex items-center justify-between text-[13px]">
                      <div className="flex items-center gap-3 text-[#86868B]">
                        <span className="flex items-center gap-1">
                           <span className="font-semibold text-primary">{m.activeTasks}</span> 
                           <span className="opacity-80">tasks</span>
                        </span>
                        <span className="w-0.5 h-0.5 rounded-full bg-[#D1D5DB]"></span>
                        <span className="flex items-center gap-1">
                           <span className="font-semibold text-primary">{m.totalProjects}</span> 
                           <span className="opacity-80">projects</span>
                        </span>
                      </div>
                      
                      {/* Minimal Capacity Dot */}
                      <div className="flex items-center gap-1.5" title={`Capacity: ${m.capacity}%`}>
                        <div className={`w-2 h-2 rounded-full ${
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
                <div className="col-span-full py-20 text-center bg-white rounded-3xl border border-dashed border-border">
                  <AlertCircle className="h-10 w-10 text-muted mx-auto mb-4" />
                  <p className="text-sm font-semibold text-primary">No members match search query</p>
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
                className="absolute right-4 top-4 p-2 text-muted hover:bg-[#F3F4F6] rounded-xl transition-colors"
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
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Skeleton className="h-16 w-16 rounded-2xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-32 rounded" />
          <Skeleton className="h-3.5 w-24 rounded" />
        </div>
      </div>
      <Skeleton className="h-10 w-full rounded-xl" />
      <Skeleton className="h-20 w-full rounded-2xl" />
      <div className="space-y-3">
        <Skeleton className="h-3.5 w-28 rounded" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    </div>
  );
}
