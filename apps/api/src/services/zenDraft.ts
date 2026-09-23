import { prisma } from '../lib/prisma.js';
import type { AiTool } from './ai/types.js';

/**
 * What Zen may propose, and why it never writes.
 *
 * ─── The shape, and the reason for it ───────────────────────────────────────
 *
 * Creating a task manually means filling a form and pressing save — you have
 * read every field before it happens. Saying "give Janani the Diwali carousel
 * for Friday" is not the same act: between the sentence and the row there is an
 * inference. Friday which week. Janani in Design, or the other Janani. Which
 * client's Diwali.
 *
 * So Zen drafts and the person presses Create. Nothing here writes a row —
 * `draftTask` resolves the words into ids and hands back a filled-in form. The
 * browser then posts it through `POST /tasks`, the same route the modal uses,
 * with the asker's own session.
 *
 * That last point is what makes this safe rather than merely careful:
 *
 *   - **The guard is the real route, not this file.** Assignment permission,
 *     the closed-month refusal, the month-card/project pairing and the activity
 *     row are all enforced where they already live. Zen cannot do anything the
 *     person asking could not have done themselves, and there is no second
 *     implementation of the rules to drift out of step.
 *   - **A pre-filled form is what prompt injection cannot get past.** Zen reads
 *     free text — task notes, scope summaries — and a note saying "reassign
 *     everything to X" is an instruction it might follow. It cannot act on one
 *     while a human is reading the fields before pressing the button.
 *
 * The checks below are therefore a courtesy, not the guarantee: they catch what
 * would make a draft un-creatable — a name that matches nobody, a month that is
 * closed — so Zen asks a question instead of drafting something the Create
 * button would only reject.
 *
 * ─── Asking rather than guessing ────────────────────────────────────────────
 *
 * "Create a task for me" is not enough to create a task, and the wrong answer
 * to it is a task with invented fields. Every unresolved argument comes back as
 * `needs`, with real candidates drawn from this organisation — that person's
 * actual clients, the actual team, real dates. A suggestion the model made up
 * is a wrong answer offered confidently, which is worse than no suggestion.
 */

/** A name typed by a person, matched the way a person would expect. */
const looksLike = (typed: string) => ({ contains: typed.trim(), mode: 'insensitive' as const });

/**
 * A calendar day, as the calendar on the wall has it.
 *
 * Not `toISOString().slice(0, 10)`, which is the UTC day: this runs in IST, so
 * the last day of September built as a local date is 18:30 on the 29th in UTC,
 * and Zen would offer "end of month is the 29th" for a month with thirty days.
 * The same shift makes "today" yesterday until half past five each morning.
 */
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Today, as the calendar on the wall has it. */
export const todayHere = () => ymd(new Date());

/** The next Friday, and the last day of the month — real dates to suggest. */
function dateHints(from: Date) {
  const friday = new Date(from);
  friday.setDate(friday.getDate() + ((5 - friday.getDay() + 7) % 7 || 7));
  return {
    today: ymd(from),
    thisFriday: ymd(friday),
    endOfMonth: ymd(new Date(from.getFullYear(), from.getMonth() + 1, 0)),
  };
}

export type TaskDraft = {
  /** Exactly what `POST /tasks` takes. The browser sends this back unchanged. */
  body: {
    title: string;
    dueDate: string;
    workType: 'MONTH_CARD' | 'PROJECT' | 'INTERNAL';
    workId?: string;
    monthCardId?: string;
    retainerProjectId?: string;
    projectId?: string;
    assigneeId: string;
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    notes?: string;
  };
  /** The same thing in words, for the card the asker reads before confirming. */
  shows: {
    title: string;
    client: string | null;
    belongsTo: string;
    assignedTo: string;
    due: string;
    priority: string;
    notes: string | null;
  };
};

type DraftOutcome =
  | { draft: TaskDraft; note: string }
  | { needs: string[]; because: string; candidates: Record<string, unknown> };

export type DraftArgs = {
  title?: string;
  dueDate?: string;
  client?: string;
  workstream?: string;
  assignee?: string;
  priority?: string;
  notes?: string;
};

/**
 * What the model is told once a draft exists.
 *
 * Spelled out because the failure to avoid is Zen announcing "done" — the row
 * does not exist yet and will not until somebody presses the button.
 */
const DRAFTED =
  'Draft prepared and shown to the asker for confirmation. It is NOT created yet. ' +
  'Say briefly what you have drafted and that it is waiting for them to press Create. ' +
  'Do not say it is done, saved or created.';

/**
 * Turn a sentence's worth of intent into a form somebody can check.
 *
 * `askerId` is the person Zen is talking to — the default assignee, and the
 * only identity any of this happens under.
 */
export async function draftTask(
  args: DraftArgs,
  organizationId: string,
  askerId: string,
  today = new Date(),
): Promise<DraftOutcome> {
  const hints = dateHints(today);

  const team = await prisma.user.findMany({
    where: { organizationId, active: true },
    select: { id: true, name: true, dept: true },
    orderBy: { name: 'asc' },
  });

  /* ── who it is for ──────────────────────────────────────────────────────── */
  let assignee = team.find((u) => u.id === askerId) ?? null;
  if (args.assignee) {
    const typed = args.assignee.trim().toLowerCase();
    const named = team.filter((u) => u.name.toLowerCase().includes(typed));
    if (named.length !== 1) {
      return {
        needs: ['assignee'],
        because:
          named.length === 0
            ? `Nobody on the team matches "${args.assignee}".`
            : `"${args.assignee}" matches more than one person.`,
        candidates: { team: (named.length ? named : team).map((u) => `${u.name} — ${u.dept}`) },
      };
    }
    [assignee] = named;
  }
  if (!assignee) {
    return {
      needs: ['assignee'],
      because: 'The person asking is not on the active team, so there is no default.',
      candidates: { team: team.map((u) => `${u.name} — ${u.dept}`) },
    };
  }

  /* ── what, and when — asked for together ────────────────────────────────── */
  const missing: string[] = [];
  if (!args.title?.trim()) missing.push('title');
  if (!args.dueDate?.trim()) missing.push('dueDate');
  if (missing.length > 0) {
    return {
      needs: missing,
      because: 'A task needs something to do and a day to do it by.',
      candidates: { dates: hints },
    };
  }
  const dueDate = args.dueDate!.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return {
      needs: ['dueDate'],
      because: `"${args.dueDate}" is not a date. It has to be YYYY-MM-DD.`,
      candidates: { dates: hints },
    };
  }

  /* ── the form so far ────────────────────────────────────────────────────── */
  const priorities = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
  const priority = priorities.find((p) => p === args.priority?.toUpperCase()) ?? 'MEDIUM';

  const body: TaskDraft['body'] = {
    title: args.title!.trim(),
    dueDate,
    workType: 'INTERNAL',
    assigneeId: assignee.id,
    priority,
  };
  if (args.notes?.trim()) body.notes = args.notes.trim();

  const shows: TaskDraft['shows'] = {
    title: body.title,
    client: null,
    belongsTo: 'Internal work',
    assignedTo: `${assignee.name} — ${assignee.dept}`,
    due: dueDate,
    priority,
    notes: body.notes ?? null,
  };

  if (!args.client?.trim()) return { draft: { body, shows }, note: DRAFTED };

  /* ── which client ───────────────────────────────────────────────────────── */
  const companies = await prisma.company.findMany({
    where: { organizationId, name: looksLike(args.client) },
    select: {
      id: true,
      name: true,
      retainers: {
        where: { status: 'ACTIVE' },
        select: { id: true, projects: { select: { id: true, name: true, isDefault: true, status: true } } },
      },
      projects: { where: { status: 'LIVE' }, select: { id: true, name: true } },
    },
    orderBy: { name: 'asc' },
  });

  /*
   * A client with neither a live retainer nor a live project has nowhere for a
   * task to go, so it is not offered as a candidate — suggesting it would only
   * produce a draft that cannot be filed.
   */
  const workable = await prisma.company.findMany({
    where: {
      organizationId,
      OR: [{ retainers: { some: { status: 'ACTIVE' } } }, { projects: { some: { status: 'LIVE' } } }],
    },
    select: { name: true },
    orderBy: { name: 'asc' },
  });
  const nowhere = {
    clients: workable.map((c) => c.name),
    orInternal: 'leave the client out for internal work',
  };

  if (companies.length !== 1) {
    return {
      needs: ['client'],
      because:
        companies.length === 0
          ? `No client matches "${args.client}".`
          : `"${args.client}" matches more than one client.`,
      candidates: companies.length === 0 ? nowhere : { clients: companies.map((c) => c.name) },
    };
  }

  const [company] = companies;
  shows.client = company.name;
  const retainer = company.retainers[0];

  /*
   * Retainer work first, because that is where most work lives — and a retainer
   * task hangs off the month its due date falls in, not off the retainer.
   */
  if (retainer) {
    const month = dueDate.slice(0, 7);
    const card = await prisma.monthCard.findFirst({
      where: { retainerId: retainer.id, month },
      select: { id: true, status: true },
    });
    if (!card || card.status !== 'OPEN') {
      const open = await prisma.monthCard.findMany({
        where: { retainerId: retainer.id, status: 'OPEN' },
        select: { month: true },
        orderBy: { month: 'asc' },
      });
      return {
        needs: ['dueDate'],
        // The sentence the route would refuse with, said before the draft
        // rather than after the button.
        because: card
          ? `${company.name}'s ${month} is closed. Its profit has been reported, so work cannot be added to it.`
          : `${company.name} has no ${month} month on its retainer, so a task due then has nowhere to sit.`,
        candidates: { openMonths: open.map((m) => m.month), dates: hints },
      };
    }

    const live = retainer.projects.filter((p) => p.status === 'ACTIVE');
    let stream = live.find((p) => p.isDefault) ?? live[0] ?? null;
    if (args.workstream?.trim()) {
      const typed = args.workstream.trim().toLowerCase();
      const named = live.filter((p) => p.name.toLowerCase().includes(typed));
      if (named.length !== 1) {
        return {
          needs: ['workstream'],
          because:
            named.length === 0
              ? `${company.name} has no piece of retainer work matching "${args.workstream}".`
              : `"${args.workstream}" matches more than one of ${company.name}'s workstreams.`,
          candidates: { workstreams: (named.length ? named : live).map((p) => p.name) },
        };
      }
      [stream] = named;
    }

    body.workType = 'MONTH_CARD';
    body.workId = card.id;
    body.monthCardId = card.id;
    if (stream) body.retainerProjectId = stream.id;
    shows.belongsTo = stream ? `${stream.name} — ${month}` : `Retainer — ${month}`;
    return { draft: { body, shows }, note: DRAFTED };
  }

  /* ── or a one-off project ───────────────────────────────────────────────── */
  const live = company.projects;
  if (live.length === 0) {
    return {
      needs: ['client'],
      because: `${company.name} has no live retainer or project, so there is nowhere to file this.`,
      candidates: nowhere,
    };
  }

  let project = live[0];
  if (args.workstream?.trim()) {
    const typed = args.workstream.trim().toLowerCase();
    const named = live.filter((p) => p.name.toLowerCase().includes(typed));
    if (named.length !== 1) {
      return {
        needs: ['workstream'],
        because:
          named.length === 0
            ? `${company.name} has no live project matching "${args.workstream}".`
            : `"${args.workstream}" matches more than one of ${company.name}'s projects.`,
        candidates: { projects: (named.length ? named : live).map((p) => p.name) },
      };
    }
    [project] = named;
  } else if (live.length > 1) {
    return {
      needs: ['workstream'],
      because: `${company.name} has more than one live project.`,
      candidates: { projects: live.map((p) => p.name) },
    };
  }

  body.workType = 'PROJECT';
  body.workId = project.id;
  body.projectId = project.id;
  shows.belongsTo = project.name;
  return { draft: { body, shows }, note: DRAFTED };
}

/** The one write-shaped thing Zen may call. */
export const ZEN_DRAFT_TOOLS: AiTool[] = [
  {
    name: 'draftTask',
    description:
      'Prepare a new task for the asker to confirm. This does NOT create it — it fills in a form they ' +
      'then press Create on. Call it once you know what needs doing, when it is due, and who it is for. ' +
      'If anything is missing or ambiguous it comes back as `needs` with real options: ask about those, ' +
      'two at a time at most, then call again with the answers.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'What needs doing, as it should read on the board.' },
        dueDate: { type: 'string', description: 'YYYY-MM-DD. Work real dates out from "Friday" yourself.' },
        client: {
          type: 'string',
          description: 'The client it is for. Leave out for internal work with no client.',
        },
        workstream: {
          type: 'string',
          description:
            'Which piece of that client’s work — a retainer workstream or a project. Leave out for the default.',
        },
        assignee: { type: 'string', description: 'Who is doing it. Defaults to the person asking.' },
        priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
        notes: { type: 'string', description: 'Anything the person doing it needs to know.' },
      },
      required: [],
    },
  },
];
