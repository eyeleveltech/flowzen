export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checklist';

export interface StageField {
  key: string;
  label: string;
  type: FieldType;
  options?: string[]; // for select and checklist
  required?: boolean;
}

// Fields shown when MOVING INTO a stage — i.e. the "(previous) → stage" gate (brief §3.4).
// `required: true` = HARD gate (blocks the transition). Others are SOFT (stored if filled).
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

  // NEGOTIATION → CONTRACT: Keep Deal Value, Expected Close Date, Contract Type, Agreed Final Value
  CONTRACT: [
    { key: 'agreedFinalValue', label: 'Agreed Final Value (₹)', type: 'number', required: false },
  ],

  // CONTRACT → ACTIVE_RETAINER / ACTIVE_PROJECT (Won & Closed → Active)
  // Hard gate: signedContractLink REQUIRED — cannot proceed without it
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
