'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import { formatDate, getInitials, formatRelativeDate, getAvatarColor } from '@/lib/utils';
import { ArrowLeft, Clock, MessageSquare, MoreHorizontal, CheckCircle2, ChevronRight, Plus, X, Trash2, Users, DollarSign } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { useAuthStore, useConfirmStore } from '@/stores';

interface ProjectDetail {
  id: string; name: string; description?: string | null; status: string; priority: string; progress: number;
  startDate?: string | null; endDate?: string | null; budget?: number | null;
  client?: { id: string; name: string; company?: string | null };
  owner?: { id: string; name: string; avatar?: string | null; email?: string | null };
  members?: { id: string; user: { id: string; name: string; avatar?: string | null; role?: string } }[];
  teams?: { id: string; team: { id: string; name: string; members: { id: string; name: string; avatar?: string | null; role?: string }[] } }[];
  tasks?: {
    id: string; title: string; status: string; priority: string; dueDate?: string | null; order: number;
    assignee?: { id: string; name: string; avatar?: string | null } | null;
    _count?: { subtasks: number; comments: number };
  }[];
  milestones?: { id: string; name: string; dueDate?: string | null; completed: boolean }[];
  activities?: { id: string; type: string; message: string; createdAt: string; user: { name: string } }[];
}

type Tab = 'tasks' | 'milestones' | 'team' | 'activity';

const statusColors: Record<string, string> = {
  PLANNING: 'bg-violet-50 text-violet-700', IN_PROGRESS: 'bg-blue-50 text-blue-700',
  REVIEW: 'bg-amber-50 text-amber-700', COMPLETED: 'bg-emerald-50 text-emerald-700',
  ON_HOLD: 'bg-orange-50 text-orange-700', CANCELLED: 'bg-red-50 text-red-700',
  BACKLOG: 'bg-gray-100 text-gray-500', TODO: 'bg-slate-100 text-slate-600', BLOCKED: 'bg-red-50 text-red-700',
};

const priorityDots: Record<string, string> = {
  LOW: 'bg-gray-300', MEDIUM: 'bg-blue-400', HIGH: 'bg-orange-500', CRITICAL: 'bg-red-500', URGENT: 'bg-red-500',
};

export default function ProjectDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { user } = useAuthStore();
  const confirm = useConfirmStore((s) => s.confirm);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [tab, setTab] = useState<Tab>('tasks');
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [isEditingTask, setIsEditingTask] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState('');
  const [taskForm, setTaskForm] = useState({ title: '', description: '', assigneeId: '', priority: 'MEDIUM', status: 'TODO', dueDate: '' });
  const [submittingTask, setSubmittingTask] = useState(false);

  // Edit Project States
  const [showEditProject, setShowEditProject] = useState(false);
  const [editForm, setEditForm] = useState<{
    name: string; description: string; clientId: string; ownerId: string;
    startDate: string; endDate: string; priority: string; budget: string; status: string; memberIds: string[]; teamIds: string[];
  }>({ name: '', description: '', clientId: '', ownerId: '', startDate: '', endDate: '', priority: 'MEDIUM', budget: '', status: 'PLANNING', memberIds: [], teamIds: [] });
  const [submittingEdit, setSubmittingEdit] = useState(false);
  const [clients, setClients] = useState<{id: string, name: string, company?: string | null}[]>([]);
  const [members, setMembers] = useState<{id: string, name: string}[]>([]);
  const [teams, setTeams] = useState<{id: string, name: string}[]>([]);

  // Milestone States
  const [showMilestoneModal, setShowMilestoneModal] = useState(false);
  const [isEditingMilestone, setIsEditingMilestone] = useState(false);
  const [editingMilestoneId, setEditingMilestoneId] = useState('');
  const [milestoneForm, setMilestoneForm] = useState({ name: '', dueDate: '' });
  const [submittingMilestone, setSubmittingMilestone] = useState(false);

  const fetchProject = useCallback(() => {
    api.get<ProjectDetail>(`/projects/${id}`).then(setProject).catch(() => router.push('/projects'));
  }, [id, router]);

  useEffect(() => {
    fetchProject();
    api.get<{ clients: {id: string, name: string, company?: string | null}[] }>('/clients?limit=100').then((res) => setClients(res.clients)).catch(() => {});
    api.get<{id: string, name: string}[]>('/team').then(setMembers).catch(() => {});
    api.get<{ teams: {id: string, name: string}[] }>('/teams').then((res) => setTeams(res.teams)).catch(() => {});
  }, [fetchProject]);

  async function handleSaveTask(e: React.FormEvent) {
    e.preventDefault();
    setSubmittingTask(true);
    try {
      if (isEditingTask) {
        await api.put(`/tasks/${editingTaskId}`, {
          ...taskForm,
          projectId: project?.id,
          assigneeId: taskForm.assigneeId || undefined,
          dueDate: taskForm.dueDate || undefined,
        });
      } else {
        await api.post('/tasks', {
          ...taskForm,
          projectId: project?.id,
          assigneeId: taskForm.assigneeId || undefined,
          dueDate: taskForm.dueDate || undefined,
        });
      }
      setShowCreateTask(false);
      setIsEditingTask(false);
      setEditingTaskId('');
      setTaskForm({ title: '', description: '', assigneeId: '', priority: 'MEDIUM', status: 'TODO', dueDate: '' });
      const updated = await api.get<ProjectDetail>(`/projects/${id}`);
      setProject(updated);
    } catch {} finally { setSubmittingTask(false); }
  }

  function startEditingTask(t: any, e: React.MouseEvent) {
    e.stopPropagation();
    setTaskForm({
      title: t.title,
      description: t.description || '',
      assigneeId: t.assignee?.id || '',
      priority: t.priority,
      status: t.status,
      dueDate: t.dueDate ? new Date(t.dueDate).toISOString().split('T')[0] : '',
    });
    setEditingTaskId(t.id);
    setIsEditingTask(true);
    setShowCreateTask(true);
  }

  function openCreateTask() {
    setTaskForm({ title: '', description: '', assigneeId: '', priority: 'MEDIUM', status: 'TODO', dueDate: '' });
    setIsEditingTask(false);
    setEditingTaskId('');
    setShowCreateTask(true);
  }

  function startEditingProject() {
    if (!project) return;
    setEditForm({
      name: project.name,
      description: project.description || '',
      clientId: project.client?.id || '',
      ownerId: project.owner?.id || '',
      startDate: project.startDate ? new Date(project.startDate).toISOString().split('T')[0] : '',
      endDate: project.endDate ? new Date(project.endDate).toISOString().split('T')[0] : '',
      priority: project.priority,
      budget: project.budget?.toString() || '',
      status: project.status,
      memberIds: project.members?.map(m => m.user.id) || [],
      teamIds: project.teams?.map(t => t.team.id) || [],
    });
    setShowEditProject(true);
  }

  async function handleEditProject(e: React.FormEvent) {
    e.preventDefault();
    setSubmittingEdit(true);
    try {
      const updated = await api.put<ProjectDetail>(`/projects/${id}`, {
        ...editForm,
        budget: editForm.budget ? parseFloat(editForm.budget) : undefined,
        startDate: editForm.startDate || undefined,
        endDate: editForm.endDate || undefined,
      });
      setProject(updated);
      setShowEditProject(false);
    } catch {} finally { setSubmittingEdit(false); }
  }

  async function handleDeleteProject() {
    const confirmed = await confirm({
      title: 'Delete Project',
      message: 'Are you sure you want to delete this project? This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await api.delete(`/projects/${id}`);
      router.push('/projects');
    } catch (err) {
      console.error(err);
    }
  }

  async function handleDeleteTask(taskId: string, e: React.MouseEvent) {
    e.stopPropagation();
    const confirmed = await confirm({
      title: 'Delete Task',
      message: 'Are you sure you want to delete this task?',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await api.delete(`/tasks/${taskId}`);
      fetchProject(); // refresh data
    } catch (err) {
      console.error(err);
    }
  }

  function openCreateMilestone() {
    setMilestoneForm({ name: '', dueDate: '' });
    setIsEditingMilestone(false);
    setEditingMilestoneId('');
    setShowMilestoneModal(true);
  }

  function startEditingMilestone(m: any, e: React.MouseEvent) {
    e.stopPropagation();
    setMilestoneForm({
      name: m.name,
      dueDate: m.dueDate ? new Date(m.dueDate).toISOString().split('T')[0] : '',
    });
    setEditingMilestoneId(m.id);
    setIsEditingMilestone(true);
    setShowMilestoneModal(true);
  }

  async function handleSaveMilestone(e: React.FormEvent) {
    e.preventDefault();
    setSubmittingMilestone(true);
    try {
      if (isEditingMilestone) {
        await api.put(`/projects/${id}/milestones/${editingMilestoneId}`, milestoneForm);
      } else {
        await api.post(`/projects/${id}/milestones`, milestoneForm);
      }
      setShowMilestoneModal(false);
      fetchProject();
    } catch {} finally { setSubmittingMilestone(false); }
  }

  async function handleDeleteMilestone(milestoneId: string, e: React.MouseEvent) {
    e.stopPropagation();
    const confirmed = await confirm({
      title: 'Delete Milestone',
      message: 'Are you sure you want to delete this milestone?',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await api.delete(`/projects/${id}/milestones/${milestoneId}`);
      fetchProject();
    } catch {}
  }

  async function toggleMilestoneCompletion(milestoneId: string, currentStatus: boolean, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await api.put(`/projects/${id}/milestones/${milestoneId}`, { completed: !currentStatus });
      fetchProject();
    } catch {}
  }

  if (!project) return <div className="py-20 text-center text-sm text-[#9CA3AF]">Loading...</div>;

  const allProjectMembers = Array.from(new Map([
    ...(project.members || []).map(m => m.user),
    ...(project.teams?.flatMap(t => t.team.members) || [])
  ].map(u => [u.id, u])).values());

  const tabs = [
    { id: 'tasks' as Tab, label: `Tasks (${project.tasks?.length ?? 0})` },
    { id: 'milestones' as Tab, label: `Milestones (${project.milestones?.length ?? 0})` },
    { id: 'team' as Tab, label: `Team (${allProjectMembers.length})` },
    { id: 'activity' as Tab, label: 'Activity' },
  ];

  const completedTasks = project.tasks?.filter((t) => t.status === 'COMPLETED').length ?? 0;
  const totalTasks = project.tasks?.length ?? 0;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <button onClick={() => router.push('/projects')} className="flex items-center gap-1.5 text-sm text-[#6B7280] hover:text-[#111827] mb-6 transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Projects
      </button>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold text-[#111827]">{project.name}</h1>
              <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium ${statusColors[project.status]}`}>
                {project.status.replace('_', ' ')}
              </span>
              <div className={`h-2 w-2 rounded-full ${priorityDots[project.priority]}`} />
            </div>
            <p className="text-sm text-[#6B7280]">{project.client?.name}</p>
            {project.description && <p className="text-sm text-[#6B7280] mt-2 max-w-2xl">{project.description}</p>}
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-4">
              {project.owner && (
                <div className="flex items-center gap-2 pr-4 border-r border-[#E5E7EB]">
                  <span className="text-xs text-[#6B7280]">Owner</span>
                  <div className={`flex h-8 w-8 items-center justify-center rounded-full text-white text-[10px] font-semibold border-2 border-white shadow-sm ${getAvatarColor(project.owner.name)}`} title={project.owner.name}>
                    {getInitials(project.owner.name)}
                  </div>
                </div>
              )}
              <div className="flex items-center gap-1 -space-x-2">
                {allProjectMembers.filter(m => m.id !== project.owner?.id).slice(0, 5).map((m, i) => (
                  <div key={m.id} className={`flex h-8 w-8 items-center justify-center rounded-full text-white text-[10px] font-semibold border-2 border-white shadow-sm ${getAvatarColor(m.name)}`} style={{ zIndex: 5 - i }} title={m.name}>
                    {getInitials(m.name)}
                  </div>
                ))}
                {allProjectMembers.length > 6 && (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F3F4F6] text-[#6B7280] text-[10px] font-semibold border-2 border-white shadow-sm" style={{ zIndex: 0 }}>
                    +{allProjectMembers.length - 6}
                  </div>
                )}
              </div>
            </div>
            {user?.role !== 'TEAM_MEMBER' && (
              <>
                <button onClick={startEditingProject} className="rounded-xl border border-[#E5E7EB] px-3 py-1.5 text-xs font-medium text-[#374151] hover:bg-[#F9FAFB] transition-all">
                  Edit Project
                </button>
                <button onClick={handleDeleteProject} className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 hover:border-red-300 transition-all flex items-center gap-1.5">
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
              </>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mt-6">
          <div className="rounded-xl border border-[#E5E7EB] bg-white p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="h-4 w-4 text-[#9CA3AF]" />
              <span className="text-xs text-[#6B7280]">Progress</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-full rounded-full bg-[#F3F4F6] overflow-hidden">
                <div className="h-full rounded-full bg-[#111827]" style={{ width: `${project.progress}%` }} />
              </div>
              <span className="text-sm font-bold text-[#111827] tabular-nums">{project.progress}%</span>
            </div>
          </div>
          <div className="rounded-xl border border-[#E5E7EB] bg-white p-4">
            <div className="flex items-center gap-2 mb-2"><Clock className="h-4 w-4 text-[#9CA3AF]" /><span className="text-xs text-[#6B7280]">Due Date</span></div>
            <p className="text-sm font-semibold text-[#111827]">{formatDate(project.endDate)}</p>
          </div>
          <div className="rounded-xl border border-[#E5E7EB] bg-white p-4">
            <div className="flex items-center gap-2 mb-2"><Users className="h-4 w-4 text-[#9CA3AF]" /><span className="text-xs text-[#6B7280]">Tasks</span></div>
            <p className="text-sm font-semibold text-[#111827]">{completedTasks}/{totalTasks} done</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[#E5E7EB] mb-6">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-all ${tab === t.id ? 'border-[#111827] text-[#111827]' : 'border-transparent text-[#6B7280] hover:text-[#111827]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'tasks' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            {user?.role !== 'TEAM_MEMBER' && (
              <button onClick={openCreateTask} className="flex items-center gap-1.5 rounded-lg bg-[#111827] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1F2937] transition-all">
                <Plus className="h-3.5 w-3.5" /> Add Task
              </button>
            )}
          </div>
          <div className="rounded-2xl border border-[#E5E7EB] bg-white overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#F3F4F6]">
                  <th className="px-6 py-3 text-left text-xs font-medium text-[#6B7280] uppercase">Task</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[#6B7280] uppercase">Assignee</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[#6B7280] uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[#6B7280] uppercase">Due Date</th>
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3F4F6]">
                {project.tasks?.length === 0 ? (
                  <tr><td colSpan={4} className="px-6 py-8 text-center text-sm text-[#9CA3AF]">No tasks yet</td></tr>
                ) : (
                  project.tasks?.map((t) => (
                    <tr key={t.id} className="hover:bg-[#FAFAFA] transition-colors cursor-pointer" onClick={() => router.push('/tasks')}>
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          <div className={`h-2 w-2 rounded-full shrink-0 ${priorityDots[t.priority]}`} />
                          <span className="text-sm font-medium text-[#111827]">{t.title}</span>
                          {(t._count?.comments ?? 0) > 0 && (
                            <span className="flex items-center gap-0.5 text-[10px] text-[#9CA3AF]"><MessageSquare className="h-3 w-3" />{t._count?.comments}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-3">
                        {t.assignee ? (
                          <div className="flex items-center gap-1.5">
                            <div className={`h-5 w-5 rounded-full text-white text-[8px] font-semibold flex items-center justify-center ${getAvatarColor(t.assignee.name)}`}>{getInitials(t.assignee.name)}</div>
                            <span className="text-sm text-[#374151]">{t.assignee.name}</span>
                          </div>
                        ) : <span className="text-sm text-[#9CA3AF]">—</span>}
                      </td>
                      <td className="px-6 py-3"><span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium ${statusColors[t.status]}`}>{t.status.replace('_', ' ')}</span></td>
                      <td className="px-6 py-3 text-sm text-[#6B7280]">{formatDate(t.dueDate)}</td>
                      <td className="px-6 py-3 text-right">
                        {(user?.role !== 'TEAM_MEMBER' || t.assignee?.id === user?.id) && (
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={(e) => startEditingTask(t, e)} className="text-xs font-medium text-[#6B7280] hover:text-[#111827] transition-colors bg-white border border-[#E5E7EB] rounded-lg px-2.5 py-1">
                              Edit
                            </button>
                            <button onClick={(e) => handleDeleteTask(t.id, e)} className="text-[#6B7280] hover:text-red-600 transition-colors bg-white border border-[#E5E7EB] rounded-lg p-1.5 hover:bg-red-50 hover:border-red-100">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'milestones' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            {user?.role !== 'TEAM_MEMBER' && (
              <button onClick={openCreateMilestone} className="flex items-center gap-1.5 rounded-lg bg-[#111827] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1F2937] transition-all">
                <Plus className="h-3.5 w-3.5" /> Add Milestone
              </button>
            )}
          </div>
          <div className="space-y-3">
            {project.milestones?.length === 0 ? (
              <div className="py-8 text-center text-sm text-[#9CA3AF] border border-dashed border-[#E5E7EB] rounded-2xl bg-white">No milestones defined</div>
            ) : (
              project.milestones?.map((m) => (
                <div key={m.id} className={`flex items-center gap-4 rounded-2xl border border-[#E5E7EB] bg-white p-4 transition-colors hover:border-gray-300 group ${m.completed ? 'opacity-60 bg-gray-50' : ''}`}>
                  <button onClick={(e) => toggleMilestoneCompletion(m.id, m.completed, e)} className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${m.completed ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-[#D1D5DB] hover:border-emerald-500'}`}>
                    {m.completed && <CheckCircle2 className="h-3.5 w-3.5" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold truncate ${m.completed ? 'text-[#9CA3AF] line-through' : 'text-[#111827]'}`}>{m.name}</p>
                    {m.dueDate && <span className="text-[11px] font-medium text-[#6B7280] flex items-center gap-1 mt-0.5"><Clock className="h-3 w-3" /> {formatDate(m.dueDate)}</span>}
                  </div>
                  {user?.role !== 'TEAM_MEMBER' && (
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={(e) => startEditingMilestone(m, e)} className="text-[#6B7280] hover:text-[#111827] p-1.5 rounded-lg bg-white border border-[#E5E7EB] hover:bg-gray-50">
                        Edit
                      </button>
                      <button onClick={(e) => handleDeleteMilestone(m.id, e)} className="text-[#6B7280] hover:text-red-600 p-1.5 rounded-lg bg-white border border-[#E5E7EB] hover:bg-red-50 hover:border-red-100">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === 'team' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {allProjectMembers.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-2xl border border-[#E5E7EB] bg-white p-4">
              <div className={`h-10 w-10 rounded-xl text-white text-sm font-semibold flex items-center justify-center ${getAvatarColor(m.name)}`}>{getInitials(m.name)}</div>
              <div>
                <p className="text-sm font-medium text-[#111827]">{m.name}</p>
                <p className="text-xs text-[#9CA3AF]">{m.role?.replace('_', ' ')}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'activity' && (
        <div className="space-y-3">
          {project.activities?.map((a) => (
            <div key={a.id} className="flex items-start gap-3 py-2">
              <div className={`h-7 w-7 rounded-full text-white text-[10px] font-semibold flex items-center justify-center shrink-0 ${getAvatarColor(a.user.name)}`}>{getInitials(a.user.name)}</div>
              <div>
                <p className="text-sm text-[#374151]"><span className="font-medium">{a.user.name}</span> {a.message}</p>
                <p className="text-xs text-[#9CA3AF]">{formatRelativeDate(a.createdAt)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Task Modal */}
      <AnimatePresence>
        {showCreateTask && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={() => setShowCreateTask(false)} />
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg bg-white border-l border-[#E5E7EB] shadow-2xl overflow-y-auto">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6]">
                <h2 className="text-lg font-semibold text-[#111827]">{isEditingTask ? 'Edit Task' : 'New Task'}</h2>
                <button onClick={() => setShowCreateTask(false)} className="p-2 rounded-xl hover:bg-[#F3F4F6]"><X className="h-4 w-4 text-[#6B7280]" /></button>
              </div>
              <form onSubmit={handleSaveTask} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Title *</label>
                  <input value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} required className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Description</label>
                  <textarea value={taskForm.description} onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })} rows={3} className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all resize-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Assignee</label>
                  <Select
                    value={taskForm.assigneeId}
                    onChange={(val) => setTaskForm({ ...taskForm, assigneeId: val })}
                    options={[{ label: 'Unassigned', value: '' }, ...allProjectMembers.map((m) => ({ label: m.name, value: m.id }))]}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Priority</label>
                    <Select
                      value={taskForm.priority}
                      onChange={(val) => setTaskForm({ ...taskForm, priority: val })}
                      options={[
                        { label: 'Low', value: 'LOW' },
                        { label: 'Medium', value: 'MEDIUM' },
                        { label: 'High', value: 'HIGH' },
                        { label: 'Urgent', value: 'URGENT' },
                      ]}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Due Date</label>
                    <input type="date" value={taskForm.dueDate} onChange={(e) => setTaskForm({ ...taskForm, dueDate: e.target.value })} className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all" />
                  </div>
                </div>
                {isEditingTask && (
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Status</label>
                    <Select
                      value={taskForm.status}
                      onChange={(val) => setTaskForm({ ...taskForm, status: val })}
                      options={[
                        { label: 'To Do', value: 'TODO' },
                        { label: 'In Progress', value: 'IN_PROGRESS' },
                        { label: 'Review', value: 'REVIEW' },
                        { label: 'Completed', value: 'COMPLETED' },
                        { label: 'Blocked', value: 'BLOCKED' },
                      ]}
                    />
                  </div>
                )}
                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => setShowCreateTask(false)} className="flex-1 rounded-xl border border-[#E5E7EB] px-4 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] transition-all">Cancel</button>
                  <button type="submit" disabled={submittingTask} className="flex-1 rounded-xl bg-[#111827] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] disabled:opacity-50 transition-all">{submittingTask ? 'Saving...' : isEditingTask ? 'Save Changes' : 'Create Task'}</button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Edit Project Modal */}
      <AnimatePresence>
        {showEditProject && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={() => setShowEditProject(false)} />
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg bg-white border-l border-[#E5E7EB] shadow-2xl overflow-y-auto">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6]">
                <h2 className="text-lg font-semibold text-[#111827]">Edit Project</h2>
                <button onClick={() => setShowEditProject(false)} className="p-2 rounded-xl hover:bg-[#F3F4F6]"><X className="h-4 w-4 text-[#6B7280]" /></button>
              </div>
              <form onSubmit={handleEditProject} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Project Name *</label>
                  <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Description</label>
                  <textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} rows={3} className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all resize-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Client *</label>
                  <Select
                    value={editForm.clientId}
                    onChange={(val) => setEditForm({ ...editForm, clientId: val })}
                    options={[{ label: 'Select client', value: '' }, ...clients.map(c => ({ label: c.company ? `${c.company} (${c.name})` : c.name, value: c.id }))]}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Owner *</label>
                  <Select
                    value={editForm.ownerId}
                    onChange={(val) => setEditForm({ ...editForm, ownerId: val })}
                    options={[{ label: 'Select owner', value: '' }, ...members.map(m => ({ label: m.name, value: m.id }))]}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Start Date</label>
                    <input type="date" value={editForm.startDate} onChange={(e) => setEditForm({ ...editForm, startDate: e.target.value })} className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">End Date</label>
                    <input type="date" value={editForm.endDate} onChange={(e) => setEditForm({ ...editForm, endDate: e.target.value })} className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Assigned Teams</label>
                  <MultiSelect
                    options={teams.map(t => ({ value: t.id, label: t.name }))}
                    value={editForm.teamIds}
                    onChange={(val) => setEditForm({ ...editForm, teamIds: val })}
                    placeholder="Search and select teams..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Additional Members</label>
                  <MultiSelect
                    options={members.filter(m => m.id !== editForm.ownerId).map(m => ({ value: m.id, label: m.name, image: getInitials(m.name), colorClass: getAvatarColor(m.name) }))}
                    value={editForm.memberIds}
                    onChange={(val) => setEditForm({ ...editForm, memberIds: val })}
                    placeholder="Search and select members..."
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Priority</label>
                    <Select
                      value={editForm.priority}
                      onChange={(val) => setEditForm({ ...editForm, priority: val })}
                      options={[{ label: 'Low', value: 'LOW' }, { label: 'Medium', value: 'MEDIUM' }, { label: 'High', value: 'HIGH' }, { label: 'Critical', value: 'CRITICAL' }]}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Status</label>
                    <Select
                      value={editForm.status}
                      onChange={(val) => setEditForm({ ...editForm, status: val })}
                      options={[
                        { label: 'Planning', value: 'PLANNING' },
                        { label: 'In Progress', value: 'IN_PROGRESS' },
                        { label: 'Review', value: 'REVIEW' },
                        { label: 'Completed', value: 'COMPLETED' },
                        { label: 'On Hold', value: 'ON_HOLD' },
                        { label: 'Cancelled', value: 'CANCELLED' },
                      ]}
                    />
                  </div>
                </div>

                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => setShowEditProject(false)} className="flex-1 rounded-xl border border-[#E5E7EB] px-4 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] transition-all">Cancel</button>
                  <button type="submit" disabled={submittingEdit} className="flex-1 rounded-xl bg-[#111827] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] disabled:opacity-50 transition-all">{submittingEdit ? 'Saving...' : 'Save Changes'}</button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Milestone Modal */}
      <AnimatePresence>
        {showMilestoneModal && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={() => setShowMilestoneModal(false)} />
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-white border-l border-[#E5E7EB] shadow-2xl overflow-y-auto">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6]">
                <h2 className="text-lg font-semibold text-[#111827]">{isEditingMilestone ? 'Edit Milestone' : 'New Milestone'}</h2>
                <button onClick={() => setShowMilestoneModal(false)} className="p-2 rounded-xl hover:bg-[#F3F4F6]"><X className="h-4 w-4 text-[#6B7280]" /></button>
              </div>
              <form onSubmit={handleSaveMilestone} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Milestone Name *</label>
                  <input value={milestoneForm.name} onChange={(e) => setMilestoneForm({ ...milestoneForm, name: e.target.value })} required className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Due Date</label>
                  <input type="date" value={milestoneForm.dueDate} onChange={(e) => setMilestoneForm({ ...milestoneForm, dueDate: e.target.value })} className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all" />
                </div>
                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => setShowMilestoneModal(false)} className="flex-1 rounded-xl border border-[#E5E7EB] px-4 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] transition-all">Cancel</button>
                  <button type="submit" disabled={submittingMilestone} className="flex-1 rounded-xl bg-[#111827] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] disabled:opacity-50 transition-all">{submittingMilestone ? 'Saving...' : 'Save Milestone'}</button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
