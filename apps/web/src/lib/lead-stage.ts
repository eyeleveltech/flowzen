/**
 * The single source of truth for how a lead's pipeline stage is named and ordered.
 *
 * Before this existed the same stage was written four different ways: the board said
 * "Won & Closed", the dashboard said "Contract", the list view and detail page printed the raw
 * enum ("ACTIVE RETAINER"), and the transition modal borrowed the generic status map. Anything
 * that shows a stage to a user must import from here.
 *
 * Kept separate from `lib/status.ts` on purpose: CHURNED and PROJECT_COMPLETED are also *client*
 * statuses, where "Churned" and "Project Completed" are the correct words. The same key means
 * different things in the two contexts, so one shared map cannot serve both.
 */

export const LEAD_STAGES = [
  'NEW_LEAD',
  'OUTREACH',
  'MEETING',
  'PROPOSAL',
  'NEGOTIATION',
  'CONTRACT',
  'ACTIVE_RETAINER',
  'ACTIVE_PROJECT',
  'ON_HOLD',
  'PROJECT_COMPLETED',
  'CHURNED',
] as const;

export type LeadStage = (typeof LEAD_STAGES)[number];

/**
 * Per-stage labels, in the vocabulary the board uses — that is what the team reads every day.
 * The two Active stages share a board column but need distinct names everywhere else (list,
 * detail, search, charts), hence the qualifier.
 */
export const LEAD_STAGE_LABELS: Record<string, string> = {
  NEW_LEAD: 'New Lead',
  OUTREACH: 'Outreach',
  MEETING: 'Meeting',
  PROPOSAL: 'Proposal',
  NEGOTIATION: 'Negotiation',
  CONTRACT: 'Won & Closed',
  ACTIVE_RETAINER: 'Active (Retainer)',
  ACTIVE_PROJECT: 'Active (Project)',
  ON_HOLD: 'On Hold',
  PROJECT_COMPLETED: 'Project Completed',
  CHURNED: 'Lost & Closed',
};

/** Short form for the badge on an Active card, where the column already says "Active". */
export const LEAD_STAGE_SHORT_LABELS: Record<string, string> = {
  ACTIVE_RETAINER: 'Retainer',
  ACTIVE_PROJECT: 'Project',
};

/**
 * Board columns. ACTIVE_RETAINER and ACTIVE_PROJECT deliberately share one column — the card's
 * badge distinguishes them — so this is a grouping over stages, not a 1:1 list.
 */
export const LEAD_STAGE_GROUPS: { id: string; title: string; color: string; stages: string[] }[] = [
  { id: 'New', title: 'New Lead', color: '#6B7280', stages: ['NEW_LEAD'] },
  { id: 'Outreach', title: 'Outreach', color: '#6B7280', stages: ['OUTREACH'] },
  { id: 'Meeting', title: 'Meeting', color: '#6B7280', stages: ['MEETING'] },
  { id: 'Proposal', title: 'Proposal', color: '#2563EB', stages: ['PROPOSAL'] },
  { id: 'Negotiation', title: 'Negotiation', color: '#2563EB', stages: ['NEGOTIATION'] },
  { id: 'WonClosed', title: 'Won & Closed', color: '#16A34A', stages: ['CONTRACT'] },
  { id: 'Active', title: 'Active', color: '#2563EB', stages: ['ACTIVE_RETAINER', 'ACTIVE_PROJECT'] },
  { id: 'OnHold', title: 'On Hold', color: '#6B7280', stages: ['ON_HOLD'] },
  { id: 'Completed', title: 'Project Completed', color: '#16A34A', stages: ['PROJECT_COMPLETED'] },
  { id: 'Lost', title: 'Lost & Closed', color: '#DC2626', stages: ['CHURNED'] },
];

/**
 * Display name for a stage. Falls back to a readable form of anything unrecognised rather than
 * showing a raw SCREAMING_CASE enum.
 */
export function leadStageLabel(stage?: string | null): string {
  if (!stage) return '—';
  return LEAD_STAGE_LABELS[stage] || stage.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
