/**
 * What an audit row says, in words.
 *
 * The trail is stored as `entityType` + `verb` — "Proposal / proposal_won" —
 * and the company screen printed the verb with its underscores swapped for
 * spaces. That reads as a column name, and it gets worse the moment the tab
 * shows more than the company's own row: "proposal version added",
 * "month card reopened", "invoice document saved" are all things somebody did,
 * written as things a database did.
 *
 * A verb missing from this map still renders — sentence-cased, underscores out
 * — rather than disappearing, because a trail that silently drops rows is worse
 * than one with a plain line in it.
 */

import { STAGE_LABEL } from '@flowzen/shared';

const VERB: Record<string, string> = {
  // The company itself
  created: 'Added to Flowzen',
  company_created: 'Added to Flowzen',
  outreach_imported: 'Imported from a file',
  company_updated: 'Updated the company details',
  company_archived: 'Removed the company',
  person_added: 'Added a contact',
  person_updated: 'Updated a contact',
  meeting_logged: 'Logged a meeting',
  outreach_promoted: 'Promoted the lead to a company',
  outreach_status_changed: 'Changed the outreach status',

  // The pipeline
  proposal_created: 'Raised a proposal',
  proposal_version_added: 'Added a proposal version',
  proposal_edited: 'Edited the proposal',
  proposal_won: 'Won the deal',
  proposal_lost: 'Marked the deal lost',
  proposal_deleted: 'Deleted the proposal',
  proposal_restored: 'Restored the proposal',
  verbal_yes: 'Flagged a verbal yes',
  probability_overridden: 'Overrode the win probability',
  proforma_generated: 'Issued a proforma',
  proforma_edited: 'Edited the proforma',

  // The work
  retainer_created: 'Started a retainer',
  retainer_started: 'Started a retainer',
  retainer_edited: 'Edited the retainer',
  retainer_stopped: 'Stopped the retainer',
  retainer_project_created: 'Added a project to the retainer',
  retainer_project_deleted: 'Removed a project from the retainer',
  project_created: 'Created a project',
  project_edited: 'Edited the project',
  project_delivered: 'Marked the project delivered',
  project_cancelled: 'Cancelled the project',
  milestone_added: 'Added a milestone',
  milestone_deleted: 'Removed a milestone',
  month_card_reopened: 'Reopened a closed month',
  task_created: 'Created a task',
  task_edited: 'Edited a task',
  task_deleted: 'Deleted a task',
  task_restored: 'Restored a task',
  task_waiting: 'Put a task on hold',
  task_resumed: 'Resumed a task',

  // The money
  invoice_document_saved: 'Saved the invoice document',
  payment_recorded: 'Recorded a payment',
  document_emailed: 'Emailed a document',
  cost_updated: 'Updated a cost',
};

/** What the row was about — shown only when it is not the company itself. */
const ENTITY: Record<string, string> = {
  Proposal: 'Proposal',
  Proforma: 'Proforma',
  Project: 'Project',
  Retainer: 'Retainer',
  MonthCard: 'Month',
  Invoice: 'Invoice',
  Task: 'Task',
};

export const activityText = (verb: string): string =>
  VERB[verb] ?? verb.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export const activityScope = (entityType?: string | null): string | null =>
  !entityType || entityType === 'Company' ? null : (ENTITY[entityType] ?? entityType);

/**
 * The figures and the move, out of the payload.
 *
 * "Added a proposal version" is true and useless: the questions somebody
 * actually brings to this tab a month later are *what did we quote* and *what
 * did it move to*. Both are in the payload now (see proposals.ts) and neither
 * was ever shown.
 *
 * Money is the payload's own business: the server strips `value` and
 * `previousValue` from the row for anybody without `money.figures`, so a line
 * that reads "Revised the quote · Proposal Sent → In Negotiation" with no
 * figure is correct rather than broken.
 */
const money = (n: unknown): string | null => {
  const v = typeof n === 'string' ? Number(n) : n;
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return `₹${v.toLocaleString('en-IN')}`;
};

const stageName = (s: unknown): string | null =>
  typeof s === 'string' && s ? (STAGE_LABEL[s] ?? s.replace(/_/g, ' ')) : null;

export const activityDetail = (a: {
  verb: string;
  payload?: Record<string, unknown> | null;
}): string | null => {
  const p = a.payload ?? {};
  const parts: string[] = [];

  const value = money(p.value);
  const was = money(p.previousValue);
  if (a.verb === 'proposal_version_added' && value) {
    parts.push(was ? `Revised to ${value}, was ${was}` : `Quoted ${value}`);
  } else if (a.verb === 'proposal_won' && value) {
    parts.push(`Won at ${value}`);
  }
  if (a.verb === 'proposal_lost' && typeof p.lostReason === 'string' && p.lostReason) {
    parts.push(p.lostReason);
  }

  // `lostFromStage` is what losing has always written; see proposals.ts.
  const from = stageName(p.stageFrom ?? p.lostFromStage);
  const to = stageName(p.stageTo);
  if (from && to && from !== to) parts.push(`${from} → ${to}`);

  /*
   * And what it did to the client.
   *
   * Losing a deal that was won takes the company back off CLIENT — to Past if
   * they had work, to Prospect if the win was a mis-click. That is a bigger
   * consequence than the row it is attached to, so it is said out loud.
   */
  const COMPANY: Record<string, string> = { CLIENT: 'Client', PROSPECT: 'Prospect', PAST: 'Past client' };
  const cFrom = typeof p.companyStatusFrom === 'string' ? COMPANY[p.companyStatusFrom] : null;
  const cTo = typeof p.companyStatusTo === 'string' ? COMPANY[p.companyStatusTo] : null;
  if (cFrom && cTo) parts.push(`Company: ${cFrom} → ${cTo}`);

  return parts.length > 0 ? parts.join(' · ') : null;
};
