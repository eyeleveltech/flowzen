import { z } from 'zod';
import type { ApiScope } from '../apiKeys.js';
import type { ApiContext } from './core.js';
import * as read from './records.js';
import * as write from './writes.js';
import {
  busySchema,
  companyListQuery,
  companySchema,
  dealListQuery,
  dealSchema,
  eventCreateSchema,
  eventListQuery,
  eventMoveSchema,
  eventSchema,
  internalProjectListQuery,
  internalProjectSchema,
  invoiceListQuery,
  invoiceSchema,
  leadCreateSchema,
  leadListQuery,
  leadSchema,
  leadUpdateSchema,
  meSchema,
  oneOf,
  pageOf,
  paymentListQuery,
  paymentSchema,
  proformaListQuery,
  proformaSchema,
  projectListQuery,
  projectSchema,
  receivablesSchema,
  retainerListQuery,
  retainerSchema,
  searchHitSchema,
  searchQuery,
  taskCreateSchema,
  taskListQuery,
  taskSchema,
  taskUpdateSchema,
  touchCreateSchema,
} from './schemas.js';

/**
 * The REST API, /api/v1, as one list (API Plan 1, decision 4).
 *
 * routes/apiV1.ts mounts each entry with its scope check, and the OpenAPI file
 * is generated from the same entries and their zod schemas — so a route, its
 * scope and its documentation are one thing written once.
 */

export type Endpoint = {
  method: 'get' | 'post' | 'patch';
  /** Express style: "/tasks/:id". */
  path: string;
  /** Any one of these. Empty: any working key. */
  scopes: ApiScope[];
  tag: string;
  summary: string;
  description?: string;
  query?: z.AnyZodObject;
  body?: z.ZodTypeAny;
  /** The success body, for the documentation. */
  response: z.ZodTypeAny;
  /** The success status, for the documentation. */
  status: 200 | 201;
  run: (ctx: ApiContext, input: { params: Record<string, string>; query: any; body: any }) => Promise<{ status: number; body: unknown }>;
};

const ok = (body: unknown) => ({ status: 200, body });
const created = (body: unknown) => ({ status: 201, body });

const leadCreatedSchema = oneOf(leadSchema).extend({
  existing: z.boolean().describe('true: this lead was already here (same externalSource and externalId), answered with 200.'),
  possibleDuplicates: z.array(z.object({ id: z.string(), name: z.string() })).describe('Leads with a similar name. A warning only.'),
});
const eventSavedSchema = oneOf(eventSchema).extend({
  clashes: z.array(z.unknown()).describe('People or gear already booked at that time. A warning only — the event is saved.'),
});

export const ENDPOINTS: Endpoint[] = [
  {
    method: 'get',
    path: '/me',
    scopes: [],
    tag: 'Key',
    summary: 'This key: its name, scopes and who it acts as',
    response: oneOf(meSchema),
    status: 200,
    run: async (ctx) => ok({ data: await read.me(ctx) }),
  },
  {
    method: 'get',
    path: '/search',
    scopes: [],
    tag: 'Search',
    summary: 'Search tasks, companies, leads, deals, projects and invoices',
    description: 'Each kind of record is searched only when the key has the scope to read it. Five of each at most.',
    query: searchQuery,
    response: z.object({ data: z.array(searchHitSchema) }),
    status: 200,
    run: async (ctx, { query }) => ok({ data: await read.search(ctx, query.q) }),
  },

  // ── Tasks ──
  {
    method: 'get',
    path: '/tasks',
    scopes: ['tasks:read'],
    tag: 'Tasks',
    summary: 'List tasks',
    description:
      'The tasks the key’s creator can see in the app: their own, a Head’s departments, everything for Management.',
    query: taskListQuery,
    response: pageOf(taskSchema),
    status: 200,
    run: async (ctx, { query }) => ok(await read.listTasks(ctx, query)),
  },
  {
    method: 'post',
    path: '/tasks',
    scopes: ['tasks:write'],
    tag: 'Tasks',
    summary: 'Create a task',
    description: 'Checked exactly as the New task form is. Send an Idempotency-Key header so a retry never creates it twice.',
    body: taskCreateSchema,
    response: oneOf(taskSchema),
    status: 201,
    run: async (ctx, { body }) => created({ data: await write.createTask(ctx, body) }),
  },
  {
    method: 'get',
    path: '/tasks/:id',
    scopes: ['tasks:read'],
    tag: 'Tasks',
    summary: 'Get a task',
    response: oneOf(taskSchema),
    status: 200,
    run: async (ctx, { params }) => ok({ data: await read.getTask(ctx, params.id) }),
  },
  {
    method: 'patch',
    path: '/tasks/:id',
    scopes: ['tasks:write'],
    tag: 'Tasks',
    summary: 'Update a task',
    description: 'Title, notes, due date, priority, people and status. Tasks cannot be deleted through the API.',
    body: taskUpdateSchema,
    response: oneOf(taskSchema),
    status: 200,
    run: async (ctx, { params, body }) => ok({ data: await write.updateTask(ctx, params.id, body) }),
  },

  // ── Work ──
  {
    method: 'get',
    path: '/internal-projects',
    scopes: ['tasks:read', 'work:read'],
    tag: 'Work',
    summary: 'List internal projects',
    query: internalProjectListQuery,
    response: pageOf(internalProjectSchema),
    status: 200,
    run: async (ctx, { query }) => ok(await read.listInternalProjects(ctx, query)),
  },
  {
    method: 'get',
    path: '/projects',
    scopes: ['work:read'],
    tag: 'Work',
    summary: 'List one-time projects',
    description: 'Names, dates and progress. No quoted values or costs.',
    query: projectListQuery,
    response: pageOf(projectSchema),
    status: 200,
    run: async (ctx, { query }) => ok(await read.listProjects(ctx, query)),
  },
  {
    method: 'get',
    path: '/retainers',
    scopes: ['work:read'],
    tag: 'Work',
    summary: 'List retainers',
    description: 'Dates, their pieces of work, and this month’s progress. No fees.',
    query: retainerListQuery,
    response: pageOf(retainerSchema),
    status: 200,
    run: async (ctx, { query }) => ok(await read.listRetainers(ctx, query)),
  },

  // ── Clients ──
  {
    method: 'get',
    path: '/companies',
    scopes: ['clients:read'],
    tag: 'Clients',
    summary: 'List companies and their contacts',
    query: companyListQuery,
    response: pageOf(companySchema),
    status: 200,
    run: async (ctx, { query }) => ok(await read.listCompanies(ctx, query)),
  },
  {
    method: 'get',
    path: '/companies/:id',
    scopes: ['clients:read'],
    tag: 'Clients',
    summary: 'Get a company',
    response: oneOf(companySchema),
    status: 200,
    run: async (ctx, { params }) => ok({ data: await read.getCompany(ctx, params.id) }),
  },

  // ── Leads ──
  {
    method: 'get',
    path: '/leads',
    scopes: ['leads:read'],
    tag: 'Leads',
    summary: 'List outreach leads',
    query: leadListQuery,
    response: pageOf(leadSchema),
    status: 200,
    run: async (ctx, { query }) => ok(await read.listLeads(ctx, query)),
  },
  {
    method: 'post',
    path: '/leads',
    scopes: ['leads:write'],
    tag: 'Leads',
    summary: 'Add a lead',
    description:
      'With externalSource and externalId, sending the same lead again answers 200 with the existing one ("existing": true) — never a second lead. The same email or phone as another lead is refused (409 duplicate_lead).',
    body: leadCreateSchema,
    response: leadCreatedSchema,
    status: 201,
    run: async (ctx, { body }) => {
      const out = await write.createLead(ctx, body);
      const payload = { data: out.lead, existing: out.existing, possibleDuplicates: out.possibleDuplicates };
      return out.existing ? ok(payload) : created(payload);
    },
  },
  {
    method: 'get',
    path: '/leads/:id',
    scopes: ['leads:read'],
    tag: 'Leads',
    summary: 'Get a lead',
    response: oneOf(leadSchema),
    status: 200,
    run: async (ctx, { params }) => ok({ data: await read.getLead(ctx, params.id) }),
  },
  {
    method: 'patch',
    path: '/leads/:id',
    scopes: ['leads:write'],
    tag: 'Leads',
    summary: 'Change a lead’s status or next step',
    description: 'FOLLOW_UP needs remarks and a nextStepDate; MEETING needs a nextStepDate — the same rules as the Outreach screen.',
    body: leadUpdateSchema,
    response: oneOf(leadSchema),
    status: 200,
    run: async (ctx, { params, body }) => ok({ data: await write.updateLead(ctx, params.id, body) }),
  },
  {
    method: 'post',
    path: '/leads/:id/touches',
    scopes: ['leads:write'],
    tag: 'Leads',
    summary: 'Log a touch on a lead',
    body: touchCreateSchema,
    response: oneOf(leadSchema),
    status: 201,
    run: async (ctx, { params, body }) => created({ data: await write.logLeadTouch(ctx, params.id, body) }),
  },

  // ── Pipeline ──
  {
    method: 'get',
    path: '/deals',
    scopes: ['pipeline:read'],
    tag: 'Pipeline',
    summary: 'List deals',
    description: 'Values only when the key’s creator may see deal values.',
    query: dealListQuery,
    response: pageOf(dealSchema),
    status: 200,
    run: async (ctx, { query }) => ok(await read.listDeals(ctx, query)),
  },
  {
    method: 'get',
    path: '/deals/:id',
    scopes: ['pipeline:read'],
    tag: 'Pipeline',
    summary: 'Get a deal, with its versions',
    response: oneOf(dealSchema),
    status: 200,
    run: async (ctx, { params }) => ok({ data: await read.getDeal(ctx, params.id) }),
  },
  {
    method: 'post',
    path: '/deals/:id/touches',
    scopes: ['pipeline:write'],
    tag: 'Pipeline',
    summary: 'Log a touch on a deal, and set its next step',
    description: 'Stage moves, won, lost and pricing are not available through the API.',
    body: touchCreateSchema,
    response: oneOf(dealSchema),
    status: 201,
    run: async (ctx, { params, body }) => created({ data: await write.logDealTouch(ctx, params.id, body) }),
  },

  // ── Calendar ──
  {
    method: 'get',
    path: '/events',
    scopes: ['calendar:read'],
    tag: 'Calendar',
    summary: 'List meetings and shoots',
    description: 'With includeBusy=true, also everybody’s Google busy time in the window — as "Busy" only.',
    query: eventListQuery,
    response: pageOf(eventSchema).extend({ busy: z.array(busySchema).optional() }),
    status: 200,
    run: async (ctx, { query }) => ok(await read.listEvents(ctx, query)),
  },
  {
    method: 'post',
    path: '/events',
    scopes: ['calendar:write'],
    tag: 'Calendar',
    summary: 'Book a meeting, shoot or other event',
    body: eventCreateSchema,
    response: eventSavedSchema,
    status: 201,
    run: async (ctx, { body }) => {
      const out = await write.createEvent(ctx, body);
      return created({ data: out.event, clashes: out.clashes });
    },
  },
  {
    method: 'get',
    path: '/events/:id',
    scopes: ['calendar:read'],
    tag: 'Calendar',
    summary: 'Get an event',
    response: oneOf(eventSchema),
    status: 200,
    run: async (ctx, { params }) => ok({ data: await read.getEvent(ctx, params.id) }),
  },
  {
    method: 'patch',
    path: '/events/:id',
    scopes: ['calendar:write'],
    tag: 'Calendar',
    summary: 'Move an event',
    description: 'Only when it starts and ends. Events cannot be cancelled or deleted through the API.',
    body: eventMoveSchema,
    response: eventSavedSchema,
    status: 200,
    run: async (ctx, { params, body }) => {
      const out = await write.moveEvent(ctx, params.id, body);
      return ok({ data: out.event, clashes: out.clashes });
    },
  },

  // ── Money ──
  {
    method: 'get',
    path: '/invoices',
    scopes: ['money:read'],
    tag: 'Money',
    summary: 'List invoices',
    description: 'Amounts only when the key’s creator may see money figures; otherwise status and dates.',
    query: invoiceListQuery,
    response: pageOf(invoiceSchema),
    status: 200,
    run: async (ctx, { query }) => ok(await read.listInvoices(ctx, query)),
  },
  {
    method: 'get',
    path: '/proformas',
    scopes: ['money:read'],
    tag: 'Money',
    summary: 'List proformas',
    query: proformaListQuery,
    response: pageOf(proformaSchema),
    status: 200,
    run: async (ctx, { query }) => ok(await read.listProformas(ctx, query)),
  },
  {
    method: 'get',
    path: '/payments',
    scopes: ['money:read'],
    tag: 'Money',
    summary: 'List payments received',
    query: paymentListQuery,
    response: pageOf(paymentSchema),
    status: 200,
    run: async (ctx, { query }) => ok(await read.listPayments(ctx, query)),
  },
  {
    method: 'get',
    path: '/receivables',
    scopes: ['money:read'],
    tag: 'Money',
    summary: 'What clients owe, and how late',
    response: oneOf(receivablesSchema),
    status: 200,
    run: async (ctx) => ok({ data: await read.receivables(ctx) }),
  },
];

/** The pattern a concrete path was served under, "/tasks/:id" — so the request log never holds an id. */
export function endpointFor(method: string, path: string): Endpoint | null {
  const parts = path.replace(/\/+$/, '').split('/');
  return (
    ENDPOINTS.find((ep) => {
      if (ep.method !== method.toLowerCase()) return false;
      const want = ep.path.split('/');
      return want.length === parts.length && want.every((seg, i) => seg.startsWith(':') || seg === parts[i]);
    }) ?? null
  );
}
