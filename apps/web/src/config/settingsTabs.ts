/**
 * The sections, in groups.
 *
 * Nine of them in one wrapping row of buttons came to two and a half rows on a
 * laptop, in the order they happened to be built — so "Trash" sat beside
 * "Onboarding" and the row you were on moved as the window changed width. They
 * answer three different kinds of question, and grouping them says which:
 * what the agency IS, WHO is here, and what HAPPENED.
 *
 * Here rather than in the page so the Zen guide's coverage test can check
 * every tab has a section.
 */
export const SETTINGS_GROUPS = [
  {
    label: 'The agency',
    tabs: [
      { key: 'organisation', label: 'Organisation', caption: 'Identity, calendar, assistant' },
      { key: 'documents', label: 'Tax & numbering', caption: 'GST, prefixes, currency' },
      { key: 'proforma', label: 'Documents & billing', caption: 'What a document says' },
      { key: 'email', label: 'Email', caption: 'How it is sent' },
      { key: 'integrations', label: 'Integrations', caption: 'Google Calendar' },
    ],
  },
  {
    label: 'People & kit',
    tabs: [
      { key: 'team', label: 'Team', caption: 'Who is here' },
      { key: 'departments', label: 'Departments', caption: 'Teams, heads, who is in each' },
      { key: 'approvals', label: 'Approvals', caption: 'Who signs off work' },
      { key: 'assets', label: 'Assets', caption: 'Tags and depreciation' },
      { key: 'onboarding', label: 'Onboarding', caption: 'What a new client needs' },
    ],
  },
  {
    label: 'Records',
    tabs: [
      { key: 'trash', label: 'Trash', caption: 'Removed, not gone' },
      { key: 'activity', label: 'Activity', caption: 'Everything that happened' },
      { key: 'usage', label: 'Usage', caption: 'Who is using Flowzen' },
    ],
  },
] as const;
