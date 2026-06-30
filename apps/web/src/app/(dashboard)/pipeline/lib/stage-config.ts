export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checklist';

export interface StageField {
  key: string;
  label: string;
  type: FieldType;
  options?: string[]; // for select and checklist
  required?: boolean;
}

// Fields shown when MOVING INTO a stage — i.e. the "(previous) → stage" gate (brief §4).
// `required: true` = HARD gate (blocks the transition). Others are SOFT (stored if filled).
export const STAGE_FIELDS: Record<string, StageField[]> = {
  NEW_LEAD: [], // captured by the lead creation form

  // NEW_LEAD → OUTREACH
  OUTREACH: [
    { key: 'sourceOfLead', label: 'Source of Lead', type: 'select', options: ['LinkedIn', 'Referral', 'Form', 'Event', 'Inbound', 'Manual'], required: true },
    { key: 'linkedinStatus', label: 'LinkedIn Profile', type: 'select', options: ['Found', 'Not found'], required: true },
  ],

  // OUTREACH → MEETING
  MEETING: [
    { key: 'channelUsed', label: 'Outreach Channel Used', type: 'select', options: ['WhatsApp', 'Email', 'LinkedIn', 'Call'], required: true },
    { key: 'responseStatus', label: 'Response Status', type: 'select', options: ['Responded Positive', 'No Response', 'Responded Negative', 'Requested Callback'], required: true },
    { key: 'meetingDate', label: 'Meeting Date Confirmed', type: 'date', required: true },
    { key: 'outreachMessageUsed', label: 'Outreach Message Used', type: 'text' },
  ],

  // MEETING → PROPOSAL
  PROPOSAL: [
    { key: 'meetingNotes', label: 'Meeting Notes', type: 'textarea' },
    { key: 'auditRequired', label: 'Audit Required?', type: 'select', options: ['No', 'Yes'], required: true },
    { key: 'auditFindings', label: 'Audit Findings (required if audit done)', type: 'textarea' },
    { key: 'auditReportLink', label: 'Audit Report Link (required if audit done)', type: 'text' },
    { key: 'servicesInScope', label: 'Services Agreed in Scope', type: 'checklist', options: ['SEO', 'Social Media', 'Paid Ads', 'Content', 'GMB', 'Email', 'PR', 'Events', 'Website', 'Others'], required: true },
    { key: 'nextStepAgreed', label: 'Next Step Agreed', type: 'text' },
  ],

  // PROPOSAL → NEGOTIATION
  NEGOTIATION: [
    { key: 'proposalDocumentLink', label: 'Proposal Document Link', type: 'text', required: true },
    { key: 'proposalSentDate', label: 'Proposal Sent Date', type: 'date', required: true },
    { key: 'engagementType', label: 'Engagement Type', type: 'select', options: ['Retainer', 'Project', 'Hybrid'], required: true },
    { key: 'proposalValidUntil', label: 'Proposal Valid Until', type: 'date' },
  ],

  // NEGOTIATION → CONTRACT (also combined on a PROPOSAL → CONTRACT skip)
  CONTRACT: [
    { key: 'agreedFinalValue', label: 'Agreed Final Value (₹)', type: 'number', required: true },
    { key: 'lastContactedDate', label: 'Last Contacted Date', type: 'date', required: true },
    { key: 'counterOfferLog', label: 'Counter Offer Log / Key Objections', type: 'textarea' },
  ],

  // CONTRACT → ACTIVE_RETAINER / ACTIVE_PROJECT
  ACTIVE_RETAINER: [
    { key: 'signedContractLink', label: 'Signed Contract Document Link', type: 'text', required: true },
    { key: 'paymentTerms', label: 'Payment Terms', type: 'select', options: ['100% Advance', '50-50', 'Monthly', 'Milestone-based'], required: true },
    { key: 'billingFrequency', label: 'Billing Frequency', type: 'select', options: ['Monthly', 'Quarterly', 'One-Time'], required: true },
    { key: 'startDate', label: 'Start Date Confirmed', type: 'date', required: true },
  ],
  ACTIVE_PROJECT: [
    { key: 'signedContractLink', label: 'Signed Contract Document Link', type: 'text', required: true },
    { key: 'paymentTerms', label: 'Payment Terms', type: 'select', options: ['100% Advance', '50-50', 'Monthly', 'Milestone-based'], required: true },
    { key: 'billingFrequency', label: 'Billing Frequency', type: 'select', options: ['Monthly', 'Quarterly', 'One-Time'], required: true },
    { key: 'startDate', label: 'Start Date Confirmed', type: 'date', required: true },
  ],

  // ACTIVE_PROJECT → PROJECT_COMPLETED
  PROJECT_COMPLETED: [
    { key: 'completionDate', label: 'Completion Date', type: 'date', required: true },
    { key: 'deliverablesSignOff', label: 'Final Deliverables Sign-off Note', type: 'textarea', required: true },
  ],

  // ANY → CHURNED (the reason is required via the modal's dedicated dropdown)
  CHURNED: [
    { key: 'competitorChosen', label: 'Competitor Chosen (if known)', type: 'text' },
    { key: 'reactivationPotential', label: 'Reactivation Potential', type: 'select', options: ['Yes - 3 months', 'Yes - 6 months', 'No'] },
  ],
};
