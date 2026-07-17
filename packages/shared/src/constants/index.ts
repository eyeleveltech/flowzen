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
  CHURNED: { bg: 'bg-rose-50', text: 'text-rose-700', dot: 'bg-rose-500' },
  PROJECT_COMPLETED: { bg: 'bg-gray-50', text: 'text-gray-600', dot: 'bg-gray-400' },
  COMPLETED: { bg: 'bg-gray-50', text: 'text-gray-600', dot: 'bg-gray-400' },

  // Project statuses
  PLANNING: { bg: 'bg-violet-50', text: 'text-violet-700', dot: 'bg-violet-500' },
  IN_PROGRESS: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
  REVIEW: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  ON_HOLD: { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500' },
  CANCELLED: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },

  // Task statuses
  BACKLOG: { bg: 'bg-gray-50', text: 'text-gray-500', dot: 'bg-gray-400' },
  TODO: { bg: 'bg-slate-50', text: 'text-slate-600', dot: 'bg-slate-400' },
  APPROVED: { bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
  BLOCKED: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
};

export const PRIORITY_COLORS: Record<string, { bg: string; text: string; icon: string }> = {
  LOW: { bg: 'bg-gray-50', text: 'text-gray-500', icon: '○' },
  MEDIUM: { bg: 'bg-blue-50', text: 'text-blue-600', icon: '◐' },
  HIGH: { bg: 'bg-orange-50', text: 'text-orange-600', icon: '●' },
  CRITICAL: { bg: 'bg-red-50', text: 'text-red-600', icon: '◉' },
  URGENT: { bg: 'bg-red-50', text: 'text-red-600', icon: '⚡' },
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
