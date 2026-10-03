import { LOST_REASONS, LOST_REASON_OTHER } from '@flowzen/shared';
import { prisma } from '../lib/prisma.js';
import type { AiTool } from './ai/types.js';
import { approveRefusal } from './taskApprovals.js';
import { eventLink, findClashes, UNPICKABLE, windowFrom } from './calendarEvents.js';
import { resolveMailConfig } from '../utils/mailer.js';
import { whenLabel } from '../utils/zonedTime.js';
import { addDays, loadWorkCalendar, nextWorkingDay } from '../utils/workCalendar.js';
import { companyLink, retainerMonthLink, taskLink } from '../utils/recordLink.js';

/**
 * Whole jobs Zen prepares and a person carries out (Zen Plan 4).
 *
 * The rule from `zenDraft.ts`, unchanged and extended: nothing here writes.
 * Each `prepare…` tool looks things up, resolves words into ids, and returns
 * a CARD — a plan in plain words where every step holds the exact request for
 * an endpoint that already exists (method, path, body). The browser sends that
 * request, on the person's own session, when they press the step's button.
 *
 *   - **The guard is the real endpoint.** Approval, closed-month, permission
 *     and stage rules all stay where they live; the checks below are a courtesy
 *     so a card does not offer what the endpoint would only refuse.
 *   - **Money documents are never posted from a card.** A proforma, invoice,
 *     retainer or project opens the screen's own form with Zen's values filled
 *     in, and the person presses that form's Save.
 *   - **Messages are never sent.** A follow-up is text with Copy, WhatsApp and
 *     Email buttons; Flowzen sends nothing itself.
 *   - **Zen never cancels or deletes anything,** and never enters a cost.
 */

/* ─── What a card is ─────────────────────────────────────────────────────── */

/** The exact request a step sends — always to an endpoint that already exists. */
export type ZenRequest = { method: 'POST' | 'PATCH'; path: string; body?: Record<string, unknown> };

/** One change inside a step. Several make a grouped step: one click, sent one by one. */
export type ZenItem = {
  label: string;
  detail?: string;
  /** The change, when there is only one way to do it. */
  request?: ZenRequest;
  /** The choices, when the person picks per item — `request: null` is "leave it". */
  options?: { label: string; request: ZenRequest | null }[];
  /** Which option is picked to begin with. */
  choice?: number;
};

/** A filled-in money form: the screen to open, which form, and its values. */
export type ZenForm = {
  name: 'proposalProforma' | 'monthProforma' | 'monthInvoice' | 'retainer' | 'project';
  /** The screen, without the one-time `zen` key the browser adds. */
  path: string;
  values: Record<string, unknown>;
};

export type ZenStep =
  /** Sent from the card, item by item. */
  | { kind: 'post'; label: string; detail?: string; items: ZenItem[]; after?: number[]; doneText?: string }
  /** Opens the real form, filled in. The person saves it. */
  | { kind: 'form'; label: string; detail?: string; form: ZenForm; after?: number[] }
  /** Only a way to a screen — for what Zen does not do, like entering costs. */
  | { kind: 'link'; label: string; detail?: string; href: string }
  /** Said, not done: nothing to press. */
  | { kind: 'note'; label: string; detail?: string };

export type ZenCard =
  | {
      type: 'plan';
      title: string;
      summary?: string[];
      /** Shown before the click, never blocking: clashes, things to know. */
      warnings?: string[];
      notes?: string[];
      link?: string;
      steps: ZenStep[];
    }
  | {
      type: 'message';
      title: string;
      to: { name: string; role: string; phone: string | null; email: string | null } | null;
      subject: string;
      text: string;
      whatsapp: string;
      mailto: string;
      note?: string;
      link?: string;
    };

export type JobOutcome = { result: unknown; cards?: ZenCard[] };

type Needs = { needs: string[]; because: string; candidates: Record<string, unknown> };
const asks = (n: Needs): JobOutcome => ({ result: n });
const says = (result: Record<string, unknown>): JobOutcome => ({ result });

/** What the model is told once a card is up: nothing has happened yet. */
const PREPARED =
  'Card prepared and shown to them. NOTHING has changed yet — each step happens only when they press its button, ' +
  'and a form step only opens the form for them to check and save. Say briefly what the card does and what to press. ' +
  'Never say it is done, sent, booked or saved: the card says so itself once it is.';
/** The card, and — for the model — what it offers, so its words match what the person sees. */
const card = (c: ZenCard, more: Record<string, unknown> = {}): JobOutcome => ({
  result: {
    prepared: true,
    note: PREPARED,
    cardOffers: c.type === 'plan' ? c.steps.map((s, i) => `${i + 1}. ${s.label}${s.kind === 'form' ? ' (opens the form)' : s.kind === 'note' ? ' (said, nothing to press)' : ''}`) : ['a message to copy or send yourself'],
    ...more,
  },
  cards: [c],
});

/* ─── Small helpers ──────────────────────────────────────────────────────── */

const looksLike = (typed: unknown) => ({ contains: String(typed).trim(), mode: 'insensitive' as const });
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTime = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}$/.test(v);
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const utcDay = (d: Date) => d.toISOString().slice(0, 10);
/** "Mon 6 Oct", for a stored YYYY-MM-DD. */
const dayLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const rupees = (v: unknown) => `₹${Math.round(Number(v ?? 0)).toLocaleString('en-IN')}`;
const thisMonth = () => ymd(new Date()).slice(0, 7);
const nextMonthOf = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A client named by the model: its id from the page, or a name. Ambiguity comes back as `needs`. */
async function resolveCompany(orgId: string, typed: unknown): Promise<{ id: string; name: string } | Needs> {
  const text = String(typed ?? '').trim();
  if (!text) return { needs: ['client'], because: 'Which client is this about?', candidates: {} };
  const byId = await prisma.company.findFirst({ where: { id: text, organizationId: orgId }, select: { id: true, name: true } });
  if (byId) return byId;
  const named = await prisma.company.findMany({
    where: { organizationId: orgId, name: looksLike(text) },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
    take: 10,
  });
  const exact = named.filter((c) => c.name.toLowerCase() === text.toLowerCase());
  if (exact.length === 1) return exact[0];
  if (named.length === 1) return named[0];
  return {
    needs: ['client'],
    because: named.length === 0 ? `No client matches "${text}".` : `"${text}" matches more than one client.`,
    candidates: { clients: named.map((c) => c.name) },
  };
}

/** Team members by name: each must match exactly one active person. */
async function resolvePeople(orgId: string, names: unknown): Promise<{ id: string; name: string }[] | Needs> {
  const list = (Array.isArray(names) ? names : names ? [names] : []).map((n) => String(n).trim()).filter(Boolean);
  const team = await prisma.user.findMany({
    where: { organizationId: orgId, active: true },
    select: { id: true, name: true, dept: true },
    orderBy: { name: 'asc' },
  });
  const out: { id: string; name: string }[] = [];
  for (const typed of list) {
    const t = typed.toLowerCase();
    const exact = team.filter((u) => u.name.toLowerCase() === t);
    const hits = exact.length ? exact : team.filter((u) => u.name.toLowerCase().includes(t));
    if (hits.length !== 1) {
      return {
        needs: ['people'],
        because: hits.length === 0 ? `Nobody on the team matches "${typed}".` : `"${typed}" matches more than one person.`,
        candidates: { team: (hits.length ? hits : team).map((u) => `${u.name} — ${u.dept}`) },
      };
    }
    if (!out.some((p) => p.id === hits[0].id)) out.push({ id: hits[0].id, name: hits[0].name });
  }
  return out;
}

const isNeeds = (v: unknown): v is Needs => Boolean(v && typeof v === 'object' && 'needs' in v);
const andList = (names: string[]) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/* ─── The tools the model is given ───────────────────────────────────────── */

export const ZEN_JOB_TOOLS = [
  {
    name: 'prepareTaskChanges',
    description:
      'Prepare changes to existing tasks for the asker to carry out: move the due date, reassign, set status (done, cancelled, in progress, to do), set priority, or start/stop a repeat. ' +
      'Pick ONE task with `task`, or a set with person / client / dueOn / status. Nothing changes until they press the card\'s button. ' +
      'A task that needs approval cannot be marked done; one waiting for approval cannot be edited.',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Part of one task\'s title, or its id — for a single task.' },
        person: { type: 'string', description: 'Tasks this team member is on.' },
        client: { type: 'string', description: 'Tasks for this client (name or id).' },
        dueOn: { type: 'string', description: 'Tasks due on this day, YYYY-MM-DD.' },
        status: { type: 'string', enum: ['OPEN', 'LATE', 'TODO', 'IN_PROGRESS', 'ON_HOLD'], description: 'Which tasks. Defaults to OPEN.' },
        newDueDate: { type: 'string', description: 'Move them to this day, YYYY-MM-DD.' },
        assignTo: { type: 'array', items: { type: 'string' }, description: 'The people to put on them instead; the first leads.' },
        setStatus: { type: 'string', enum: ['DONE', 'CANCELLED', 'IN_PROGRESS', 'TODO'] },
        setPriority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
        repeat: { type: 'string', enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'STOP'], description: 'Start a repeat from the due date, or STOP it.' },
      },
    },
  },
  {
    name: 'prepareApproval',
    description:
      'Prepare an approval decision on a task waiting for approval: APPROVE, or REQUEST_CHANGES with written feedback (ask for the feedback if they have not said what to fix).',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Part of the task\'s title, or its id.' },
        client: { type: 'string' },
        decision: { type: 'string', enum: ['APPROVE', 'REQUEST_CHANGES'] },
        feedback: { type: 'string', description: 'What needs changing — required to send it back.' },
      },
      required: ['decision'],
    },
  },
  {
    name: 'prepareFollowUp',
    description:
      'Draft a short, polite follow-up message for the asker to send themselves (Copy, WhatsApp or Email — Flowzen sends nothing): ' +
      'INVOICE for an unpaid invoice, PROPOSAL for a proposal gone quiet, VERBAL_YES for an advance still to come, CLIENT to check in with a quiet client.',
    parameters: {
      type: 'object',
      properties: {
        about: { type: 'string', enum: ['INVOICE', 'PROPOSAL', 'VERBAL_YES', 'CLIENT'] },
        client: { type: 'string' },
        invoice: { type: 'string', description: 'The invoice number, when there are several.' },
        to: { type: 'string', description: "The client contact's name, when there are several." },
      },
      required: ['about', 'client'],
    },
  },
  {
    name: 'prepareSalesStep',
    description:
      'Prepare a move on a client\'s proposal: VERBAL_YES (flag it, only once a proforma is issued), WON on a version (then the retainer or project form opens filled in), ' +
      'LOST with a reason, RAISE_PROFORMA (opens the proforma form filled in), or SET_UP_WORK for a won deal with no retainer or project yet. ' +
      '"They said yes to version 2" or "they signed" is WON on that version — a verbal yes takes no version. ' +
      'Call this even when you are unsure which proposal is meant: it works that out from the version, or asks with the real options.',
    parameters: {
      type: 'object',
      properties: {
        client: { type: 'string' },
        action: { type: 'string', enum: ['VERBAL_YES', 'WON', 'LOST', 'RAISE_PROFORMA', 'SET_UP_WORK'] },
        proposal: { type: 'string', description: 'Which proposal, when the client has several: "retainer", "project", or words from its scope.' },
        version: { type: 'number', description: 'The version they agreed to, for WON.' },
        reason: { type: 'string', description: `Why it was lost: one of ${LOST_REASONS.join(', ')} — or their words.` },
        startDate: { type: 'string', description: 'For the retainer or project form, YYYY-MM-DD, if they said.' },
        endDate: { type: 'string', description: 'For a project form, YYYY-MM-DD, if they said.' },
        termMonths: { type: 'number', description: 'For a retainer form, if they said.' },
        gstPercent: { type: 'number', description: 'If they said.' },
        name: { type: 'string', description: 'For a project form: its name, if they said.' },
      },
      required: ['client', 'action'],
    },
  },
  {
    name: 'prepareMonthClose',
    description:
      "Prepare closing one client's retainer month: its open tasks (mark done, move, or cancel, one choice each), costs (a link — Zen never enters costs), the proforma and the invoice (forms, filled in), and when the month closes.",
    parameters: {
      type: 'object',
      properties: {
        client: { type: 'string' },
        month: { type: 'string', description: 'As 2026-09. Defaults to the current month.' },
      },
      required: ['client'],
    },
  },
  {
    name: 'prepareEvent',
    description:
      'Prepare booking a meeting or shoot (BOOK), or moving one (MOVE), with clash warnings shown before the click. Zen never cancels an event: for CANCEL this returns its link to cancel it there. ' +
      'Work the real date and times out yourself (the studio\'s clock). Meetings default to one hour.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['BOOK', 'MOVE', 'CANCEL'] },
        event: { type: 'string', description: 'For MOVE or CANCEL: words from the event\'s title.' },
        kind: { type: 'string', enum: ['MEETING', 'SHOOT', 'OTHER'] },
        title: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD — for MOVE, the new day.' },
        start: { type: 'string', description: 'HH:MM, 24-hour.' },
        end: { type: 'string', description: 'HH:MM, 24-hour.' },
        allDay: { type: 'boolean' },
        place: { type: 'string' },
        people: { type: 'array', items: { type: 'string' }, description: 'Team members on it.' },
        client: { type: 'string' },
        contacts: { type: 'array', items: { type: 'string' }, description: "The client's people coming — never emailed." },
        gear: { type: 'array', items: { type: 'string' }, description: 'For a shoot: equipment by name or tag.' },
        notes: { type: 'string' },
      },
      required: ['action'],
    },
  },
] as const satisfies readonly AiTool[];

export type ZenJobName = (typeof ZEN_JOB_TOOLS)[number]['name'];
export const isZenJob = (name: string): name is ZenJobName => ZEN_JOB_TOOLS.some((t) => t.name === name);

export async function runZenJob(
  name: ZenJobName,
  args: Record<string, unknown>,
  organizationId: string,
  askerId: string,
  now = new Date(),
): Promise<JobOutcome> {
  switch (name) {
    case 'prepareTaskChanges':
      return prepareTaskChanges(args, organizationId, askerId, now);
    case 'prepareApproval':
      return prepareApproval(args, organizationId, askerId);
    case 'prepareFollowUp':
      return prepareFollowUp(args, organizationId, askerId, now);
    case 'prepareSalesStep':
      return prepareSalesStep(args, organizationId);
    case 'prepareMonthClose':
      return prepareMonthClose(args, organizationId, now);
    case 'prepareEvent':
      return prepareEvent(args, organizationId, askerId, now);
  }
}

/* ─── 1. Task changes ────────────────────────────────────────────────────── */

const TASK_SELECT = {
  id: true,
  title: true,
  status: true,
  dueDate: true,
  needsApproval: true,
  createdById: true,
  repeat: { select: { stoppedAt: true, frequency: true } },
  assignees: { select: { user: { select: { id: true, name: true } } } },
  monthCard: { select: { month: true, retainer: { select: { company: { select: { name: true } } } } } },
  project: { select: { name: true } },
} as const;

const taskLabel = (t: { title: string; dueDate: Date; assignees: { user: { name: string } }[] }) =>
  `${t.title} — ${t.assignees.map((a) => firstName(a.user.name)).join(', ') || 'nobody'} · due ${dayLabel(utcDay(t.dueDate))}`;

async function prepareTaskChanges(args: Record<string, unknown>, orgId: string, askerId: string, now: Date): Promise<JobOutcome> {
  const today = ymd(now);
  const wants = {
    due: args.newDueDate,
    people: args.assignTo,
    status: args.setStatus ? String(args.setStatus) : null,
    priority: args.setPriority ? String(args.setPriority) : null,
    repeat: args.repeat ? String(args.repeat) : null,
  };
  if (!wants.due && !wants.people && !wants.status && !wants.priority && !wants.repeat) {
    return asks({ needs: ['change'], because: 'What should change — the due date, who is on it, its status, priority, or its repeat?', candidates: {} });
  }
  if (wants.due !== undefined && !isDay(wants.due)) {
    return asks({ needs: ['newDueDate'], because: `"${wants.due}" is not a date. It has to be YYYY-MM-DD.`, candidates: { today } });
  }
  if (!args.task && !args.person && !args.client && !args.dueOn) {
    return asks({ needs: ['which tasks'], because: 'Which task — or whose, for which client, or due when?', candidates: {} });
  }

  let assignees: { id: string; name: string }[] | null = null;
  if (wants.people) {
    const found = await resolvePeople(orgId, wants.people);
    if (isNeeds(found)) return asks(found);
    if (found.length === 0) return asks({ needs: ['assignTo'], because: 'Who should be on them?', candidates: {} });
    assignees = found;
  }

  /* Which tasks. */
  const where: Record<string, unknown>[] = [{ organizationId: orgId, deletedAt: null }];
  if (args.task) where.push({ OR: [{ id: String(args.task) }, { title: looksLike(args.task) }] });
  if (args.person) {
    const who = await resolvePeople(orgId, [args.person]);
    if (isNeeds(who)) return asks(who);
    where.push({ assignees: { some: { userId: who[0].id } } });
  }
  if (args.client) {
    const company = await resolveCompany(orgId, args.client);
    if (isNeeds(company)) return asks(company);
    where.push({
      OR: [
        { monthCard: { retainer: { companyId: company.id } } },
        { project: { companyId: company.id } },
        { companyId: company.id },
      ],
    });
  }
  if (args.dueOn) {
    if (!isDay(args.dueOn)) return asks({ needs: ['dueOn'], because: `"${args.dueOn}" is not a date.`, candidates: { today } });
    where.push({ dueDate: { gte: new Date(`${args.dueOn}T00:00:00Z`), lt: new Date(`${addDays(args.dueOn, 1)}T00:00:00Z`) } });
  }
  // One task named outright may be finished; a set is the work still owed.
  const status = args.status ? String(args.status) : args.task ? null : 'OPEN';
  if (status === 'OPEN') where.push({ status: { in: ['TODO', 'IN_PROGRESS', 'ON_HOLD', 'IN_REVIEW'] } });
  else if (status === 'LATE') where.push({ status: { in: ['TODO', 'IN_PROGRESS', 'ON_HOLD'] }, dueDate: { lt: new Date(`${today}T00:00:00Z`) } });
  else if (status) where.push({ status });

  const tasks = await prisma.task.findMany({ where: { AND: where } as never, select: TASK_SELECT, orderBy: { dueDate: 'asc' }, take: 51 });
  if (tasks.length === 0) {
    return says({ found: 0, because: 'No tasks match that.', hint: 'Try getTasks to see what there is.' });
  }
  if (tasks.length > 50) {
    return says({ found: 'more than 50', because: 'That is more than 50 tasks. Narrow it — by person, client or due day.' });
  }
  if (args.task && !args.person && !args.client && !args.dueOn && tasks.length > 1) {
    return asks({
      needs: ['task'],
      because: `"${args.task}" matches ${tasks.length} tasks.`,
      candidates: { tasks: tasks.slice(0, 10).map(taskLabel) },
    });
  }

  /* What each one can take, said before the button rather than after it. */
  const left: { task: (typeof tasks)[number]; why: string }[] = [];
  const editable = tasks.filter((t) => {
    if (t.status === 'IN_REVIEW' && !(wants.status === 'CANCELLED' && !wants.due && !wants.people && !wants.priority && !wants.repeat)) {
      left.push({ task: t, why: 'waiting for approval — an approver approves it or sends it back' });
      return false;
    }
    return true;
  });

  const patch: Record<string, unknown> = {};
  if (wants.due) patch.dueDate = wants.due;
  if (assignees) patch.assigneeIds = assignees.map((p) => p.id);
  if (wants.priority) patch.priority = wants.priority;
  if (wants.repeat) patch.repeat = wants.repeat === 'STOP' ? null : wants.repeat;

  const steps: ZenStep[] = [];
  const notes: string[] = [];

  if (Object.keys(patch).length > 0) {
    const items: ZenItem[] = [];
    for (const t of editable) {
      const liveRepeat = t.repeat && !t.repeat.stoppedAt ? t.repeat : null;
      if (wants.repeat === 'STOP' && !liveRepeat && Object.keys(patch).length === 1) {
        left.push({ task: t, why: "doesn't repeat" });
        continue;
      }
      if (wants.repeat && wants.repeat !== 'STOP' && liveRepeat?.frequency === wants.repeat && Object.keys(patch).length === 1) {
        left.push({ task: t, why: `already repeats ${wants.repeat.toLowerCase()}` });
        continue;
      }
      items.push({
        label: taskLabel(t),
        // A copy in a repeat: this copy moves, the series does not.
        ...(wants.due && liveRepeat ? { detail: 'Only this copy moves; the repeat continues.' } : {}),
        request: { method: 'PATCH', path: `/tasks/${t.id}`, body: patch },
      });
    }
    const copies = items.filter((i) => i.detail).length;
    if (copies) {
      // Moving a copy never changes its repeat: the stored day stays, so later copies keep theirs.
      notes.push(
        copies === 1
          ? 'Only this copy moves; the repeat continues — later copies keep their usual day.'
          : 'Only these copies move; their repeats continue — later copies keep their usual days.',
      );
    }
    if (items.length) {
      const what = [
        wants.due ? `to ${dayLabel(String(wants.due))}` : null,
        assignees ? `to ${andList(assignees.map((p) => p.name))}` : null,
        wants.priority ? `priority ${String(wants.priority).toLowerCase()}` : null,
        wants.repeat ? (wants.repeat === 'STOP' ? 'stop repeating' : `repeat ${String(wants.repeat).toLowerCase()}`) : null,
      ]
        .filter(Boolean)
        .join(', ');
      const verb = wants.due ? 'Move' : assignees ? 'Reassign' : wants.repeat ? 'Change the repeat on' : 'Change';
      steps.push({
        kind: 'post',
        label: `${verb} ${plural(items.length, 'task')} ${what}`.replace(/\s+/g, ' ').trim(),
        items,
        doneText: wants.due ? 'moved' : 'changed',
      });
    }
  }

  if (wants.status) {
    const items: ZenItem[] = [];
    const forApproval: (typeof tasks)[number][] = [];
    for (const t of editable) {
      if (t.status === wants.status) {
        left.push({ task: t, why: `already ${wants.status.toLowerCase().replace('_', ' ')}` });
        continue;
      }
      if (wants.status === 'DONE' && t.needsApproval) {
        left.push({ task: t, why: 'needs approval, so it is finished by sending it for approval, not by marking it done' });
        forApproval.push(t);
        continue;
      }
      items.push({ label: taskLabel(t), request: { method: 'PATCH', path: `/tasks/${t.id}/status`, body: { status: wants.status } } });
    }
    if (items.length) {
      const word = { DONE: 'done', CANCELLED: 'cancelled', IN_PROGRESS: 'in progress', TODO: 'to do' }[wants.status] ?? wants.status;
      steps.push({ kind: 'post', label: `Mark ${plural(items.length, 'task')} ${word}`, items, doneText: word });
    }
    // Sending for approval is for somebody on the task, or who made it.
    const canSend = forApproval.filter(
      (t) => ['TODO', 'IN_PROGRESS'].includes(t.status) && (t.createdById === askerId || t.assignees.some((a) => a.user.id === askerId)),
    );
    if (canSend.length) {
      steps.push({
        kind: 'post',
        label: `Send ${plural(canSend.length, 'task')} for approval instead`,
        detail: 'An approver then approves it, which marks it done.',
        items: canSend.map((t) => ({ label: taskLabel(t), request: { method: 'POST', path: `/tasks/${t.id}/submit-review`, body: {} } })),
        doneText: 'sent for approval',
      });
    }
    if (forApproval.length > canSend.length) {
      notes.push('A task that needs approval is finished by somebody on it pressing "Send for approval", and an approver approving it.');
    }
  }

  const leftOut = left.map((l) => `${l.task.title}: ${l.why}`);
  if (steps.length === 0) {
    return says({ nothingToDo: true, because: leftOut.length ? leftOut : 'Nothing to change.', links: left.map((l) => taskLink(l.task.id)) });
  }
  return card(
    {
      type: 'plan',
      title: steps.length === 1 ? steps[0].label : `Change ${plural(editable.length, 'task')}`,
      ...(leftOut.length ? { warnings: leftOut.map((l) => `Left out — ${l}`) } : {}),
      ...(notes.length ? { notes } : {}),
      steps,
    },
    { tasks: tasks.length, leftOut, ...(notes.length ? { keepInMind: notes } : {}) },
  );
}

/* ─── 2. Approvals ───────────────────────────────────────────────────────── */

async function prepareApproval(args: Record<string, unknown>, orgId: string, askerId: string): Promise<JobOutcome> {
  const decision = String(args.decision ?? '');
  if (decision !== 'APPROVE' && decision !== 'REQUEST_CHANGES') {
    return asks({ needs: ['decision'], because: 'Approve it, or send it back with changes?', candidates: {} });
  }
  const filters: Record<string, unknown>[] = [{ organizationId: orgId, deletedAt: null }];
  if (args.task) filters.push({ OR: [{ id: String(args.task) }, { title: looksLike(args.task) }] });
  if (args.client) {
    const company = await resolveCompany(orgId, args.client);
    if (isNeeds(company)) return asks(company);
    filters.push({ OR: [{ monthCard: { retainer: { companyId: company.id } } }, { project: { companyId: company.id } }, { companyId: company.id }] });
  }
  const waiting = await prisma.task.findMany({
    where: { AND: [...filters, { status: 'IN_REVIEW' }] } as never,
    select: { ...TASK_SELECT, taskType: true },
    take: 20,
  });
  if (waiting.length !== 1) {
    if (waiting.length === 0) {
      const any = args.task
        ? await prisma.task.findFirst({ where: { AND: filters } as never, select: { title: true, status: true } })
        : null;
      const queue = await prisma.task.findMany({
        where: { organizationId: orgId, deletedAt: null, status: 'IN_REVIEW' },
        select: TASK_SELECT,
        take: 15,
      });
      return asks({
        needs: ['task'],
        because: any ? `"${any.title}" is not waiting for approval — it is ${any.status.toLowerCase().replace('_', ' ')}.` : 'No task matching that is waiting for approval.',
        candidates: { waitingForApproval: queue.map(taskLabel) },
      });
    }
    return asks({ needs: ['task'], because: 'More than one task waiting for approval matches.', candidates: { tasks: waiting.map(taskLabel) } });
  }
  const task = waiting[0];
  const feedback = String(args.feedback ?? '').trim();
  if (decision === 'REQUEST_CHANGES' && !feedback) {
    return asks({ needs: ['feedback'], because: 'Say what needs changing — the editor works from this.', candidates: { task: task.title } });
  }

  const round = await prisma.taskReview.findFirst({
    where: { taskId: task.id, decision: null },
    orderBy: { round: 'desc' },
    select: { round: true, submittedAt: true, escalatedAt: true, link: true, note: true, submittedBy: { select: { name: true } } },
  });
  // Said before the button: whether this person may decide it at all.
  const refusal = await approveRefusal(orgId, askerId, { taskType: task.taskType, assigneeIds: task.assignees.map((a) => a.user.id) }, round);
  if (refusal) return says({ cannot: refusal, link: taskLink(task.id) });

  const approve = decision === 'APPROVE';
  return card({
    type: 'plan',
    title: `${approve ? 'Approve' : 'Send back'}: ${task.title}`,
    link: taskLink(task.id),
    summary: [
      round ? `Round ${round.round}, sent by ${round.submittedBy.name} on ${dayLabel(utcDay(round.submittedAt))}${round.escalatedAt ? ' · escalated' : ''}.` : 'Waiting for approval.',
      ...(round?.link ? [`The work: ${round.link}`] : []),
      ...(round?.note ? [`Their note: "${round.note}"`] : []),
    ],
    steps: [
      approve
        ? { kind: 'post', label: 'Approve it', detail: 'It becomes Done.', items: [{ label: task.title, request: { method: 'POST', path: `/tasks/${task.id}/approve`, body: {} } }], doneText: 'approved' }
        : {
            kind: 'post',
            label: 'Send it back for changes',
            detail: `"${feedback}"`,
            items: [{ label: task.title, request: { method: 'POST', path: `/tasks/${task.id}/request-changes`, body: { feedback } } }],
            doneText: 'sent back',
          },
    ],
  });
}

/* ─── 3. Follow-up messages ──────────────────────────────────────────────── */

/** WhatsApp wants the number with its country code and nothing else. */
const whatsappDigits = (phone: string | null) => {
  if (!phone) return null;
  const d = phone.replace(/\D/g, '');
  if (d.length === 10) return `91${d}`;
  if (d.length === 11 && d.startsWith('0')) return `91${d.slice(1)}`;
  return d.length >= 11 ? d : null;
};

async function prepareFollowUp(args: Record<string, unknown>, orgId: string, askerId: string, now: Date): Promise<JobOutcome> {
  const about = String(args.about ?? '');
  if (!['INVOICE', 'PROPOSAL', 'VERBAL_YES', 'CLIENT'].includes(about)) {
    return asks({ needs: ['about'], because: 'A reminder about an invoice, a proposal, an advance after a verbal yes, or a general check-in?', candidates: {} });
  }
  const company = await resolveCompany(orgId, args.client);
  if (isNeeds(company)) return asks(company);
  const [org, me, people] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: askerId }, select: { name: true } }),
    prisma.person.findMany({
      where: { companyId: company.id, active: true },
      select: { name: true, role: true, phone: true, email: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  const today = ymd(now);
  let subject = '';
  let body = '';
  let link = companyLink(company.id);

  if (about === 'INVOICE') {
    const invoices = await prisma.invoice.findMany({
      where: {
        organizationId: orgId,
        companyId: company.id,
        status: { notIn: ['PAID', 'CANCELLED'] as never },
        ...(args.invoice ? { number: looksLike(args.invoice) } : {}),
      },
      orderBy: { dueAt: 'asc' },
      select: { id: true, number: true, amount: true, dueAt: true, payments: { select: { amount: true } } },
    });
    const overdue = invoices.filter((i) => utcDay(i.dueAt) < today);
    const pool = overdue.length ? overdue : invoices;
    if (pool.length === 0) return says({ nothingToChase: `${company.name} has no unpaid invoice.` });
    if (pool.length > 1 && !args.invoice) {
      return asks({
        needs: ['invoice'],
        because: `${company.name} has ${pool.length} unpaid invoices.`,
        candidates: { invoices: pool.map((i) => `${i.number} · ${rupees(i.amount)} · due ${dayLabel(utcDay(i.dueAt))}`) },
      });
    }
    const inv = pool[0];
    const paid = inv.payments.reduce((s, p) => s + Number(p.amount), 0);
    const balance = Number(inv.amount) - paid;
    subject = `Invoice ${inv.number} — payment reminder`;
    body =
      `A gentle reminder that invoice ${inv.number} for ${rupees(inv.amount)}, due on ${dayLabel(utcDay(inv.dueAt))}, is still open` +
      (paid > 0 ? ` — ${rupees(balance)} remains after the part payment received` : '') +
      '. Could you let us know when we can expect the payment?';
    link = companyLink(company.id, 'MONEY');
  } else if (about === 'PROPOSAL' || about === 'VERBAL_YES') {
    const stages = about === 'PROPOSAL' ? ['PROPOSAL_SENT', 'IN_NEGOTIATION', 'PROFORMA_ISSUED'] : ['VERBAL_YES'];
    const proposal = await prisma.proposal.findFirst({
      where: { organizationId: orgId, companyId: company.id, deletedAt: null, outcome: null, stage: { in: stages as never } },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, versions: { orderBy: { n: 'desc' }, take: 1, select: { n: true, scopeSummary: true, sentAt: true } } },
    });
    if (!proposal) {
      return says({ nothingToChase: about === 'PROPOSAL' ? `${company.name} has no open proposal.` : `${company.name} has no proposal at Verbal yes.` });
    }
    const v = proposal.versions[0];
    link = companyLink(company.id, 'PROPOSALS');
    if (about === 'PROPOSAL') {
      subject = 'Following up on our proposal';
      body =
        `I wanted to follow up on the proposal we sent on ${v ? dayLabel(utcDay(v.sentAt)) : 'earlier'}` +
        (v?.scopeSummary ? ` for ${v.scopeSummary.trim().replace(/\.$/, '')}` : '') +
        '. Do you have any questions, or would a quick call to go through it help?';
    } else {
      const proforma = await prisma.proforma.findFirst({
        where: { organizationId: orgId, sourceType: 'PROPOSAL' as never, sourceId: proposal.id, status: 'UNPAID' as never },
        orderBy: { raisedAt: 'desc' },
        select: { number: true, amount: true, total: true },
      });
      subject = `Next step: the advance for ${company.name}`;
      body = proforma
        ? `Thank you for confirming you'd like to go ahead. To get started, could you arrange the advance against proforma ${proforma.number} for ${rupees(proforma.total ?? proforma.amount)}? Happy to resend it if that helps.`
        : "Thank you for confirming you'd like to go ahead. Could you let us know when we can expect the advance, so we can get started?";
    }
  } else {
    subject = 'Checking in';
    body = "It's been a little while since we last spoke, so I wanted to check in. How are things on your side, and is there anything we can help with this month?";
  }

  /* Who it goes to: the payer for money, the approver or contact otherwise. */
  const prefer = about === 'INVOICE' || about === 'VERBAL_YES' ? ['PAYER'] : ['APPROVER', 'CONTACT'];
  const reachable = (p: (typeof people)[number]) => Boolean(p.phone || p.email);
  let pool = people.filter((p) => prefer.includes(p.role) && reachable(p));
  let note: string | undefined;
  if (pool.length === 0) {
    pool = people.filter(reachable);
    if (pool.length && about === 'INVOICE') note = `${company.name} has no payer contact with a phone or email, so this is addressed to another contact.`;
  }
  if (args.to) {
    const t = String(args.to).toLowerCase();
    const named = people.filter((p) => p.name.toLowerCase().includes(t));
    if (named.length !== 1) {
      return asks({
        needs: ['to'],
        because: named.length ? `"${args.to}" matches more than one contact.` : `${company.name} has no contact called "${args.to}".`,
        candidates: { contacts: people.map((p) => `${p.name} — ${p.role.toLowerCase()}${p.phone ? ', phone' : ''}${p.email ? ', email' : ''}`) },
      });
    }
    pool = named;
  } else if (pool.length > 1) {
    return asks({
      needs: ['to'],
      because: `${company.name} has ${pool.length} ${prefer.includes('PAYER') ? 'payer' : ''} contacts it could go to.`.replace(/\s+/g, ' '),
      candidates: { contacts: pool.map((p) => `${p.name} — ${p.role.toLowerCase()}${p.phone ? ', phone' : ''}${p.email ? ', email' : ''}`) },
    });
  }
  const to = pool[0] ?? null;
  if (!to) note = `${company.name} has no contact with a phone or email in Flowzen — add one on their page, or send it from your own phone.`;

  const text = `Hi ${to ? firstName(to.name) : 'there'},\n\n${body}\n\nThank you,\n${me?.name ?? ''}\n${org?.name ?? ''}`.trim();
  const digits = whatsappDigits(to?.phone ?? null);
  return card(
    {
      type: 'message',
      title: `${subject} — ${company.name}`,
      to: to ? { name: to.name, role: to.role, phone: to.phone, email: to.email } : null,
      subject,
      text,
      whatsapp: `https://wa.me/${digits ?? ''}?text=${encodeURIComponent(text)}`,
      mailto: `mailto:${to?.email ? encodeURIComponent(to.email) : ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`,
      ...(note ? { note } : {}),
      link,
    },
    { to: to?.name ?? null, sentByFlowzen: false },
  );
}

/* ─── 4. Sales steps ─────────────────────────────────────────────────────── */

async function prepareSalesStep(args: Record<string, unknown>, orgId: string): Promise<JobOutcome> {
  const action = String(args.action ?? '');
  if (!['VERBAL_YES', 'WON', 'LOST', 'RAISE_PROFORMA', 'SET_UP_WORK'].includes(action)) {
    return asks({ needs: ['action'], because: 'Verbal yes, won, lost, raise a proforma, or set up the work?', candidates: {} });
  }
  const company = await resolveCompany(orgId, args.client);
  if (isNeeds(company)) return asks(company);

  const proposals = await prisma.proposal.findMany({
    where: { organizationId: orgId, companyId: company.id, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      kind: true,
      stage: true,
      outcome: true,
      wonVersionId: true,
      versions: { orderBy: { n: 'desc' }, select: { id: true, n: true, value: true, scopeSummary: true } },
    },
  });
  const linked = await Promise.all([
    prisma.retainer.findMany({ where: { sourceProposalId: { in: proposals.map((p) => p.id) } }, select: { sourceProposalId: true } }),
    prisma.project.findMany({ where: { sourceProposalId: { in: proposals.map((p) => p.id) }, deletedAt: undefined }, select: { sourceProposalId: true } }),
  ]);
  const hasWork = new Set(linked.flat().map((r) => r.sourceProposalId));
  const describe = (p: (typeof proposals)[number]) =>
    `${p.kind.toLowerCase()} · v${p.versions[0]?.n ?? 1} ${rupees(p.versions[0]?.value)} · ${p.outcome ? p.outcome.toLowerCase() : p.stage.toLowerCase().replace(/_/g, ' ')}${p.versions[0]?.scopeSummary ? ` · ${p.versions[0].scopeSummary.slice(0, 60)}` : ''}`;

  let pool =
    action === 'SET_UP_WORK'
      ? proposals.filter((p) => p.outcome === 'WON' && !hasWork.has(p.id))
      : proposals.filter((p) => !p.outcome);
  if (args.proposal) {
    const t = String(args.proposal).toLowerCase();
    const byKind = t.includes('retainer') ? 'RETAINER' : t.includes('project') ? 'PROJECT' : null;
    pool = pool.filter((p) => p.id === args.proposal || (byKind ? p.kind === byKind : p.versions.some((v) => v.scopeSummary.toLowerCase().includes(t))));
  }
  // "Version 2" names the proposal too, when only one of them has a version 2.
  if (pool.length > 1 && action === 'WON' && args.version !== undefined) {
    const withIt = pool.filter((x) => x.versions.some((v) => v.n === Number(args.version)));
    if (withIt.length === 1) pool = withIt;
  }
  if (pool.length !== 1) {
    return asks({
      needs: ['proposal'],
      because:
        pool.length === 0
          ? action === 'SET_UP_WORK'
            ? `${company.name} has no won deal still waiting for its retainer or project.`
            : `${company.name} has no open proposal${args.proposal ? ` matching "${args.proposal}"` : ''}.`
          : `${company.name} has ${pool.length} that could be meant.`,
      candidates: { proposals: (pool.length ? pool : proposals).map(describe) },
    });
  }
  const p = pool[0];
  const latest = p.versions[0];
  const link = companyLink(company.id, 'PROPOSALS');

  /** The retainer or project form, filled in from the agreed version. */
  const workForm = (value: number): Extract<ZenStep, { kind: 'form' }> => {
    const values =
      p.kind === 'RETAINER'
        ? {
            companyId: company.id,
            companyName: company.name,
            sourceProposalId: p.id,
            monthlyValue: value,
            ...(isDay(args.startDate) ? { startDate: args.startDate } : {}),
            ...(Number(args.termMonths) > 0 ? { termMonths: Number(args.termMonths) } : {}),
            ...(args.gstPercent !== undefined ? { gstPercent: Number(args.gstPercent) } : {}),
          }
        : {
            companyId: company.id,
            companyName: company.name,
            sourceProposalId: p.id,
            quotedValue: value,
            ...(args.name ? { name: String(args.name) } : {}),
            ...(isDay(args.startDate) ? { startDate: args.startDate } : {}),
            ...(isDay(args.endDate) ? { endDate: args.endDate } : {}),
            ...(args.gstPercent !== undefined ? { gstPercent: Number(args.gstPercent) } : {}),
          };
    return {
      kind: 'form',
      label: p.kind === 'RETAINER' ? 'Set up the retainer' : 'Create the project',
      detail: `Opens the ${p.kind === 'RETAINER' ? 'retainer' : 'project'} form with ${rupees(value)} filled in. Nothing is created until you press its Save.`,
      form: { name: p.kind === 'RETAINER' ? 'retainer' : 'project', path: `/companies/${company.id}?tab=PROPOSALS`, values },
    };
  };

  if (action === 'SET_UP_WORK') {
    const won = p.versions.find((v) => v.id === p.wonVersionId) ?? latest;
    return card({ type: 'plan', title: `${company.name}: ${p.kind === 'RETAINER' ? 'set up the retainer' : 'create the project'}`, link, steps: [workForm(Number(won?.value ?? 0))] });
  }

  if (action === 'WON') {
    let version = latest;
    if (args.version !== undefined) {
      const found = p.versions.find((v) => v.n === Number(args.version));
      if (!found) return asks({ needs: ['version'], because: `There is no version ${args.version}.`, candidates: { versions: p.versions.map((v) => `v${v.n} · ${rupees(v.value)}`) } });
      version = found;
    } else if (p.versions.length > 1) {
      return asks({ needs: ['version'], because: 'Which version did they agree to?', candidates: { versions: p.versions.map((v) => `v${v.n} · ${rupees(v.value)}`) } });
    }
    return card({
      type: 'plan',
      title: `${company.name}: won on v${version.n} (${rupees(version.value)})`,
      link,
      summary: [`${company.name} moves to Client and this proposal locks — no more versions.`],
      steps: [
        { kind: 'post', label: `Mark won on v${version.n}`, items: [{ label: describe(p), request: { method: 'POST', path: `/proposals/${p.id}/win`, body: { versionId: version.id } } }], doneText: 'won' },
        { ...workForm(Number(version.value)), after: [0] },
      ],
    });
  }

  if (action === 'LOST') {
    const typed = String(args.reason ?? '').trim();
    if (!typed) return asks({ needs: ['reason'], because: 'Why was it lost?', candidates: { reasons: LOST_REASONS.filter((r) => r !== LOST_REASON_OTHER) } });
    // One of the list, as the list spells it — or their own words, as "Other" stores them.
    const listed = LOST_REASONS.find((r) => r.toLowerCase() === typed.toLowerCase() && r !== LOST_REASON_OTHER);
    const reason = listed ?? typed;
    return card({
      type: 'plan',
      title: `${company.name}: mark the ${p.kind.toLowerCase()} proposal lost`,
      link,
      summary: [`Reason: ${reason}.`, 'A lost proposal does not come back; quote them again as a new proposal.'],
      steps: [{ kind: 'post', label: 'Mark it lost', items: [{ label: describe(p), request: { method: 'POST', path: `/proposals/${p.id}/lose`, body: { lostReason: reason } } }], doneText: 'lost' }],
    });
  }

  if (action === 'VERBAL_YES') {
    if (p.stage !== 'PROFORMA_ISSUED') {
      return says({ cannot: `Verbal yes can only be flagged once a proforma has been issued — this one is at ${p.stage.toLowerCase().replace(/_/g, ' ')}.`, link });
    }
    return card({
      type: 'plan',
      title: `${company.name}: flag verbal yes`,
      link,
      summary: ['A manual flag only — winning still needs Mark won on the agreed version.'],
      steps: [{ kind: 'post', label: 'Flag verbal yes', items: [{ label: describe(p), request: { method: 'PATCH', path: `/proposals/${p.id}/stage`, body: { stage: 'VERBAL_YES' } } }], doneText: 'flagged' }],
    });
  }

  // RAISE_PROFORMA: a money document, so the form opens filled in.
  return card({
    type: 'plan',
    title: `${company.name}: raise a proforma`,
    link,
    steps: [
      {
        kind: 'form',
        label: 'Raise the proforma',
        detail: `Opens the proforma form with ${rupees(latest?.value)} (v${latest?.n ?? 1}) filled in. It is raised only when you press its Save.`,
        form: { name: 'proposalProforma', path: `/companies/${company.id}?tab=PROPOSALS`, values: { proposalId: p.id, amount: Number(latest?.value ?? 0) } },
      },
    ],
  });
}

/* ─── 5. Closing a retainer month ────────────────────────────────────────── */

async function prepareMonthClose(args: Record<string, unknown>, orgId: string, now: Date): Promise<JobOutcome> {
  const company = await resolveCompany(orgId, args.client);
  if (isNeeds(company)) return asks(company);
  const month = isMonth(args.month) ? args.month : thisMonth();
  const monthCard = await prisma.monthCard.findFirst({
    where: { month, retainer: { organizationId: orgId, companyId: company.id } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      closedAt: true,
      revenue: true,
      retainerId: true,
      retainer: { select: { billing: true } },
      invoice: { select: { number: true, status: true, amount: true } },
      costs: { where: { deletedAt: null }, select: { amount: true } },
      tasks: { where: { deletedAt: null, status: { in: ['TODO', 'IN_PROGRESS', 'ON_HOLD', 'IN_REVIEW'] } }, orderBy: { dueDate: 'asc' }, select: TASK_SELECT },
    },
  });
  if (!monthCard) {
    const months = await prisma.monthCard.findMany({
      where: { retainer: { organizationId: orgId, companyId: company.id } },
      orderBy: { month: 'desc' },
      take: 6,
      select: { month: true },
    });
    return asks({ needs: ['month'], because: `${company.name} has no retainer month for ${month}.`, candidates: { months: months.map((m) => m.month) } });
  }

  const label = monthLabel(month);
  const next = nextMonthOf(month);
  const calendar = await loadWorkCalendar(orgId);
  // The next month's first working day — or, for a month already over, the next
  // working day from today, so nothing is moved into the past.
  const firstOfNext = nextWorkingDay(calendar, `${next}-01`);
  const moveTo = firstOfNext > ymd(now) ? firstOfNext : nextWorkingDay(calendar, addDays(ymd(now), 1));
  const steps: ZenStep[] = [];
  const notes: string[] = [];

  /* 1. The open tasks — one choice each. */
  const inReview = monthCard.tasks.filter((t) => t.status === 'IN_REVIEW');
  const open = monthCard.tasks.filter((t) => t.status !== 'IN_REVIEW');
  if (open.length) {
    steps.push({
      kind: 'post',
      label: `Settle ${plural(open.length, 'open task')}`,
      detail: `Pick one for each. Moving changes the due date only — the task stays on ${label}'s list.`,
      items: open.map((t) => {
        const options: { label: string; request: ZenRequest | null }[] = [
          { label: `Move to ${dayLabel(moveTo)}`, request: { method: 'PATCH', path: `/tasks/${t.id}`, body: { dueDate: moveTo } } },
          ...(t.needsApproval ? [] : [{ label: 'Mark done', request: { method: 'PATCH' as const, path: `/tasks/${t.id}/status`, body: { status: 'DONE' } } }]),
          { label: 'Cancel', request: { method: 'PATCH', path: `/tasks/${t.id}/status`, body: { status: 'CANCELLED' } } },
          { label: 'Leave it', request: null },
        ];
        return { label: taskLabel(t), ...(t.needsApproval ? { detail: 'Needs approval, so it is not marked done from here.' } : {}), options, choice: 0 };
      }),
      doneText: 'settled',
    });
  } else {
    steps.push({ kind: 'note', label: `No open tasks on ${label}.` });
  }
  if (inReview.length) {
    notes.push(`${plural(inReview.length, 'task')} waiting for approval: ${andList(inReview.map((t) => t.title))}. An approver decides those.`);
  }

  /* 2. Costs — never entered by Zen. */
  if (monthCard.costs.length === 0) {
    steps.push({
      kind: 'link',
      label: 'Enter the costs',
      detail: `Nothing is costed against ${label} yet, so its profit is not known. Zen does not enter costs.`,
      href: retainerMonthLink(monthCard.retainerId, month, 'costs'),
    });
  } else {
    const total = monthCard.costs.reduce((s, c) => s + Number(c.amount), 0);
    steps.push({ kind: 'note', label: `${plural(monthCard.costs.length, 'cost')} entered (${rupees(total)}).` });
  }

  /* 3. The proforma, and 4. the invoice — the real forms, filled in. */
  const proforma = await prisma.proforma.findFirst({
    where: { organizationId: orgId, sourceType: 'MONTH_CARD' as never, sourceId: monthCard.id, status: { not: 'CANCELLED' as never } },
    orderBy: { raisedAt: 'desc' },
    select: { number: true, status: true },
  });
  const path = `/retainers/${monthCard.retainerId}?month=${month}`;
  if (monthCard.invoice) {
    steps.push({ kind: 'note', label: proforma ? `Proforma ${proforma.number} raised.` : 'Invoiced without a proforma.' });
    steps.push({
      kind: 'note',
      label: `Invoice ${monthCard.invoice.number} entered (${rupees(monthCard.invoice.amount)}) — ${monthCard.invoice.status === 'PAID' ? 'paid' : 'waiting for payment'}.`,
    });
  } else {
    steps.push(
      proforma
        ? { kind: 'note', label: `Proforma ${proforma.number} raised (${proforma.status.toLowerCase()}).` }
        : {
            kind: 'form',
            label: 'Raise the proforma',
            detail: `Opens ${label}'s proforma form with the fee (${rupees(monthCard.revenue)}) filled in. It is raised only when you press its Save.`,
            form: { name: 'monthProforma', path, values: { monthCardId: monthCard.id } },
          },
    );
    const notYet = monthCard.retainer.billing === 'IN_ARREARS' && ymd(now) < `${next}-01`;
    steps.push(
      notYet
        ? { kind: 'note', label: `The invoice: billed after the month, so it can be entered from 1 ${monthLabel(next).split(' ')[0]}.` }
        : {
            kind: 'form',
            label: 'Enter the invoice',
            detail: 'Opens the Enter invoice form (the number from Tally, amount and dates) filled in. It is recorded only when you press its Save.',
            form: { name: 'monthInvoice', path, values: { monthCardId: monthCard.id } },
          },
    );
  }

  /* 5. Closing — there is no close button: the month closes on the 1st. */
  steps.push({
    kind: 'note',
    label:
      monthCard.status === 'CLOSED'
        ? `${label} is already closed${monthCard.closedAt ? ` (${dayLabel(utcDay(monthCard.closedAt))})` : ''}. Only its costs are locked.`
        : `${label} closes by itself on 1 ${monthLabel(next)} — there is no close button. Closing locks its costs.`,
  });

  return card({
    type: 'plan',
    title: `Close ${label} for ${company.name}`,
    link: retainerMonthLink(monthCard.retainerId, month),
    summary: [`Fee ${rupees(monthCard.revenue)} · ${monthCard.status === 'CLOSED' ? 'closed' : 'open'}.`],
    ...(notes.length ? { notes } : {}),
    steps,
  });
}

/* ─── 6. Meetings and shoots ─────────────────────────────────────────────── */

/** "10:00" plus minutes, on the wall clock; the day moves if it passes midnight. */
function wallPlus(day: string, time: string, minutes: number) {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const days = Math.floor(total / 1440);
  const rest = total % 1440;
  return { day: days ? addDays(day, days) : day, time: `${String(Math.floor(rest / 60)).padStart(2, '0')}:${String(rest % 60).padStart(2, '0')}` };
}

async function prepareEvent(args: Record<string, unknown>, orgId: string, askerId: string, now: Date): Promise<JobOutcome> {
  const action = String(args.action ?? '');
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { timezone: true } });
  const timezone = org?.timezone || 'Asia/Kolkata';

  /** An existing event by words from its title — upcoming first. */
  const findEvent = async () => {
    const typed = String(args.event ?? args.title ?? '').trim();
    if (!typed) return { needs: ['event'], because: 'Which event?', candidates: {} } as Needs;
    const found = await prisma.calendarEvent.findMany({
      where: { organizationId: orgId, deletedAt: null, title: looksLike(typed), endsAt: { gte: new Date(now.getTime() - 86_400_000) } },
      orderBy: { startsAt: 'asc' },
      take: 10,
      select: {
        id: true,
        title: true,
        kind: true,
        startsAt: true,
        endsAt: true,
        allDay: true,
        attendees: { select: { user: { select: { id: true, name: true } } } },
        reservations: { select: { assetId: true } },
      },
    });
    if (found.length !== 1) {
      return {
        needs: ['event'],
        because: found.length ? `"${typed}" matches more than one upcoming event.` : `No upcoming event matches "${typed}".`,
        candidates: { events: found.map((e) => `${e.title} · ${whenLabel(e.startsAt, e.endsAt, e.allDay, timezone)}`) },
      } as Needs;
    }
    return found[0];
  };

  if (action === 'CANCEL') {
    const ev = await findEvent();
    if (isNeeds(ev)) return asks(ev);
    return says({ cannot: "Zen doesn't cancel events. Open it and press Cancel it yourself.", event: ev.title, link: eventLink(ev.id) });
  }
  if (action !== 'BOOK' && action !== 'MOVE') {
    return asks({ needs: ['action'], because: 'Book a new one, or move an existing one?', candidates: {} });
  }

  const mailOn = Boolean(await resolveMailConfig(orgId));
  const told = (people: { id: string; name: string }[]) => {
    const others = people.filter((p) => p.id !== askerId).map((p) => p.name);
    if (!others.length) return null;
    return mailOn
      ? `${andList(others)} will be emailed and get a bell alert when you ${action === 'BOOK' ? 'book it' : 'move it'}.`
      : `${andList(others)} will get a bell alert when you ${action === 'BOOK' ? 'book it' : 'move it'} (email is not set up in Settings → Email).`;
  };

  if (action === 'MOVE') {
    const ev = await findEvent();
    if (isNeeds(ev)) return asks(ev);
    if (!isDay(args.date)) return asks({ needs: ['date'], because: 'Move it to which day?', candidates: { today: ymd(now) } });
    let startsAt: string;
    let endsAt: string;
    if (ev.allDay) {
      const length = Math.round((ev.endsAt.getTime() - ev.startsAt.getTime()) / 86_400_000);
      startsAt = args.date;
      endsAt = addDays(args.date, Math.max(1, length) - 1);
    } else {
      if (!isTime(args.start)) return asks({ needs: ['start'], because: 'At what time?', candidates: {} });
      const minutes = Math.round((ev.endsAt.getTime() - ev.startsAt.getTime()) / 60_000);
      const end = isTime(args.end) ? { day: args.date, time: args.end } : wallPlus(args.date, args.start, minutes);
      startsAt = `${args.date}T${args.start}`;
      endsAt = `${end.day}T${end.time}`;
    }
    const window = windowFrom(startsAt, endsAt, ev.allDay, timezone);
    if ('error' in window) return asks({ needs: ['start', 'end'], because: window.error, candidates: {} });
    const people = ev.attendees.map((a) => a.user);
    const clashes = await findClashes({
      organizationId: orgId,
      start: window.start,
      end: window.end,
      assetIds: ev.reservations.map((r) => r.assetId),
      attendeeIds: people.map((p) => p.id),
      excludeEventId: ev.id,
      timezone,
    });
    const tell = told(people);
    return card({
      type: 'plan',
      title: `Move: ${ev.title}`,
      link: eventLink(ev.id),
      summary: [`From ${whenLabel(ev.startsAt, ev.endsAt, ev.allDay, timezone)}`, `To ${whenLabel(window.start, window.end, ev.allDay, timezone)}`],
      ...(clashes.length ? { warnings: clashes.map((c) => c.message) } : {}),
      ...(tell ? { notes: [tell] } : {}),
      steps: [{ kind: 'post', label: 'Move it', items: [{ label: ev.title, request: { method: 'PATCH', path: `/calendar/events/${ev.id}`, body: { startsAt, endsAt } } }], doneText: 'moved' }],
    }, { whoIsTold: tell ?? 'nobody else is on it', emailIsSetUp: mailOn });
  }

  /* BOOK */
  const kind = ['MEETING', 'SHOOT', 'OTHER'].includes(String(args.kind)) ? String(args.kind) : null;
  const missing: string[] = [];
  if (!kind) missing.push('kind');
  if (!String(args.title ?? '').trim()) missing.push('title');
  if (!isDay(args.date)) missing.push('date');
  if (!args.allDay && !isTime(args.start)) missing.push('start');
  if (missing.length) {
    return asks({ needs: missing.slice(0, 2), because: 'A booking needs what it is, a title, the day and the start time.', candidates: { kinds: ['MEETING', 'SHOOT', 'OTHER'], today: ymd(now) } });
  }
  if (kind === 'SHOOT' && !args.allDay && !isTime(args.end)) {
    return asks({ needs: ['end'], because: 'Until what time is the shoot?', candidates: {} });
  }
  const date = String(args.date);
  let startsAt: string;
  let endsAt: string;
  if (args.allDay) {
    startsAt = date;
    endsAt = date;
  } else {
    const end = isTime(args.end) ? { day: date, time: String(args.end) } : wallPlus(date, String(args.start), 60);
    startsAt = `${date}T${args.start}`;
    endsAt = `${end.day}T${end.time}`;
  }
  const window = windowFrom(startsAt, endsAt, Boolean(args.allDay), timezone);
  if ('error' in window) return asks({ needs: ['start', 'end'], because: window.error, candidates: {} });

  const people = await resolvePeople(orgId, args.people);
  if (isNeeds(people)) return asks(people);

  let company: { id: string; name: string } | null = null;
  let contacts: { id: string; name: string }[] = [];
  if (args.client) {
    const found = await resolveCompany(orgId, args.client);
    if (isNeeds(found)) return asks(found);
    company = found;
    const theirs = await prisma.person.findMany({ where: { companyId: found.id, active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    for (const typed of (Array.isArray(args.contacts) ? args.contacts : []).map((c) => String(c).trim()).filter(Boolean)) {
      // "Mr Rao" is a contact called Rao.
      const t = typed.replace(/^(mr|mrs|ms|dr)\.?\s+/i, '').toLowerCase();
      const hits = theirs.filter((p) => p.name.toLowerCase().includes(t));
      if (hits.length !== 1) {
        return asks({ needs: ['contacts'], because: hits.length ? `"${typed}" matches more than one of ${found.name}'s people.` : `${found.name} has nobody called "${typed}".`, candidates: { contacts: theirs.map((p) => p.name) } });
      }
      if (!contacts.some((c) => c.id === hits[0].id)) contacts.push(hits[0]);
    }
  } else if (Array.isArray(args.contacts) && args.contacts.length) {
    return asks({ needs: ['client'], because: 'Which client are those contacts from?', candidates: {} });
  }

  let gear: { id: string; label: string }[] = [];
  const gearAsked = (Array.isArray(args.gear) ? args.gear : []).map((g) => String(g).trim()).filter(Boolean);
  if (gearAsked.length) {
    if (kind !== 'SHOOT') return asks({ needs: ['kind'], because: 'Only a shoot takes gear — is this a shoot?', candidates: {} });
    const register = await prisma.asset.findMany({
      where: { organizationId: orgId, status: { notIn: UNPICKABLE } },
      select: { id: true, tag: true, name: true, status: true },
      orderBy: { tag: 'asc' },
    });
    for (const typed of gearAsked) {
      const t = typed.toLowerCase();
      const byTag = register.filter((a) => a.tag.toLowerCase() === t);
      const hits = byTag.length ? byTag : register.filter((a) => a.name.toLowerCase().includes(t) || a.tag.toLowerCase().includes(t));
      if (hits.length !== 1) {
        return asks({
          needs: ['gear'],
          because: hits.length ? `"${typed}" matches more than one item.` : `Nothing on the register that can go on a shoot matches "${typed}".`,
          candidates: { gear: (hits.length ? hits : register).slice(0, 15).map((a) => `${a.tag} · ${a.name} · ${a.status.toLowerCase().replace(/_/g, ' ')}`) },
        });
      }
      if (!gear.some((g) => g.id === hits[0].id)) gear.push({ id: hits[0].id, label: `${hits[0].tag} ${hits[0].name}` });
    }
  }

  const clashes = await findClashes({
    organizationId: orgId,
    start: window.start,
    end: window.end,
    assetIds: gear.map((g) => g.id),
    attendeeIds: people.map((p) => p.id),
    timezone,
    // No viewer: a Google busy block is "Busy" on a card, never its title.
  });
  const title = String(args.title).trim();
  const body: Record<string, unknown> = {
    kind,
    title,
    startsAt,
    endsAt,
    allDay: Boolean(args.allDay),
    location: args.place ? String(args.place).trim() : null,
    attendeeIds: people.map((p) => p.id),
    companyId: company?.id ?? null,
    contactIds: contacts.map((c) => c.id),
    assetIds: gear.map((g) => g.id),
    ...(args.notes ? { notes: String(args.notes) } : {}),
  };
  const tell = told(people);
  return card({
    type: 'plan',
    title: `Book: ${title}`,
    summary: [
      `${kind === 'SHOOT' ? 'Shoot' : kind === 'MEETING' ? 'Meeting' : 'Event'} · ${whenLabel(window.start, window.end, Boolean(args.allDay), timezone)}`,
      ...(people.length ? [`People: ${andList(people.map((p) => p.name))}`] : []),
      ...(company ? [`With ${company.name}${contacts.length ? ` (${andList(contacts.map((c) => c.name))} — never emailed)` : ''}`] : []),
      ...(body.location ? [`At ${body.location}`] : []),
      ...(gear.length ? [`Gear reserved: ${andList(gear.map((g) => g.label))} — reserving is a plan; check it out on the day`] : []),
    ],
    ...(clashes.length ? { warnings: clashes.map((c) => c.message) } : {}),
    notes: [...(tell ? [tell] : []), 'It shows "Booked by" whoever presses Book.'],
    steps: [{ kind: 'post', label: 'Book it', items: [{ label: title, request: { method: 'POST', path: '/calendar/events', body } }], doneText: 'booked' }],
  }, { whoIsTold: tell ?? 'nobody else is on it', emailIsSetUp: mailOn });
}
