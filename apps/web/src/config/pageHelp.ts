/**
 * The "?" beside the page title: what each screen is for, in plain words.
 *
 * ─── What it is ─────────────────────────────────────────────────────────────
 *
 * One short card per screen, opened from the top bar (components/layout/
 * PageHelp.tsx): what the page is for, the two or three things people do
 * there, and a "Read more" into the matching part of How it works. The top bar
 * picks the card from the address, so it works on every page, whether or not
 * the page uses `PageHeader`.
 *
 * ─── The rules for the words ────────────────────────────────────────────────
 *
 * - Written for somebody who is not technical: short sentences, and the words
 *   the screen itself uses for its tabs and buttons. When a screen renames a
 *   button, change it here too (and in Zen's guide, api/services/zen/
 *   flowzen-guide.md, which this follows).
 * - GENERIC. Never a figure, a person's name, a client's name or anything else
 *   a reader may not be allowed to see — the same card is shown to everybody
 *   who can open the page. The test refuses an amount.
 * - Only about the page the person already has open.
 *
 * ─── How a card is found ────────────────────────────────────────────────────
 *
 * Keyed by route, written the way the app folder writes it: `/projects/[id]`
 * is any one project. A key matches an address that starts with it, segment
 * by segment, and the most specific key wins — so `/companies/abc` gets the
 * company page's card, not the Companies list's, and `/companies` never gets
 * the company page's. An address no key matches gets `GENERAL_HELP`.
 */

/**
 * The parts of How it works that "Read more" can open.
 *
 * The page gives each of these as an `id` (typed against this list, so it
 * cannot give one that is not here), and the test checks every one of them is
 * really on the page — so a link from a card always lands somewhere.
 */
export const HOW_IT_WORKS_SECTIONS = [
  'the-flow',
  'stage-lead',
  'stage-proposal',
  'stage-won',
  'stage-tasks',
  'stage-billing',
  'stage-money',
  'a-normal-day',
  'day-everybody',
  'day-department-head',
  'day-business-development',
  'day-accounts',
  'day-management',
  'the-bell',
  'the-rules',
  'quick-map',
] as const;

export type HowItWorksSection = (typeof HOW_IT_WORKS_SECTIONS)[number];

export interface PageHelp {
  /** The screen, as the sidebar or its own title calls it. */
  title: string;
  /** What this page is for, in one or two sentences. */
  purpose: string;
  /** The two or three things people do here. */
  steps: string[];
  /** The part of How it works "Read more" opens. Left out: the top of that page. */
  readMore?: HowItWorksSection;
}

export const PAGE_HELP: Record<string, PageHelp> = {
  // ─── Daily ────────────────────────────────────────────────────────────────
  '/my-work': {
    title: 'My Work',
    purpose: 'Your own list of tasks: everything you are on, sorted by when it is due. Start your day here.',
    steps: [
      'Look at Overdue and Due today first, then Coming up.',
      'Tap the round tick at the start of a row when a task is done. Change its status or due date on the row.',
      'Type a title in the line at the top and press Enter to add a task for yourself. Task for myself opens the full form.',
    ],
    readMore: 'stage-tasks',
  },
  '/calendar': {
    title: 'Calendar',
    purpose: 'What is on when: your tasks, meetings, shoots and holidays, by Week, Month or as a Schedule.',
    steps: [
      'Switch the layers on or off to choose what shows.',
      'Press Create to add a task, or to book a meeting or a shoot.',
      'Drag a task to change its due date, or drag an event to move it.',
    ],
    readMore: 'day-everybody',
  },
  '/members': {
    title: 'Team',
    purpose: 'Who is carrying what: each person’s open, overdue and waiting tasks, in one table.',
    steps: [
      'Use the Delivery table to see who is busy and who has work running late.',
      'Click a person to see their tasks.',
      'Use the menu on a row to Assign a task, or to see the Kit they hold.',
    ],
    readMore: 'day-department-head',
  },
  '/my-department': {
    title: 'My department',
    purpose: 'Your department on one page: your people, what they are working on, and what needs you.',
    steps: [
      'Start with what needs you: late tasks, tasks on hold for a while, and gear that is overdue.',
      'Open a person’s card to see their tasks and their week. The + on a card assigns them a task.',
      'Use the tabs for the department’s Work, Calendar, Equipment and Time split.',
    ],
    readMore: 'day-department-head',
  },
  '/all-work': {
    title: 'All tasks',
    purpose: 'Every task in the studio in one list. A Head sees the tasks of their own departments.',
    steps: [
      'Filter by person, client, project, type of work or status. Overdue only shows just the late ones.',
      'Use Group by to sort the list by project, client, person or due date.',
      'Click a task to open it. Click a column heading to sort by it.',
    ],
    readMore: 'stage-tasks',
  },

  // ─── Business ─────────────────────────────────────────────────────────────
  '/companies': {
    title: 'Companies',
    purpose: 'Every company the studio works with or is talking to: Clients, Prospects and Past clients.',
    steps: [
      'Use the tabs to see Client, Prospect, Past or All.',
      'Click a company to open everything about it: its people, work, proposals and invoices.',
      'A new company comes from the Outreach list: press Promote to company on an interested lead.',
    ],
    readMore: 'stage-proposal',
  },
  '/companies/[id]': {
    title: 'Company page',
    purpose: 'Everything about one company in one place: its people, its work, its proposals, its invoices and its history.',
    steps: [
      'Overview & People lists the company’s contacts. Add Person adds one.',
      'Proposals is where a deal moves: New proposal, then new versions, the proforma, and Mark won or lost.',
      'Work holds its retainers, projects and follow-ups. Open one to see its tasks.',
    ],
    readMore: 'stage-won',
  },
  '/outreach': {
    title: 'Outreach list',
    purpose: 'People and businesses who might become clients, before they are companies.',
    steps: [
      'New lead adds a name with a phone or an email.',
      'After every call or message, press Log touch, and keep the status up to date: Follow up, Meeting, Interested or Dead.',
      'When a lead is Interested, Promote to company makes it a Prospect in Companies.',
    ],
    readMore: 'stage-lead',
  },
  '/pipeline': {
    title: 'Pipeline',
    purpose: 'Every deal as a card, in columns from Prospect to Won or Lost.',
    steps: [
      'Drag a card to the next column. Flowzen then asks for the real step: a new version, a proforma, Mark won or Mark lost.',
      'Use the menu on a card to Log touch or Set next step, so no deal goes quiet.',
      'On a Won card, set up the retainer or create the project.',
    ],
    readMore: 'stage-proposal',
  },
  '/quotations': {
    title: 'Proposals',
    purpose: 'Every proposal and proforma in one list.',
    steps: [
      'Use the tabs: Active, Closed and Proformas.',
      'Press Write the proposal under a client’s name to open the proposal document.',
      'Versions, proformas, and marking a deal won or lost happen on the Pipeline or on the company’s Proposals tab.',
    ],
    readMore: 'stage-proposal',
  },
  '/quotations/[id]': {
    title: 'Proposal',
    purpose: 'The proposal document itself, written in Flowzen by hand or with the AI.',
    steps: [
      'Start with Write with AI or Start blank, then change the sections. It saves by itself.',
      'Send for review hands the draft to Management, who add the prices and finalise it.',
      'Download the PDF, or press New version to make changes once it is final.',
    ],
    readMore: 'stage-proposal',
  },
  '/live-work': {
    title: 'Live work',
    purpose: 'Everything being delivered right now: retainers, projects, sample work and the studio’s own internal projects.',
    steps: [
      'Use the tabs: Retainers, Projects, Sample and Internal.',
      'See which work is late or at risk, then open it to see its tasks.',
      'Internal holds the studio’s own projects, and General — no project for one-off studio jobs.',
    ],
    readMore: 'stage-tasks',
  },

  // ─── Management ───────────────────────────────────────────────────────────
  '/brief': {
    title: 'Monday brief',
    purpose: 'Last week on one page, and what needs your action this week.',
    steps: [
      'Read the summary at the top, then the tiles: last week against the week before.',
      'Click a tile to see what is behind it.',
      'Work through Needs your action and This week.',
    ],
    readMore: 'day-management',
  },
  '/money': {
    title: 'Money',
    purpose: 'Invoices, billing, costs and profit, all in one place. Figures for, at the top, chooses the period the tiles show.',
    steps: [
      'Billing lists every retainer month and project milestone waiting for a proforma, an invoice or a payment.',
      'Invoices: press Record payment when money comes in. New invoice records an invoice already raised in Tally.',
      'Costs: press Record a cost for a vendor bill. Profit & Costs shows each client’s profit for a month.',
    ],
    readMore: 'stage-billing',
  },
  '/subscriptions': {
    title: 'Subscriptions',
    purpose: 'What the studio spends on each platform, worked out from the platforms’ own invoices.',
    steps: [
      'Drop a platform’s invoice in, check the review card, then press Save.',
      'Click a platform to see its invoices and how its price has changed.',
      'Each saved invoice also counts as a company cost on Money.',
    ],
    readMore: 'stage-money',
  },
  '/forecast': {
    title: 'Forecast',
    purpose: 'The next three months of cash: what should come in, and what goes out.',
    steps: [
      'Read each month’s card: money coming in, money going out, and what is left.',
      'Use What if this deal closes? to add one open deal to the months.',
    ],
    readMore: 'stage-money',
  },
  '/logins': {
    title: 'Logins',
    purpose: 'The studio’s and its clients’ usernames and passwords, kept for Management. Every look is recorded.',
    steps: [
      'Search for a login by name, website or username.',
      'Show or copy a password when you need it. It hides again by itself.',
      'Add login saves a new one. A deleted login can be put back from Recently deleted.',
    ],
    readMore: 'day-management',
  },
  '/assets': {
    title: 'Assets',
    purpose: 'The studio’s equipment, such as cameras, lights and laptops, and who has each piece.',
    steps: [
      'Search by tag, name, make or serial, or use the tabs: Out now, In repair and Retired.',
      'Open an item to see who has it, and its Chain of custody.',
      'To book gear for a shoot, add it to the shoot on the Calendar.',
    ],
    readMore: 'quick-map',
  },
  '/assets/[id]': {
    title: 'Asset',
    purpose: 'One piece of equipment: what it is, who has it now, and where it has been.',
    steps: [
      'See who holds it now, and when it is due back.',
      'Chain of custody shows every holder, and the condition it went out and came back in.',
      'Whoever hands out the kit uses Check out, Check in and Hand on here.',
    ],
    readMore: 'quick-map',
  },

  // ─── Admin ────────────────────────────────────────────────────────────────
  '/allocations': {
    title: 'Time split',
    purpose: 'How each person’s month is shared across clients and projects, as percentages. It is how people’s time counts in client profit.',
    steps: [
      'Pick the month. Near the end of each month, each person’s split is suggested from the tasks they finished.',
      'Check each person. Press Edit if it is wrong, then Confirm.',
      'Each person’s Total % should come to 100.',
    ],
    readMore: 'stage-money',
  },
  '/settings': {
    title: 'Settings',
    purpose: 'How the studio is set up: people, departments, pricing, documents, connections and records.',
    steps: [
      'Pick a tab on the left. They are grouped: Agency, Sales & money, People & work, AI & connections and Records.',
      'Departments sets each department’s head and who is in it.',
      'Activity shows everything that happened, and Trash puts back what was removed.',
    ],
    readMore: 'day-management',
  },

  // ─── Bottom of the sidebar, and the account menu ──────────────────────────
  '/how-it-works': {
    title: 'How it works',
    purpose: 'The whole of Flowzen on one page: how work moves from a lead to the money, and what each role does.',
    steps: [
      'Read the six stages, with one example client carried through all of them.',
      'Find your own day under A normal day.',
      'Use The quick map to find where anything is.',
    ],
    readMore: 'quick-map',
  },
  '/profile': {
    title: 'Your profile',
    purpose: 'Your own details, and how Flowzen reaches you.',
    steps: [
      'Check your name, job title and phone, then press Save.',
      'Turn on Phone notifications, when you see that card, so new tasks and meetings reach your phone.',
      'Change your password here. Your email, department and access are changed by an admin.',
    ],
    readMore: 'the-bell',
  },
  '/trash': {
    title: 'Trash',
    purpose: 'Things that were deleted, kept so they can be put back.',
    steps: [
      'Find what was deleted by mistake and press Restore.',
      'You only see the kinds of things you are allowed to put back.',
    ],
  },

  // ─── Pages reached by clicking through ────────────────────────────────────
  '/projects/[id]': {
    title: 'Project',
    purpose: 'One client project, from start to delivery: its milestones, tasks and people.',
    steps: [
      'Tasks lists the project’s tasks. + Task adds one.',
      'Milestones shows each part of the bill and how far it has got: Pending, Proforma raised, Invoiced, Paid.',
      'People and Activity show who is on it, and everything that has happened.',
    ],
    readMore: 'stage-tasks',
  },
  '/retainers/[id]': {
    title: 'Retainer',
    purpose: 'One client’s retainer, a month at a time: the work, the tasks and the billing for that month.',
    steps: [
      'Move between months with the arrows beside the month.',
      'Projects holds the pieces of work in this retainer. Open one to see its tasks. + Task adds one.',
      'Invoice shows this month’s invoice and whether it is paid.',
    ],
    readMore: 'stage-tasks',
  },
  '/retainers/[id]/projects/[projectId]': {
    title: 'Retainer work',
    purpose: 'One piece of work inside a client’s retainer, and its tasks, a month at a time.',
    steps: [
      'Move between months with the arrows to see that month’s tasks.',
      '+ Task adds a task to this piece of work. Click a task to open it.',
      'The billing for the month is on the retainer’s own page.',
    ],
    readMore: 'stage-tasks',
  },
  '/internal-projects/[id]': {
    title: 'Internal project',
    purpose: 'One of the studio’s own projects, with no client and no money: its dates, progress and tasks.',
    steps: [
      'See how far it has got, what is due next, and who is on it under People on this.',
      'New task adds a task to it.',
      'Edit changes its name, owner or dates. Press Mark done when it is finished.',
    ],
    readMore: 'stage-tasks',
  },
};

/** For an address with no card of its own: a page not found, or one this person cannot open. */
export const GENERAL_HELP: PageHelp = {
  title: 'Using Flowzen',
  purpose: 'Each screen in Flowzen does one part of the work. How it works explains the whole app on one page.',
  steps: [
    'Use the sidebar to move between screens. It only shows the screens you can open.',
    'Search, at the top, finds a company, a project or a task by name.',
    'Stuck on a screen? Ask your Head.',
  ],
};

const segments = (path: string): string[] => path.split(/[?#]/)[0].split('/').filter(Boolean);
const isParam = (segment: string): boolean => segment.startsWith('[') && segment.endsWith(']');

/** Most specific first: the longest key, and between two as long, the one with more fixed segments. */
const KEYS = Object.keys(PAGE_HELP)
  .map((key) => ({ key, parts: segments(key) }))
  .sort(
    (a, b) =>
      b.parts.length - a.parts.length ||
      b.parts.filter((p) => !isParam(p)).length - a.parts.filter((p) => !isParam(p)).length,
  );

/** The card for this address: its own, or the general one. */
export function helpFor(pathname: string): PageHelp {
  const path = segments(pathname);
  const hit = KEYS.find(
    ({ parts }) => parts.length > 0 && parts.length <= path.length && parts.every((p, i) => isParam(p) || p === path[i]),
  );
  return hit ? PAGE_HELP[hit.key] : GENERAL_HELP;
}

/** Where this card's "Read more" goes. */
export const readMoreHref = (help: PageHelp): string =>
  help.readMore ? `/how-it-works#${help.readMore}` : '/how-it-works';
