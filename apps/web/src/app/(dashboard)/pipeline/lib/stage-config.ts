export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checklist';

export interface StageField {
  key: string;
  label: string;
  type: FieldType;
  options?: string[]; // for select and checklist
  required?: boolean;
}

// Fields shown when MOVING INTO a stage — the "(previous) → stage" prompt (brief §3.4).
// Policy: NO hard gates — every field below is optional (stored if filled, never blocks the
// move). Stages can also be skipped/jumped freely. If you ever want to hard-gate a field, set
// `required: true` here AND enforce it server-side in the stage service; the UI alone is not a
// guarantee. (The only mandatory input is the Lost Reason on CHURNED, handled by the modal.)
export const STAGE_FIELDS: Record<string, StageField[]> = {
  NEW_LEAD: [], // captured by the lead creation form; no notes required

  // NEW_LEAD → OUTREACH: nothing required
  OUTREACH: [],

  // OUTREACH → MEETING: Keep Meeting Date only
  MEETING: [
    { key: 'meetingDate', label: 'Meeting Date Confirmed', type: 'date', required: false },
  ],

  // MEETING → PROPOSAL: Keep Audit Required + Services in Scope
  PROPOSAL: [
    { key: 'auditRequired', label: 'Audit Required?', type: 'select', options: ['No', 'Yes'], required: false },
    { key: 'servicesInScope', label: 'Services Agreed in Scope', type: 'checklist', options: ['SEO', 'Social Media', 'Paid Ads', 'Content', 'GMB', 'Email', 'PR', 'Events', 'Website', 'Others'], required: false },
  ],

  // PROPOSAL → NEGOTIATION: Keep Deal Value, Expected Close Date, Proposal Sent Date
  // Proposal Document Link is auto-linked to in-system proposals (no manual field)
  // Proposal validity auto-set to 14 days from sent date on the backend
  NEGOTIATION: [
    { key: 'proposalSentDate', label: 'Proposal Sent Date', type: 'date', required: false },
  ],

  // NEGOTIATION → CONTRACT: Deal Value, Expected Close Date, Contract Type.
  //
  // There is deliberately NO separate "Agreed Final Value" field. It used to live here, next to
  // the modal's own Deal Value input — two boxes for one number, on the same screen, which the
  // server then had to keep in sync. It didn't: the sync overwrote the value the user typed on
  // the following save. The deal's Deal Value input is simply LABELLED "Agreed Final Value" at
  // this stage (see StageTransitionModal), because by CONTRACT that is what it means.
  CONTRACT: [],

  // CONTRACT → ACTIVE_RETAINER / ACTIVE_PROJECT (Won & Closed → Active).
  // Entering Active is what auto-creates the revenue record (retainer → subscription,
  // project → contract). These fields are captured if filled but do not block the move.
  ACTIVE_RETAINER: [
    { key: 'signedContractLink', label: 'Signed Contract Document Link', type: 'text', required: false },
    { key: 'paymentTerms', label: 'Payment Terms', type: 'select', options: ['100% Advance', '50-50', 'Monthly', 'Milestone-based'], required: false },
    { key: 'billingFrequency', label: 'Billing Frequency', type: 'select', options: ['Monthly', 'Quarterly', 'One-Time'], required: false },
    { key: 'startDate', label: 'Start Date Confirmed', type: 'date', required: false },
  ],
  ACTIVE_PROJECT: [
    { key: 'signedContractLink', label: 'Signed Contract Document Link', type: 'text', required: false },
    { key: 'paymentTerms', label: 'Payment Terms', type: 'select', options: ['100% Advance', '50-50', 'Monthly', 'Milestone-based'], required: false },
    { key: 'billingFrequency', label: 'Billing Frequency', type: 'select', options: ['Monthly', 'Quarterly', 'One-Time'], required: false },
    { key: 'startDate', label: 'Start Date Confirmed', type: 'date', required: false },
  ],

  // ON_HOLD: no transition fields — parked from any stage
  ON_HOLD: [],

  // ANY → PROJECT_COMPLETED
  PROJECT_COMPLETED: [
    { key: 'completionDate', label: 'Completion Date', type: 'date', required: false },
    { key: 'deliverablesSignOff', label: 'Final Deliverables Sign-off Note', type: 'textarea', required: false },
  ],

  // ANY → CHURNED (Lost & Closed): only the Lost Reason dropdown, handled by modal
  CHURNED: [],
};

// Does moving INTO this stage ask the user for anything? Covers both the per-stage fields
// above AND the modal-level inputs (deal value/close date, contract type, lost reason).
// Stages that need nothing (§3.4: e.g. New Lead → Outreach, or parking On Hold) commit
// instantly on drag — no modal, no toll gate. The two common dates (Next Follow-up /
// Last Contacted) are optional and editable on the lead itself, so they never justify
// interrupting the move.
export function stageNeedsTransitionInput(targetStage: string): boolean {
  if (targetStage === 'CHURNED') return true; // mandatory Lost Reason (§3.6)
  if (['NEGOTIATION', 'CONTRACT'].includes(targetStage)) return true; // deal value + expected close date
  if (['ACTIVE_RETAINER', 'ACTIVE_PROJECT'].includes(targetStage)) return true; // contract type + billing details
  return (STAGE_FIELDS[targetStage] || []).length > 0;
}

// Stage-specific probability weights for weighted deal value calculations in the Kanban footer
export const STAGE_PROBABILITIES: Record<string, number> = {
  NEW_LEAD: 0.10,
  OUTREACH: 0.20,
  MEETING: 0.30,
  PROPOSAL: 0.40,
  NEGOTIATION: 0.70,
  CONTRACT: 0.90,
  ACTIVE_RETAINER: 1.00,
  ACTIVE_PROJECT: 1.00,
  ON_HOLD: 0.10,
  PROJECT_COMPLETED: 1.00,
  CHURNED: 0.00,
};
