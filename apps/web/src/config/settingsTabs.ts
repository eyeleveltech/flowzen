import {
  BarChart3,
  Building2,
  CalendarClock,
  ClipboardList,
  FileText,
  History,
  Mail,
  Network,
  Package,
  Plug,
  Receipt,
  Sparkles,
  Tags,
  Trash2,
  TrendingUp,
  Users,
} from 'lucide-react';

/**
 * The sections, in groups.
 *
 * Grouped by what a person comes to change: the agency itself, how it sells
 * and bills, its people and the work it takes on, the AI and the services it
 * talks to, and the records of what happened. The old "Organisation" section
 * held six unrelated things — identity, sign-in, the working calendar, deal
 * odds, staleness and the AI key — so each now lives where it belongs.
 *
 * Here rather than in the page so the Zen guide's coverage test can check
 * every tab has a section. The keys are what `/settings?tab=` takes.
 */
export const SETTINGS_GROUPS = [
  {
    label: 'Agency',
    tabs: [
      { key: 'organisation', label: 'General', caption: 'Who the agency is, and how people sign in.', icon: Building2 },
      { key: 'calendar', label: 'Working calendar', caption: 'Working hours, days off and public holidays.', icon: CalendarClock },
    ],
  },
  {
    label: 'Sales & money',
    tabs: [
      { key: 'pipeline', label: 'Pipeline', caption: 'How likely each stage is to land, and when a deal goes stale.', icon: TrendingUp },
      { key: 'pricing', label: 'Services & pricing', caption: 'What the agency sells, its floors and agreed client rates.', icon: Tags },
      { key: 'proforma', label: 'Documents & billing', caption: 'What a proforma or invoice says, and who issues it.', icon: FileText },
      { key: 'documents', label: 'Tax & numbering', caption: 'GST, document numbers, the financial year and currency.', icon: Receipt },
    ],
  },
  {
    label: 'People & work',
    tabs: [
      { key: 'team', label: 'Team', caption: 'Who is here.', icon: Users },
      { key: 'departments', label: 'Departments', caption: 'The teams, their heads and who is in each.', icon: Network },
      { key: 'onboarding', label: 'Onboarding', caption: 'What a new client needs before work starts.', icon: ClipboardList },
      { key: 'assets', label: 'Assets', caption: 'Asset tags and depreciation.', icon: Package },
    ],
  },
  {
    label: 'AI & connections',
    tabs: [
      { key: 'zen', label: 'Zen assistant', caption: 'The AI behind Zen and proposal writing, and what Zen remembers.', icon: Sparkles },
      { key: 'email', label: 'Email', caption: 'How Flowzen sends mail.', icon: Mail },
      { key: 'integrations', label: 'Integrations', caption: 'Google Calendar and phone notifications.', icon: Plug },
    ],
  },
  {
    label: 'Records',
    tabs: [
      { key: 'activity', label: 'Activity', caption: 'Everything that happened, and who did it.', icon: History },
      { key: 'usage', label: 'Usage', caption: 'Who is using Flowzen, and how much.', icon: BarChart3 },
      { key: 'trash', label: 'Trash', caption: 'Removed, not gone. Put things back from here.', icon: Trash2 },
    ],
  },
] as const;
