export const CLIENT_STATUSES = ['PROSPECT', 'ACTIVE', 'ONHOLD', 'CHURNED', 'PROJECT_COMPLETED'] as const;

export const PROJECT_STATUSES = ['PLANNING', 'IN_PROGRESS', 'REVIEW', 'COMPLETED', 'ON_HOLD', 'CANCELLED'] as const;

export const PROJECT_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export const TASK_STATUSES = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'APPROVED', 'BLOCKED', 'ON_HOLD', 'COMPLETED'] as const;

export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

export const USER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'PROJECT_MANAGER', 'TEAM_MEMBER'] as const;

export const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  // Client statuses
  PROSPECT: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
  ACTIVE: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  ONHOLD: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  CHURNED: { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
  PROJECT_COMPLETED: { bg: 'bg-slate-50', text: 'text-slate-700', dot: 'bg-slate-400' },
  COMPLETED: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },

  // Project statuses
  PLANNING: { bg: 'bg-slate-50', text: 'text-slate-700', dot: 'bg-slate-400' },
  IN_PROGRESS: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
  REVIEW: { bg: 'bg-purple-50', text: 'text-purple-700', dot: 'bg-purple-500' },
  ON_HOLD: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  CANCELLED: { bg: 'bg-rose-50', text: 'text-rose-700', dot: 'bg-rose-500' },

  // Task statuses
  BACKLOG: { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
  TODO: { bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400' },
  APPROVED: { bg: 'bg-teal-50', text: 'text-teal-700', dot: 'bg-teal-500' },
  BLOCKED: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
};

export const PRIORITY_CONFIG: Record<string, { dot: string; badge: string; color: string; label: string; icon: string }> = {
  LOW: { dot: 'bg-gray-300', badge: 'bg-gray-100 text-gray-700 border-gray-200', color: 'text-gray-400', label: 'Low', icon: '○' },
  MEDIUM: { dot: 'bg-blue-400', badge: 'bg-blue-50 text-blue-700 border-blue-200', color: 'text-blue-500', label: 'Medium', icon: '◐' },
  HIGH: { dot: 'bg-orange-500', badge: 'bg-amber-50 text-amber-700 border-amber-200', color: 'text-orange-500', label: 'High', icon: '●' },
  CRITICAL: { dot: 'bg-red-500', badge: 'bg-red-50 text-red-700 border-red-200', color: 'text-red-500', label: 'Critical', icon: '◉' },
  URGENT: { dot: 'bg-red-500', badge: 'bg-red-50 text-red-700 border-red-200', color: 'text-red-500', label: 'Urgent', icon: '⚡' },
};

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  PROJECT_MANAGER: 'Project Manager',
  TEAM_MEMBER: 'Team Member',
};

export const STATUS_LABELS: Record<string, string> = {
  PROSPECT: 'Prospect',
  ACTIVE: 'Active',
  ONHOLD: 'On Hold',
  CHURNED: 'Churned',
  PROJECT_COMPLETED: 'Project Completed',
  COMPLETED: 'Completed',
  PLANNING: 'Planning',
  IN_PROGRESS: 'In Progress',
  REVIEW: 'Review',
  APPROVED: 'Approved',
  ON_HOLD: 'On Hold',
  CANCELLED: 'Cancelled',
  BACKLOG: 'Backlog',
  TODO: 'To Do',
  BLOCKED: 'Blocked',
};
