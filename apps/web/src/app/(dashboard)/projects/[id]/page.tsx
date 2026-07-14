'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import { formatDate, formatShortDate, getInitials, formatRelativeDate, getAvatarColor, getClientDisplayName } from '@/lib/utils';
import { TASK_STATUS_COLORS, TASK_STATUS_OPTIONS } from '@/lib/task-status';
import { ArrowLeft, Edit2, Plus, Calendar as CalendarIcon, Flag, Clock, Users, Link2, CheckCircle2, Circle, MoreVertical, Trash2, Mail, FileText, ChevronDown, Check, X, File, AlertCircle, TrendingUp, DollarSign, Briefcase, MessageSquare, MoreHorizontal, ChevronRight, Filter, ArrowUpRight, Settings, Kanban, LayoutList } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { TaskDetailDrawer } from '@/components/tasks/task-detail-drawer';
import { TaskBoardView } from '../components/TaskBoardView';
import { ViewSettingsPanel } from '@/components/ui/view-settings-panel';

import { MultiSelect } from '@/components/ui/multi-select';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { TagsInput } from '@/components/ui/tags-input';
import toast from 'react-hot-toast';
import { useAuthStore, useConfirmStore, useTimeTrackingStore } from '@/stores';

interface ProjectDetail {
  id: string; name: string; description?: string | null; status: string; priority: string; progress: number;
  type: string; scope?: string | null; reportingCadence: string; clientApprovalRequired: boolean;
  tags: string[]; projectNotes?: string | null; folderLink?: string | null;
  startDate?: string | null; endDate?: string | null; budget?: number | null;
  client?: { id: string; name: string; company?: string | null; lead?: { id: string } | null };
  owner?: { id: string; name: string; avatar?: string | null; email?: string | null };
  members?: { id: string; user: { id: string; name: string; avatar?: string | null; role?: string } }[];
  teams?: { id: string; team: { id: string; name: string; members: { id: string; name: string; avatar?: string | null; role?: string }[] } }[];
  tasks?: {
    id: string; title: string; status: string; priority: string; dueDate?: string | null; order: number;
    loggedHours?: number | null;
    assignee?: { id: string; name: string; avatar?: string | null } | null;
    assignees?: { id: string; name: string; avatar?: string | null }[];
    assignedBy?: { id: string; name: string; avatar?: string | null } | null;
    _count?: { subtasks: number; comments: number };
  }[];
  milestones?: { id: string; name: string; dueDate?: string | null; completed: boolean }[];
  activities?: { id: string; type: string; message: string; createdAt: string; user: { name: string } }[];
  comments?: { id: string; content: string; createdAt: string; author: { id: string; name: string; avatar?: string | null } }[];
}

type Tab = 'tasks' | 'team' | 'activity' | 'comments';

// Project statuses only — task badges use TASK_STATUS_COLORS.
const statusColors: Record<string, string> = {
  PLANNING: 'bg-violet-50 text-violet-700', IN_PROGRESS: 'bg-blue-50 text-blue-700',
  REVIEW: 'bg-amber-50 text-amber-700', COMPLETED: 'bg-emerald-50 text-emerald-700',
  ON_HOLD: 'bg-orange-50 text-orange-700', CANCELLED: 'bg-red-50 text-red-700',
};

const priorityDots: Record<string, string> = {
  LOW: 'bg-gray-300', MEDIUM: 'bg-blue-400', HIGH: 'bg-orange-500', CRITICAL: 'bg-red-500', URGENT: 'bg-red-500',
};

const formatForDateTimeLocal = (dateString?: string | null) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

export default function ProjectDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const confirm = useConfirmStore((s) => s.confirm);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [tab, setTab] = useState<Tab>('tasks');
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [isEditingTask, setIsEditingTask] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState('');
  const [taskForm, setTaskForm] = useState({ title: '', description: '', type: 'OTHER', assigneeIds: [] as string[], reviewerId: '', assignedById: '', priority: 'MEDIUM', status: 'TODO', dueDate: '', assignedDate: '', loggedHours: 0, driveLink: '', isRecurring: false, recurrenceFrequency: 'WEEKLY' });
  const [submittingTask, setSubmittingTask] = useState(false);
  // Task filters within this project's Tasks tab
  const [taskView, setTaskView] = useState<'list' | 'board'>('list');
  const [taskSearch, setTaskSearch] = useState('');
  const [taskStatusFilter, setTaskStatusFilter] = useState<string[]>([]);
  const [taskDueDateFilter, setTaskDueDateFilter] = useState<string>('');

  const [taskAssigneeFilter, setTaskAssigneeFilter] = useState<string[]>([]);
  const [taskTypeFilter, setTaskTypeFilter] = useState<string[]>([]);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [showTaskFilters, setShowTaskFilters] = useState(false);

  const ALL_TASK_COLUMNS = [
    { id: 'task', label: 'Task' },
    { id: 'type', label: 'Type' },
    { id: 'assignee', label: 'Assignee' },
    { id: 'status', label: 'Status' },
    { id: 'dueDate', label: 'Due Date' },
  ];

  const [showViewSettings, setShowViewSettings] = useState(false);
  const [visibleTaskColumns, setVisibleTaskColumns] = useState<string[]>(ALL_TASK_COLUMNS.map(c => c.id));
  const [viewName, setViewName] = useState('All Tasks');

  useEffect(() => {
    if (typeof window !== 'undefined' && id) {
      const saved = localStorage.getItem(`flowzen_view_tasks_${id}`);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.name) setViewName(parsed.name);
          if (parsed.visibleColumns) setVisibleTaskColumns(parsed.visibleColumns);
          if (parsed.viewType) setTaskView(parsed.viewType);
        } catch (e) {
          console.error(e);
        }
      }
    }
  }, [id]);


  // Edit Project States
  const [showEditProject, setShowEditProject] = useState(false);
  const [editForm, setEditForm] = useState<{
    name: string; description: string; clientId: string; ownerId: string;
    type: string; platform: string; scope: string; reportingCadence: string; clientApprovalRequired: boolean; tags: string[]; projectNotes: string; folderLink: string;
    startDate: string; endDate: string; priority: string; budget: string; status: string; memberIds: string[]; teamIds: string[];
  }>({ name: '', description: '', clientId: '', ownerId: '', type: 'ONE_TIME', platform: '', scope: '', reportingCadence: 'NONE', clientApprovalRequired: false, tags: [], projectNotes: '', folderLink: '', startDate: '', endDate: '', priority: 'MEDIUM', budget: '', status: 'PLANNING', memberIds: [], teamIds: [] });
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

  const [commentContent, setCommentContent] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [viewModalContent, setViewModalContent] = useState<{ title: string, content: string } | null>(null);

  const fetchProject = useCallback(() => {
    api.get<ProjectDetail>(`/projects/${id}`).then(setProject).catch(() => router.push('/projects'));
  }, [id, router]);

  useEffect(() => {
    fetchProject();
    api.get<{ clients: {id: string, name: string, company?: string | null}[] }>('/clients?limit=100').then((res) => setClients(res.clients)).catch(() => {});
    api.get<{id: string, name: string}[]>('/team').then(setMembers).catch(() => {});
    api.get<{ teams: {id: string, name: string}[] }>('/teams').then((res) => setTeams(res.teams)).catch(() => {});
  }, [fetchProject]);

  // Lock body scroll when any drawer is open
  useEffect(() => {
    const anyOpen = showEditProject || showCreateTask || isEditingTask || showMilestoneModal || !!viewModalContent;
    if (anyOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [showEditProject, showCreateTask, isEditingTask, showMilestoneModal, viewModalContent]);

  async function handleSaveTask(e: React.FormEvent) {
    e.preventDefault();
    setSubmittingTask(true);
    try {
      if (isEditingTask) {
        await api.put(`/tasks/${editingTaskId}`, {
          ...taskForm,
          projectId: project?.id,
          assigneeIds: taskForm.assigneeIds,
          reviewerId: taskForm.reviewerId || undefined,
          assignedById: taskForm.assignedById || undefined,
          dueDate: taskForm.dueDate || undefined,
          driveLink: taskForm.driveLink || undefined,
        });
      } else {
        await api.post('/tasks', {
          ...taskForm,
          projectId: project?.id,
          assigneeIds: taskForm.assigneeIds,
          reviewerId: taskForm.reviewerId || undefined,
          assignedById: taskForm.assignedById || undefined,
          dueDate: taskForm.dueDate || undefined,
          assignedDate: taskForm.assignedDate || undefined,
          driveLink: taskForm.driveLink || undefined,
        });
      }
      toast.success(isEditingTask ? 'Task updated' : 'Task created');
      
      if (isEditingTask && taskForm.status === 'COMPLETED') {
        const hours = await useTimeTrackingStore.getState().prompt({ taskId: editingTaskId, taskTitle: taskForm.title });
        if (hours) {
          await api.put(`/tasks/${editingTaskId}`, { loggedHours: hours });
          toast.success('Time logged');
        }
      }
      
      setShowCreateTask(false);
      setIsEditingTask(false);
      setEditingTaskId('');
      setTaskForm({ title: '', description: '', type: 'OTHER', assigneeIds: [], reviewerId: '', assignedById: '', priority: 'MEDIUM', status: 'TODO', dueDate: formatForDateTimeLocal(new Date().toISOString()), assignedDate: new Date().toISOString().split('T')[0], loggedHours: 0, driveLink: '', isRecurring: false, recurrenceFrequency: 'WEEKLY' });
      const updated = await api.get<ProjectDetail>(`/projects/${id}`);
      setProject(updated);
      // The global Tasks list + dashboard read cached data — refresh them.
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err: any) {
      toast.error(err.message || 'Failed to save task');
    } finally { setSubmittingTask(false); }
  }

  function startEditingTask(t: any, e?: React.MouseEvent) {
    e?.stopPropagation();
    setTaskForm({
      title: t.title,
      description: t.description || '',
      type: t.type || 'OTHER',
      assigneeIds: t.assignees?.length ? t.assignees.map((a: any) => a.id) : (t.assignee ? [t.assignee.id] : []),
      reviewerId: t.reviewer?.id || '',
      priority: t.priority,
      status: t.status,
      dueDate: t.dueDate ? formatForDateTimeLocal(t.dueDate) : formatForDateTimeLocal(new Date().toISOString()),
      assignedDate: t.assignedDate ? t.assignedDate.split('T')[0] : '',
      assignedById: t.assignedBy?.id || '',
      loggedHours: t.loggedHours || 0,
      driveLink: t.driveLink || '',
      isRecurring: t.isRecurring || false,
      recurrenceFrequency: t.recurrenceFrequency || 'WEEKLY'
    });
    setEditingTaskId(t.id);
    setIsEditingTask(true);
    setShowCreateTask(true);
  }

  function openCreateTask() {
    setTaskForm({ title: '', description: '', type: 'OTHER', assigneeIds: [], reviewerId: '', assignedById: '', priority: 'MEDIUM', status: 'TODO', dueDate: formatForDateTimeLocal(new Date().toISOString()), assignedDate: new Date().toISOString().split('T')[0], loggedHours: 0, driveLink: '', isRecurring: false, recurrenceFrequency: 'WEEKLY' });
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
      type: project.type || 'ONE_TIME',
      platform: (project as any).platform || '',
      scope: project.scope || '',
      reportingCadence: project.reportingCadence || 'NONE',
      clientApprovalRequired: project.clientApprovalRequired || false,
      tags: project.tags || [],
      projectNotes: project.projectNotes || '',
      folderLink: project.folderLink || '',
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
      toast.success('Project updated successfully');
      setProject(updated);
      // Keep the projects list + dashboard in sync (they read cached React Query data).
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setShowEditProject(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update project');
    } finally { setSubmittingEdit(false); }
  }

  async function handleDeleteProject() {
    const confirmed = await confirm({
      title: 'Delete Project',
      message: 'This permanently deletes the project, including its tasks and milestones. This action cannot be undone.',
      confirmText: 'Delete Project',
      cancelText: 'Cancel',
      variant: 'danger',
      requireText: project?.name,
    });
    if (!confirmed) return;
    try {
      await api.delete(`/projects/${id}`);
      // Drop the project from every cached projects list immediately so the list
      // page reflects the deletion without a stale flash, then reconcile in the
      // background (counts, dashboard).
      queryClient.setQueriesData({ queryKey: ['projects'] }, (old: any) => {
        if (!old?.pages) return old;
        return { ...old, pages: old.pages.map((p: any) => ({ ...p, projects: (p.projects || []).filter((pr: any) => pr.id !== id) })) };
      });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Project deleted successfully');
      router.push('/projects');
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete project');
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
      toast.success('Task deleted');
      fetchProject(); // refresh data
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete task');
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
      toast.success(isEditingMilestone ? 'Milestone updated' : 'Milestone created');
      setShowMilestoneModal(false);
      fetchProject();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save milestone');
    } finally { setSubmittingMilestone(false); }
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
      toast.success('Milestone deleted');
      fetchProject();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete milestone');
    }
  }

  async function toggleMilestoneCompletion(milestoneId: string, currentStatus: boolean, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await api.put(`/projects/${id}/milestones/${milestoneId}`, { completed: !currentStatus });
      toast.success(currentStatus ? 'Milestone marked incomplete' : 'Milestone marked complete');
      fetchProject();
    } catch (err: any) {
      toast.error(err.message || 'Failed to toggle milestone');
    }
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!commentContent.trim()) return;
    setSubmittingComment(true);
    try {
      await api.post(`/projects/${id}/comments`, { content: commentContent });
      setCommentContent('');
      fetchProject();
      toast.success('Comment added');
    } catch (err: any) {
      toast.error(err.message || 'Failed to add comment');
    } finally {
      setSubmittingComment(false);
    }
  }

  if (!project) return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header Skeleton */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl border border-border">
        <div className="space-y-3">
          <div className="h-4 w-24 bg-[#F3F4F6] rounded-md animate-pulse" />
          <div className="h-8 w-64 bg-border rounded-lg animate-pulse" />
          <div className="h-4 w-48 bg-[#F3F4F6] rounded-md animate-pulse" />
        </div>
        <div className="flex gap-2">
          <div className="h-10 w-28 bg-[#F3F4F6] rounded-xl animate-pulse" />
          <div className="h-10 w-28 bg-[#F3F4F6] rounded-xl animate-pulse" />
        </div>
      </div>

      {/* Grid Cards Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white rounded-2xl border border-border p-5 h-32 flex flex-col justify-between">
            <div className="h-4 w-1/3 bg-[#F3F4F6] rounded-md animate-pulse mb-4" />
            <div className="space-y-3">
              <div className="h-4 w-full bg-border rounded-md animate-pulse" />
              <div className="h-4 w-2/3 bg-[#F3F4F6] rounded-md animate-pulse" />
            </div>
          </div>
        ))}
      </div>

      {/* Main Content Skeleton */}
      <div className="bg-white rounded-2xl border border-border h-96 flex flex-col p-6">
        <div className="flex gap-6 mb-6 border-b border-[#F3F4F6] pb-4">
          <div className="h-6 w-20 bg-border rounded-md animate-pulse" />
          <div className="h-6 w-24 bg-[#F3F4F6] rounded-md animate-pulse" />
          <div className="h-6 w-20 bg-[#F3F4F6] rounded-md animate-pulse" />
        </div>
        <div className="flex-1 space-y-4">
          <div className="h-4 w-full bg-[#F3F4F6] rounded-md animate-pulse" />
          <div className="h-4 w-full bg-[#F3F4F6] rounded-md animate-pulse" />
          <div className="h-4 w-3/4 bg-[#F3F4F6] rounded-md animate-pulse" />
        </div>
      </div>
    </div>
  );

  const allProjectMembers = Array.from(new Map([
    ...(project.members || []).map(m => m.user),
    ...(project.teams?.flatMap(t => t.team.members) || [])
  ].map(u => [u.id, u])).values());

  const tabs = [
    { id: 'tasks' as Tab, label: `Tasks (${project.tasks?.length ?? 0})` },
    { id: 'team' as Tab, label: `Team (${allProjectMembers.length})` },
    { id: 'comments' as Tab, label: `Comments (${project.comments?.length ?? 0})` },
    { id: 'activity' as Tab, label: 'Activity' },
  ];

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const completedTasks = project.tasks?.filter((t) => t.status === 'COMPLETED').length ?? 0;
  const totalTasks = project.tasks?.length ?? 0;
  const overdueTasksCount = project.tasks?.filter(t => t.dueDate && new Date(t.dueDate) < todayStart && t.status !== 'COMPLETED').length || 0;

  // Tasks tab: filtering (multi-select)
  const projectTasks = (project.tasks || []) as any[];
  const taskAssignees = Array.from(new Map(
    projectTasks.flatMap((t) => (t.assignees?.length ? t.assignees : (t.assignee ? [t.assignee] : []))).map((a: any) => [a.id, a]),
  ).values());

  const filteredTasks = projectTasks.filter((t) => {
    if (taskSearch && !t.title.toLowerCase().includes(taskSearch.toLowerCase())) return false;
    if (taskStatusFilter.length && !taskStatusFilter.includes(t.status)) return false;
    if (taskTypeFilter.length && !taskTypeFilter.includes(t.type || 'OTHER')) return false;
    if (taskDueDateFilter) {
      if (!t.dueDate) return false;
      const due = new Date(t.dueDate); due.setHours(0, 0, 0, 0);
      const filter = new Date(taskDueDateFilter); filter.setHours(0, 0, 0, 0);
      if (due.getTime() !== filter.getTime()) return false;
    }
    if (taskAssigneeFilter.length) {
      const ids = t.assignees?.length ? t.assignees.map((a: any) => a.id) : (t.assignee ? [t.assignee.id] : []);
      if (!taskAssigneeFilter.some((id) => ids.includes(id))) return false;
    }
    return true;
  });

  let finalTasks = [...filteredTasks];
  finalTasks.sort((a, b) => {
    const priorityOrder: Record<string, number> = { URGENT: 5, CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
    const valA = priorityOrder[a.priority] || 0;
    const valB = priorityOrder[b.priority] || 0;
    return valB - valA;
  });

  const hasTaskFilters = !!(taskSearch || taskStatusFilter.length || taskAssigneeFilter.length || taskTypeFilter.length || taskDueDateFilter);
  let projectHealth: 'GREEN' | 'AMBER' | 'RED' = 'GREEN';
  if (overdueTasksCount >= 3 || (project.endDate && new Date(project.endDate) < todayStart && project.status !== 'COMPLETED')) {
    projectHealth = 'RED';
  } else if (overdueTasksCount >= 1) {
    projectHealth = 'AMBER';
  }
  
  const healthConfig = {
    GREEN: { color: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'On Track' },
    AMBER: { color: 'bg-amber-50 text-amber-700 border-amber-200', label: 'At Risk' },
    RED: { color: 'bg-red-50 text-red-700 border-red-200', label: 'Off Track' },
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <button onClick={() => router.push('/projects')} className="flex items-center gap-1.5 text-sm text-secondary hover:text-primary mb-4 md:mb-6 transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Projects
      </button>

      {/* Header Top Row */}
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6 mb-8">
        <div>
          <div className="flex flex-wrap items-center gap-2 md:gap-3 mb-2">
            <h1 className="text-xl md:text-3xl font-semibold text-primary tracking-tight">{project.name}</h1>
            <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium border ${healthConfig[projectHealth].color}`}>
              <div className={`h-1.5 w-1.5 rounded-full mr-1.5 ${projectHealth === 'GREEN' ? 'bg-emerald-500' : projectHealth === 'AMBER' ? 'bg-amber-500' : 'bg-red-500'}`} />
              {healthConfig[projectHealth].label}
            </span>
            <span className="inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200 capitalize">
              {project.type?.replace('_', ' ') || 'One Time'}
            </span>
            <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium border ${statusColors[project.status]} border-opacity-20`}>
              {project.status.replace('_', ' ')}
            </span>
          </div>
          <p className="text-base font-medium text-secondary">{project.client ? getClientDisplayName(project.client) : 'Internal Project'}</p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full sm:w-auto">
          {project.client?.lead?.id && (
            <button onClick={() => router.push(`/pipeline/${project.client!.lead!.id}`)} className="w-full sm:w-auto justify-center rounded-xl border border-border px-4 py-2 text-sm font-medium text-primary bg-white hover:bg-primary/5 transition-all flex items-center gap-1.5">
              Pipeline <ArrowUpRight className="h-4 w-4" />
            </button>
          )}
          {project.folderLink && (
            <a href={project.folderLink} target="_blank" rel="noopener noreferrer" className="w-full sm:w-auto justify-center rounded-xl border border-border px-4 py-2 text-sm font-medium text-[#2563EB] bg-white hover:bg-blue-50 transition-all flex items-center gap-1.5">
              Drive Folder
            </a>
          )}
          {user?.role !== 'TEAM_MEMBER' && (
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button onClick={startEditingProject} className="flex-1 sm:flex-none justify-center rounded-xl border border-border px-4 py-2 text-sm font-medium text-[#374151] bg-white hover:bg-[#F9FAFB] transition-all whitespace-nowrap">
                Edit Project
              </button>
              <button onClick={handleDeleteProject} className="flex-1 sm:flex-none justify-center rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 hover:border-red-300 transition-all flex items-center gap-1.5 whitespace-nowrap">
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Info Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        {/* Key Dates Card */}
        <div className="bg-white rounded-2xl border border-border p-5">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="h-4 w-4 text-[#9CA3AF]" />
            <span className="text-xs font-medium text-secondary uppercase tracking-wide">Key Dates</span>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-secondary">Start</span>
              <span className="font-medium text-primary">{formatDate(project.startDate) || '—'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-secondary">End</span>
              <span className="font-medium text-primary">{formatDate(project.endDate) || '—'}</span>
            </div>
          </div>
        </div>

        {/* Client Details Card */}
        <div className="bg-white rounded-2xl border border-border p-5">
          <div className="flex items-center gap-2 mb-4">
            <Briefcase className="h-4 w-4 text-[#9CA3AF]" />
            <span className="text-xs font-medium text-secondary uppercase tracking-wide">Client Details</span>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-secondary">Client</span>
              <span className="font-medium text-primary">{project.client ? getClientDisplayName(project.client) : 'Internal'}</span>
            </div>
            {project.client?.name !== 'Internal' && project.client?.company && (
              <div className="flex justify-between text-sm">
                <span className="text-secondary">Contact</span>
                <span className="font-medium text-primary">{project.client.name}</span>
              </div>
            )}
          </div>
        </div>

        {/* Progress Card */}
        <div className="bg-white rounded-2xl border border-border p-5">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 className="h-4 w-4 text-[#9CA3AF]" />
            <span className="text-xs font-medium text-secondary uppercase tracking-wide">Progress</span>
          </div>
          <div className="mt-1">
            <div className="flex justify-between items-end mb-2">
              <span className="text-2xl font-semibold text-primary leading-none">{project.progress}%</span>
              <span className="text-xs text-secondary">{completedTasks}/{totalTasks} tasks</span>
            </div>
            <div className="h-2 w-full rounded-full bg-[#F3F4F6] overflow-hidden">
              <div className="h-full rounded-full bg-primary" style={{ width: `${project.progress}%` }} />
            </div>
          </div>
        </div>

        {/* Assigned Team Card */}
        <div className="bg-white rounded-2xl border border-border p-5">
          <div className="flex items-center gap-2 mb-4">
            <Users className="h-4 w-4 text-[#9CA3AF]" />
            <span className="text-xs font-medium text-secondary uppercase tracking-wide">Assigned Team</span>
          </div>
          <div className="flex items-center gap-1 -space-x-2 mt-2">
            {allProjectMembers.slice(0, 5).map((m, i) => (
              <div key={m.id} className={`flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold border-2 border-white ${getAvatarColor(m.name)}`} style={{ zIndex: 5 - i }} title={m.name}>
                {getInitials(m.name)}
              </div>
            ))}
            {allProjectMembers.length > 5 && (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F3F4F6] text-secondary text-xs font-semibold border-2 border-white" style={{ zIndex: 0 }}>
                +{allProjectMembers.length - 5}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Scope & Notes Cards */}
      {(project.scope || project.projectNotes) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          {project.scope && (
            <div className="bg-white rounded-2xl border border-border p-6 relative">
              <span className="block text-xs font-medium text-secondary uppercase tracking-wide mb-3">Scope of Work</span>
              <div 
                className="text-sm text-[#374151] line-clamp-2 prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: project.scope }}
              />
              <button 
                onClick={() => setViewModalContent({ title: 'Scope of Work', content: project.scope || '' })}
                className="mt-3 text-xs font-medium text-[#2563EB] hover:text-[#1D4ED8]"
              >
                View full scope
              </button>
            </div>
          )}
          {project.projectNotes && (
            <div className="bg-white rounded-2xl border border-border p-6 relative">
              <span className="block text-xs font-medium text-secondary uppercase tracking-wide mb-3">Internal Notes</span>
              <div 
                className="text-sm text-[#374151] line-clamp-2 prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: project.projectNotes }}
              />
              <button 
                onClick={() => setViewModalContent({ title: 'Internal Notes', content: project.projectNotes || '' })}
                className="mt-3 text-xs font-medium text-[#2563EB] hover:text-[#1D4ED8]"
              >
                View full notes
              </button>
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto scrollbar-hide whitespace-nowrap">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-3 md:px-4 py-2.5 text-sm font-medium border-b-2 transition-all shrink-0 ${tab === t.id ? 'border-primary text-primary' : 'border-transparent text-secondary hover:text-primary'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'tasks' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3">
            {/* Search bar row */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-sm">
                <input
                  value={taskSearch}
                  onChange={(e) => setTaskSearch(e.target.value)}
                  placeholder="Search tasks..."
                  className="flex-1 w-full rounded-lg border border-border bg-white px-3 py-1.5 text-sm outline-none focus:border-primary transition-all"
                />
                <div className="hidden md:flex items-center rounded-lg border border-border p-0.5 bg-white shrink-0">
                  <button
                    onClick={() => setTaskView('list')}
                    className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-all ${taskView === 'list' ? 'bg-primary text-white' : 'text-secondary hover:text-primary'}`}
                  >
                    <LayoutList className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setTaskView('board')}
                    className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-all ${taskView === 'board' ? 'bg-primary text-white' : 'text-secondary hover:text-primary'}`}
                  >
                    <Kanban className="h-3.5 w-3.5" />
                  </button>
                </div>
                <button 
                  onClick={() => setShowTaskFilters(!showTaskFilters)} 
                  className="md:hidden flex items-center justify-center p-1.5 rounded-lg border border-border bg-white text-secondary hover:bg-gray-50 transition-colors"
                >
                  <Filter className="h-4 w-4" />
                </button>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={openCreateTask} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1F2937] transition-all">
                  <Plus className="h-3.5 w-3.5" /> Add Task
                </button>
                <button 
                  onClick={() => setShowViewSettings(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-medium text-secondary hover:text-primary transition-all shadow-sm" 
                  title="Customize View"
                >
                  <Settings className="h-3.5 w-3.5" /> Customize
                </button>
              </div>
            </div>
            {/* Filters row */}
            <div className={`flex flex-wrap items-center gap-2 ${showTaskFilters ? 'flex' : 'hidden md:flex'}`}>
              <div className="w-full md:w-40">
                <MultiSelect value={taskStatusFilter} onChange={setTaskStatusFilter} placeholder="Status" options={TASK_STATUS_OPTIONS} />
              </div>
              <div className="w-full md:w-40">
                <MultiSelect value={taskTypeFilter} onChange={setTaskTypeFilter} placeholder="Task Type" options={[
                  { label: 'Design', value: 'DESIGN' },
                  { label: 'Content', value: 'CONTENT' },
                  { label: 'Video', value: 'VIDEO' },
                  { label: 'Marketing', value: 'DIGITAL_MARKETING' },
                  { label: 'Social Media', value: 'SOCIAL_MEDIA' },
                  { label: 'Development', value: 'DEVELOPMENT' },
                  { label: 'Strategy', value: 'STRATEGY' },
                  { label: 'Business', value: 'BUSINESS' },
                  { label: 'Other', value: 'OTHER' },
                ]} />
              </div>
              <div className="w-full md:w-44">
                <MultiSelect value={taskAssigneeFilter} onChange={setTaskAssigneeFilter} placeholder="Assignee" options={taskAssignees.map((a: any) => ({ value: a.id, label: a.name, image: getInitials(a.name), colorClass: getAvatarColor(a.name) }))} />
              </div>
              <div className="w-full md:w-auto">
                <input
                  type="date"
                  value={taskDueDateFilter}
                  onChange={(e) => setTaskDueDateFilter(e.target.value)}
                  className="w-full rounded-lg border border-border bg-white px-3 py-1.5 text-sm outline-none focus:border-primary text-secondary"
                  title="Filter by due date"
                />
              </div>
              {hasTaskFilters && (
                <button
                  onClick={() => { setTaskSearch(''); setTaskStatusFilter([]); setTaskAssigneeFilter([]); setTaskTypeFilter([]); setTaskDueDateFilter(''); }}
                  className="text-xs text-secondary hover:text-primary underline px-1"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {taskView === 'board' ? (
            <TaskBoardView 
              tasks={finalTasks} 
              onUpdateTask={() => {
                queryClient.invalidateQueries({ queryKey: ['project', id] });
              }} 
              onTaskClick={(t) => setDetailTaskId(t.id)} 
            />
          ) : (
            <>
              {/* Desktop Table View */}
              <div className="hidden md:block rounded-2xl border border-border bg-white overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#F3F4F6]">
                      {visibleTaskColumns.includes('task') && <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wide">Task</th>}
                      {visibleTaskColumns.includes('type') && <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wide">Type</th>}
                      {visibleTaskColumns.includes('assignee') && <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wide">Assignee</th>}
                      {visibleTaskColumns.includes('status') && <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wide">Status</th>}
                      {visibleTaskColumns.includes('dueDate') && <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wide">Due Date</th>}
                      <th className="px-6 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F3F4F6]">
                    {finalTasks.length === 0 ? (
                      <tr><td colSpan={visibleTaskColumns.length + 1} className="px-6 py-8 text-center text-sm text-[#9CA3AF]">{hasTaskFilters ? 'No tasks match your filters' : 'No tasks yet'}</td></tr>
                    ) : (
                      finalTasks.map((t) => (
                        <tr key={t.id} className="hover:bg-surface transition-colors cursor-pointer" onClick={() => setDetailTaskId(t.id)}>
                          {visibleTaskColumns.includes('task') && (
                            <td className="px-6 py-3">
                              <div className="flex items-center gap-2">
                                <div className={`h-2 w-2 rounded-full shrink-0 ${priorityDots[t.priority]}`} />
                                <span className="text-sm font-medium text-primary">{t.title}</span>
                                {(t.loggedHours ?? 0) > 0 && (
                                  <div className="flex flex-col gap-1 ml-2">
                                    <span className="text-[10px] text-secondary bg-[#F3F4F6] px-1.5 py-0.5 rounded-md font-medium tabular-nums border border-border leading-none whitespace-nowrap">⏱ {t.loggedHours || 0}h</span>
                                  </div>
                                )}
                                {(t._count?.comments ?? 0) > 0 && (
                                  <span className="flex items-center gap-0.5 text-[10px] text-[#9CA3AF] ml-1"><MessageSquare className="h-3 w-3" />{t._count?.comments}</span>
                                )}
                              </div>
                            </td>
                          )}
                          {visibleTaskColumns.includes('type') && (
                            <td className="px-6 py-3">
                              <span className="text-xs text-secondary capitalize">{(t.type || 'other').toLowerCase().replace(/_/g, ' ')}</span>
                            </td>
                          )}
                          {visibleTaskColumns.includes('assignee') && (
                            <td className="px-6 py-3">
                              {t.assignee ? (
                                <div className="flex items-center gap-1.5">
                                  <div className={`h-5 w-5 rounded-full text-[8px] font-semibold flex items-center justify-center ${getAvatarColor(t.assignee.name)}`}>{getInitials(t.assignee.name)}</div>
                                  <span className="text-sm text-[#374151]">{t.assignee.name}{(t.assignees?.length || 0) > 1 ? ` +${t.assignees!.length - 1}` : ''}</span>
                                </div>
                              ) : <span className="text-sm text-[#9CA3AF]">—</span>}
                            </td>
                          )}
                          {visibleTaskColumns.includes('status') && (
                            <td className="px-6 py-3"><span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium ${TASK_STATUS_COLORS[t.status]}`}>{t.status.replace('_', ' ')}</span></td>
                          )}
                          {visibleTaskColumns.includes('dueDate') && (
                            <td className="px-6 py-3 text-sm text-secondary">{formatShortDate(t.dueDate)}</td>
                          )}
                          <td className="px-6 py-3 text-right">
                            {(user?.role !== 'TEAM_MEMBER' || t.assignee?.id === user?.id) && (
                              <div className="flex items-center justify-end gap-2">
                                <button onClick={(e) => startEditingTask(t, e)} className="text-xs font-medium text-secondary hover:text-primary transition-colors bg-white border border-border rounded-lg px-2.5 py-1">
                                  Edit
                                </button>
                                <button onClick={(e) => handleDeleteTask(t.id, e)} className="text-secondary hover:text-red-600 transition-colors bg-white border border-border rounded-lg p-1.5 hover:bg-red-50 hover:border-red-100">
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

              {/* Mobile Card View */}
              <div className="md:hidden flex flex-col gap-3">
                {finalTasks.length === 0 ? (
                  <div className="p-8 text-center text-sm text-[#9CA3AF] bg-white rounded-xl border border-border">
                    {hasTaskFilters ? 'No tasks match your filters' : 'No tasks yet'}
                  </div>
                ) : (
                  finalTasks.map((t) => (
                    <motion.div
                      key={t.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      onClick={() => setDetailTaskId(t.id)}
                      className="p-4 rounded-xl border border-border bg-white hover:border-primary cursor-pointer transition-colors"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-start gap-2 flex-1 pr-3">
                          <div className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${priorityDots[t.priority]}`} />
                          <div>
                            <p className="text-sm font-medium text-primary leading-tight">{t.title}</p>
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              <span className="text-xs font-medium text-secondary">{formatShortDate(t.dueDate)}</span>
                              {(t.loggedHours ?? 0) > 0 && (
                                <span className="text-[10px] text-secondary bg-[#F3F4F6] px-1.5 py-0.5 rounded-md font-medium tabular-nums border border-border">
                                  ⏱ {t.loggedHours || 0}h
                                </span>
                              )}
                              {(t._count?.comments ?? 0) > 0 && (
                                <span className="flex items-center gap-0.5 text-[10px] text-[#9CA3AF]">
                                  <MessageSquare className="h-3 w-3" />
                                  {t._count?.comments}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <span className={`shrink-0 inline-flex items-center rounded-lg px-2 py-0.5 text-[10px] font-medium ${TASK_STATUS_COLORS[t.status]}`}>
                          {t.status.replace('_', ' ')}
                        </span>
                      </div>
                      
                      <div className="flex items-center justify-between mt-4">
                        <div className="flex items-center gap-2">
                          {t.assignee ? (
                            <>
                              <div className={`h-6 w-6 rounded-full text-[10px] font-semibold flex items-center justify-center ${getAvatarColor(t.assignee.name)}`}>
                                {getInitials(t.assignee.name)}
                              </div>
                              <span className="text-xs font-medium text-[#374151]">{t.assignee.name}{(t.assignees?.length || 0) > 1 ? ` +${t.assignees!.length - 1}` : ''}</span>
                            </>
                          ) : (
                            <span className="text-xs text-[#9CA3AF]">Unassigned</span>
                          )}
                        </div>
                        
                        {(user?.role !== 'TEAM_MEMBER' || t.assignee?.id === user?.id) && (
                          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            <button onClick={(e) => startEditingTask(t, e)} className="text-xs font-medium text-secondary hover:text-primary transition-colors bg-white border border-border rounded-lg px-2.5 py-1">
                              Edit
                            </button>
                            <button onClick={(e) => handleDeleteTask(t.id, e)} className="text-secondary hover:text-red-600 transition-colors bg-white border border-border rounded-lg p-1.5 hover:bg-red-50 hover:border-red-100">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'team' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {allProjectMembers.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-2xl border border-border bg-white p-4">
 <div className={`h-10 w-10 rounded-xl text-sm font-semibold flex items-center justify-center ${getAvatarColor(m.name)}`}>{getInitials(m.name)}</div>
              <div>
                <p className="text-sm font-medium text-primary">{m.name}</p>
                <p className="text-xs text-[#9CA3AF]">{m.role?.replace('_', ' ')}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'comments' && (
        <div className="space-y-6 max-w-3xl">
          <div className="bg-white rounded-2xl border border-border p-4">
            <form onSubmit={handleAddComment}>
              <textarea
                value={commentContent}
                onChange={(e) => setCommentContent(e.target.value)}
                placeholder="Write a project comment or update..."
                className="w-full min-h-25 text-sm text-primary outline-none resize-y"
              />
              <div className="mt-4 flex justify-end">
                <button
                  type="submit"
                  disabled={submittingComment || !commentContent.trim()}
                  className="rounded-xl bg-primary px-4 py-2 text-xs font-medium text-white hover:bg-[#1F2937] disabled:opacity-50 transition-all flex items-center gap-1.5"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  {submittingComment ? 'Posting...' : 'Post Comment'}
                </button>
              </div>
            </form>
          </div>

          <div className="space-y-4">
            {project.comments?.length === 0 ? (
              <div className="py-8 text-center text-sm text-[#9CA3AF] bg-white rounded-2xl border border-dashed border-border">
                No comments yet. Be the first to start the discussion!
              </div>
            ) : (
              project.comments?.map((comment) => (
                <div key={comment.id} className="flex gap-4">
 <div className={`h-8 w-8 rounded-full text-[10px] font-semibold flex items-center justify-center shrink-0 mt-1 ${getAvatarColor(comment.author.name)}`}>
                    {getInitials(comment.author.name)}
                  </div>
                  <div className="flex-1 bg-white rounded-2xl border border-border p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-sm text-primary">{comment.author.name}</span>
                      <span className="text-xs text-[#9CA3AF]">{formatRelativeDate(comment.createdAt)}</span>
                    </div>
                    <p className="text-sm text-[#374151] whitespace-pre-wrap">{comment.content}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === 'activity' && (
        <div className="space-y-3">
          {project.activities?.map((a) => (
            <div key={a.id} className="flex items-start gap-3 py-2">
 <div className={`h-7 w-7 rounded-full text-[10px] font-semibold flex items-center justify-center shrink-0 ${getAvatarColor(a.user.name)}`}>{getInitials(a.user.name)}</div>
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
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg bg-white border-l border-border shadow-2xl shadow-black/10 overflow-y-auto">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6]">
                <h2 className="text-lg font-semibold text-primary">{isEditingTask ? 'Edit Task' : 'New Task'}</h2>
                <button onClick={() => setShowCreateTask(false)} className="p-2 rounded-xl hover:bg-[#F3F4F6]"><X className="h-4 w-4 text-secondary" /></button>
              </div>
              <form onSubmit={handleSaveTask} className="p-6 pb-24 md:pb-6 space-y-4">
                <div>
                  <label htmlFor="pt-title" className="block text-sm font-medium text-[#374151] mb-1.5">Title *</label>
                  <input id="pt-title" value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} required className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary transition-all" />
                </div>
                <div>
                  <label htmlFor="pt-dueDate" className="block text-sm font-medium text-[#374151] mb-1.5">Due Date and Time</label>
                  <input id="pt-dueDate" type="datetime-local" value={taskForm.dueDate} onChange={(e) => setTaskForm({ ...taskForm, dueDate: e.target.value })} className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary transition-all" />
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={taskForm.isRecurring} onChange={(e) => setTaskForm({ ...taskForm, isRecurring: e.target.checked })} className="rounded border-border text-primary focus:ring-primary w-4 h-4" />
                    <span className="text-sm font-medium text-[#374151]">Repeat Task</span>
                  </label>
                </div>
                {taskForm.isRecurring && (
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Repeat Frequency</label>
                    <Select
                      ariaLabel="Repeat Frequency"
                      value={taskForm.recurrenceFrequency || 'WEEKLY'}
                      onChange={(val) => setTaskForm({ ...taskForm, recurrenceFrequency: val })}
                      options={[{ label: 'Daily', value: 'DAILY' }, { label: 'Weekly', value: 'WEEKLY' }, { label: 'Monthly', value: 'MONTHLY' }, { label: 'Yearly', value: 'YEARLY' }]}
                    />
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Description</label>
                  <RichTextEditor value={taskForm.description} onChange={(val) => setTaskForm({ ...taskForm, description: val })} placeholder="Add task details..." />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Task Type</label>
                    <Select
                      ariaLabel="Task Type"
                      value={taskForm.type as any}
                      onChange={(val) => setTaskForm({ ...taskForm, type: val })}
                      options={[
                        { label: 'Design', value: 'DESIGN' },
                        { label: 'Content', value: 'CONTENT' },
                        { label: 'Video', value: 'VIDEO' },
                        { label: 'Digital Marketing', value: 'DIGITAL_MARKETING' },
                        { label: 'Social Media', value: 'SOCIAL_MEDIA' },
                        { label: 'Development', value: 'DEVELOPMENT' },
                        { label: 'Strategy', value: 'STRATEGY' },
                        { label: 'Business', value: 'BUSINESS' },
                        { label: 'Other', value: 'OTHER' },
                      ]}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Reviewer</label>
                    <Select
                      ariaLabel="Reviewer"
                      value={taskForm.reviewerId}
                      onChange={(val) => setTaskForm({ ...taskForm, reviewerId: val })}
                      options={[{ label: 'No Reviewer', value: '' }, ...allProjectMembers.map((m) => ({ label: m.name, value: m.id, sublabel: (m as any).designation, avatar: getInitials(m.name) }))]}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Assigned By</label>
                    <Select
                      ariaLabel="Assigned By"
                      value={taskForm.assignedById}
                      onChange={(val) => setTaskForm({ ...taskForm, assignedById: val })}
                      options={[{ label: 'Self (Default)', value: '' }, ...allProjectMembers.map((m) => ({ label: m.name, value: m.id, sublabel: (m as any).designation, avatar: getInitials(m.name) }))]}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Assignees</label>
                    <MultiSelect
                      compact={false}
                      value={taskForm.assigneeIds}
                      onChange={(vals) => setTaskForm({ ...taskForm, assigneeIds: vals })}
                      placeholder="Add assignees..."
                      options={allProjectMembers.map((m) => ({ value: m.id, label: m.name, image: getInitials(m.name), colorClass: getAvatarColor(m.name) }))}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Priority</label>
                    <Select
                      ariaLabel="Priority"
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
                    <label htmlFor="pt-assignedDate" className="block text-sm font-medium text-[#374151] mb-1.5">Assigned Date</label>
                    <input id="pt-assignedDate" type="date" value={taskForm.assignedDate} onChange={(e) => setTaskForm({ ...taskForm, assignedDate: e.target.value })} className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary transition-all" />
                  </div>
                  <div>
                    <label htmlFor="pt-loggedHours" className="block text-sm font-medium text-[#374151] mb-1.5">Time Spent (hours)</label>
                    <input id="pt-loggedHours" type="number" step="0.5" min="0" value={taskForm.loggedHours} onChange={(e) => setTaskForm({ ...taskForm, loggedHours: parseFloat(e.target.value) || 0 })} className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary transition-all" />
                  </div>
                </div>
                <div>
                  <label htmlFor="pt-driveLink" className="block text-sm font-medium text-[#374151] mb-1.5">Drive Link (Uploads, Drafts)</label>
                  <input id="pt-driveLink" type="url" value={taskForm.driveLink} onChange={(e) => setTaskForm({ ...taskForm, driveLink: e.target.value })} placeholder="https://drive.google.com/..." className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary transition-all" />
                </div>
                {isEditingTask && (
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Status</label>
                    <Select
                      ariaLabel="Status"
                      value={taskForm.status}
                      onChange={(val) => setTaskForm({ ...taskForm, status: val })}
                      options={TASK_STATUS_OPTIONS}
                    />
                  </div>
                )}
                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => setShowCreateTask(false)} className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] transition-all">Cancel</button>
                  <button type="submit" disabled={submittingTask} className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] disabled:opacity-50 transition-all">{submittingTask ? 'Saving...' : isEditingTask ? 'Save Changes' : 'Create Task'}</button>
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
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg bg-white border-l border-border shadow-2xl shadow-black/10 overflow-y-auto">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6]">
                <h2 className="text-lg font-semibold text-primary">Edit Project</h2>
                <button onClick={() => setShowEditProject(false)} className="p-2 rounded-xl hover:bg-[#F3F4F6]"><X className="h-4 w-4 text-secondary" /></button>
              </div>
              <form onSubmit={handleEditProject} className="p-6 pb-24 md:pb-6 space-y-8">
                {/* Basic Info */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-primary border-b border-[#F3F4F6] pb-2">Basic Info</h3>
                  <div>
                    <label htmlFor="pe-name" className="block text-sm font-medium text-[#374151] mb-1.5">Project Name *</label>
                    <input id="pe-name" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary transition-all" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Description</label>
                    <RichTextEditor value={editForm.description} onChange={(val) => setEditForm({ ...editForm, description: val })} placeholder="Project description..." />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-[#374151] mb-1.5">Project Type</label>
                      <Select
                        ariaLabel="Project Type"
                        value={editForm.type}
                        onChange={(val) => setEditForm({ ...editForm, type: val })}
                        options={[
                          { label: 'Retainer', value: 'RETAINER' },
                          { label: 'One-Time Project', value: 'ONE_TIME' },
                          { label: 'Event', value: 'EVENT' },
                          { label: 'Internal', value: 'INTERNAL' },
                        ]}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[#374151] mb-1.5">Status</label>
                      <Select
                        ariaLabel="Status"
                        value={editForm.status}
                        onChange={(val) => setEditForm({ ...editForm, status: val })}
                        options={[
                          { label: 'Planning', value: 'PLANNING' },
                          { label: 'In Progress', value: 'IN_PROGRESS' },
                          { label: 'In Review', value: 'REVIEW' },
                          { label: 'Completed', value: 'COMPLETED' },
                          { label: 'On Hold', value: 'ON_HOLD' },
                          { label: 'Cancelled', value: 'CANCELLED' },
                        ]}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[#374151] mb-1.5">Priority</label>
                      <Select
                        ariaLabel="Priority"
                        value={editForm.priority}
                        onChange={(val) => setEditForm({ ...editForm, priority: val })}
                        options={[
                          { label: 'Low', value: 'LOW' },
                          { label: 'Medium', value: 'MEDIUM' },
                          { label: 'High', value: 'HIGH' },
                          { label: 'Urgent', value: 'CRITICAL' },
                        ]}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[#374151] mb-1.5">Platform</label>
                      <Select
                        ariaLabel="Platform"
                        value={editForm.platform}
                        onChange={(val) => setEditForm({ ...editForm, platform: val })}
                        options={[
                          { label: 'None', value: '' },
                          { label: 'Instagram', value: 'INSTAGRAM' },
                          { label: 'Facebook', value: 'FACEBOOK' },
                          { label: 'LinkedIn', value: 'LINKEDIN' },
                          { label: 'X (Twitter)', value: 'X_TWITTER' },
                          { label: 'TikTok', value: 'TIKTOK' },
                          { label: 'YouTube', value: 'YOUTUBE' },
                          { label: 'Google Ads', value: 'GOOGLE_ADS' },
                          { label: 'Website', value: 'WEBSITE' },
                          { label: 'Mobile App', value: 'MOBILE_APP' },
                          { label: 'E-Commerce', value: 'E_COMMERCE' },
                          { label: 'Cross Platform', value: 'CROSS_PLATFORM' },
                          { label: 'Other', value: 'OTHER' },
                        ]}
                      />
                    </div>
                  </div>
                </div>

                {/* Client & Ownership */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-primary border-b border-[#F3F4F6] pb-2">Client & Ownership</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-[#374151] mb-1.5">Client</label>
                      <Select
                        ariaLabel="Client"
                        value={editForm.clientId}
                        onChange={(val) => setEditForm({ ...editForm, clientId: val })}
                        options={[{ label: 'Select a client...', value: '' }, ...clients.filter((c: any) => !['PROJECT_COMPLETED', 'CHURNED'].includes(c.status) || c.id === editForm.clientId).map(c => ({ label: getClientDisplayName(c), value: c.id }))]}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[#374151] mb-1.5">Project Owner *</label>
                      <Select
                        ariaLabel="Project Owner"
                        value={editForm.ownerId}
                        onChange={(val) => setEditForm({ ...editForm, ownerId: val })}
                        options={[{ label: 'Select owner', value: '' }, ...members.map(m => ({ label: m.name, value: m.id, sublabel: (m as any).designation, avatar: getInitials(m.name) }))]}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Team Members</label>
                    <MultiSelect
                      compact={false}
 options={members.filter(m => m.id !== editForm.ownerId).map(m => ({ value: m.id, label: m.name, image: getInitials(m.name), colorClass: getAvatarColor(m.name) }))}
                      value={editForm.memberIds}
                      onChange={(val) => setEditForm({ ...editForm, memberIds: val })}
                      placeholder="Search and select team members..."
                    />
                  </div>
                </div>

                {/* Timeline */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-primary border-b border-[#F3F4F6] pb-2">Timeline</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="pe-startDate" className="block text-sm font-medium text-[#374151] mb-1.5">Start Date</label>
                      <input id="pe-startDate" type="date" value={editForm.startDate} onChange={(e) => setEditForm({ ...editForm, startDate: e.target.value })} className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary transition-all" />
                    </div>
                    <div>
                      <label htmlFor="pe-endDate" className="block text-sm font-medium text-[#374151] mb-1.5">End Date {(editForm.type === 'ONE_TIME' || editForm.type === 'EVENT') && '*'}</label>
                      <input id="pe-endDate" type="date" value={editForm.endDate} onChange={(e) => setEditForm({ ...editForm, endDate: e.target.value })} required={editForm.type === 'ONE_TIME' || editForm.type === 'EVENT'} className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary transition-all" />
                    </div>
                  </div>
                </div>

                {/* Scope */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-primary border-b border-[#F3F4F6] pb-2">Scope</h3>
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Scope of Work</label>
                    <RichTextEditor 
                      value={editForm.scope} 
                      onChange={(val) => setEditForm({ ...editForm, scope: val })} 
                      placeholder="Enter the scope of work..."
                    />
                  </div>
                  <div>

                  </div>
                </div>

                {/* Workflow */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-primary border-b border-[#F3F4F6] pb-2">Workflow</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-[#374151] mb-1.5">Reporting Cadence</label>
                      <Select
                        ariaLabel="Reporting Cadence"
                        value={editForm.reportingCadence}
                        onChange={(val) => setEditForm({ ...editForm, reportingCadence: val })}
                        options={[
                          { label: 'None', value: 'NONE' },
                          { label: 'Weekly', value: 'WEEKLY' },
                          { label: 'Fortnightly', value: 'FORTNIGHTLY' },
                          { label: 'Monthly', value: 'MONTHLY' },
                        ]}
                      />
                    </div>
                    <div className="flex items-center gap-3 h-full pt-6">
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input 
                          type="checkbox" 
                          className="sr-only peer" 
                          checked={editForm.clientApprovalRequired} 
                          onChange={(e) => setEditForm({ ...editForm, clientApprovalRequired: e.target.checked })} 
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                        <span className="ml-3 text-sm font-medium text-[#374151]">Client approval required</span>
                      </label>
                    </div>
                  </div>
                </div>

                {/* Reference */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-primary border-b border-[#F3F4F6] pb-2">Reference</h3>
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Tags</label>
                    <TagsInput 
                      value={editForm.tags} 
                      onChange={(val) => setEditForm({ ...editForm, tags: val })} 
                      placeholder="Type and press Enter to add tags..."
                    />
                  </div>
                  <div>
                    <label htmlFor="pe-notes" className="block text-sm font-medium text-[#374151] mb-1.5">Notes</label>
                    <textarea
                      id="pe-notes"
                      value={editForm.projectNotes}
                      onChange={(e) => setEditForm({ ...editForm, projectNotes: e.target.value })}
                      className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary transition-all min-h-[80px]"
                      placeholder="Internal project notes..."
                    />
                  </div>
                  <div>
                    <label htmlFor="pe-folderLink" className="block text-sm font-medium text-[#374151] mb-1.5">Folder Link (URL)</label>
                    <input id="pe-folderLink" type="url" value={editForm.folderLink} onChange={(e) => setEditForm({ ...editForm, folderLink: e.target.value })} className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary transition-all" />
                  </div>
                </div>

                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => setShowEditProject(false)} className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] transition-all">Cancel</button>
                  <button type="submit" disabled={submittingEdit} className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] disabled:opacity-50 transition-all">{submittingEdit ? 'Saving...' : 'Save Changes'}</button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Modals */}
      <AnimatePresence>
        {/* View Content Modal */}
        {viewModalContent && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={() => setViewModalContent(null)} />
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg bg-white border-l border-border shadow-2xl shadow-black/10 flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6] shrink-0">
                <h2 className="text-lg font-semibold text-primary">{viewModalContent.title}</h2>
                <button onClick={() => setViewModalContent(null)} className="p-2 rounded-xl hover:bg-[#F3F4F6]"><X className="h-4 w-4 text-secondary" /></button>
              </div>
              <div className="p-6 pb-24 md:pb-6 overflow-y-auto flex-1">
                <div 
                  className="prose prose-sm max-w-none text-[#374151]"
                  dangerouslySetInnerHTML={{ __html: viewModalContent.content }}
                />
              </div>
            </motion.div>
          </>
        )}

        {/* Milestone Modal */}
        {showMilestoneModal && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={() => setShowMilestoneModal(false)} />
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-white border-l border-border shadow-2xl shadow-black/10 overflow-y-auto">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6]">
                <h2 className="text-lg font-semibold text-primary">{isEditingMilestone ? 'Edit Milestone' : 'New Milestone'}</h2>
                <button onClick={() => setShowMilestoneModal(false)} className="p-2 rounded-xl hover:bg-[#F3F4F6]"><X className="h-4 w-4 text-secondary" /></button>
              </div>
              <form onSubmit={handleSaveMilestone} className="p-6 pb-24 md:pb-6 space-y-4">
                <div>
                  <label htmlFor="ms-name" className="block text-sm font-medium text-[#374151] mb-1.5">Milestone Name *</label>
                  <input id="ms-name" value={milestoneForm.name} onChange={(e) => setMilestoneForm({ ...milestoneForm, name: e.target.value })} required className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary transition-all" />
                </div>
                <div>
                  <label htmlFor="ms-dueDate" className="block text-sm font-medium text-[#374151] mb-1.5">Due Date</label>
                  <input id="ms-dueDate" type="date" value={milestoneForm.dueDate} onChange={(e) => setMilestoneForm({ ...milestoneForm, dueDate: e.target.value })} className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary transition-all" />
                </div>
                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => setShowMilestoneModal(false)} className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] transition-all">Cancel</button>
                  <button type="submit" disabled={submittingMilestone} className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] disabled:opacity-50 transition-all">{submittingMilestone ? 'Saving...' : 'Save Milestone'}</button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Task detail (read view + status + comments), opened by clicking a task */}
      <AnimatePresence>
        {detailTaskId && (
          <TaskDetailDrawer
            taskId={detailTaskId}
            onClose={() => setDetailTaskId(null)}
            onChanged={async () => {
              try {
                const updated = await api.get<ProjectDetail>(`/projects/${id}`);
                setProject(updated);
              } catch { /* ignore */ }
            }}
            onEdit={(t) => { setDetailTaskId(null); startEditingTask(t); }}
            canManage={user?.role !== 'TEAM_MEMBER'}
            currentUserId={user?.id}
          />
        )}
      </AnimatePresence>

      <ViewSettingsPanel
        isOpen={showViewSettings}
        onClose={() => setShowViewSettings(false)}
        viewName={viewName}
        onViewNameChange={setViewName}
        viewType={taskView}
        onViewTypeChange={setTaskView}
        columns={ALL_TASK_COLUMNS}
        visibleColumns={visibleTaskColumns}
        onVisibleColumnsChange={setVisibleTaskColumns}
        onSave={() => {
          localStorage.setItem(`flowzen_view_tasks_${id}`, JSON.stringify({ viewType: taskView, visibleColumns: visibleTaskColumns, name: viewName }));
          setShowViewSettings(false);
          toast.success('View saved successfully');
        }}
        onReset={() => {
          setTaskView('list');
          setVisibleTaskColumns(ALL_TASK_COLUMNS.map(c => c.id));
          setViewName('All Tasks');
        }}
      />
    </motion.div>
  );
}
