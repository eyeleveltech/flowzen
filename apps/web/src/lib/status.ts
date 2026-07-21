export interface StatusConfig {
  label: string;
  bg: string;
  text: string;
  border: string;
  dot: string;
  bar?: string;
}

export const STATUS_LABELS: Record<string, string> = {
  // Client statuses
  PROSPECT: 'Prospect',
  ACTIVE: 'Active',
  ONHOLD: 'On Hold',
  CHURNED: 'Churned',
  PROJECT_COMPLETED: 'Project Completed',

  // Project statuses
  PLANNING: 'Planning',
  IN_PROGRESS: 'In Progress',
  REVIEW: 'Review',
  COMPLETED: 'Completed',
  ON_HOLD: 'On Hold',
  CANCELLED: 'Cancelled',

  // Task statuses
  BACKLOG: 'Backlog',
  TODO: 'To Do',
  APPROVED: 'Approved',
  BLOCKED: 'Blocked',

  // Pipeline stages
  NEW_LEAD: 'New Lead',
  LEAD: 'Lead',
  OUTREACH: 'Outreach',
  CONTACTED: 'Contacted',
  MEETING: 'Meeting',
  MEETING_SCHEDULED: 'Meeting Scheduled',
  NEEDS_ANALYSIS: 'Needs Analysis',
  PROPOSAL: 'Proposal',
  PROPOSAL_SENT: 'Proposal Sent',
  NEGOTIATION: 'Negotiation',
  CONTRACT: 'Contract',
  WON: 'Won',
  ACTIVE_RETAINER: 'Active Retainer',
  ACTIVE_PROJECT: 'Active Project',
  LOST: 'Lost',
};

export const STATUS_COLORS: Record<string, StatusConfig> = {
  // Client statuses
  PROSPECT: { label: 'Prospect', bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500', bar: 'bg-blue-500' },
  ACTIVE: { label: 'Active', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500', bar: 'bg-emerald-500' },
  ONHOLD: { label: 'On Hold', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500', bar: 'bg-amber-500' },
  CHURNED: { label: 'Churned', bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-200', dot: 'bg-gray-400', bar: 'bg-gray-400' },
  PROJECT_COMPLETED: { label: 'Project Completed', bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200', dot: 'bg-slate-400', bar: 'bg-slate-400' },

  // Project statuses
  PLANNING: { label: 'Planning', bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200', dot: 'bg-slate-400', bar: 'bg-slate-400' },
  IN_PROGRESS: { label: 'In Progress', bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500', bar: 'bg-blue-500' },
  REVIEW: { label: 'Review', bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', dot: 'bg-purple-500', bar: 'bg-purple-500' },
  COMPLETED: { label: 'Completed', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500', bar: 'bg-emerald-500' },
  ON_HOLD: { label: 'On Hold', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500', bar: 'bg-amber-500' },
  CANCELLED: { label: 'Cancelled', bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', dot: 'bg-rose-500', bar: 'bg-rose-500' },

  // Task statuses
  BACKLOG: { label: 'Backlog', bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-200', dot: 'bg-gray-400', bar: 'bg-gray-400' },
  TODO: { label: 'To Do', bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200', dot: 'bg-slate-400', bar: 'bg-slate-400' },
  APPROVED: { label: 'Approved', bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200', dot: 'bg-teal-500', bar: 'bg-teal-500' },
  BLOCKED: { label: 'Blocked', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', dot: 'bg-red-500', bar: 'bg-red-500' },
};

const DEFAULT_STATUS_CONFIG: StatusConfig = {
  label: '',
  bg: 'bg-gray-50',
  text: 'text-gray-600',
  border: 'border-gray-200',
  dot: 'bg-gray-400',
  bar: 'bg-gray-400',
};

export function getStatusLabel(status?: string | null): string {
  if (!status) return '—';
  return STATUS_LABELS[status] || status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function getStatusColor(status?: string | null): StatusConfig {
  if (!status || !STATUS_COLORS[status]) {
    return {
      ...DEFAULT_STATUS_CONFIG,
      label: getStatusLabel(status),
    };
  }
  return STATUS_COLORS[status];
}
