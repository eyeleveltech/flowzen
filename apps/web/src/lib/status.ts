import { LEAD_STAGE_LABELS } from './lead-stage';

// Pipeline stages reuse the canonical labels rather than restating them — restating is how the
// board ("Won & Closed") and this map ("Contract") drifted apart in the first place.
//
// CHURNED and PROJECT_COMPLETED are held back because they are *client* statuses too, and there
// the right words are "Churned" / "Project Completed" (defined below), whereas the same lead
// stage reads "Lost & Closed". ON_HOLD is dropped only because it is already declared as a
// client status with an identical label.
const STAGE_KEYS_OWNED_BY_STATUSES = new Set(['CHURNED', 'PROJECT_COMPLETED', 'ON_HOLD']);
const PIPELINE_STAGE_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(LEAD_STAGE_LABELS).filter(([key]) => !STAGE_KEYS_OWNED_BY_STATUSES.has(key)),
);

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

  // Document & Quote statuses
  DRAFT: 'Draft',
  SENT: 'Sent',
  ACCEPTED: 'Accepted',
  EXPIRED: 'Expired',

  // Invoice & Payment statuses
  PAID: 'Paid',
  UNPAID: 'Unpaid',
  OVERDUE: 'Overdue',
  PARTIAL: 'Partially Paid',
  REFUNDED: 'Refunded',

  // Subscription & Contract statuses
  UPCOMING: 'Upcoming',
  IN_DISCUSSION: 'In Discussion',
  AT_RISK: 'At Risk',
  RENEWED: 'Renewed',
  TERMINATED: 'Terminated',

  // Pipeline stages — inherited from lib/lead-stage.ts (see the note at the top of this file).
  // Anything rendering a lead's stage should call leadStageLabel() directly; these exist so a
  // stray getStatusLabel(stage) still produces the right words instead of a raw enum.
  ...PIPELINE_STAGE_LABELS,

  // Legacy values from earlier pipeline shapes, kept so old records still render readably.
  LEAD: 'Lead',
  CONTACTED: 'Contacted',
  MEETING_SCHEDULED: 'Meeting Scheduled',
  NEEDS_ANALYSIS: 'Needs Analysis',
  PROPOSAL_SENT: 'Proposal Sent',
  WON: 'Won',
  LOST: 'Lost',
};

/**
 * Four tones. That is the whole vocabulary.
 *
 * This map previously spent NINE colour families (blue, emerald, amber, gray, slate, purple,
 * rose, red, teal) on 29 statuses, and several of them said the same thing twice: red AND rose
 * both meant "bad", emerald AND teal both meant "good", and purple meant nothing in particular.
 *
 * The rule now is: in a monochrome product, colour means "act on this". Blue on "Prospect" spent
 * attention on a state that needs no action, and every colour spent that way makes a red
 * "Overdue" harder to find. So anything that is merely a normal step in a process is neutral,
 * and the three semantic tones are kept for states a person should actually do something about.
 *
 * The three semantic tones deliberately match the palette tokens exactly — red-500 is
 * --color-danger, amber-500 is --color-warning, green-500 is --color-success — so a badge and an
 * icon tinted from the token cannot drift apart.
 *
 * Contrast: NEUTRAL is 9.3:1, QUIET is 4.6:1, both AA for normal text.
 */

/** A normal step in a process. Nothing is wrong, nothing is owed. */
const NEUTRAL = { bg: 'bg-subtle', text: 'text-body', border: 'border-border', dot: 'bg-secondary', bar: 'bg-secondary' };
/** Finished or abandoned. Kept quieter than NEUTRAL so closed records recede in a list. */
const QUIET = { bg: 'bg-surface', text: 'text-secondary', border: 'border-border', dot: 'bg-line', bar: 'bg-line' };
/** Needs attention soon. */
const WARN = { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500', bar: 'bg-amber-500' };
/** Needs action now. */
const DANGER = { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', dot: 'bg-red-500', bar: 'bg-red-500' };
/** Money or a contract landed. Reserved for outcomes, not for every completed thing. */
const GOOD = { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', dot: 'bg-green-500', bar: 'bg-green-500' };

export const STATUS_COLORS: Record<string, StatusConfig> = {
  // Client & General Active statuses
  PROSPECT: { label: 'Prospect', ...NEUTRAL },
  ACTIVE: { label: 'Active', ...GOOD },
  ONHOLD: { label: 'On Hold', ...WARN },
  CHURNED: { label: 'Churned', ...QUIET },
  PROJECT_COMPLETED: { label: 'Project Completed', ...QUIET },

  // Project statuses
  PLANNING: { label: 'Planning', ...NEUTRAL },
  IN_PROGRESS: { label: 'In Progress', ...NEUTRAL },
  REVIEW: { label: 'Review', ...NEUTRAL },
  COMPLETED: { label: 'Completed', ...QUIET },
  ON_HOLD: { label: 'On Hold', ...WARN },
  CANCELLED: { label: 'Cancelled', ...QUIET },

  // Task statuses
  BACKLOG: { label: 'Backlog', ...QUIET },
  TODO: { label: 'To Do', ...NEUTRAL },
  APPROVED: { label: 'Approved', ...NEUTRAL },
  BLOCKED: { label: 'Blocked', ...DANGER },

  // Document, Invoice & Quote statuses
  DRAFT: { label: 'Draft', ...QUIET },
  SENT: { label: 'Sent', ...NEUTRAL },
  ACCEPTED: { label: 'Accepted', ...GOOD },
  EXPIRED: { label: 'Expired', ...WARN },

  // Payment & Financial statuses
  PAID: { label: 'Paid', ...GOOD },
  UNPAID: { label: 'Unpaid', ...WARN },
  OVERDUE: { label: 'Overdue', ...DANGER },
  PARTIAL: { label: 'Partially Paid', ...NEUTRAL },
  REFUNDED: { label: 'Refunded', ...NEUTRAL },
  UPCOMING: { label: 'Upcoming', ...NEUTRAL },
  IN_DISCUSSION: { label: 'In Discussion', ...WARN },
  AT_RISK: { label: 'At Risk', ...DANGER },
  RENEWED: { label: 'Renewed', ...GOOD },
  TERMINATED: { label: 'Terminated', ...QUIET },
};

const DEFAULT_STATUS_CONFIG: StatusConfig = { label: '', ...QUIET };

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
