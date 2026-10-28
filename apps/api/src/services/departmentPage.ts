import { RolePreset, TaskStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { UserSession } from '../middleware/auth.js';
import { peopleInScope } from './teamScope.js';
import { BOARD_PERSON_SELECT, composeTeamBoard, type AttentionReason } from './teamBoard.js';
import { findClashes, type Clash } from './calendarEvents.js';
import { isLate, projectProgress } from './internalWork.js';
import { daysLate } from '../utils/assetDue.js';
import { dayStartUtc, localDayAndTime } from '../utils/zonedTime.js';
import { addDays, todayIn } from '../utils/workCalendar.js';

/**
 * My Department — one page for a department's head (Department head page plan).
 *
 * The people, everything they are working on, the calendar, gear and the
 * time split, for ONE department. It replaced Team → Board, which
 * showed task counts and nothing else.
 *
 * Who may open it: the department's head, or Management (who reach it from
 * Settings → Departments, not the sidebar). Nobody else — not even another
 * department's head. And every figure is narrowed by `teamScope` as well, so
 * the page can never show more than the routes it sits beside would.
 *
 * What is never here: rankings, scores, timers, "overloaded" labels, and any
 * money — pay stays admin-only, and the time split is percentages.
 */

type Session = Pick<UserSession, 'userId' | 'organizationId' | 'preset' | 'permissions' | 'active'>;

export type PageDepartment = { id: string; name: string; headId: string | null; headName: string | null };

/**
 * The department, if this person may open its page — its head, or Management.
 * Otherwise why not: 404 for a department that is not this organisation's (or
 * archived), 403 for one somebody else heads.
 */
export async function departmentForPage(
  user: Session,
  departmentId: string,
): Promise<{ department: PageDepartment } | { status: 403 | 404; error: string }> {
  const d = await prisma.department.findFirst({
    where: { id: departmentId, organizationId: user.organizationId, archivedAt: null },
    select: { id: true, name: true, headId: true, head: { select: { name: true } } },
  });
  if (!d) return { status: 404, error: 'Department not found' };
  if (d.headId !== user.userId && user.preset !== RolePreset.MANAGEMENT) {
    return { status: 403, error: 'Only the head of this department, or Management, can open its page.' };
  }
  return { department: { id: d.id, name: d.name, headId: d.headId, headName: d.head?.name ?? null } };
}

/** The departments a person heads — what puts "My department" in their sidebar. */
export async function departmentsHeadedBy(organizationId: string, userId: string): Promise<{ id: string; name: string }[]> {
  return prisma.department.findMany({
    where: { organizationId, headId: userId, archivedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true },
  });
}

/** The department's active people, narrowed by the caller's team scope. */
export async function departmentPeople(user: Session, departmentId: string) {
  return prisma.user.findMany({
    where: await peopleInScope(user, { organizationId: user.organizationId, active: true, departmentId }),
    orderBy: { name: 'asc' },
    select: { ...BOARD_PERSON_SELECT, phone: true, email: true },
  });
}

export type DepartmentPerson = Awaited<ReturnType<typeof departmentPeople>>[number];

/**
 * Everybody active in a department, unscoped — for Zen, which only Management
 * can use and which reads the whole studio (as `getTeamLoad` does).
 */
export function allDepartmentPeople(organizationId: string, departmentId: string) {
  return prisma.user.findMany({
    where: { organizationId, active: true, departmentId },
    orderBy: { name: 'asc' },
    select: { ...BOARD_PERSON_SELECT, phone: true, email: true },
  });
}

/** "Not confirmed" is only worth saying once the month is nearly done. */
export const TIME_SPLIT_CHECK_FROM_DAY = 25;

export type AttentionItem =
  | { kind: 'TASK'; taskId: string; reasons: AttentionReason[] }
  | {
      kind: 'GEAR_OVERDUE';
      assetId: string;
      tag: string;
      name: string;
      holder: { id: string; name: string };
      dueAt: Date | null;
      daysOverdue: number;
    }
  | { kind: 'TIME_SPLIT'; month: string; people: { id: string; name: string }[] };

/**
 * The People tab and the header: each person's card, and "Needs attention".
 *
 * The task half is the Board's own compute (`composeTeamBoard`) — Now, Next up
 * and the counts are exactly what Team → Board showed. Added: contact details,
 * today's meetings and shoots, the gear each holds, and two more reasons to
 * look — gear overdue back, and the time split still unconfirmed from the 25th.
 */
export async function composeDepartmentOverview(
  orgId: string,
  department: PageDepartment,
  people: DepartmentPerson[],
  now: Date = new Date(),
) {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { timezone: true } });
  const tz = org?.timezone || 'Asia/Kolkata';
  const ids = people.map((p) => p.id);
  const board = await composeTeamBoard(orgId, people, now);
  const today = board.today;
  const month = today.slice(0, 7);

  const [events, held, reservations, allocations] = await Promise.all([
    ids.length
      ? prisma.calendarEvent.findMany({
          where: {
            organizationId: orgId,
            deletedAt: null,
            startsAt: { lt: dayStartUtc(addDays(today, 1), tz) },
            endsAt: { gt: dayStartUtc(today, tz) },
            attendees: { some: { userId: { in: ids } } },
          },
          orderBy: { startsAt: 'asc' },
          select: { id: true, kind: true, title: true, startsAt: true, endsAt: true, allDay: true, location: true, attendees: { select: { userId: true } } },
        })
      : [],
    ids.length
      ? prisma.asset.findMany({
          where: { organizationId: orgId, deletedAt: null, currentHolderId: { in: ids } },
          orderBy: { tag: 'asc' },
          select: {
            id: true,
            tag: true,
            name: true,
            category: true,
            status: true,
            currentHolderId: true,
            movements: { where: { returnedAt: null }, orderBy: { outAt: 'desc' }, take: 1, select: { kind: true, dueAt: true, outAt: true } },
          },
        })
      : [],
    // Gear set aside for the team's shoots and meetings still to come.
    ids.length
      ? prisma.assetReservation.findMany({
          where: {
            organizationId: orgId,
            endsAt: { gt: now },
            event: { deletedAt: null, attendees: { some: { userId: { in: ids } } } },
          },
          orderBy: { startsAt: 'asc' },
          take: 100,
          select: {
            asset: { select: { id: true, tag: true, name: true } },
            event: {
              select: { id: true, kind: true, title: true, startsAt: true, endsAt: true, allDay: true, attendees: { select: { userId: true } } },
            },
          },
        })
      : [],
    ids.length
      ? prisma.peopleAllocation.findMany({ where: { userId: { in: ids }, month }, select: { userId: true, confirmedAt: true } })
      : [],
  ]);

  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const when = (ev: { startsAt: Date; endsAt: Date; allDay: boolean }) => {
    if (ev.allDay) return { allDay: true as const, time: null, endTime: null };
    return { allDay: false as const, time: localDayAndTime(ev.startsAt, tz).time, endTime: localDayAndTime(ev.endsAt, tz).time };
  };

  const gear = held.map((a) => {
    const m = a.movements[0] ?? null;
    const late = m?.kind === 'BOOKING' ? daysLate(m.dueAt, now) : 0;
    return {
      id: a.id,
      tag: a.tag,
      name: a.name,
      category: a.category,
      holderId: a.currentHolderId!,
      /** CUSTODY is held long-term; BOOKING is out with a date it is due back. */
      kind: m?.kind ?? 'CUSTODY',
      dueAt: m?.kind === 'BOOKING' ? m.dueAt : null,
      overdue: late > 0,
      daysOverdue: late,
    };
  });

  // One row per event, its reserved gear together, with the register's own clash check.
  const byEvent = new Map<string, { event: (typeof reservations)[number]['event']; assets: { id: string; tag: string; name: string }[] }>();
  for (const r of reservations) {
    const row = byEvent.get(r.event.id) ?? { event: r.event, assets: [] };
    row.assets.push(r.asset);
    byEvent.set(r.event.id, row);
  }
  const reserved = await Promise.all(
    [...byEvent.values()].map(async ({ event, assets }) => {
      const clashes: Clash[] = await findClashes({
        organizationId: orgId,
        start: event.startsAt,
        end: event.endsAt,
        assetIds: assets.map((a) => a.id),
        attendeeIds: [],
        excludeEventId: event.id,
        timezone: tz,
        now,
      });
      const day = localDayAndTime(event.startsAt, tz).date;
      return {
        eventId: event.id,
        title: event.title,
        kind: event.kind,
        day,
        ...when(event),
        people: event.attendees.filter((a) => nameOf.has(a.userId)).map((a) => ({ id: a.userId, name: nameOf.get(a.userId)! })),
        assets,
        clashes,
      };
    }),
  );

  const cards = board.people.map((row) => {
    const p = people.find((x) => x.id === row.id)!;
    return {
      ...row,
      phone: p.phone,
      email: p.email,
      todayEvents: events
        .filter((e) => e.attendees.some((a) => a.userId === row.id))
        .map((e) => ({ id: e.id, kind: e.kind, title: e.title, location: e.location, ...when(e) })),
      gear: gear.filter((g) => g.holderId === row.id),
    };
  });

  // ── Needs attention ──
  const attention: AttentionItem[] = board.attention.map((a) => ({ kind: 'TASK' as const, ...a }));
  for (const g of gear.filter((x) => x.overdue).sort((a, b) => b.daysOverdue - a.daysOverdue)) {
    attention.push({
      kind: 'GEAR_OVERDUE',
      assetId: g.id,
      tag: g.tag,
      name: g.name,
      holder: { id: g.holderId, name: nameOf.get(g.holderId) ?? 'Somebody' },
      dueAt: g.dueAt,
      daysOverdue: g.daysOverdue,
    });
  }
  if (Number(today.slice(8, 10)) >= TIME_SPLIT_CHECK_FROM_DAY) {
    // Nothing entered is not confirmed either: the month has to be split and signed off.
    const unconfirmed = people.filter((p) => {
      const rows = allocations.filter((a) => a.userId === p.id);
      return rows.length === 0 || rows.some((a) => !a.confirmedAt);
    });
    if (unconfirmed.length > 0) {
      attention.push({ kind: 'TIME_SPLIT', month, people: unconfirmed.map((p) => ({ id: p.id, name: p.name })) });
    }
  }

  return {
    department: { ...department, peopleCount: people.length },
    today,
    week: board.week,
    month,
    people: cards,
    tasks: board.tasks,
    attention,
    equipment: {
      held: gear,
      reserved,
    },
  };
}

const OPEN_STATUSES: TaskStatus[] = [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.ON_HOLD];

/**
 * The Work tab: the client work the department's people are on — by client,
 * then retainer or project — and the department's own internal projects.
 *
 * Counted from the team's open tasks only: "the people on it" are this
 * department's people, and open and overdue are the tasks at least one of them
 * is on. Overdue is the app's one rule (`isLate`).
 */
export async function composeDepartmentWork(orgId: string, department: PageDepartment, people: DepartmentPerson[], now: Date = new Date()) {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { timezone: true } });
  const today = todayIn(org?.timezone || 'Asia/Kolkata', now);
  const ids = people.map((p) => p.id);
  const mine = new Set(ids);

  const [tasks, internal] = await Promise.all([
    ids.length
      ? prisma.task.findMany({
          where: {
            organizationId: orgId,
            deletedAt: null,
            status: { in: OPEN_STATUSES },
            assignees: { some: { userId: { in: ids } } },
            OR: [{ monthCardId: { not: null } }, { projectId: { not: null } }],
          },
          select: {
            id: true,
            title: true,
            status: true,
            dueDate: true,
            assignees: { select: { user: { select: { id: true, name: true } } } },
            monthCard: { select: { retainerId: true, retainer: { select: { id: true, company: { select: { id: true, name: true } } } } } },
            project: { select: { id: true, name: true, company: { select: { id: true, name: true } } } },
          },
        })
      : [],
    prisma.internalProject.findMany({
      where: { organizationId: orgId, departmentId: department.id, status: 'ACTIVE' },
      orderBy: [{ targetDate: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        status: true,
        targetDate: true,
        owner: { select: { id: true, name: true } },
        tasks: {
          where: { deletedAt: null },
          select: { id: true, title: true, status: true, dueDate: true, assignees: { select: { user: { select: { id: true, name: true } } } } },
        },
      },
    }),
  ]);

  type Item = {
    kind: 'RETAINER' | 'PROJECT';
    id: string;
    name: string;
    href: string;
    people: Map<string, string>;
    open: number;
    overdue: number;
    next: { taskId: string; title: string; dueDate: string } | null;
  };
  const clients = new Map<string, { id: string; name: string; href: string; items: Map<string, Item> }>();

  for (const t of tasks) {
    const company = t.project?.company ?? t.monthCard?.retainer.company;
    if (!company) continue;
    const client = clients.get(company.id) ?? { id: company.id, name: company.name, href: `/companies/${company.id}?tab=WORK`, items: new Map() };
    clients.set(company.id, client);
    const key = t.project ? `PROJECT:${t.project.id}` : `RETAINER:${t.monthCard!.retainerId}`;
    const item: Item =
      client.items.get(key) ??
      (t.project
        ? { kind: 'PROJECT', id: t.project.id, name: t.project.name, href: `/projects/${t.project.id}`, people: new Map(), open: 0, overdue: 0, next: null }
        : { kind: 'RETAINER', id: t.monthCard!.retainerId, name: 'Retainer', href: `/retainers/${t.monthCard!.retainerId}`, people: new Map(), open: 0, overdue: 0, next: null });
    client.items.set(key, item);
    for (const a of t.assignees) if (mine.has(a.user.id)) item.people.set(a.user.id, a.user.name);
    item.open += 1;
    if (isLate(t, today)) item.overdue += 1;
    const due = t.dueDate.toISOString().slice(0, 10);
    if (!item.next || due < item.next.dueDate) item.next = { taskId: t.id, title: t.title, dueDate: due };
  }

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return {
    department: { ...department, peopleCount: people.length },
    today,
    clients: [...clients.values()].sort(byName).map((c) => ({
      id: c.id,
      name: c.name,
      href: c.href,
      items: [...c.items.values()]
        // Retainer first, then projects by name.
        .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'RETAINER' ? -1 : 1))
        .map((i) => ({
          kind: i.kind,
          id: i.id,
          name: i.name,
          href: i.href,
          people: [...i.people.entries()].map(([id, name]) => ({ id, name })).sort(byName),
          open: i.open,
          overdue: i.overdue,
          nextDeadline: i.next,
        })),
    })),
    internalProjects: internal.map((p) => {
      const progress = projectProgress(p, p.tasks, today);
      return {
        id: p.id,
        name: p.name,
        href: `/internal-projects/${p.id}`,
        owner: p.owner,
        targetDate: p.targetDate ? p.targetDate.toISOString().slice(0, 10) : null,
        people: progress.people.map(({ id, name }) => ({ id, name })),
        percentDone: progress.percentDone,
        daysLeft: progress.daysLeft,
        pastTarget: progress.pastTarget,
        open: progress.open,
        overdue: progress.overdue,
      };
    }),
  };
}
