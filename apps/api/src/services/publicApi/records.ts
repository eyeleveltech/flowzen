import type { z } from 'zod';
import { InvoiceStatus, Prisma, TaskStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { hasPermission } from '../../middleware/auth.js';
import { companyLink, linkForUser, rawLinkFor, taskLink } from '../../utils/recordLink.js';
import { canSeeDealValues } from '../../utils/dealValues.js';
import { invoiceState, daysPastDue } from '../../utils/invoiceState.js';
import { sumPaise, toPaise } from '../../utils/paise.js';
import { asStoredDay } from '../../utils/moneyDates.js';
import { dayStartUtc } from '../../utils/zonedTime.js';
import { addDays } from '../../utils/workCalendar.js';
import { taskReadableWhere } from '../taskAccess.js';
import { waitingOnShown } from '../taskWaiting.js';
import { ACTIVE_DEAL_WHERE, CLOSED_STAGES } from '../activeDeal.js';
import { studioToday } from '../salesFollowUp.js';
import { eventLink, localWindow } from '../calendarEvents.js';
import { googleConfigured } from '../googleCalendar.js';
import { UNFINISHED } from '../internalWork.js';
import type { ApiScope } from '../apiKeys.js';
import { absoluteLink, ApiError, day, iso, notFound, pageArgs, person, type ApiContext, type Page } from './core.js';
import type {
  BusyOut,
  CompanyOut,
  DealOut,
  EventOut,
  InternalProjectOut,
  InvoiceOut,
  LeadOut,
  MeOut,
  PaymentOut,
  PersonOut,
  ProformaOut,
  ProjectOut,
  ReceivablesOut,
  RetainerOut,
  SearchHit,
  TaskOut,
  companyListQuery,
  dealListQuery,
  eventListQuery,
  internalProjectListQuery,
  invoiceListQuery,
  leadListQuery,
  paymentListQuery,
  proformaListQuery,
  projectListQuery,
  retainerListQuery,
  taskListQuery,
} from './schemas.js';

/**
 * Every public API read (API Plan 1, decision 4).
 *
 * Each one reads through the same access rule as the app screen it mirrors —
 * `taskReadableWhere` for tasks (a Head sees their departments), the deal and
 * invoice figure switches for money — and answers in the API's own shapes
 * (schemas.ts). Nothing here can see more than the key's creator can see in
 * the app; some of it sees less, because a key's scopes narrow it further.
 */

type Q<T extends z.ZodTypeAny> = z.output<T>;

const like = (q: string) => ({ contains: q, mode: 'insensitive' as const });

/** An id that could be one. Anything else is "not found" without asking the database. */
export const validId = (id: string): boolean => /^[A-Za-z0-9_-]{1,64}$/.test(id);

// ── Progress, counted the way projectProgress counts it ──────────────────────

type Progress = { total: number; done: number; open: number; overdue: number; percent: number };

/**
 * Task counts per bucket: cancelled work counts for nothing, done is done,
 * and open work past its due day is overdue — the rule in
 * services/internalWork.ts, counted in one query for a whole page.
 */
async function progressFor(
  column: 'projectId' | 'internalProjectId' | 'monthCardId',
  ids: string[],
  today: string,
): Promise<Map<string, Progress>> {
  const out = new Map<string, Progress>();
  if (ids.length === 0) return out;
  const rows = await prisma.task.findMany({
    where: { [column]: { in: ids }, deletedAt: null, status: { not: TaskStatus.CANCELLED } } as Prisma.TaskWhereInput,
    select: { projectId: true, internalProjectId: true, monthCardId: true, status: true, dueDate: true },
  });
  for (const key of ids) out.set(key, { total: 0, done: 0, open: 0, overdue: 0, percent: 0 });
  for (const t of rows) {
    const p = out.get(t[column] ?? '');
    if (!p) continue;
    p.total += 1;
    if (t.status === TaskStatus.DONE) p.done += 1;
    else {
      p.open += 1;
      if ((UNFINISHED as readonly string[]).includes(t.status) && day(t.dueDate)! < today) p.overdue += 1;
    }
  }
  for (const p of out.values()) p.percent = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return out;
}

const NO_PROGRESS: Progress = { total: 0, done: 0, open: 0, overdue: 0, percent: 0 };

/**
 * A retainer's fee and a project's quote: for a key that may read money
 * (money:read) made by somebody who may see figures. work:read alone is names,
 * dates and progress, as it always was.
 */
const seesFees = (ctx: ApiContext) => ctx.key.scopes.includes('money:read') && hasPermission(ctx.user, 'money.figures');

// ── Tasks ────────────────────────────────────────────────────────────────────

const TASK_SELECT = {
  id: true,
  title: true,
  status: true,
  priority: true,
  taskType: true,
  dueDate: true,
  dueTime: true,
  notes: true,
  workType: true,
  waitingOn: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  monthCardId: true,
  projectId: true,
  companyId: true,
  monthCard: { select: { retainer: { select: { company: { select: { id: true, name: true } } } } } },
  project: { select: { id: true, name: true, company: { select: { id: true, name: true } } } },
  retainerProject: { select: { id: true, name: true } },
  internalProject: { select: { id: true, name: true } },
  company: { select: { id: true, name: true } },
  assignees: { orderBy: { assignedAt: 'asc' }, select: { user: { select: { id: true, name: true } } } },
  assignedBy: { select: { id: true, name: true } },
  creator: { select: { id: true, name: true } },
} satisfies Prisma.TaskSelect;

type TaskRow = Prisma.TaskGetPayload<{ select: typeof TASK_SELECT }>;

function taskOut(t: TaskRow): TaskOut {
  const client = t.monthCard?.retainer.company ?? t.project?.company ?? t.company ?? null;
  const project = t.project
    ? { id: t.project.id, name: t.project.name, kind: 'project' as const }
    : t.retainerProject
      ? { id: t.retainerProject.id, name: t.retainerProject.name, kind: 'retainerProject' as const }
      : t.internalProject
        ? { id: t.internalProject.id, name: t.internalProject.name, kind: 'internalProject' as const }
        : null;
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    taskType: t.taskType,
    dueDate: day(t.dueDate)!,
    dueTime: t.dueTime,
    notes: t.notes,
    workType: t.workType,
    client: person(client),
    project,
    assignees: t.assignees.map((a) => ({ id: a.user.id, name: a.user.name })),
    assignedBy: person(t.assignedBy),
    createdBy: person(t.creator)!,
    waitingOn: waitingOnShown(t),
    completedAt: iso(t.completedAt),
    createdAt: iso(t.createdAt)!,
    updatedAt: iso(t.updatedAt)!,
    link: absoluteLink(taskLink(t.id)),
  };
}

export async function listTasks(ctx: ApiContext, q: Q<typeof taskListQuery>): Promise<Page<TaskOut>> {
  const paging = pageArgs(q);
  const and: Prisma.TaskWhereInput[] = [...(paging.where as Prisma.TaskWhereInput[])];
  if (q.status?.length) and.push({ status: { in: q.status } });
  if (q.assigneeId) and.push({ assignees: { some: { userId: q.assigneeId === 'me' ? ctx.user.userId : q.assigneeId } } });
  if (q.dueFrom) and.push({ dueDate: { gte: asStoredDay(q.dueFrom) } });
  if (q.dueTo) and.push({ dueDate: { lte: asStoredDay(q.dueTo) } });
  if (q.projectId) {
    and.push({ OR: [{ projectId: q.projectId }, { retainerProjectId: q.projectId }, { internalProjectId: q.projectId }] });
  }
  if (q.q) and.push({ title: like(q.q) });
  // The app's own rule: your work; a Head's departments; everything for Management.
  const where = await taskReadableWhere(ctx.user, { organizationId: ctx.user.organizationId, deletedAt: null, AND: and });
  const rows = await prisma.task.findMany({ where, orderBy: paging.orderBy, take: paging.take, select: TASK_SELECT });
  const { rows: page, nextCursor } = paging.finish(rows);
  return { data: page.map(taskOut), nextCursor };
}

export async function getTask(ctx: ApiContext, id: string): Promise<TaskOut> {
  if (!validId(id)) throw notFound('Task');
  const t = await prisma.task.findFirst({
    where: await taskReadableWhere(ctx.user, { id, organizationId: ctx.user.organizationId, deletedAt: null }),
    select: TASK_SELECT,
  });
  if (!t) throw notFound('Task');
  return taskOut(t);
}

// ── Projects of all three kinds ──────────────────────────────────────────────

export async function listInternalProjects(ctx: ApiContext, q: Q<typeof internalProjectListQuery>): Promise<Page<InternalProjectOut>> {
  const paging = pageArgs(q);
  const rows = await prisma.internalProject.findMany({
    where: {
      organizationId: ctx.user.organizationId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { name: like(q.q) } : {}),
      AND: paging.where as Prisma.InternalProjectWhereInput[],
    },
    orderBy: paging.orderBy,
    take: paging.take,
    include: { owner: { select: { id: true, name: true } }, department: { select: { id: true, name: true } } },
  });
  const { rows: page, nextCursor } = paging.finish(rows);
  const progress = await progressFor('internalProjectId', page.map((p) => p.id), await studioToday(ctx.user.organizationId));
  return {
    data: page.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      status: p.status,
      startDate: day(p.startDate),
      targetDate: day(p.targetDate),
      owner: person(p.owner),
      department: person(p.department),
      progress: progress.get(p.id) ?? NO_PROGRESS,
      createdAt: iso(p.createdAt)!,
      updatedAt: iso(p.updatedAt)!,
      link: absoluteLink(linkForUser('InternalProject', p.id, ctx.user)),
    })),
    nextCursor,
  };
}

// No cost estimate or margin anywhere: the quote and its milestones are the
// money, and only for a key that may read money (seesFees).
const PROJECT_SELECT = {
  id: true,
  name: true,
  status: true,
  priority: true,
  startDate: true,
  endDate: true,
  isSample: true,
  description: true,
  quotedValue: true,
  gstPercent: true,
  createdAt: true,
  updatedAt: true,
  company: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true } },
} satisfies Prisma.ProjectSelect;

type ProjectRow = Prisma.ProjectGetPayload<{ select: typeof PROJECT_SELECT }>;

function projectOut(p: ProjectRow, progress: Progress, ctx: ApiContext): ProjectOut {
  return {
    id: p.id,
    name: p.name,
    client: person(p.company)!,
    status: p.status,
    priority: p.priority,
    startDate: day(p.startDate)!,
    endDate: day(p.endDate)!,
    owner: person(p.owner)!,
    isSample: p.isSample,
    description: p.description,
    quotedValue: seesFees(ctx) ? Number(p.quotedValue) : null,
    gstPercent: p.gstPercent == null ? null : Number(p.gstPercent),
    progress,
    createdAt: iso(p.createdAt)!,
    updatedAt: iso(p.updatedAt)!,
    link: absoluteLink(linkForUser('Project', p.id, ctx.user)),
  };
}

export async function listProjects(ctx: ApiContext, q: Q<typeof projectListQuery>): Promise<Page<ProjectOut>> {
  const paging = pageArgs(q);
  const rows = await prisma.project.findMany({
    where: {
      organizationId: ctx.user.organizationId,
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { name: like(q.q) } : {}),
      AND: paging.where as Prisma.ProjectWhereInput[],
    },
    orderBy: paging.orderBy,
    take: paging.take,
    select: PROJECT_SELECT,
  });
  const { rows: page, nextCursor } = paging.finish(rows);
  const progress = await progressFor('projectId', page.map((p) => p.id), await studioToday(ctx.user.organizationId));
  return { data: page.map((p) => projectOut(p, progress.get(p.id) ?? NO_PROGRESS, ctx)), nextCursor };
}

export async function getProject(ctx: ApiContext, id: string): Promise<ProjectOut> {
  if (!validId(id)) throw notFound('Project');
  const p = await prisma.project.findFirst({
    where: { id, organizationId: ctx.user.organizationId, deletedAt: null },
    select: {
      ...PROJECT_SELECT,
      milestones: { orderBy: { order: 'asc' }, select: { id: true, label: true, percent: true, amount: true, status: true } },
    },
  });
  if (!p) throw notFound('Project');
  const progress = await progressFor('projectId', [p.id], await studioToday(ctx.user.organizationId));
  const fees = seesFees(ctx);
  return {
    ...projectOut(p, progress.get(p.id) ?? NO_PROGRESS, ctx),
    milestones: p.milestones.map((m) => ({ ...m, amount: fees ? Number(m.amount) : null })),
  };
}

/** A retainer, with this month's card for its progress. */
const retainerSelect = (month: string) =>
  ({
    id: true,
    status: true,
    startDate: true,
    termMonths: true,
    renewalDate: true,
    billing: true,
    monthlyValue: true,
    gstPercent: true,
    stoppedAt: true,
    stopReason: true,
    createdAt: true,
    updatedAt: true,
    company: { select: { id: true, name: true } },
    owner: { select: { id: true, name: true } },
    projects: {
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, status: true, startDate: true, endDate: true },
    },
    monthCards: { where: { month }, select: { id: true } },
  }) satisfies Prisma.RetainerSelect;

type RetainerRow = Prisma.RetainerGetPayload<{ select: ReturnType<typeof retainerSelect> }>;

/** Each retainer as the API shows it, with this month's progress counted in one query. */
async function retainersOut(rows: RetainerRow[], month: string, today: string, ctx: ApiContext): Promise<RetainerOut[]> {
  const progress = await progressFor('monthCardId', rows.flatMap((r) => r.monthCards.map((c) => c.id)), today);
  const fees = seesFees(ctx);
  return rows.map((r) => {
    const card = r.monthCards[0];
    return {
      id: r.id,
      name: `${r.company.name} retainer`,
      client: person(r.company)!,
      status: r.status,
      startDate: day(r.startDate)!,
      termMonths: r.termMonths,
      renewalDate: day(r.renewalDate),
      owner: person(r.owner)!,
      billing: r.billing,
      monthlyFee: fees ? Number(r.monthlyValue) : null,
      gstPercent: r.gstPercent == null ? null : Number(r.gstPercent),
      stoppedAt: iso(r.stoppedAt),
      stopReason: r.stopReason,
      projects: r.projects.map((p) => ({ id: p.id, name: p.name, status: p.status, startDate: day(p.startDate), endDate: day(p.endDate) })),
      thisMonth: card ? { month, ...(progress.get(card.id) ?? NO_PROGRESS) } : null,
      createdAt: iso(r.createdAt)!,
      updatedAt: iso(r.updatedAt)!,
      link: absoluteLink(linkForUser('Retainer', r.id, ctx.user)),
    };
  });
}

export async function listRetainers(ctx: ApiContext, q: Q<typeof retainerListQuery>): Promise<Page<RetainerOut>> {
  const paging = pageArgs(q);
  const today = await studioToday(ctx.user.organizationId);
  const month = today.slice(0, 7);
  const rows = await prisma.retainer.findMany({
    where: {
      organizationId: ctx.user.organizationId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { company: { name: like(q.q) } } : {}),
      AND: paging.where as Prisma.RetainerWhereInput[],
    },
    orderBy: paging.orderBy,
    take: paging.take,
    select: retainerSelect(month),
  });
  const { rows: page, nextCursor } = paging.finish(rows);
  return { data: await retainersOut(page, month, today, ctx), nextCursor };
}

export async function getRetainer(ctx: ApiContext, id: string): Promise<RetainerOut> {
  if (!validId(id)) throw notFound('Retainer');
  const today = await studioToday(ctx.user.organizationId);
  const month = today.slice(0, 7);
  const r = await prisma.retainer.findFirst({ where: { id, organizationId: ctx.user.organizationId }, select: retainerSelect(month) });
  if (!r) throw notFound('Retainer');
  return (await retainersOut([r], month, today, ctx))[0];
}

// ── Companies ────────────────────────────────────────────────────────────────

const COMPANY_SELECT = {
  id: true,
  name: true,
  status: true,
  vertical: true,
  source: true,
  city: true,
  website: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: { id: true, name: true } },
  people: {
    where: { active: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, role: true, email: true, phone: true, linkedin: true },
  },
} satisfies Prisma.CompanySelect;

const companyOut = (c: Prisma.CompanyGetPayload<{ select: typeof COMPANY_SELECT }>): CompanyOut => ({
  id: c.id,
  name: c.name,
  status: c.status,
  industry: c.vertical,
  source: c.source,
  city: c.city,
  website: c.website,
  owner: person(c.owner),
  archived: Boolean(c.archivedAt),
  contacts: c.people,
  createdAt: iso(c.createdAt)!,
  updatedAt: iso(c.updatedAt)!,
  link: absoluteLink(companyLink(c.id)),
});

export async function listCompanies(ctx: ApiContext, q: Q<typeof companyListQuery>): Promise<Page<CompanyOut>> {
  const paging = pageArgs(q);
  const rows = await prisma.company.findMany({
    where: {
      organizationId: ctx.user.organizationId,
      ...(q.includeArchived ? {} : { archivedAt: null }),
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { name: like(q.q) } : {}),
      AND: paging.where as Prisma.CompanyWhereInput[],
    },
    orderBy: paging.orderBy,
    take: paging.take,
    select: COMPANY_SELECT,
  });
  const { rows: page, nextCursor } = paging.finish(rows);
  return { data: page.map(companyOut), nextCursor };
}

export async function getCompany(ctx: ApiContext, id: string): Promise<CompanyOut> {
  if (!validId(id)) throw notFound('Company');
  const c = await prisma.company.findFirst({ where: { id, organizationId: ctx.user.organizationId }, select: COMPANY_SELECT });
  if (!c) throw notFound('Company');
  return companyOut(c);
}

// ── Leads ────────────────────────────────────────────────────────────────────

const LEAD_SELECT = {
  id: true,
  name: true,
  vertical: true,
  source: true,
  status: true,
  contactPersonName: true,
  phone: true,
  email: true,
  remarks: true,
  nextStep: true,
  nextActionDate: true,
  lastTouchedAt: true,
  externalSource: true,
  externalId: true,
  importedAt: true,
  updatedAt: true,
  owner: { select: { id: true, name: true } },
  promotedCompany: { select: { id: true, name: true } },
} satisfies Prisma.OutreachEntrySelect;

const leadOut = (l: Prisma.OutreachEntryGetPayload<{ select: typeof LEAD_SELECT }>, ctx: ApiContext): LeadOut => ({
  id: l.id,
  name: l.name,
  industry: l.vertical,
  source: l.source,
  status: l.status,
  contactPersonName: l.contactPersonName,
  phone: l.phone,
  email: l.email,
  remarks: l.remarks,
  nextStep: l.nextStep,
  nextStepDate: day(l.nextActionDate),
  lastTouchedAt: iso(l.lastTouchedAt),
  owner: person(l.owner),
  promotedCompany: person(l.promotedCompany),
  externalSource: l.externalSource,
  externalId: l.externalId,
  createdAt: iso(l.importedAt)!,
  updatedAt: iso(l.updatedAt)!,
  link: absoluteLink(linkForUser('OutreachEntry', l.id, ctx.user)),
});

/** A lead was "created" when it landed on the list. */
const LEAD_COLUMNS = { createdAt: 'importedAt', updatedAt: 'updatedAt' };

export async function listLeads(ctx: ApiContext, q: Q<typeof leadListQuery>): Promise<Page<LeadOut>> {
  const paging = pageArgs(q, LEAD_COLUMNS);
  const rows = await prisma.outreachEntry.findMany({
    where: {
      organizationId: ctx.user.organizationId,
      deletedAt: null,
      ...(q.includePromoted ? {} : { promotedCompanyId: null }),
      ...(q.status?.length ? { status: { in: q.status } } : {}),
      ...(q.q ? { name: like(q.q) } : {}),
      ...(q.externalSource ? { externalSource: q.externalSource } : {}),
      ...(q.externalId ? { externalId: q.externalId } : {}),
      AND: paging.where as Prisma.OutreachEntryWhereInput[],
    },
    orderBy: paging.orderBy,
    take: paging.take,
    select: LEAD_SELECT,
  });
  const { rows: page, nextCursor } = paging.finish(rows);
  return { data: page.map((l) => leadOut(l, ctx)), nextCursor };
}

export async function getLead(ctx: ApiContext, id: string): Promise<LeadOut> {
  if (!validId(id)) throw notFound('Lead');
  const l = await prisma.outreachEntry.findFirst({
    where: { id, organizationId: ctx.user.organizationId, deletedAt: null },
    select: LEAD_SELECT,
  });
  if (!l) throw notFound('Lead');
  return leadOut(l, ctx);
}

/** A lead by where an automation got it from — deleted ones included, so a re-send never collides. */
export const leadByExternal = (orgId: string, externalSource: string, externalId: string) =>
  prisma.outreachEntry.findFirst({
    // `deletedAt: undefined` on purpose: a lead somebody removed still owns its external id.
    where: { organizationId: orgId, externalSource, externalId, deletedAt: undefined },
    select: { id: true, deletedAt: true },
  });

// ── Deals ────────────────────────────────────────────────────────────────────

const dealSelect = (allVersions: boolean) =>
  ({
    id: true,
    kind: true,
    stage: true,
    outcome: true,
    nextStep: true,
    nextStepDate: true,
    lastTouchedAt: true,
    probabilityOverride: true,
    verbalYesAt: true,
    wonAt: true,
    wonVersionId: true,
    lostReason: true,
    createdAt: true,
    updatedAt: true,
    company: { select: { id: true, name: true } },
    owner: { select: { id: true, name: true } },
    versions: {
      orderBy: { n: 'desc' },
      ...(allVersions ? {} : { take: 1 }),
      select: { id: true, n: true, sentAt: true, value: true, scopeSummary: true },
    },
  }) satisfies Prisma.ProposalSelect;

type DealRow = Prisma.ProposalGetPayload<{ select: ReturnType<typeof dealSelect> }>;

function dealOut(p: DealRow, ctx: ApiContext, withVersions: boolean): DealOut {
  // Prices are Management's (Founder, 19 Oct 2026): the same switch as the board.
  const values = canSeeDealValues(ctx.user);
  const latest = p.versions[0];
  return {
    id: p.id,
    client: person(p.company)!,
    kind: p.kind,
    stage: p.stage,
    outcome: p.outcome,
    owner: person(p.owner)!,
    nextStep: p.nextStep,
    nextStepDate: day(p.nextStepDate),
    lastTouchedAt: iso(p.lastTouchedAt),
    value: values && latest ? Number(latest.value) : null,
    probabilityOverride: p.probabilityOverride,
    ...(withVersions
      ? {
          versions: p.versions.map((v) => ({
            n: v.n,
            sentAt: iso(v.sentAt)!,
            value: values ? Number(v.value) : null,
            scopeSummary: v.scopeSummary,
            won: v.id === p.wonVersionId,
          })),
        }
      : {}),
    verbalYesAt: iso(p.verbalYesAt),
    wonAt: iso(p.wonAt),
    lostReason: p.lostReason,
    createdAt: iso(p.createdAt)!,
    updatedAt: iso(p.updatedAt)!,
    link: absoluteLink(hasPermission(ctx.user, 'pipeline.read') ? `/quotations/${p.id}` : null),
  };
}

export async function listDeals(ctx: ApiContext, q: Q<typeof dealListQuery>): Promise<Page<DealOut>> {
  const paging = pageArgs(q);
  // An AND list, so a stage and "open" narrow together rather than one overwriting the other.
  const and: Prisma.ProposalWhereInput[] = [...(paging.where as Prisma.ProposalWhereInput[])];
  if (q.stage) and.push({ stage: q.stage });
  if (q.open === true) and.push(ACTIVE_DEAL_WHERE);
  if (q.open === false) and.push({ OR: [{ outcome: { not: null } }, { stage: { in: CLOSED_STAGES } }] });
  const rows = await prisma.proposal.findMany({
    where: {
      organizationId: ctx.user.organizationId,
      deletedAt: null,
      ...(q.companyId ? { companyId: q.companyId } : {}),
      AND: and,
    },
    orderBy: paging.orderBy,
    take: paging.take,
    select: dealSelect(false),
  });
  const { rows: page, nextCursor } = paging.finish(rows);
  return { data: page.map((p) => dealOut(p, ctx, false)), nextCursor };
}

export async function getDeal(ctx: ApiContext, id: string): Promise<DealOut> {
  if (!validId(id)) throw notFound('Deal');
  const p = await prisma.proposal.findFirst({
    where: { id, organizationId: ctx.user.organizationId, deletedAt: null },
    select: dealSelect(true),
  });
  if (!p) throw notFound('Deal');
  return dealOut(p, ctx, true);
}

// ── Calendar ─────────────────────────────────────────────────────────────────

const EVENT_SELECT = {
  id: true,
  kind: true,
  title: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  location: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  company: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  attendees: { select: { user: { select: { id: true, name: true } } } },
} satisfies Prisma.CalendarEventSelect;

const eventOut = (ev: Prisma.CalendarEventGetPayload<{ select: typeof EVENT_SELECT }>, timezone: string): EventOut => {
  const local = localWindow(ev, timezone);
  return {
    id: ev.id,
    kind: ev.kind,
    title: ev.title,
    startsAt: iso(ev.startsAt)!,
    endsAt: iso(ev.endsAt)!,
    startsAtLocal: local.startsAt,
    endsAtLocal: local.endsAt,
    allDay: ev.allDay,
    location: ev.location,
    notes: ev.notes,
    client: person(ev.company),
    attendees: ev.attendees.map((a) => ({ id: a.user.id, name: a.user.name })),
    bookedBy: person(ev.createdBy)!,
    createdAt: iso(ev.createdAt)!,
    updatedAt: iso(ev.updatedAt)!,
    link: absoluteLink(eventLink(ev.id)),
  };
};

export const orgCalendar = async (orgId: string) => {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { timezone: true, googleCalendarEnabled: true },
  });
  return { timezone: org?.timezone || 'Asia/Kolkata', googleOn: googleConfigured() && Boolean(org?.googleCalendarEnabled) };
};

/** A bound as a moment: a bare date is the office's midnight — or, for `to`, the midnight after it. */
const boundary = (v: string, timezone: string, end: boolean): Date =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) ? dayStartUtc(end ? addDays(v, 1) : v, timezone) : new Date(v);

/** Events are seen by everybody in the app, every one of them; only changing one is narrowed. */
export async function listEvents(
  ctx: ApiContext,
  q: Q<typeof eventListQuery>,
): Promise<Page<EventOut> & { busy?: BusyOut[] }> {
  const paging = pageArgs(q);
  const { timezone, googleOn } = await orgCalendar(ctx.user.organizationId);
  const from = q.from ? boundary(q.from, timezone, false) : null;
  const to = q.to ? boundary(q.to, timezone, true) : null;
  const attendee = q.attendeeId === 'me' ? ctx.user.userId : q.attendeeId;
  const rows = await prisma.calendarEvent.findMany({
    where: {
      organizationId: ctx.user.organizationId,
      deletedAt: null,
      ...(from ? { endsAt: { gt: from } } : {}),
      ...(to ? { startsAt: { lt: to } } : {}),
      ...(attendee ? { attendees: { some: { userId: attendee } } } : {}),
      AND: paging.where as Prisma.CalendarEventWhereInput[],
    },
    orderBy: paging.orderBy,
    take: paging.take,
    select: EVENT_SELECT,
  });
  const { rows: page, nextCursor } = paging.finish(rows);
  const result: Page<EventOut> & { busy?: BusyOut[] } = { data: page.map((ev) => eventOut(ev, timezone)), nextCursor };

  if (q.includeBusy) {
    if (!from || !to) throw new ApiError(400, 'invalid_request', 'Busy time needs from and to.');
    if (to.getTime() - from.getTime() > 62 * 86_400_000) {
      throw new ApiError(400, 'invalid_request', 'Ask for busy time 62 days or fewer at a time.');
    }
    // Everybody's Google busy time is "Busy" and whose — never the Google title, not even one's own.
    const blocks = googleOn
      ? await prisma.externalBusyBlock.findMany({
          where: {
            organizationId: ctx.user.organizationId,
            startsAt: { lt: to },
            endsAt: { gt: from },
            ...(attendee ? { userId: attendee } : {}),
          },
          orderBy: { startsAt: 'asc' },
          take: 500,
          select: { startsAt: true, endsAt: true, allDay: true, user: { select: { id: true, name: true } } },
        })
      : [];
    result.busy = blocks.map((b) => ({
      person: person(b.user)!,
      title: 'Busy' as const,
      startsAt: iso(b.startsAt)!,
      endsAt: iso(b.endsAt)!,
      allDay: b.allDay,
    }));
  }
  return result;
}

export async function getEvent(ctx: ApiContext, id: string): Promise<EventOut> {
  if (!validId(id)) throw notFound('Event');
  const { timezone } = await orgCalendar(ctx.user.organizationId);
  const ev = await prisma.calendarEvent.findFirst({
    where: { id, organizationId: ctx.user.organizationId, deletedAt: null },
    select: EVENT_SELECT,
  });
  if (!ev) throw notFound('Event');
  return eventOut(ev, timezone);
}

// ── Money ────────────────────────────────────────────────────────────────────

/** Figures need `money.figures`, as on every money screen. `money:read` alone is paid, unpaid and overdue. */
const seesFigures = (ctx: ApiContext) => hasPermission(ctx.user, 'money.figures');
const rupees = (paise: number) => paise / 100;

export async function listInvoices(ctx: ApiContext, q: Q<typeof invoiceListQuery>): Promise<Page<InvoiceOut>> {
  const paging = pageArgs(q);
  const today = await studioToday(ctx.user.organizationId);
  const todayStored = asStoredDay(today);
  const status = q.status;
  const OPEN = [InvoiceStatus.RAISED, InvoiceStatus.OVERDUE];
  // The filters mean what the badges show, as on /money: OVERDUE is open and past due.
  const statusWhere: Prisma.InvoiceWhereInput =
    status === 'OVERDUE'
      ? { status: { in: OPEN }, dueAt: { lt: todayStored } }
      : status === 'RAISED'
        ? { status: { in: OPEN }, dueAt: { gte: todayStored } }
        : status === 'OPEN'
          ? { status: { in: OPEN } }
          : status === 'PAID' || status === 'CANCELLED'
            ? { status }
            : {};
  const rows = await prisma.invoice.findMany({
    where: {
      organizationId: ctx.user.organizationId,
      ...statusWhere,
      ...(q.companyId ? { companyId: q.companyId } : {}),
      AND: paging.where as Prisma.InvoiceWhereInput[],
    },
    orderBy: paging.orderBy,
    take: paging.take,
    select: {
      id: true,
      number: true,
      status: true,
      raisedAt: true,
      dueAt: true,
      paidAt: true,
      amount: true,
      gstAmount: true,
      createdAt: true,
      updatedAt: true,
      company: { select: { id: true, name: true } },
      payments: { select: { amount: true } },
    },
  });
  const { rows: page, nextCursor } = paging.finish(rows);
  const figures = seesFigures(ctx);
  return {
    data: page.map((inv) => {
      const { state, isOverdue } = invoiceState(inv, today);
      const paid = sumPaise(inv.payments);
      return {
        id: inv.id,
        number: inv.number,
        client: person(inv.company)!,
        status: isOverdue && inv.status === 'RAISED' ? 'OVERDUE' : inv.status,
        state,
        raisedAt: day(inv.raisedAt)!,
        dueAt: day(inv.dueAt)!,
        paidAt: day(inv.paidAt),
        agingDays: isOverdue ? daysPastDue(inv.dueAt, today) : 0,
        figuresVisible: figures,
        amount: figures ? Number(inv.amount) : null,
        gstAmount: figures && inv.gstAmount !== null ? Number(inv.gstAmount) : null,
        totalPaid: figures ? rupees(paid) : null,
        balanceDue: figures ? rupees(Math.max(0, toPaise(inv.amount) - paid)) : null,
        createdAt: iso(inv.createdAt)!,
        updatedAt: iso(inv.updatedAt)!,
        link: absoluteLink(linkForUser('Invoice', inv.id, ctx.user)),
      };
    }),
    nextCursor,
  };
}

export async function listProformas(ctx: ApiContext, q: Q<typeof proformaListQuery>): Promise<Page<ProformaOut>> {
  // The app opens the proforma register to selling and to Accounts, not on
  // `money.status` alone — and a key never sees more than the app.
  if (!hasPermission(ctx.user, 'pipeline.read') && !hasPermission(ctx.user, 'money.figures')) {
    throw new ApiError(
      403,
      'insufficient_permission',
      'Proformas are open to people who sell (pipeline) or see money figures. The person who made this key has neither.',
    );
  }
  const paging = pageArgs(q);
  const rows = await prisma.proforma.findMany({
    where: {
      organizationId: ctx.user.organizationId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.companyId ? { companyId: q.companyId } : {}),
      AND: paging.where as Prisma.ProformaWhereInput[],
    },
    orderBy: paging.orderBy,
    take: paging.take,
    select: {
      id: true,
      number: true,
      status: true,
      sourceType: true,
      raisedAt: true,
      validTill: true,
      invoiceId: true,
      amount: true,
      createdAt: true,
      updatedAt: true,
      company: { select: { id: true, name: true } },
    },
  });
  const { rows: page, nextCursor } = paging.finish(rows);
  const figures = seesFigures(ctx);
  return {
    data: page.map((pf) => ({
      id: pf.id,
      number: pf.number,
      client: person(pf.company)!,
      status: pf.status,
      sourceType: pf.sourceType,
      raisedAt: day(pf.raisedAt)!,
      validTill: day(pf.validTill)!,
      invoiceId: pf.invoiceId,
      figuresVisible: figures,
      amount: figures ? Number(pf.amount) : null,
      createdAt: iso(pf.createdAt)!,
      updatedAt: iso(pf.updatedAt)!,
      link: absoluteLink(linkForUser('Proforma', pf.id, ctx.user)),
    })),
    nextCursor,
  };
}

/** A payment is never edited, so it was last "updated" when it was recorded. */
const PAYMENT_COLUMNS = { createdAt: 'createdAt', updatedAt: 'createdAt' };

export async function listPayments(ctx: ApiContext, q: Q<typeof paymentListQuery>): Promise<Page<PaymentOut>> {
  const paging = pageArgs(q, PAYMENT_COLUMNS);
  const rows = await prisma.payment.findMany({
    where: {
      invoice: { organizationId: ctx.user.organizationId, ...(q.companyId ? { companyId: q.companyId } : {}) },
      AND: paging.where as Prisma.PaymentWhereInput[],
    },
    orderBy: paging.orderBy,
    take: paging.take,
    select: {
      id: true,
      amount: true,
      gstAmount: true,
      receivedAt: true,
      mode: true,
      reference: true,
      createdAt: true,
      invoice: { select: { id: true, number: true, company: { select: { id: true, name: true } } } },
    },
  });
  const { rows: page, nextCursor } = paging.finish(rows);
  const figures = seesFigures(ctx);
  return {
    data: page.map((p) => ({
      id: p.id,
      invoice: { id: p.invoice.id, number: p.invoice.number },
      client: person(p.invoice.company)!,
      receivedAt: day(p.receivedAt)!,
      mode: p.mode,
      reference: p.reference,
      figuresVisible: figures,
      amount: figures ? Number(p.amount) : null,
      gstAmount: figures && p.gstAmount !== null ? Number(p.gstAmount) : null,
      createdAt: iso(p.createdAt)!,
      updatedAt: iso(p.createdAt)!,
      link: absoluteLink(linkForUser('Invoice', p.invoice.id, ctx.user)),
    })),
    nextCursor,
  };
}

/** What is owed: open invoices, how many are overdue, and how late — amounts only with figures. */
export async function receivables(ctx: ApiContext): Promise<ReceivablesOut> {
  const today = await studioToday(ctx.user.organizationId);
  const open = await prisma.invoice.findMany({
    where: { organizationId: ctx.user.organizationId, status: { in: [InvoiceStatus.RAISED, InvoiceStatus.OVERDUE] } },
    select: { status: true, dueAt: true, amount: true, payments: { select: { amount: true } } },
  });
  const figures = seesFigures(ctx);
  const tally = () => ({ count: 0, paise: 0 });
  const totals = { open: tally(), overdue: tally(), notDue: tally(), days1to30: tally(), days31to60: tally(), days61to90: tally(), over90: tally() };
  for (const inv of open) {
    const owed = Math.max(0, toPaise(inv.amount) - sumPaise(inv.payments));
    const late = invoiceState(inv, today).isOverdue ? daysPastDue(inv.dueAt, today) : 0;
    const bucket = late === 0 ? 'notDue' : late <= 30 ? 'days1to30' : late <= 60 ? 'days31to60' : late <= 90 ? 'days61to90' : 'over90';
    for (const k of ['open', ...(late > 0 ? ['overdue'] : []), bucket] as (keyof typeof totals)[]) {
      totals[k].count += 1;
      totals[k].paise += owed;
    }
  }
  const out = (t: { count: number; paise: number }) => ({ count: t.count, amount: figures ? rupees(t.paise) : null });
  return {
    asOf: today,
    figuresVisible: figures,
    open: out(totals.open),
    overdue: out(totals.overdue),
    aging: {
      notDue: out(totals.notDue),
      days1to30: out(totals.days1to30),
      days31to60: out(totals.days31to60),
      days61to90: out(totals.days61to90),
      over90: out(totals.over90),
    },
  };
}

// ── Search, and who the key is ───────────────────────────────────────────────

const SEARCH_EACH = 5;

/** One box over what this key may read: each kind of record only with its scope. */
export async function search(ctx: ApiContext, q: string): Promise<SearchHit[]> {
  const orgId = ctx.user.organizationId;
  const has = (s: ApiScope) => ctx.key.scopes.includes(s);
  const text = like(q);
  const [tasks, companies, leads, deals, projects, invoices] = await Promise.all([
    has('tasks:read')
      ? prisma.task.findMany({
          where: await taskReadableWhere(ctx.user, { organizationId: orgId, deletedAt: null, title: text }),
          orderBy: { dueDate: 'asc' },
          take: SEARCH_EACH,
          select: TASK_SELECT,
        })
      : [],
    has('clients:read')
      ? prisma.company.findMany({
          where: { organizationId: orgId, archivedAt: null, name: text },
          orderBy: { name: 'asc' },
          take: SEARCH_EACH,
          select: { id: true, name: true, status: true },
        })
      : [],
    has('leads:read')
      ? prisma.outreachEntry.findMany({
          where: { organizationId: orgId, deletedAt: null, promotedCompanyId: null, name: text },
          orderBy: { importedAt: 'desc' },
          take: SEARCH_EACH,
          select: { id: true, name: true, status: true },
        })
      : [],
    has('pipeline:read')
      ? prisma.proposal.findMany({
          where: { organizationId: orgId, deletedAt: null, company: { name: text } },
          orderBy: { updatedAt: 'desc' },
          take: SEARCH_EACH,
          select: { id: true, stage: true, kind: true, company: { select: { name: true } } },
        })
      : [],
    has('work:read')
      ? prisma.project.findMany({
          where: { organizationId: orgId, deletedAt: null, name: text },
          orderBy: { updatedAt: 'desc' },
          take: SEARCH_EACH,
          select: { id: true, name: true, company: { select: { name: true } } },
        })
      : [],
    has('money:read')
      ? prisma.invoice.findMany({
          where: { organizationId: orgId, number: text },
          orderBy: { createdAt: 'desc' },
          take: SEARCH_EACH,
          select: { id: true, number: true, company: { select: { name: true } } },
        })
      : [],
  ]);
  return [
    ...tasks.map((t) => {
      const o = taskOut(t);
      return { type: 'task' as const, id: o.id, title: o.title, context: o.project?.name ?? o.client?.name ?? 'Internal', link: o.link };
    }),
    ...companies.map((c) => ({ type: 'company' as const, id: c.id, title: c.name, context: c.status, link: absoluteLink(companyLink(c.id)) })),
    ...leads.map((l) => ({ type: 'lead' as const, id: l.id, title: l.name, context: l.status, link: absoluteLink(rawLinkFor('OutreachEntry', l.id)) })),
    ...deals.map((d) => ({ type: 'deal' as const, id: d.id, title: d.company.name, context: `${d.kind} · ${d.stage}`, link: absoluteLink(`/quotations/${d.id}`) })),
    ...projects.map((p) => ({ type: 'project' as const, id: p.id, title: p.name, context: p.company.name, link: absoluteLink(linkForUser('Project', p.id, ctx.user)) })),
    ...invoices.map((i) => ({ type: 'invoice' as const, id: i.id, title: i.number, context: i.company.name, link: absoluteLink(linkForUser('Invoice', i.id, ctx.user)) })),
  ];
}

// ── People ───────────────────────────────────────────────────────────────────

/**
 * Who work can be put on: the team's working members, so an automation can
 * turn a name into the id a task's assigneeIds takes. Departments only for a
 * creator who may see the team, as on the Team page.
 */
export async function listPeople(ctx: ApiContext, q: { q?: string }): Promise<PersonOut[]> {
  const team = hasPermission(ctx.user, 'work.team');
  const rows = await prisma.user.findMany({
    where: { organizationId: ctx.user.organizationId, active: true, ...(q.q ? { name: like(q.q) } : {}) },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, designation: true, department: { select: { id: true, name: true } } },
  });
  return rows.map((u) => ({
    id: u.id,
    name: u.name,
    designation: u.designation,
    department: team ? person(u.department) : null,
    isKeyOwner: u.id === ctx.user.userId,
  }));
}

export async function me(ctx: ApiContext): Promise<MeOut> {
  const [key, org] = await Promise.all([
    prisma.apiKey.findUnique({ where: { id: ctx.key.id }, select: { expiresAt: true, createdAt: true } }),
    prisma.organization.findUnique({ where: { id: ctx.user.organizationId }, select: { id: true, name: true, timezone: true } }),
  ]);
  return {
    key: {
      id: ctx.key.id,
      name: ctx.key.name,
      prefix: ctx.key.prefix,
      scopes: ctx.key.scopes,
      expiresAt: iso(key?.expiresAt),
      createdAt: iso(key?.createdAt) ?? new Date().toISOString(),
    },
    actsAs: { id: ctx.user.userId, name: ctx.user.name, email: ctx.user.email, role: ctx.user.preset },
    organization: { id: org?.id ?? ctx.user.organizationId, name: org?.name ?? '', timezone: org?.timezone ?? 'Asia/Kolkata' },
  };
}
