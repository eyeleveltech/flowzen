import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { AssetStatus, EventKind, InvoiceStatus, OutreachStatus, ProformaStatus, ProjectStatus, RetainerProjectStatus, RetainerStatus, TaskStatus, type Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate, hasPermission, requirePermission, type AuthRequest } from '../middleware/auth.js';
import { linkForUser, taskLink } from '../utils/recordLink.js';
import { addDays, todayIn } from '../utils/workCalendar.js';
import { rupees } from '../utils/money.js';
import { dayStartUtc, localDayAndTime, whenLabel } from '../utils/zonedTime.js';
import { googleConfigured, queueEventForGoogle } from '../services/googleCalendar.js';
import { taskInScope, teamScope } from '../services/teamScope.js';
import {
  afterEventSaved,
  eventLink,
  findClashes,
  localWindow,
  syncTodayAlertFor,
  UNPICKABLE,
  windowFrom,
  type EventSnapshot,
} from '../services/calendarEvents.js';

/**
 * GET /api/calendar — what is happening when, in one list.
 *
 * Dated things lived on a dozen screens: a task's due date on My Work, an
 * invoice's on Money, a proforma's expiry on Proposals, a renewal on the
 * retainer, a follow-up on Outreach, the lens due back on Assets. Nothing put
 * them side by side, so "what is on this week" meant opening all of them.
 *
 * Each layer is read with the permission of the screen its items come from,
 * and a layer the caller cannot see is dropped without a word — asking for it
 * is not an error, it is just empty. One query per layer, never one per day.
 *
 * Dates are the organisation's calendar days. Most of these columns ARE days
 * (`@db.Date`) and are passed through as they are; the one timestamp — when a
 * piece of gear is due back — is turned into the day it falls on in the
 * organisation's timezone, not the server's.
 */

export const calendarRouter = Router();
calendarRouter.use(authenticate);

export const CALENDAR_LAYERS = ['mine', 'team', 'events', 'google', 'money', 'sales', 'work', 'equipment', 'holidays'] as const;
export type CalendarLayer = (typeof CALENDAR_LAYERS)[number];

/** Six weeks and a bit: a month view with its spill-over days fits, a quarter does not. */
export const MAX_WINDOW_DAYS = 62;

export type CalendarItem = {
  id: string;
  layer: CalendarLayer;
  kind: string;
  title: string;
  /** The organisation's calendar day, YYYY-MM-DD. */
  date: string;
  /** HH:MM, only when the record has a time of its own. */
  time?: string;
  allDay: boolean;
  /** Where it opens, or null when this person has no screen to open it on. */
  link: string | null;
  /** True only for a task this person may move. */
  draggable: boolean;
  overdue?: boolean;
  /** Finished — a task done, a project delivered. Shown, but greyed. */
  done?: boolean;
  /** The task behind a task item, for moving it. */
  taskId?: string;
  dueTime?: string | null;
  /** Meetings and shoots: where it ends (all-day: the day after, exclusive). */
  endDate?: string;
  endTime?: string;
  eventId?: string;
  eventKind?: 'MEETING' | 'SHOOT' | 'OTHER';
  /** The caller is one of its people — drawn stronger. */
  isMine?: boolean;
  bookedBy?: string;
  location?: string | null;
};

type User = NonNullable<AuthRequest['user']>;

/**
 * Who may see each layer — the permission each item's own screen asks.
 *
 * Money is two screens: invoices are `money.status` (the paid/unpaid list
 * Heads and BD hold too), proformas are Proposals' `pipeline.read` or Money's
 * `money.figures`. The layer is there if either half is.
 */
const LAYER_ALLOWED: Record<CalendarLayer, (u: User) => boolean> = {
  mine: () => true,
  team: (u) => hasPermission(u, 'work.team'),
  // Meetings and shoots are the team's, every one of them, for everybody.
  events: () => true,
  // Everybody's Google busy time, as "Busy" — only when the org has it on.
  google: () => true,
  money: (u) =>
    hasPermission(u, 'money.status') || hasPermission(u, 'pipeline.read') || hasPermission(u, 'money.figures'),
  sales: (u) => hasPermission(u, 'company.read'),
  work: (u) => hasPermission(u, 'work.all'),
  equipment: () => true,
  holidays: () => true,
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const querySchema = z.object({
  from: z.string().regex(DAY, 'Give from as YYYY-MM-DD.'),
  to: z.string().regex(DAY, 'Give to as YYYY-MM-DD.'),
  layers: z.string().optional(),
  person: z.string().optional(),
  /** A department's id — the team layer narrowed to the people in it. */
  departmentId: z.string().optional(),
});

/** A `@db.Date` column as the day it is. */
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

const names = (assignees: { user: { name: string } }[]) => assignees.map((a) => a.user.name).join(', ');

calendarRouter.get('/', requirePermission('work.own'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const { from, to, person, departmentId } = parsed.data;
    const span = (asDate(to).getTime() - asDate(from).getTime()) / 86_400_000 + 1;
    if (Number.isNaN(span) || span < 1) {
      res.status(400).json({ success: false, error: 'The end date comes before the start.' });
      return;
    }
    if (span > MAX_WINDOW_DAYS) {
      res.status(400).json({ success: false, error: `Ask for ${MAX_WINDOW_DAYS} days or fewer at a time.` });
      return;
    }

    const user = req.user!;
    const orgId = user.organizationId;
    const me = user.userId;

    // What they may see, of what they asked for. Nothing asked means everything.
    const asked = parsed.data.layers
      ? parsed.data.layers.split(',').map((l) => l.trim())
      : [...CALENDAR_LAYERS];
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { timezone: true, holidays: true, workingDays: true, googleCalendarEnabled: true },
    });
    const googleOn = googleConfigured() && Boolean(org?.googleCalendarEnabled);
    const available = CALENDAR_LAYERS.filter((l) => LAYER_ALLOWED[l](user) && (l !== 'google' || googleOn));
    const layers = new Set(available.filter((l) => asked.includes(l)));
    const timezone = org?.timezone || 'Asia/Kolkata';
    const now = new Date();
    const today = todayIn(timezone, now);
    const range = { gte: asDate(from), lte: asDate(to) };
    const inWindow = (day: string) => day >= from && day <= to;
    const figures = hasPermission(user, 'money.figures');

    const items: CalendarItem[] = [];

    // ── Tasks ────────────────────────────────────────────────────────────────
    const taskSelect = {
      id: true,
      title: true,
      dueDate: true,
      dueTime: true,
      status: true,
      assignees: { select: { user: { select: { name: true } } } },
    } satisfies Prisma.TaskSelect;
    type TaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;
    const taskItem = (t: TaskRow, layer: CalendarLayer, title: string): CalendarItem => {
      const date = dayOf(t.dueDate);
      const done = t.status === TaskStatus.DONE;
      return {
        id: `task:${t.id}`,
        layer,
        kind: 'task',
        title,
        date,
        ...(t.dueTime ? { time: t.dueTime } : {}),
        allDay: !t.dueTime,
        link: taskLink(t.id),
        // Anybody who holds work.own may move a due date through PATCH
        // /tasks/:id, which is what a drop calls. A finished task stays put.
        draggable: !done,
        overdue: !done && date < today,
        done,
        taskId: t.id,
        dueTime: t.dueTime,
      };
    };
    const taskBase = {
      organizationId: orgId,
      dueDate: range,
      status: { not: TaskStatus.CANCELLED },
    } satisfies Prisma.TaskWhereInput;

    const [mine, team] = await Promise.all([
      layers.has('mine')
        ? prisma.task.findMany({
            where: { ...taskBase, assignees: { some: { userId: me } } },
            select: taskSelect,
          })
        : [],
      layers.has('team')
        ? prisma.task.findMany({
            // A Head's team is the departments they lead.
            where: await taskInScope(user, {
              ...taskBase,
              AND: [
                ...(person ? [{ assignees: { some: { userId: person } } }] : []),
                ...(departmentId ? [{ assignees: { some: { user: { departmentId } } } }] : []),
                // Shown once: with My tasks on, your own are already there.
                ...(layers.has('mine') ? [{ NOT: { assignees: { some: { userId: me } } } }] : []),
              ],
            }),
            select: taskSelect,
          })
        : [],
    ]);
    for (const t of mine) items.push(taskItem(t, 'mine', t.title));
    for (const t of team) items.push(taskItem(t, 'team', `${t.title} · ${names(t.assignees)}`));

    // ── Meetings and shoots ──────────────────────────────────────────────────
    if (layers.has('events')) {
      // Events are moments: the window is the studio's midnight to midnight.
      const events = await prisma.calendarEvent.findMany({
        where: {
          organizationId: orgId,
          deletedAt: null,
          startsAt: { lt: dayStartUtc(addDays(to, 1), timezone) },
          endsAt: { gt: dayStartUtc(from, timezone) },
          // One person's schedule, for anybody: events are seen by everyone,
          // so picking a person to find them a free slot shows nothing new.
          ...(person ? { attendees: { some: { userId: person } } } : {}),
        },
        select: {
          id: true,
          kind: true,
          title: true,
          startsAt: true,
          endsAt: true,
          allDay: true,
          location: true,
          createdById: true,
          createdBy: { select: { name: true } },
          attendees: { select: { userId: true } },
        },
      });
      const edits = await eventEditRule(user);
      for (const ev of events) {
        const s = localDayAndTime(ev.startsAt, timezone);
        const e = localDayAndTime(ev.endsAt, timezone);
        items.push({
          id: `event:${ev.id}`,
          layer: 'events',
          kind: 'event',
          title: ev.title,
          date: s.date,
          ...(ev.allDay ? {} : { time: s.time, endTime: e.time }),
          endDate: e.date,
          allDay: ev.allDay,
          link: eventLink(ev.id),
          draggable: edits({ createdById: ev.createdById, attendeeIds: ev.attendees.map((a) => a.userId) }),
          done: ev.endsAt <= now,
          eventId: ev.id,
          eventKind: ev.kind,
          isMine: ev.attendees.some((a) => a.userId === me),
          bookedBy: ev.createdBy.name,
          location: ev.location,
        });
      }
    }

    // ── Google busy time ─────────────────────────────────────────────────────
    if (layers.has('google')) {
      const blocks = await prisma.externalBusyBlock.findMany({
        where: {
          organizationId: orgId,
          startsAt: { lt: dayStartUtc(addDays(to, 1), timezone) },
          endsAt: { gt: dayStartUtc(from, timezone) },
          ...(person ? { userId: person } : {}),
        },
        select: { id: true, userId: true, title: true, startsAt: true, endsAt: true, allDay: true, user: { select: { name: true } } },
      });
      for (const b of blocks) {
        const own = b.userId === me;
        const s = localDayAndTime(b.startsAt, timezone);
        const e = localDayAndTime(b.endsAt, timezone);
        items.push({
          id: `busy:${b.id}`,
          layer: 'google',
          kind: 'busy',
          /*
           * The title is the owner's alone. Anybody else gets "Busy" and
           * whose — the Google title is never put in their response at all.
           */
          title: own ? (b.title ?? 'Busy') : `Busy · ${b.user.name}`,
          date: s.date,
          ...(b.allDay ? {} : { time: s.time, endTime: e.time }),
          endDate: e.date,
          allDay: b.allDay,
          link: null,
          draggable: false,
          isMine: own,
        });
      }
    }

    // ── Money ────────────────────────────────────────────────────────────────
    if (layers.has('money')) {
      const seesInvoices = hasPermission(user, 'money.status');
      const seesProformas = hasPermission(user, 'pipeline.read') || figures;
      const [invoices, proformas] = await Promise.all([
        seesInvoices
          ? prisma.invoice.findMany({
              where: {
                organizationId: orgId,
                status: { in: [InvoiceStatus.RAISED, InvoiceStatus.OVERDUE] },
                dueAt: range,
              },
              select: { id: true, number: true, amount: true, dueAt: true, status: true, company: { select: { name: true } } },
            })
          : [],
        seesProformas
          ? prisma.proforma.findMany({
              where: { organizationId: orgId, status: ProformaStatus.UNPAID, validTill: range },
              select: { id: true, number: true, amount: true, validTill: true, sourceType: true, company: { select: { name: true } } },
            })
          : [],
      ]);
      for (const inv of invoices) {
        const date = dayOf(inv.dueAt);
        items.push({
          id: `invoice:${inv.id}`,
          layer: 'money',
          kind: 'invoice_due',
          // The amount only for those who may see figures — money.status is
          // paid or unpaid, not how much.
          title: `${inv.number} · ${inv.company.name}${figures ? ` · ${rupees(Number(inv.amount))}` : ''} due`,
          date,
          allDay: true,
          link: linkForUser('Invoice', inv.id, user),
          draggable: false,
          overdue: inv.status === InvoiceStatus.OVERDUE || date < today,
        });
      }
      for (const pf of proformas) {
        const date = dayOf(pf.validTill);
        items.push({
          id: `proforma:${pf.id}`,
          layer: 'money',
          kind: 'proforma_expiry',
          title: `${pf.number} · ${pf.company.name}${figures ? ` · ${rupees(Number(pf.amount))}` : ''} · valid till`,
          date,
          allDay: true,
          // A retainer month's proforma is dealt with on the billing board;
          // any other on Proposals.
          link:
            pf.sourceType === 'MONTH_CARD' ? linkForUser('MonthCard', pf.id, user) : linkForUser('Proforma', pf.id, user),
          draggable: false,
          overdue: date < today,
        });
      }
    }

    // ── Sales ────────────────────────────────────────────────────────────────
    if (layers.has('sales')) {
      const leads = await prisma.outreachEntry.findMany({
        where: {
          organizationId: orgId,
          nextActionDate: range,
          status: { not: OutreachStatus.DEAD },
          // Promoted, it is a company now; its follow-ups live there.
          promotedCompanyId: null,
        },
        select: { id: true, name: true, nextActionDate: true },
      });
      for (const l of leads) {
        const date = dayOf(l.nextActionDate!);
        items.push({
          id: `lead:${l.id}`,
          layer: 'sales',
          kind: 'lead_follow_up',
          title: `Follow up · ${l.name}`,
          date,
          allDay: true,
          link: linkForUser('OutreachEntry', l.id, user),
          draggable: false,
          overdue: date < today,
        });
      }
    }

    // ── Work ─────────────────────────────────────────────────────────────────
    if (layers.has('work')) {
      const [projects, retainers, retainerProjects] = await Promise.all([
        prisma.project.findMany({
          where: {
            organizationId: orgId,
            status: { not: ProjectStatus.CANCELLED },
            OR: [{ startDate: range }, { endDate: range }],
          },
          select: { id: true, name: true, startDate: true, endDate: true, status: true, company: { select: { name: true } } },
        }),
        prisma.retainer.findMany({
          where: { organizationId: orgId, status: RetainerStatus.ACTIVE, renewalDate: range },
          select: { id: true, renewalDate: true, company: { select: { name: true } } },
        }),
        prisma.retainerProject.findMany({
          where: { retainer: { organizationId: orgId }, OR: [{ startDate: range }, { endDate: range }] },
          select: {
            id: true,
            retainerId: true,
            name: true,
            startDate: true,
            endDate: true,
            status: true,
            retainer: { select: { company: { select: { name: true } } } },
          },
        }),
      ]);
      for (const p of projects) {
        const done = p.status === ProjectStatus.DELIVERED;
        const link = linkForUser('Project', p.id, user);
        const start = dayOf(p.startDate);
        const end = dayOf(p.endDate);
        if (inWindow(start)) {
          items.push({ id: `project-start:${p.id}`, layer: 'work', kind: 'project_start', title: `Starts · ${p.name} · ${p.company.name}`, date: start, allDay: true, link, draggable: false, done });
        }
        if (inWindow(end)) {
          items.push({ id: `project-end:${p.id}`, layer: 'work', kind: 'project_end', title: `Ends · ${p.name} · ${p.company.name}`, date: end, allDay: true, link, draggable: false, done, overdue: !done && end < today });
        }
      }
      for (const r of retainers) {
        items.push({
          id: `renewal:${r.id}`,
          layer: 'work',
          kind: 'retainer_renewal',
          title: `Renewal · ${r.company.name} retainer`,
          date: dayOf(r.renewalDate!),
          allDay: true,
          link: linkForUser('Retainer', r.id, user),
          draggable: false,
        });
      }
      for (const rp of retainerProjects) {
        const done = rp.status === RetainerProjectStatus.DONE;
        const link = linkForUser('RetainerProject', rp.id, user, rp.retainerId);
        const start = rp.startDate ? dayOf(rp.startDate) : null;
        const end = rp.endDate ? dayOf(rp.endDate) : null;
        if (start && inWindow(start)) {
          items.push({ id: `rp-start:${rp.id}`, layer: 'work', kind: 'retainer_project_start', title: `Starts · ${rp.name} · ${rp.retainer.company.name}`, date: start, allDay: true, link, draggable: false, done });
        }
        if (end && inWindow(end)) {
          items.push({ id: `rp-end:${rp.id}`, layer: 'work', kind: 'retainer_project_end', title: `Ends · ${rp.name} · ${rp.retainer.company.name}`, date: end, allDay: true, link, draggable: false, done, overdue: !done && end < today });
        }
      }
    }

    // ── Equipment ────────────────────────────────────────────────────────────
    if (layers.has('equipment')) {
      // `dueAt` is a moment, not a day: read a day either side and keep what
      // falls inside the window on the organisation's own clock.
      const out = await prisma.assetMovement.findMany({
        where: {
          returnedAt: null,
          dueAt: { gte: asDate(addDays(from, -1)), lt: asDate(addDays(to, 2)) },
          asset: { organizationId: orgId, deletedAt: null },
        },
        select: { id: true, assetId: true, dueAt: true, asset: { select: { tag: true, name: true } }, user: { select: { name: true } } },
      });
      for (const m of out) {
        const { date } = localDayAndTime(m.dueAt!, timezone);
        if (!inWindow(date)) continue;
        items.push({
          id: `gear:${m.id}`,
          layer: 'equipment',
          kind: 'gear_due_back',
          title: `${m.asset.tag} ${m.asset.name} due back · ${m.user.name}`,
          date,
          allDay: true,
          link: linkForUser('Asset', m.assetId, user),
          draggable: false,
          overdue: m.dueAt! < now,
        });
      }
    }

    // ── Holidays ─────────────────────────────────────────────────────────────
    if (layers.has('holidays')) {
      for (const day of org?.holidays ?? []) {
        if (!inWindow(day)) continue;
        items.push({ id: `holiday:${day}`, layer: 'holidays', kind: 'holiday', title: 'Holiday', date: day, allDay: true, link: null, draggable: false });
      }
    }

    items.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        Number(b.allDay) - Number(a.allDay) ||
        (a.time ?? '').localeCompare(b.time ?? '') ||
        a.title.localeCompare(b.title),
    );

    res.json({
      success: true,
      items,
      // Which layers this person has at all, for the Layers menu.
      available,
      // For shading: the organisation's days off, which Settings keeps admin-only.
      workingDays: org?.workingDays ?? [1, 2, 3, 4, 5, 6],
      timezone,
      today,
      // Only ever about the caller: their own Google connection has stopped working.
      googleNeedsReconnect: googleOn
        ? (await prisma.googleCalendarConnection.findUnique({ where: { userId: me }, select: { status: true } }))?.status === 'NEEDS_RECONNECT'
        : false,
    });
  } catch (err) {
    next(err);
  }
});

// ═══ Meetings, shoots and the gear they reserve ═════════════════════════════
//
// Anybody may book one, for anybody — an assistant books the boss's meeting
// without being on it. Whoever booked it, or `work.team`, may change or delete
// it. Deleting is soft and lets its gear go. Clashes warn and never refuse.

const eventSchema = z.object({
  kind: z.nativeEnum(EventKind),
  title: z.string().trim().min(1, 'Give it a title.').max(200),
  /** The studio's wall clock: "2026-10-09T10:00", or "2026-10-09" all day (end inclusive). */
  startsAt: z.string(),
  endsAt: z.string(),
  allDay: z.boolean().default(false),
  location: z.string().trim().max(200).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  attendeeIds: z.array(z.string()).max(60).default([]),
  companyId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  retainerId: z.string().nullable().optional(),
  contactIds: z.array(z.string()).max(40).default([]),
  assetIds: z.array(z.string()).max(60).default([]),
});
const eventPatchSchema = eventSchema.partial();

const clashSchema = z.object({
  startsAt: z.string(),
  endsAt: z.string(),
  allDay: z.boolean().default(false),
  assetIds: z.array(z.string()).max(60).default([]),
  attendeeIds: z.array(z.string()).max(60).default([]),
  excludeEventId: z.string().nullable().optional(),
});

const orgTimezone = async (orgId: string) =>
  (await prisma.organization.findUnique({ where: { id: orgId }, select: { timezone: true } }))?.timezone || 'Asia/Kolkata';

/**
 * Who may change an event: whoever booked it, Management, or a Head whose
 * people include whoever booked it or somebody on it. Every event is SEEN by
 * everybody; this is only about changing one (Departments Plan 3).
 *
 * Built once per request, so the calendar's list asks for the scope once
 * rather than once per event.
 */
const eventEditRule = async (user: User): Promise<(ev: { createdById: string; attendeeIds: string[] }) => boolean> => {
  if (!hasPermission(user, 'work.team')) return (ev) => ev.createdById === user.userId;
  const scope = await teamScope(user);
  if (scope.all) return () => true;
  const mine = new Set(scope.peopleIds);
  return (ev) => ev.createdById === user.userId || mine.has(ev.createdById) || ev.attendeeIds.some((id) => mine.has(id));
};

const mayEdit = async (user: User, ev: { createdById: string; attendees: { userId: string }[] }) =>
  (await eventEditRule(user))({ createdById: ev.createdById, attendeeIds: ev.attendees.map((a) => a.userId) });

type EventFields = {
  kind: EventKind;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location: string | null;
  notes: string | null;
  attendeeIds: string[];
  companyId: string | null;
  projectId: string | null;
  retainerId: string | null;
  contactIds: string[];
  assetIds: string[];
};

/**
 * Everything a saved event must be, checked against the database. Returns the
 * reason it is not, or null.
 */
async function eventRefusal(orgId: string, f: EventFields): Promise<string | null> {
  if (f.attendeeIds.length) {
    const found = await prisma.user.count({ where: { id: { in: f.attendeeIds }, organizationId: orgId, active: true } });
    if (found !== f.attendeeIds.length) return 'One of those people is not on the team.';
  }
  if (f.assetIds.length) {
    if (f.kind !== EventKind.SHOOT) return 'Only a shoot takes gear.';
    const assets = await prisma.asset.findMany({
      where: { id: { in: f.assetIds }, organizationId: orgId },
      select: { id: true, tag: true, status: true },
    });
    if (assets.length !== f.assetIds.length) return 'One of those items is not in the register.';
    const gone = assets.find((a) => UNPICKABLE.includes(a.status));
    if (gone) return `${gone.tag} is ${gone.status.toLowerCase()} and can't go on a shoot.`;
  }
  if ((f.projectId || f.retainerId || f.contactIds.length) && !f.companyId) return 'Choose the client first.';
  if (f.projectId && f.retainerId) return 'Choose a project or a retainer, not both.';
  if (f.companyId) {
    const company = await prisma.company.findFirst({ where: { id: f.companyId, organizationId: orgId }, select: { id: true } });
    if (!company) return 'That client is not one of yours.';
    if (f.projectId) {
      const project = await prisma.project.findFirst({ where: { id: f.projectId, companyId: f.companyId }, select: { id: true } });
      if (!project) return "That project isn't this client's.";
    }
    if (f.retainerId) {
      const retainer = await prisma.retainer.findFirst({ where: { id: f.retainerId, companyId: f.companyId }, select: { id: true } });
      if (!retainer) return "That retainer isn't this client's.";
    }
    if (f.contactIds.length) {
      const found = await prisma.person.count({ where: { id: { in: f.contactIds }, companyId: f.companyId, active: true } });
      if (found !== f.contactIds.length) return "One of those contacts isn't at this client.";
    }
  }
  return null;
}

/** People, contacts and gear, replaced together — inside the save's transaction. */
async function replaceLinks(
  tx: Pick<typeof prisma, 'calendarEventAttendee' | 'calendarEventContact' | 'assetReservation'>,
  orgId: string,
  eventId: string,
  f: EventFields,
  actorId: string,
  what: { people: boolean; contacts: boolean },
) {
  if (what.people) {
    await tx.calendarEventAttendee.deleteMany({ where: { eventId } });
    if (f.attendeeIds.length) {
      await tx.calendarEventAttendee.createMany({ data: f.attendeeIds.map((userId) => ({ eventId, userId })) });
    }
  }
  if (what.contacts) {
    await tx.calendarEventContact.deleteMany({ where: { eventId } });
    if (f.contactIds.length) {
      await tx.calendarEventContact.createMany({ data: f.contactIds.map((personId) => ({ eventId, personId })) });
    }
  }
  // The gear always follows the event's window, so it is always rewritten.
  await tx.assetReservation.deleteMany({ where: { eventId } });
  if (f.assetIds.length) {
    await tx.assetReservation.createMany({
      data: f.assetIds.map((assetId) => ({
        organizationId: orgId,
        assetId,
        eventId,
        startsAt: f.start,
        endsAt: f.end,
        createdById: actorId,
      })),
    });
  }
}

const SNAPSHOT_SELECT = {
  id: true,
  title: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  location: true,
  createdBy: { select: { id: true, name: true } },
  attendees: { select: { userId: true } },
} satisfies Prisma.CalendarEventSelect;

const snapshotOf = (ev: Prisma.CalendarEventGetPayload<{ select: typeof SNAPSHOT_SELECT }>): EventSnapshot => ({
  id: ev.id,
  title: ev.title,
  startsAt: ev.startsAt,
  endsAt: ev.endsAt,
  allDay: ev.allDay,
  location: ev.location,
  createdBy: ev.createdBy,
  attendeeIds: ev.attendees.map((a) => a.userId),
});

const actorOf = async (user: User) => ({
  id: user.userId,
  name: (await prisma.user.findUnique({ where: { id: user.userId }, select: { name: true } }))?.name ?? 'Somebody',
});

/**
 * GET /calendar/event-options — what the event form offers: the clients with
 * their projects, retainers and contacts (names only), and the gear that can
 * go on a shoot. Names and ids, nothing with a figure on it, so it is open to
 * everybody who can book an event — which is everybody.
 */
calendarRouter.get('/event-options', requirePermission('work.own'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const [companies, assets] = await Promise.all([
      prisma.company.findMany({
        where: { organizationId: orgId, archivedAt: null },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          // A meeting is as often with a prospect as with a client — both are offered, and say which.
          status: true,
          projects: {
            where: { deletedAt: null, status: { not: ProjectStatus.CANCELLED } },
            orderBy: { startDate: 'desc' },
            select: { id: true, name: true },
          },
          retainers: { where: { status: RetainerStatus.ACTIVE }, select: { id: true } },
          people: { where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } },
        },
      }),
      prisma.asset.findMany({
        where: { organizationId: orgId, status: { notIn: UNPICKABLE } },
        orderBy: [{ category: 'asc' }, { tag: 'asc' }],
        select: { id: true, tag: true, name: true, status: true },
      }),
    ]);
    res.json({
      success: true,
      companies: companies.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        projects: c.projects,
        retainers: c.retainers.map((r) => ({ id: r.id, name: `${c.name} retainer` })),
        contacts: c.people,
      })),
      assets,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /calendar/clashes — what would get in the way of this window, for the
 * live form. Saves nothing.
 */
calendarRouter.post('/clashes', requirePermission('work.own'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = clashSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const orgId = req.user!.organizationId;
    const timezone = await orgTimezone(orgId);
    const window = windowFrom(parsed.data.startsAt, parsed.data.endsAt, parsed.data.allDay, timezone);
    if ('error' in window) {
      res.status(400).json({ success: false, error: window.error });
      return;
    }
    const clashes = await findClashes({
      viewerId: req.user!.userId,
      organizationId: orgId,
      start: window.start,
      end: window.end,
      assetIds: [...new Set(parsed.data.assetIds)],
      attendeeIds: [...new Set(parsed.data.attendeeIds)],
      excludeEventId: parsed.data.excludeEventId,
      timezone,
    });
    res.json({ success: true, clashes });
  } catch (err) {
    next(err);
  }
});

/** POST /calendar/events — book a meeting, a shoot, or anything else. */
calendarRouter.post('/events', requirePermission('work.own'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const d = parsed.data;
    const user = req.user!;
    const orgId = user.organizationId;
    const timezone = await orgTimezone(orgId);
    const window = windowFrom(d.startsAt, d.endsAt, d.allDay, timezone);
    if ('error' in window) {
      res.status(400).json({ success: false, error: window.error });
      return;
    }
    const f: EventFields = {
      kind: d.kind,
      title: d.title,
      start: window.start,
      end: window.end,
      allDay: d.allDay,
      location: d.location?.trim() || null,
      notes: d.notes?.trim() || null,
      attendeeIds: [...new Set(d.attendeeIds)],
      companyId: d.companyId || null,
      projectId: d.projectId || null,
      retainerId: d.retainerId || null,
      contactIds: [...new Set(d.contactIds)],
      assetIds: d.kind === EventKind.SHOOT ? [...new Set(d.assetIds)] : d.assetIds,
    };
    const refusal = await eventRefusal(orgId, f);
    if (refusal) {
      res.status(400).json({ success: false, error: refusal });
      return;
    }

    const created = await prisma.$transaction(async (tx) => {
      const ev = await tx.calendarEvent.create({
        data: {
          organizationId: orgId,
          kind: f.kind,
          title: f.title,
          startsAt: f.start,
          endsAt: f.end,
          allDay: f.allDay,
          location: f.location,
          notes: f.notes,
          companyId: f.companyId,
          projectId: f.projectId,
          retainerId: f.retainerId,
          createdById: user.userId,
        },
        select: { id: true },
      });
      await replaceLinks(tx, orgId, ev.id, f, user.userId, { people: true, contacts: true });
      return ev;
    });

    // Committed. Now tell people, ring today's bell, and say what clashes.
    const saved = await prisma.calendarEvent.findFirst({ where: { id: created.id, organizationId: orgId }, select: SNAPSHOT_SELECT });
    await afterEventSaved({ organizationId: orgId, actor: await actorOf(user), before: null, after: snapshotOf(saved!), timezone });
    await syncTodayAlertFor(orgId, created.id, timezone);
    // Into the "Flowzen" calendar of everybody on it who has connected Google.
    void queueEventForGoogle({ organizationId: orgId, eventId: created.id, attendeeIds: f.attendeeIds, removedIds: [], timezone });
    const clashes = await findClashes({
      viewerId: req.user!.userId,
      organizationId: orgId,
      start: f.start,
      end: f.end,
      assetIds: f.assetIds,
      attendeeIds: f.attendeeIds,
      excludeEventId: created.id,
      timezone,
    });
    res.status(201).json({ success: true, event: { id: created.id }, clashes });
  } catch (err) {
    next(err);
  }
});

/** The event's history, as lines a person reads: "Moved to Sat 4 Oct 10:00–11:00 by Priya". */
async function historyOf(orgId: string, eventId: string) {
  const rows = await prisma.activity.findMany({
    where: { organizationId: orgId, entityType: 'CalendarEvent', entityId: eventId },
    orderBy: { at: 'desc' },
    take: 12,
    select: { verb: true, payload: true, at: true, actor: { select: { name: true } } },
  });
  const ids = new Set<string>();
  for (const r of rows) {
    const p = (r.payload ?? {}) as { added?: string[]; removed?: string[] };
    for (const id of [...(p.added ?? []), ...(p.removed ?? [])]) ids.add(id);
  }
  const names = new Map(
    (ids.size ? await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } }) : []).map((u) => [u.id, u.name]),
  );
  const who = (id: string) => names.get(id) ?? 'someone';
  return rows.map((r) => {
    const p = (r.payload ?? {}) as { to?: string; added?: string[]; removed?: string[]; changed?: Record<string, unknown> };
    const by = r.actor?.name ?? 'Someone';
    let text: string;
    switch (r.verb) {
      case 'event_created':
        text = `Booked by ${by}`;
        break;
      case 'event_moved':
        text = `Moved to ${p.to ?? 'a new time'} by ${by}`;
        break;
      case 'event_people_changed': {
        const parts = [
          ...(p.added?.length ? [`added ${p.added.map(who).join(', ')}`] : []),
          ...(p.removed?.length ? [`removed ${p.removed.map(who).join(', ')}`] : []),
        ];
        text = `${by} ${parts.join('; ') || 'changed who is on it'}`;
        break;
      }
      case 'event_edited':
        text = `${by} changed the ${Object.keys(p.changed ?? {}).map((k) => FIELD_WORD[k] ?? k).join(', ') || 'details'}`;
        break;
      case 'event_deleted':
        text = `Cancelled by ${by}`;
        break;
      default:
        text = `${by} ${r.verb.replace(/_/g, ' ')}`;
    }
    return { at: r.at, text };
  });
}

const FIELD_WORD: Record<string, string> = {
  title: 'title',
  notes: 'notes',
  kind: 'kind',
  gear: 'gear',
  client: 'client',
  contacts: 'client contacts',
};

/** One item of gear on a shoot, as it stands right now. */
function gearLine(
  a: {
    id: string;
    tag: string;
    name: string;
    status: AssetStatus;
    currentHolder: { name: string } | null;
    movements: { dueAt: Date | null; user: { name: string } }[];
  },
  timezone: string,
) {
  const m = a.movements[0];
  const due = m?.dueAt ? new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'short', day: 'numeric', month: 'short' }).format(m.dueAt) : null;
  const statusLine =
    a.status === AssetStatus.IN_STOCK
      ? 'In the cupboard'
      : a.status === AssetStatus.BOOKED_OUT
        ? `Out with ${m?.user.name ?? a.currentHolder?.name ?? 'somebody'}${due ? `, due back ${due}` : ''}`
        : a.status === AssetStatus.ASSIGNED
          ? `Held by ${a.currentHolder?.name ?? 'somebody'}`
          : a.status === AssetStatus.IN_REPAIR
            ? 'In repair'
            : a.status.toLowerCase();
  return {
    assetId: a.id,
    tag: a.tag,
    name: a.name,
    status: a.status,
    statusLine,
    // Taking it out is still the asset's own checkout — nothing is automatic.
    checkoutHref: a.status === AssetStatus.IN_STOCK ? `/assets/${a.id}?checkout=1` : null,
  };
}

/** GET /calendar/events/:id — the drawer: details, people, gear as it stands, clashes, history. */
calendarRouter.get('/events/:id', requirePermission('work.own'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const orgId = user.organizationId;
    const ev = await prisma.calendarEvent.findFirst({
      where: { id: String(req.params.id), organizationId: orgId },
      include: {
        createdBy: { select: { id: true, name: true } },
        attendees: { select: { user: { select: { id: true, name: true } } } },
        contacts: { select: { person: { select: { id: true, name: true, phone: true, email: true } } } },
        company: { select: { id: true, name: true, status: true } },
        project: { select: { id: true, name: true } },
        retainer: { select: { id: true, company: { select: { name: true } } } },
        reservations: {
          select: {
            asset: {
              select: {
                id: true,
                tag: true,
                name: true,
                status: true,
                currentHolder: { select: { name: true } },
                movements: {
                  where: { returnedAt: null },
                  orderBy: { outAt: 'desc' },
                  take: 1,
                  select: { dueAt: true, user: { select: { name: true } } },
                },
              },
            },
          },
        },
      },
    });
    if (!ev) {
      res.status(404).json({ success: false, error: 'That event is not on the calendar.' });
      return;
    }
    const timezone = await orgTimezone(orgId);
    // A client's phone and email are the client book's, which is company.read.
    const seesContactDetails = hasPermission(user, 'company.read');
    const [clashes, history] = await Promise.all([
      findClashes({
        viewerId: req.user!.userId,
        organizationId: orgId,
        start: ev.startsAt,
        end: ev.endsAt,
        assetIds: ev.reservations.map((r) => r.asset.id),
        attendeeIds: ev.attendees.map((a) => a.user.id),
        excludeEventId: ev.id,
        timezone,
      }),
      historyOf(orgId, ev.id),
    ]);

    res.json({
      success: true,
      event: {
        id: ev.id,
        kind: ev.kind,
        title: ev.title,
        allDay: ev.allDay,
        ...localWindow(ev, timezone),
        when: whenLabel(ev.startsAt, ev.endsAt, ev.allDay, timezone),
        location: ev.location,
        notes: ev.notes,
        company: ev.company,
        project: ev.project,
        retainer: ev.retainer ? { id: ev.retainer.id, name: `${ev.retainer.company.name} retainer` } : null,
        createdBy: ev.createdBy,
        attendees: ev.attendees.map((a) => a.user),
        contacts: ev.contacts.map(({ person }) => ({
          id: person.id,
          name: person.name,
          ...(seesContactDetails ? { phone: person.phone, email: person.email } : {}),
        })),
        gear: ev.reservations.map((r) => gearLine(r.asset, timezone)),
        isPast: ev.endsAt <= new Date(),
      },
      clashes,
      history,
      canEdit: await mayEdit(user, { createdById: ev.createdById, attendees: ev.attendees.map((a) => ({ userId: a.user.id })) }),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /calendar/events/:id — change it. Anything left out stays as it is;
 * people, contacts and gear sent are replaced whole. A drag sends only the
 * window.
 */
calendarRouter.patch('/events/:id', requirePermission('work.own'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = eventPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const d = parsed.data;
    const user = req.user!;
    const orgId = user.organizationId;
    const existing = await prisma.calendarEvent.findFirst({
      where: { id: String(req.params.id), organizationId: orgId },
      include: {
        attendees: { select: { userId: true } },
        contacts: { select: { personId: true } },
        reservations: { select: { assetId: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'That event is not on the calendar.' });
      return;
    }
    if (!(await mayEdit(user, existing))) {
      res.status(403).json({ success: false, error: 'Only whoever booked it, Management, or the head of somebody on it can change this.' });
      return;
    }
    const timezone = await orgTimezone(orgId);

    // The window: whatever was sent, read against what is there.
    const allDay = d.allDay ?? existing.allDay;
    const current = localWindow(existing, timezone);
    let start = existing.startsAt;
    let end = existing.endsAt;
    if (d.startsAt !== undefined || d.endsAt !== undefined || d.allDay !== undefined) {
      const window = windowFrom(d.startsAt ?? current.startsAt, d.endsAt ?? current.endsAt, allDay, timezone);
      if ('error' in window) {
        res.status(400).json({ success: false, error: window.error });
        return;
      }
      ({ start, end } = window);
    }

    const kind = d.kind ?? existing.kind;
    const companyId = d.companyId !== undefined ? d.companyId || null : existing.companyId;
    // A different client: what hung off the old one goes, unless sent anew.
    const clientChanged = companyId !== existing.companyId;
    const f: EventFields = {
      kind,
      title: d.title ?? existing.title,
      start,
      end,
      allDay,
      location: d.location !== undefined ? d.location?.trim() || null : existing.location,
      notes: d.notes !== undefined ? d.notes?.trim() || null : existing.notes,
      attendeeIds: d.attendeeIds ? [...new Set(d.attendeeIds)] : existing.attendees.map((a) => a.userId),
      companyId,
      projectId: d.projectId !== undefined ? d.projectId || null : clientChanged ? null : existing.projectId,
      retainerId: d.retainerId !== undefined ? d.retainerId || null : clientChanged ? null : existing.retainerId,
      contactIds: d.contactIds ? [...new Set(d.contactIds)] : clientChanged ? [] : existing.contacts.map((c) => c.personId),
      // No longer a shoot: the gear goes unless it was sent (and refused).
      assetIds: d.assetIds
        ? [...new Set(d.assetIds)]
        : kind === EventKind.SHOOT
          ? existing.reservations.map((r) => r.assetId)
          : [],
    };
    const refusal = await eventRefusal(orgId, f);
    if (refusal) {
      res.status(400).json({ success: false, error: refusal });
      return;
    }

    const before = snapshotOf({ ...existing, attendees: existing.attendees });
    await prisma.$transaction(async (tx) => {
      await tx.calendarEvent.update({
        where: { id: existing.id },
        data: {
          kind: f.kind,
          title: f.title,
          startsAt: f.start,
          endsAt: f.end,
          allDay: f.allDay,
          location: f.location,
          notes: f.notes,
          companyId: f.companyId,
          projectId: f.projectId,
          retainerId: f.retainerId,
        },
      });
      await replaceLinks(tx, orgId, existing.id, f, user.userId, {
        people: Boolean(d.attendeeIds),
        contacts: Boolean(d.contactIds) || clientChanged,
      });
    });

    // What changed that tells nobody, for the history.
    const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
    const changedFields: Record<string, { from: unknown; to: unknown }> = {};
    if (f.title !== existing.title) changedFields.title = { from: existing.title, to: f.title };
    if ((f.notes ?? '') !== (existing.notes ?? '')) changedFields.notes = { from: Boolean(existing.notes), to: Boolean(f.notes) };
    if (f.kind !== existing.kind) changedFields.kind = { from: existing.kind, to: f.kind };
    if (!sameSet(f.assetIds, existing.reservations.map((r) => r.assetId))) changedFields.gear = { from: existing.reservations.length, to: f.assetIds.length };
    if (f.companyId !== existing.companyId || f.projectId !== existing.projectId || f.retainerId !== existing.retainerId) {
      const ids = [existing.companyId, f.companyId].filter((x): x is string => Boolean(x));
      const names = new Map(
        (await prisma.company.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]),
      );
      const nameOf = (id: string | null) => (id ? (names.get(id) ?? 'a client') : 'No client');
      changedFields.client = { from: nameOf(existing.companyId), to: nameOf(f.companyId) };
    }
    if (!sameSet(f.contactIds, existing.contacts.map((c) => c.personId))) changedFields.contacts = { from: existing.contacts.length, to: f.contactIds.length };

    const saved = await prisma.calendarEvent.findFirst({ where: { id: existing.id, organizationId: orgId }, select: SNAPSHOT_SELECT });
    await afterEventSaved({
      organizationId: orgId,
      actor: await actorOf(user),
      before,
      after: snapshotOf(saved!),
      timezone,
      changedFields,
    });
    await syncTodayAlertFor(orgId, existing.id, timezone);
    void queueEventForGoogle({
      organizationId: orgId,
      eventId: existing.id,
      attendeeIds: f.attendeeIds,
      removedIds: before.attendeeIds.filter((id) => !f.attendeeIds.includes(id)),
      timezone,
    });
    const clashes = await findClashes({
      viewerId: req.user!.userId,
      organizationId: orgId,
      start: f.start,
      end: f.end,
      assetIds: f.assetIds,
      attendeeIds: f.attendeeIds,
      excludeEventId: existing.id,
      timezone,
    });
    res.json({ success: true, event: { id: existing.id }, clashes });
  } catch (err) {
    next(err);
  }
});

/** DELETE /calendar/events/:id — cancel it. Soft, and its gear is let go. */
calendarRouter.delete('/events/:id', requirePermission('work.own'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const orgId = user.organizationId;
    const existing = await prisma.calendarEvent.findFirst({
      where: { id: String(req.params.id), organizationId: orgId },
      select: { ...SNAPSHOT_SELECT, createdById: true },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'That event is not on the calendar.' });
      return;
    }
    if (!(await mayEdit(user, existing))) {
      res.status(403).json({ success: false, error: 'Only whoever booked it, Management, or the head of somebody on it can cancel this.' });
      return;
    }
    const timezone = await orgTimezone(orgId);
    await prisma.$transaction([
      prisma.calendarEvent.update({ where: { id: existing.id }, data: { deletedAt: new Date() } }),
      // Released: the gear is free for that window again.
      prisma.assetReservation.deleteMany({ where: { eventId: existing.id } }),
    ]);
    await afterEventSaved({ organizationId: orgId, actor: await actorOf(user), before: snapshotOf(existing), after: null, timezone });
    await syncTodayAlertFor(orgId, existing.id, timezone);
    // Out of everybody's Google.
    void queueEventForGoogle({
      organizationId: orgId,
      eventId: existing.id,
      attendeeIds: [],
      removedIds: existing.attendees.map((a) => a.userId),
      timezone,
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});
