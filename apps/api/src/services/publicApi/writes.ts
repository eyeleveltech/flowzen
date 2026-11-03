import type { z } from 'zod';
import { MonthCardStatus, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { tasksRouter } from '../../routes/tasks.js';
import { outreachRouter } from '../../routes/outreach.js';
import { proposalsRouter } from '../../routes/proposals.js';
import { calendarRouter } from '../../routes/calendar.js';
import { companiesRouter } from '../../routes/companies.js';
import { retainersRouter } from '../../routes/retainers.js';
import { projectsRouter } from '../../routes/projects.js';
import { localDayAndTime } from '../../utils/zonedTime.js';
import { checkForDuplicates } from '../duplicateCheck.js';
import { ApiError, day, notFound, type ApiContext } from './core.js';
import { dispatchOk } from './dispatch.js';
import {
  getCompany,
  getDeal,
  getEvent,
  getLead,
  getProject,
  getRetainer,
  getTask,
  leadByExternal,
  orgCalendar,
  validId,
} from './records.js';
import type {
  CompanyOut,
  DealOut,
  EventOut,
  LeadOut,
  ProjectOut,
  RetainerOut,
  TaskOut,
  companyCreateSchema,
  companyUpdateSchema,
  contactCreateSchema,
  contactUpdateSchema,
  dealCreateSchema,
  dealLoseSchema,
  dealUpdateSchema,
  dealVerbalYesSchema,
  dealVersionSchema,
  dealWinSchema,
  eventCreateSchema,
  eventMoveSchema,
  leadCreateSchema,
  leadUpdateSchema,
  milestoneCreateSchema,
  milestoneUpdateSchema,
  projectCreateSchema,
  projectUpdateSchema,
  promoteSchema,
  retainerCreateSchema,
  retainerPieceCreateSchema,
  retainerPieceUpdateSchema,
  retainerUpdateSchema,
  taskCreateSchema,
  taskUpdateSchema,
  touchCreateSchema,
} from './schemas.js';

/**
 * Every public API write (API Plan 1, decision 4).
 *
 * Each goes through the app's own route for the same act (dispatch.ts), so
 * a task made through a key is checked, filed, pushed and logged exactly as
 * one made on My Work — and the Activity row says "via API: <key>" because
 * the key's request context is still open around it.
 *
 * What can be done is still less than the app: nothing is deleted anywhere,
 * events are not cancelled, and no invoice, proforma or payment is raised or
 * recorded. Companies, the whole of a deal's life and retainers and projects
 * are written here — by the routes their screens use, under the same rules.
 */

type In<T extends z.ZodTypeAny> = z.output<T>;

const path = (id: string, rest = '') => {
  if (!validId(id)) throw notFound('Record');
  return `/${encodeURIComponent(id)}${rest}`;
};

/** The fields that were sent, so a route never mistakes an absent one for a cleared one. */
const sent = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/**
 * Somebody a record is handed to is on this team and working.
 *
 * Some of the app's routes take an owner id on trust, because their form only
 * offers the team. A key can send anything, so it is checked here first.
 */
async function onTheTeam(ctx: ApiContext, ...ids: (string | null | undefined)[]): Promise<void> {
  const want = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  if (want.length === 0) return;
  const found = await prisma.user.count({ where: { id: { in: want }, organizationId: ctx.user.organizationId, active: true } });
  if (found !== want.length) {
    throw new ApiError(400, 'invalid_request', 'That person is not on the team. GET /people lists who is.');
  }
}

// ── Tasks ────────────────────────────────────────────────────────────────────

/**
 * The month card a retainer task sits on: the month it is due, or failing
 * that the latest month still open — the months the New task form offers.
 */
async function retainerMonth(ctx: ApiContext, body: In<typeof taskCreateSchema>): Promise<{ monthCardId: string; pieceId: string | null }> {
  const orgId = ctx.user.organizationId;
  let retainerId = body.retainerId ?? null;
  if (body.retainerProjectId) {
    const piece = await prisma.retainerProject.findFirst({
      where: { id: body.retainerProjectId, retainer: { organizationId: orgId } },
      select: { retainerId: true },
    });
    if (!piece || (retainerId && piece.retainerId !== retainerId)) {
      throw new ApiError(400, 'invalid_request', 'That piece of work is not on this retainer.');
    }
    retainerId = piece.retainerId;
  }
  const retainer = await prisma.retainer.findFirst({ where: { id: retainerId!, organizationId: orgId }, select: { id: true } });
  if (!retainer) throw notFound('Retainer');
  const card =
    (await prisma.monthCard.findFirst({ where: { retainerId: retainer.id, month: body.dueDate.slice(0, 7) }, select: { id: true } })) ??
    (await prisma.monthCard.findFirst({
      where: { retainerId: retainer.id, status: MonthCardStatus.OPEN },
      orderBy: { month: 'desc' },
      select: { id: true },
    }));
  if (!card) {
    throw new ApiError(400, 'invalid_request', 'This retainer has no month open for work. Its month starts when the retainer does.');
  }
  return { monthCardId: card.id, pieceId: body.retainerProjectId ?? null };
}

export async function createTask(ctx: ApiContext, body: In<typeof taskCreateSchema>): Promise<TaskOut> {
  const homes = [body.projectId, body.retainerId || body.retainerProjectId, body.internalProjectId || body.companyId].filter(Boolean);
  if (homes.length > 1) {
    throw new ApiError(400, 'invalid_request', 'A task sits in a one-time project, on a retainer, or is internal work — one of them.');
  }
  const onRetainer = body.retainerId || body.retainerProjectId ? await retainerMonth(ctx, body) : null;
  const created = await dispatchOk(tasksRouter, ctx.req, {
    method: 'POST',
    url: '/',
    body: {
      title: body.title,
      workType: body.projectId ? 'PROJECT' : onRetainer ? 'MONTH_CARD' : 'INTERNAL',
      ...(body.projectId ? { projectId: body.projectId, workId: body.projectId } : {}),
      ...(onRetainer
        ? {
            workId: onRetainer.monthCardId,
            monthCardId: onRetainer.monthCardId,
            ...(onRetainer.pieceId ? { retainerProjectId: onRetainer.pieceId } : {}),
          }
        : {}),
      ...(body.internalProjectId ? { internalProjectId: body.internalProjectId } : {}),
      ...(body.companyId ? { companyId: body.companyId } : {}),
      // Nobody named: the key's creator, as the New task form does.
      ...(body.assigneeIds ? { assigneeIds: body.assigneeIds } : {}),
      dueDate: body.dueDate,
      ...(body.dueTime !== undefined ? { dueTime: body.dueTime } : {}),
      ...(body.priority ? { priority: body.priority } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.taskType !== undefined ? { taskType: body.taskType } : {}),
    },
  });
  return getTask(ctx, created.task.id);
}

/**
 * The fields through the edit route, the status through the status route —
 * two routes in the app, one call here. On hold goes through "put on hold",
 * so the clock pauses the way it does from My Work.
 */
export async function updateTask(ctx: ApiContext, id: string, body: In<typeof taskUpdateSchema>): Promise<TaskOut> {
  const { status, ...fields } = body;
  if (Object.keys(fields).length > 0) {
    await dispatchOk(tasksRouter, ctx.req, { method: 'PATCH', url: path(id), body: fields });
  }
  if (status === 'ON_HOLD') {
    await dispatchOk(tasksRouter, ctx.req, { method: 'POST', url: path(id, '/wait'), body: {} });
  } else if (status) {
    await dispatchOk(tasksRouter, ctx.req, { method: 'PATCH', url: path(id, '/status'), body: { status } });
  }
  return getTask(ctx, id);
}

// ── Leads ────────────────────────────────────────────────────────────────────

export type LeadCreated = {
  lead: LeadOut;
  existing: boolean;
  /** Leads with a similar name — a warning, never a refusal (services/duplicateCheck). */
  possibleDuplicates: { id: string; name: string }[];
};

const isUniqueClash = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export async function createLead(ctx: ApiContext, body: In<typeof leadCreateSchema>): Promise<LeadCreated> {
  const orgId = ctx.user.organizationId;
  const external = body.externalSource && body.externalId ? { source: body.externalSource, id: body.externalId } : null;

  // The same lead sent again (decision 4): answered with the one already here.
  const already = async () => {
    if (!external) return null;
    const found = await leadByExternal(orgId, external.source, external.id);
    if (!found) return null;
    if (found.deletedAt) {
      throw new ApiError(
        409,
        'lead_removed',
        'This lead was sent before and then removed in Flowzen. Restore it from Settings → Trash rather than sending it again.',
        { leadId: found.id },
      );
    }
    return { lead: await getLead(ctx, found.id), existing: true, possibleDuplicates: [] };
  };
  const first = await already();
  if (first) return first;

  // §3.12, through the existing rule: the same email or phone is the same lead.
  const others = await prisma.outreachEntry.findMany({
    where: { organizationId: orgId, deletedAt: null },
    select: { id: true, name: true, email: true, phone: true },
  });
  const verdict = checkForDuplicates({ name: body.name, email: body.email, phone: body.phone }, others);
  if (verdict.action === 'BLOCK') {
    throw new ApiError(409, 'duplicate_lead', `${verdict.matches[0].name} already has that ${verdict.matches[0].reason}.`, {
      matches: verdict.matches.map((m) => ({ id: m.id, name: m.name, reason: m.reason })),
    });
  }

  let created: { entry: { id: string } };
  try {
    created = await dispatchOk(outreachRouter, ctx.req, {
      method: 'POST',
      url: '/',
      body: {
        name: body.name,
        vertical: body.industry,
        ...(body.source ? { source: body.source } : {}),
        ...(body.ownerId ? { ownerId: body.ownerId } : {}),
        contactPersonName: body.contactPersonName ?? null,
        phone: body.phone ?? null,
        email: body.email ?? null,
        ...(external ? { externalSource: external.source, externalId: external.id } : {}),
      },
    });
  } catch (e) {
    // Two copies sent at once: the second loses the race to the unique index.
    if (isUniqueClash(e)) {
      const raced = await already();
      if (raced) return raced;
    }
    throw e;
  }
  return {
    lead: await getLead(ctx, created.entry.id),
    existing: false,
    possibleDuplicates: verdict.action === 'WARN' ? verdict.matches.map((m) => ({ id: m.id, name: m.name })) : [],
  };
}

/**
 * Its details through the edit route, a status change through the status
 * route — the two forms on the Outreach screen. The next step rides with the
 * status change when there is one, as it does there.
 */
export async function updateLead(ctx: ApiContext, id: string, body: In<typeof leadUpdateSchema>): Promise<LeadOut> {
  const { status, remarks, nextStep, nextStepDate, industry, ...rest } = body;
  const details = sent({ ...rest, vertical: industry });
  const stepAlone = !status && (nextStep !== undefined || nextStepDate !== undefined);
  if (Object.keys(details).length > 0 || stepAlone) {
    await dispatchOk(outreachRouter, ctx.req, {
      method: 'PATCH',
      url: path(id),
      body: {
        ...details,
        ...(stepAlone ? sent({ nextStep, nextActionDate: nextStepDate }) : {}),
      },
    });
  }
  if (status) {
    await dispatchOk(outreachRouter, ctx.req, {
      method: 'PATCH',
      url: path(id, '/status'),
      body: { status, ...sent({ remarks, nextStep, nextActionDate: nextStepDate }) },
    });
  }
  return getLead(ctx, id);
}

export async function logLeadTouch(ctx: ApiContext, id: string, body: In<typeof touchCreateSchema>): Promise<LeadOut> {
  await dispatchOk(outreachRouter, ctx.req, { method: 'POST', url: path(id, '/touch'), body });
  return getLead(ctx, id);
}

export type Promoted = { company: CompanyOut; lead: LeadOut; followUpTaskId: string | null };

/** An Interested lead, made a company — by "Promote" on the Outreach screen. */
export async function promoteLead(ctx: ApiContext, id: string, body: In<typeof promoteSchema>): Promise<Promoted> {
  await onTheTeam(ctx, body.ownerId);
  const out = await dispatchOk(outreachRouter, ctx.req, {
    method: 'POST',
    url: path(id, '/promote'),
    body: sent({
      city: body.city,
      companyName: body.companyName,
      vertical: body.industry,
      ownerId: body.ownerId,
      contactName: body.contactName,
      contactEmail: body.contactEmail,
      contactPhone: body.contactPhone,
      contactRole: body.contactRole,
      force: body.force,
    }),
  });
  return { company: await getCompany(ctx, out.company.id), lead: await getLead(ctx, id), followUpTaskId: out.followUpTaskId ?? null };
}

// ── Companies ────────────────────────────────────────────────────────────────

/** "Karnataka" or "29": the company routes take the state as a name or its GST code, and store both. */
const stateAs = (v: string) => (/^\d{1,2}$/.test(v) ? { stateCode: v.padStart(2, '0') } : { stateName: v });

export async function createCompany(ctx: ApiContext, body: In<typeof companyCreateSchema>): Promise<CompanyOut> {
  await onTheTeam(ctx, body.ownerId);
  const contact = body.contact
    ? { name: body.contact.name, phone: body.contact.phone ?? null, ...(body.contact.email ? { email: body.contact.email } : {}) }
    : undefined;
  const out = await dispatchOk(companiesRouter, ctx.req, {
    method: 'POST',
    url: '/',
    body: {
      name: body.name,
      vertical: body.industry,
      city: body.city,
      // The create form sends blanks, never nulls: what was not given is left out.
      ...(body.source ? { source: body.source } : {}),
      ...(body.website ? { website: body.website } : {}),
      ...(body.gstin ? { gstin: body.gstin } : {}),
      ...(body.billingAddress ? { billingAddress: body.billingAddress } : {}),
      ...(body.state ? stateAs(body.state) : {}),
      ...(body.ownerId ? { ownerId: body.ownerId } : {}),
      ...(contact ? { contact } : {}),
      // A client from before Flowzen: recorded as such, never as a won deal.
      ...(body.existingClient ? { status: 'CLIENT', existingClient: true } : {}),
      ...(body.force ? { force: true } : {}),
    },
  });
  return getCompany(ctx, out.data.id);
}

export async function updateCompany(ctx: ApiContext, id: string, body: In<typeof companyUpdateSchema>): Promise<CompanyOut> {
  await onTheTeam(ctx, body.ownerId);
  const { industry, state, ...rest } = body;
  await dispatchOk(companiesRouter, ctx.req, {
    method: 'PATCH',
    url: path(id),
    body: {
      ...sent({ ...rest, vertical: industry }),
      ...(state === undefined ? {} : state ? stateAs(state) : { stateCode: null, stateName: null }),
    },
  });
  return getCompany(ctx, id);
}

export type ContactOut = { id: string; name: string; role: 'APPROVER' | 'PAYER' | 'CONTACT'; email: string | null; phone: string | null; linkedin: string | null };

const contactOut = (p: ContactOut): ContactOut => ({
  id: p.id,
  name: p.name,
  role: p.role,
  email: p.email,
  phone: p.phone,
  linkedin: p.linkedin,
});

export async function addContact(ctx: ApiContext, companyId: string, body: In<typeof contactCreateSchema>): Promise<ContactOut> {
  const out = await dispatchOk(companiesRouter, ctx.req, {
    method: 'POST',
    url: path(companyId, '/people'),
    body: { name: body.name, role: body.role, email: body.email || '', phone: body.phone || '', linkedin: body.linkedin || '' },
  });
  return contactOut(out.person);
}

/** null clears a field: the edit route reads null as a blank. */
export async function updateContact(
  ctx: ApiContext,
  companyId: string,
  contactId: string,
  body: In<typeof contactUpdateSchema>,
): Promise<ContactOut> {
  const out = await dispatchOk(companiesRouter, ctx.req, {
    method: 'PATCH',
    url: `${path(companyId, '/people')}${path(contactId)}`,
    body: sent(body),
  });
  return contactOut(out.person);
}

// ── Deals ────────────────────────────────────────────────────────────────────

/** On the pipeline as v1, at Proposal sent — "New proposal" on the board. */
export async function createDeal(ctx: ApiContext, body: In<typeof dealCreateSchema>): Promise<DealOut> {
  await onTheTeam(ctx, body.ownerId);
  const out = await dispatchOk(proposalsRouter, ctx.req, {
    method: 'POST',
    url: '/',
    body: sent({
      companyId: body.companyId,
      kind: body.kind,
      ownerId: body.ownerId,
      initialValue: body.value,
      scopeSummary: body.scopeSummary,
      fileUrl: body.fileUrl,
      nextStep: body.nextStep,
      nextStepDate: body.nextStepDate,
    }),
  });
  return getDeal(ctx, out.proposal.id);
}

/** A new price sent: v2, v3… The stage follows from it, as on the board. */
export async function addDealVersion(ctx: ApiContext, id: string, body: In<typeof dealVersionSchema>): Promise<DealOut> {
  await dispatchOk(proposalsRouter, ctx.req, { method: 'POST', url: path(id, '/versions'), body: sent(body) });
  return getDeal(ctx, id);
}

/** The edit form, and the probability box beside it — two routes in the app. */
export async function updateDeal(ctx: ApiContext, id: string, body: In<typeof dealUpdateSchema>): Promise<DealOut> {
  await onTheTeam(ctx, body.ownerId);
  const { probability, ...rest } = body;
  const fields = sent(rest);
  if (Object.keys(fields).length > 0) {
    await dispatchOk(proposalsRouter, ctx.req, { method: 'PATCH', url: path(id), body: fields });
  }
  if (probability !== undefined) {
    await dispatchOk(proposalsRouter, ctx.req, { method: 'PATCH', url: path(id, '/probability'), body: { probabilityOverride: probability } });
  }
  return getDeal(ctx, id);
}

/** The one stage set by hand, and only once a proforma is out. */
export async function markVerbalYes(ctx: ApiContext, id: string, body: In<typeof dealVerbalYesSchema>): Promise<DealOut> {
  await dispatchOk(proposalsRouter, ctx.req, { method: 'PATCH', url: path(id, '/stage'), body: { stage: 'VERBAL_YES', ...sent(body) } });
  return getDeal(ctx, id);
}

/**
 * Won, on the price they accepted. The app names a version by its id; the API
 * by its number, which is what a person says ("they took v2").
 */
export async function winDeal(ctx: ApiContext, id: string, body: In<typeof dealWinSchema>): Promise<DealOut> {
  if (!validId(id)) throw notFound('Deal');
  const deal = await prisma.proposal.findFirst({
    where: { id, organizationId: ctx.user.organizationId, deletedAt: null },
    select: { versions: { orderBy: { n: 'desc' }, select: { id: true, n: true } } },
  });
  if (!deal) throw notFound('Deal');
  const version = body.version ? deal.versions.find((v) => v.n === body.version) : deal.versions[0];
  if (!version) {
    throw body.version
      ? new ApiError(404, 'not_found', `This deal has no v${body.version}.`)
      : new ApiError(400, 'invalid_request', 'Nothing has been priced on this deal yet. Send a price first.');
  }
  await dispatchOk(proposalsRouter, ctx.req, { method: 'POST', url: path(id, '/win'), body: { versionId: version.id } });
  return getDeal(ctx, id);
}

export async function loseDeal(ctx: ApiContext, id: string, body: In<typeof dealLoseSchema>): Promise<DealOut> {
  await dispatchOk(proposalsRouter, ctx.req, { method: 'POST', url: path(id, '/lose'), body: { lostReason: body.reason } });
  return getDeal(ctx, id);
}

/** A lost deal, back at the stage it was lost from — Verbal yes, for one that had been won. */
export async function reopenDeal(ctx: ApiContext, id: string): Promise<DealOut> {
  await dispatchOk(proposalsRouter, ctx.req, { method: 'POST', url: path(id, '/reopen'), body: {} });
  return getDeal(ctx, id);
}

// ── Retainers ────────────────────────────────────────────────────────────────

export async function createRetainer(ctx: ApiContext, body: In<typeof retainerCreateSchema>): Promise<RetainerOut> {
  await onTheTeam(ctx, body.ownerId);
  const out = await dispatchOk(retainersRouter, ctx.req, {
    method: 'POST',
    url: '/',
    body: sent({
      companyId: body.companyId,
      monthlyValue: body.monthlyFee,
      gstPercent: body.gstPercent,
      billing: body.billing,
      startDate: body.startDate,
      termMonths: body.termMonths,
      ownerId: body.ownerId,
      firstProjectName: body.firstProjectName,
      sourceProposalId: body.dealId,
    }),
  });
  return getRetainer(ctx, out.retainer.id);
}

/**
 * The edit form, Stop and Resume — three routes in the app, one call here, in
 * the only order that works: a stopped retainer is resumed before it is
 * changed, and a running one is changed before it is stopped.
 */
export async function updateRetainer(ctx: ApiContext, id: string, body: In<typeof retainerUpdateSchema>): Promise<RetainerOut> {
  if (!validId(id)) throw notFound('Retainer');
  const current = await prisma.retainer.findFirst({ where: { id, organizationId: ctx.user.organizationId }, select: { status: true } });
  if (!current) throw notFound('Retainer');
  const { status, stopReason, monthlyFee, ...rest } = body;
  const fields = sent({ ...rest, monthlyValue: monthlyFee });
  if (status === 'STOPPED' && current.status === 'ACTIVE' && !stopReason) {
    throw new ApiError(400, 'invalid_request', 'Say why it is ending — stopReason.');
  }

  if (status === 'ACTIVE' && current.status === 'STOPPED') {
    await dispatchOk(retainersRouter, ctx.req, { method: 'POST', url: path(id, '/resume'), body: {} });
  }
  if (Object.keys(fields).length > 0) {
    await dispatchOk(retainersRouter, ctx.req, { method: 'PATCH', url: path(id), body: fields });
  }
  if (status === 'STOPPED' && current.status === 'ACTIVE') {
    await dispatchOk(retainersRouter, ctx.req, { method: 'POST', url: path(id, '/stop'), body: { reason: stopReason } });
  }
  return getRetainer(ctx, id);
}

export type PieceOut = { id: string; name: string; status: 'ACTIVE' | 'DONE'; startDate: string | null; endDate: string | null };

const pieceOut = (p: { id: string; name: string; status: 'ACTIVE' | 'DONE'; startDate: Date | string | null; endDate: Date | string | null }): PieceOut => ({
  id: p.id,
  name: p.name,
  status: p.status,
  startDate: p.startDate ? day(new Date(p.startDate)) : null,
  endDate: p.endDate ? day(new Date(p.endDate)) : null,
});

/** A piece of a retainer's work beside the monthly work: a campaign, a launch. */
export async function addRetainerPiece(ctx: ApiContext, retainerId: string, body: In<typeof retainerPieceCreateSchema>): Promise<PieceOut> {
  const out = await dispatchOk(retainersRouter, ctx.req, { method: 'POST', url: path(retainerId, '/projects'), body: sent(body) });
  return pieceOut(out.project);
}

export async function updateRetainerPiece(
  ctx: ApiContext,
  retainerId: string,
  pieceId: string,
  body: In<typeof retainerPieceUpdateSchema>,
): Promise<PieceOut> {
  const out = await dispatchOk(retainersRouter, ctx.req, {
    method: 'PATCH',
    url: `${path(retainerId, '/projects')}${path(pieceId)}`,
    body: sent(body),
  });
  return pieceOut(out.project);
}

// ── One-time projects ────────────────────────────────────────────────────────

export async function createProject(ctx: ApiContext, body: In<typeof projectCreateSchema>): Promise<ProjectOut> {
  await onTheTeam(ctx, body.ownerId);
  const { dealId, ...rest } = body;
  const out = await dispatchOk(projectsRouter, ctx.req, {
    method: 'POST',
    url: '/',
    body: sent({ ...rest, sourceProposalId: dealId }),
  });
  return getProject(ctx, out.project.id);
}

/** Its details and its status — LIVE, DELIVERED or CANCELLED — through the edit route. */
export async function updateProject(ctx: ApiContext, id: string, body: In<typeof projectUpdateSchema>): Promise<ProjectOut> {
  await onTheTeam(ctx, body.ownerId);
  await dispatchOk(projectsRouter, ctx.req, { method: 'PATCH', url: path(id), body: sent(body) });
  return getProject(ctx, id);
}

export async function addMilestone(ctx: ApiContext, projectId: string, body: In<typeof milestoneCreateSchema>): Promise<ProjectOut> {
  await dispatchOk(projectsRouter, ctx.req, { method: 'POST', url: path(projectId, '/milestones'), body });
  return getProject(ctx, projectId);
}

/** Its name, share and amount. Billing moves it along — raising its proforma — never this. */
export async function updateMilestone(
  ctx: ApiContext,
  projectId: string,
  milestoneId: string,
  body: In<typeof milestoneUpdateSchema>,
): Promise<ProjectOut> {
  await dispatchOk(projectsRouter, ctx.req, {
    method: 'PATCH',
    url: `${path(projectId, '/milestones')}${path(milestoneId)}`,
    body: sent(body),
  });
  return getProject(ctx, projectId);
}

// ── Deals: touches ───────────────────────────────────────────────────────────

/** A touch, and with it the next step. */
export async function logDealTouch(ctx: ApiContext, id: string, body: In<typeof touchCreateSchema>): Promise<DealOut> {
  await dispatchOk(proposalsRouter, ctx.req, { method: 'POST', url: path(id, '/touch'), body });
  return getDeal(ctx, id);
}

// ── Calendar ─────────────────────────────────────────────────────────────────

const OFFICE_TIME = /^\d{4}-\d{2}-\d{2}(T([01]\d|2[0-3]):[0-5]\d)?$/;

/**
 * The calendar's routes take office wall-clock time. An ISO moment with an
 * offset — what most automation tools send — is turned into it first.
 */
function officeTime(v: string, allDay: boolean, timezone: string): string {
  if (OFFICE_TIME.test(v)) return v;
  const local = localDayAndTime(new Date(v), timezone);
  return allDay ? local.date : `${local.date}T${local.time}`;
}

export type EventSaved = { event: EventOut; clashes: unknown[] };

export async function createEvent(ctx: ApiContext, body: In<typeof eventCreateSchema>): Promise<EventSaved> {
  const { timezone } = await orgCalendar(ctx.user.organizationId);
  const out = await dispatchOk(calendarRouter, ctx.req, {
    method: 'POST',
    url: '/events',
    body: {
      ...body,
      startsAt: officeTime(body.startsAt, body.allDay, timezone),
      endsAt: officeTime(body.endsAt, body.allDay, timezone),
    },
  });
  return { event: await getEvent(ctx, out.event.id), clashes: out.clashes ?? [] };
}

/** Moving is the one change: when it starts and ends. Cancelling is not offered. */
export async function moveEvent(ctx: ApiContext, id: string, body: In<typeof eventMoveSchema>): Promise<EventSaved> {
  const { timezone } = await orgCalendar(ctx.user.organizationId);
  const allDay = body.allDay ?? (await getEvent(ctx, id)).allDay;
  const out = await dispatchOk(calendarRouter, ctx.req, {
    method: 'PATCH',
    url: `/events${path(id)}`,
    body: {
      startsAt: officeTime(body.startsAt, allDay, timezone),
      endsAt: officeTime(body.endsAt, allDay, timezone),
      ...(body.allDay !== undefined ? { allDay: body.allDay } : {}),
    },
  });
  return { event: await getEvent(ctx, id), clashes: out.clashes ?? [] };
}
