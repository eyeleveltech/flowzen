export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checklist';

export interface StageField {
  key: string;
  label: string;
  type: FieldType;
  options?: string[]; // for select and checklist
  required?: boolean;
}

export const STAGE_FIELDS: Record<string, StageField[]> = {
  LEAD: [], // Covered by creation form
  MQL: [
    { key: 'mqlScore', label: 'MQL Score (1-10)', type: 'number' },
    { key: 'marketingTouchpoints', label: 'Marketing Touchpoints', type: 'textarea' },
    { key: 'qualificationCriteria', label: 'Qualification Criteria Met', type: 'checklist', options: ['Fits ICP', 'Budget Signals', 'Decision-Maker Contact', 'Timing Signals'] }
  ],
  SQL: [
    { key: 'budgetConfirmed', label: 'Budget Confirmed', type: 'select', options: ['Yes', 'Estimated', 'Unknown'] },
    { key: 'decisionMakerIdentified', label: 'Decision Maker Identified', type: 'select', options: ['Yes', 'No'] },
    { key: 'sqlCriteriaNotes', label: 'SQL Criteria Notes', type: 'textarea' }
  ],
  REACH_OUT: [
    { key: 'channelUsed', label: 'Channel Used', type: 'select', options: ['Call', 'Email', 'WhatsApp', 'LinkedIn DM', 'In-Person', 'Other'] },
    { key: 'messageScript', label: 'Message / Script', type: 'textarea' },
    { key: 'responseStatus', label: 'Response Status', type: 'select', options: ['No Response', 'Responded Positive', 'Responded Negative', 'Requested Callback'] },
    { key: 'followUpDate', label: 'Follow-up Date', type: 'date' }
  ],
  DISCOVERY: [
    { key: 'meetingFormat', label: 'Meeting Format', type: 'select', options: ['In-Person', 'Video Call', 'Phone Call'] },
    { key: 'attendees', label: 'Attendees', type: 'text' },
    { key: 'requirementsSummary', label: 'Requirements Summary', type: 'textarea' },
    { key: 'painPoints', label: 'Pain Points Identified', type: 'textarea' },
    { key: 'budgetRange', label: 'Budget Range Mentioned (₹)', type: 'text' },
    { key: 'timelineMentioned', label: 'Timeline Mentioned', type: 'text' },
    { key: 'nextStepAgreed', label: 'Next Step Agreed', type: 'text' },
    { key: 'meetingNotes', label: 'Meeting Notes / Recording Link', type: 'text' }
  ],
  AUDIT: [
    { key: 'auditType', label: 'Audit Type', type: 'checklist', options: ['SEO Audit', 'Social Media Audit', 'Ad Account Audit', 'GMB Audit', 'Competitor Analysis', 'Brand Audit'] },
    { key: 'keyFindings', label: 'Key Findings', type: 'textarea' },
    { key: 'gapsIdentified', label: 'Gaps Identified', type: 'textarea' },
    { key: 'auditDocumentLink', label: 'Audit Document / Report Link', type: 'text' }
  ],
  PRESENTATION: [
    { key: 'presentationFormat', label: 'Presentation Format', type: 'select', options: ['In-Person', 'Video Call'] },
    { key: 'attendees', label: 'Attendees', type: 'text' },
    { key: 'presentationDeckLink', label: 'Presentation Deck Link', type: 'text' },
    { key: 'ideasPresented', label: 'Ideas Presented (Summary)', type: 'textarea' },
    { key: 'clientVerbalFeedback', label: 'Client Verbal Feedback', type: 'textarea' },
    { key: 'clientOutcome', label: 'Client Outcome', type: 'select', options: ['Interested - Proceed to Proposal', 'Needs More Time', 'Requested Changes', 'Not Interested'] }
  ],
  PROPOSAL: [
    { key: 'engagementType', label: 'Engagement Type', type: 'select', options: ['Retainer', 'One-Time Project', 'Hybrid'] },
    { key: 'proposalDocumentLink', label: 'Proposal Document Link', type: 'text' },
    { key: 'proposalValidUntil', label: 'Proposal Valid Until Date', type: 'date' },
    { key: 'keyDeliverables', label: 'Key Deliverables in Scope', type: 'textarea' }
  ],
  NEGOTIATION: [
    { key: 'counterOfferLog', label: 'Counter Offer Log', type: 'textarea' },
    { key: 'currentProposedValue', label: 'Current Proposed Value (₹)', type: 'number' },
    { key: 'keyObjections', label: 'Key Objections', type: 'textarea' },
    { key: 'concessionsMade', label: 'Concessions Made', type: 'textarea' },
    { key: 'lastContactedDate', label: 'Last Contacted Date', type: 'date' }
  ],
  FINALIZATION: [
    { key: 'finalScopeAgreed', label: 'Final Scope Agreed', type: 'textarea' },
    { key: 'startDateConfirmed', label: 'Start Date Confirmed', type: 'date' },
    { key: 'specialConditions', label: 'Any Special Conditions', type: 'textarea' }
  ],
  CONTRACT: [
    { key: 'contractDuration', label: 'Contract Duration (Months / Timeline)', type: 'text' },
    { key: 'signedContractLink', label: 'Signed Contract Document Link', type: 'text' },
    { key: 'paymentTerms', label: 'Payment Terms', type: 'select', options: ['100% Advance', '50/50', 'Monthly', 'Milestone-based'] },
    { key: 'billingFrequency', label: 'Billing Frequency', type: 'select', options: ['Monthly', 'Quarterly', 'One-Time'] }
  ],
  ACTIVE_RETAINER: [
    { key: 'servicesInScope', label: 'Services in Scope', type: 'checklist', options: ['SEO', 'Social Media', 'Paid Ads', 'Content', 'GMB', 'Email', 'PR', 'Events', 'Website'] },
    { key: 'reportingCycle', label: 'Reporting Cycle', type: 'select', options: ['Weekly', 'Bi-Weekly', 'Monthly'] },
    { key: 'nextRenewalDate', label: 'Next Renewal Date', type: 'date' },
    { key: 'kpiTargets', label: 'KPI Targets', type: 'textarea' }
  ],
  ACTIVE_PROJECT: [
    { key: 'paymentSchedule', label: 'Payment Schedule', type: 'textarea' },
    { key: 'deliverablesList', label: 'Deliverables List', type: 'textarea' },
    { key: 'completionPercentage', label: 'Completion Percentage (0-100)', type: 'number' },
    { key: 'finalDeliveryDate', label: 'Final Delivery Date', type: 'date' }
  ],
  WON_CLOSED: [
    { key: 'closureDate', label: 'Closure Date', type: 'date' },
    { key: 'finalValueCollected', label: 'Final Value Collected (₹)', type: 'number' },
    { key: 'testimonial', label: 'Testimonial / Case Study', type: 'textarea' }
  ],
  LOST_CLOSED: [
    { key: 'competitorChosen', label: 'Competitor Chosen (if known)', type: 'text' },
    { key: 'reactivationPotential', label: 'Reactivation Potential', type: 'select', options: ['Yes - 3 months', 'Yes - 6 months', 'No'] }
  ]
};
