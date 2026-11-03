import type { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { tasksRouter } from '../../routes/tasks.js';
import { outreachRouter } from '../../routes/outreach.js';
import { proposalsRouter } from '../../routes/proposals.js';
import { calendarRouter } from '../../routes/calendar.js';
import { localDayAndTime } from '../../utils/zonedTime.js';
import { checkForDuplicates } from '../duplicateCheck.js';
import { ApiError, notFound, type ApiContext } from './core.js';
import { dispatchOk } from './dispatch.js';
import { getDeal, getEvent, getLead, getTask, leadByExternal, orgCalendar, validId } from './records.js';
import type {
  DealOut,
  EventOut,
  LeadOut,
  TaskOut,
  eventCreateSchema,
  eventMoveSchema,
  leadCreateSchema,
  leadUpdateSchema,
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
 * What can be done is deliberately less than the app: no deletes anywhere,
 * no cancelling events, no stage moves, won or lost on deals, and no money.
 */

type In<T extends z.ZodTypeAny> = z.output<T>;

const path = (id: string, rest = '') => {
  if (!validId(id)) throw notFound('Record');
  return `/${encodeURIComponent(id)}${rest}`;
};

// ── Tasks ────────────────────────────────────────────────────────────────────

export async function createTask(ctx: ApiContext, body: In<typeof taskCreateSchema>): Promise<TaskOut> {
  if (body.projectId && (body.internalProjectId || body.companyId)) {
    throw new ApiError(400, 'invalid_request', 'A task sits in a one-time project or is internal work, not both.');
  }
  const created = await dispatchOk(tasksRouter, ctx.req, {
    method: 'POST',
    url: '/',
    body: {
      title: body.title,
      workType: body.projectId ? 'PROJECT' : 'INTERNAL',
      ...(body.projectId ? { projectId: body.projectId, workId: body.projectId } : {}),
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

/** A status change through the status route; the next step alone through the edit route. */
export async function updateLead(ctx: ApiContext, id: string, body: In<typeof leadUpdateSchema>): Promise<LeadOut> {
  if (body.status) {
    await dispatchOk(outreachRouter, ctx.req, {
      method: 'PATCH',
      url: path(id, '/status'),
      body: {
        status: body.status,
        ...(body.remarks !== undefined ? { remarks: body.remarks } : {}),
        ...(body.nextStep !== undefined ? { nextStep: body.nextStep } : {}),
        ...(body.nextStepDate !== undefined ? { nextActionDate: body.nextStepDate } : {}),
      },
    });
  } else {
    await dispatchOk(outreachRouter, ctx.req, {
      method: 'PATCH',
      url: path(id),
      body: {
        ...(body.nextStep !== undefined ? { nextStep: body.nextStep } : {}),
        ...(body.nextStepDate !== undefined ? { nextActionDate: body.nextStepDate } : {}),
      },
    });
  }
  return getLead(ctx, id);
}

export async function logLeadTouch(ctx: ApiContext, id: string, body: In<typeof touchCreateSchema>): Promise<LeadOut> {
  await dispatchOk(outreachRouter, ctx.req, { method: 'POST', url: path(id, '/touch'), body });
  return getLead(ctx, id);
}

// ── Deals ────────────────────────────────────────────────────────────────────

/** A touch, and with it the next step. Nothing else about a deal is writable here. */
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
