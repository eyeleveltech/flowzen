/**
 * The activity log, as a person reads it.
 *
 * ─── What was there ─────────────────────────────────────────────────────────
 *
 * Every write in Flowzen already leaves an `Activity` row — entity type, id,
 * verb, who, when, and a payload. Settings showed the last hundred of them as
 * "task deleted · Naif · Task": the verb with its underscores swapped out,
 * nothing saying WHICH task, and no way to look further back than a hundred
 * rows or to ask "what did Naif do this week".
 *
 * ─── What this does ─────────────────────────────────────────────────────────
 *
 *   · names the thing each row is about — the task's title, the company, the
 *     invoice number — looked up now, deleted rows included, so a line about
 *     something since deleted still says what it was;
 *   · says what happened in a sentence — "deleted the task", "moved the
 *     milestone" — and what changed underneath it, "Due date: 3 Oct → 5 Oct";
 *   · sorts every row into an area, so the log can be narrowed to the part of
 *     the business somebody is asking about.
 *
 * Read-only, and only ever describes. Nothing here writes a row.
 */

import { STAGE_LABEL } from '@flowzen/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

// ── Areas ────────────────────────────────────────────────────────────────────

export const AREAS = [
  { key: 'tasks', label: 'Tasks' },
  { key: 'work', label: 'Projects & retainers' },
  { key: 'clients', label: 'Clients & pipeline' },
  { key: 'money', label: 'Money' },
  { key: 'people', label: 'Team' },
  { key: 'signins', label: 'Sign-ins & passwords' },
  { key: 'assets', label: 'Assets' },
  { key: 'settings', label: 'Settings & Flowzen' },
] as const;

export type Area = (typeof AREAS)[number]['key'];

/** Account-security events, wherever they are filed. */
const SIGN_IN_VERBS = [
  'signed_in',
  'sign_in_failed',
  'invite_accepted',
  'password_changed',
  'password_reset',
  'password_reset_requested',
  'password_reset_link_issued',
];
/** Rows filed against the organisation that belong to a more specific area. */
const CLIENT_ORG_VERBS = ['outreach_imported'];
const PEOPLE_ORG_VERBS = ['allocations_confirmed'];

const WORK_TYPES = ['Project', 'Retainer', 'MonthCard', 'InternalProject'];
const MONEY_TYPES = ['Invoice', 'Proforma', 'Cost'];
const CLIENT_TYPES = ['Company', 'Proposal', 'OutreachEntry'];

export function areaWhere(area: string): Prisma.ActivityWhereInput | null {
  switch (area) {
    case 'tasks':
      return { entityType: 'Task' };
    case 'work':
      return { entityType: { in: WORK_TYPES } };
    case 'money':
      return { entityType: { in: MONEY_TYPES } };
    case 'clients':
      return { OR: [{ entityType: { in: CLIENT_TYPES } }, { verb: { in: CLIENT_ORG_VERBS } }] };
    case 'people':
      return {
        OR: [{ entityType: 'User', verb: { notIn: SIGN_IN_VERBS } }, { verb: { in: PEOPLE_ORG_VERBS } }],
      };
    case 'signins':
      return { verb: { in: SIGN_IN_VERBS } };
    case 'assets':
      return { entityType: 'Asset' };
    case 'settings':
      return { entityType: 'Organization', verb: { notIn: [...CLIENT_ORG_VERBS, ...PEOPLE_ORG_VERBS] } };
    default:
      return null;
  }
}

export function areaOf(entityType: string, verb: string): Area {
  if (SIGN_IN_VERBS.includes(verb)) return 'signins';
  if (CLIENT_ORG_VERBS.includes(verb)) return 'clients';
  if (PEOPLE_ORG_VERBS.includes(verb)) return 'people';
  if (entityType === 'Task') return 'tasks';
  if (WORK_TYPES.includes(entityType)) return 'work';
  if (MONEY_TYPES.includes(entityType)) return 'money';
  if (CLIENT_TYPES.includes(entityType)) return 'clients';
  if (entityType === 'User') return 'people';
  if (entityType === 'Asset') return 'assets';
  return 'settings';
}

// ── What a row is about ──────────────────────────────────────────────────────

export type Subject = {
  label: string;
  /** Where it sits — the client a task is for, the company on an invoice. */
  context: string | null;
  href: string | null;
  /** Deleted since, or never found: named from what the row itself recorded. */
  gone: boolean;
};

type Row = { entityType: string; entityId: string; payload: unknown };

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

const monthLabel = (m: string) => {
  const d = new Date(`${m}-01T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? m
    : d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
};

/** What a row can say about itself when the thing it names is gone. */
const fallback = (row: Row): Pick<Subject, 'label' | 'context'> => {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  // A document is its number; the company is where it sits.
  if (row.entityType === 'Invoice' || row.entityType === 'Proforma') {
    const n = str(p.number) ?? str(p.invoiceNumber);
    const noun = row.entityType === 'Proforma' ? 'Proforma' : 'Invoice';
    return { label: n ? `${noun} ${n}` : `A removed ${noun.toLowerCase()}`, context: str(p.companyName) };
  }
  const named = str(p.title) ?? str(p.name) ?? str(p.companyName) ?? str(p.tag);
  if (named) return { label: named, context: null };
  if (str(p.vendor)) return { label: String(p.vendor), context: null };
  return { label: 'something since removed', context: null };
};

/**
 * Every subject on a page of rows, in one query per kind of thing.
 *
 * Deleted rows are looked up too (`deletedAt: undefined` opts out of the
 * soft-delete filter in lib/prisma.ts): "deleted the task ID CARD" is the line
 * somebody comes here for, and it has to be able to say ID CARD.
 */
export async function resolveSubjects(orgId: string, rows: Row[]): Promise<Map<string, Subject>> {
  const ids = (type: string) => [...new Set(rows.filter((r) => r.entityType === type).map((r) => r.entityId))];
  const out = new Map<string, Subject>();
  const put = (type: string, id: string, s: Subject) => out.set(`${type}:${id}`, s);

  const [tasks, companies, projects, proposals, retainers, months, internal, invoices, proformas, costs, assets, users, leads, org] =
    await Promise.all([
      ids('Task').length
        ? prisma.task.findMany({
            where: { id: { in: ids('Task') }, organizationId: orgId, deletedAt: undefined },
            select: {
              id: true,
              title: true,
              deletedAt: true,
              projectId: true,
              companyId: true,
              internalProjectId: true,
              company: { select: { name: true } },
              project: { select: { name: true, company: { select: { name: true } } } },
              retainerProject: { select: { id: true, name: true, retainerId: true, retainer: { select: { company: { select: { name: true } } } } } },
              monthCard: { select: { retainerId: true, retainer: { select: { company: { select: { name: true } } } } } },
              internalProject: { select: { name: true } },
            },
          })
        : [],
      ids('Company').length
        ? prisma.company.findMany({ where: { id: { in: ids('Company') }, organizationId: orgId }, select: { id: true, name: true } })
        : [],
      ids('Project').length
        ? prisma.project.findMany({
            where: { id: { in: ids('Project') }, organizationId: orgId, deletedAt: undefined },
            select: { id: true, name: true, deletedAt: true, isSample: true, company: { select: { name: true } } },
          })
        : [],
      ids('Proposal').length
        ? prisma.proposal.findMany({
            where: { id: { in: ids('Proposal') }, organizationId: orgId, deletedAt: undefined },
            select: { id: true, kind: true, deletedAt: true, companyId: true, company: { select: { name: true } } },
          })
        : [],
      ids('Retainer').length
        ? prisma.retainer.findMany({
            where: { id: { in: ids('Retainer') }, organizationId: orgId },
            select: { id: true, company: { select: { name: true } } },
          })
        : [],
      ids('MonthCard').length
        ? prisma.monthCard.findMany({
            where: { id: { in: ids('MonthCard') }, retainer: { organizationId: orgId } },
            select: { id: true, month: true, retainerId: true, retainer: { select: { company: { select: { name: true } } } } },
          })
        : [],
      ids('InternalProject').length
        ? prisma.internalProject.findMany({
            where: { id: { in: ids('InternalProject') }, organizationId: orgId },
            select: { id: true, name: true },
          })
        : [],
      ids('Invoice').length
        ? prisma.invoice.findMany({
            where: { id: { in: ids('Invoice') }, organizationId: orgId },
            select: { id: true, number: true, companyId: true, company: { select: { name: true } } },
          })
        : [],
      ids('Proforma').length
        ? prisma.proforma.findMany({
            where: { id: { in: ids('Proforma') }, organizationId: orgId },
            select: { id: true, number: true, companyId: true, company: { select: { name: true } } },
          })
        : [],
      ids('Cost').length
        ? prisma.cost.findMany({
            where: { id: { in: ids('Cost') }, organizationId: orgId, deletedAt: undefined },
            select: {
              id: true,
              vendor: true,
              category: true,
              deletedAt: true,
              projectId: true,
              project: { select: { name: true } },
              monthCard: { select: { retainerId: true, retainer: { select: { company: { select: { name: true } } } } } },
            },
          })
        : [],
      ids('Asset').length
        ? prisma.asset.findMany({
            where: { id: { in: ids('Asset') }, organizationId: orgId, deletedAt: undefined },
            select: { id: true, tag: true, name: true, deletedAt: true },
          })
        : [],
      ids('User').length
        ? prisma.user.findMany({ where: { id: { in: ids('User') }, organizationId: orgId }, select: { id: true, name: true } })
        : [],
      ids('OutreachEntry').length
        ? prisma.outreachEntry.findMany({
            where: { id: { in: ids('OutreachEntry') }, organizationId: orgId, deletedAt: undefined },
            select: { id: true, name: true, deletedAt: true, promotedCompanyId: true },
          })
        : [],
      ids('Organization').length
        ? prisma.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true } })
        : null,
    ]);

  for (const t of tasks) {
    const client =
      t.project?.company?.name ??
      t.retainerProject?.retainer?.company?.name ??
      t.monthCard?.retainer?.company?.name ??
      t.company?.name ??
      null;
    const job = t.project?.name ?? t.retainerProject?.name ?? t.internalProject?.name ?? null;
    put('Task', t.id, {
      label: t.title,
      context: client ? [client, job].filter(Boolean).join(' · ') : job ? `Internal · ${job}` : 'Internal',
      href: t.deletedAt
        ? null
        : t.projectId
          ? `/projects/${t.projectId}`
          : t.retainerProject
            ? `/retainers/${t.retainerProject.retainerId}/projects/${t.retainerProject.id}`
            : t.monthCard
              ? `/retainers/${t.monthCard.retainerId}`
              : t.internalProjectId
                ? `/internal-projects/${t.internalProjectId}`
                : t.companyId
                  ? `/companies/${t.companyId}`
                  : null,
      gone: Boolean(t.deletedAt),
    });
  }
  for (const c of companies) put('Company', c.id, { label: c.name, context: null, href: `/companies/${c.id}`, gone: false });
  for (const p of projects) {
    put('Project', p.id, {
      label: p.name,
      context: [p.company?.name, p.isSample ? 'Sample work' : null].filter(Boolean).join(' · ') || null,
      href: p.deletedAt ? null : `/projects/${p.id}`,
      gone: Boolean(p.deletedAt),
    });
  }
  for (const p of proposals) {
    put('Proposal', p.id, {
      label: p.company?.name ?? 'A proposal',
      context: p.kind === 'RETAINER' ? 'Monthly retainer' : 'One-time project',
      href: p.deletedAt ? null : `/companies/${p.companyId}`,
      gone: Boolean(p.deletedAt),
    });
  }
  for (const r of retainers) put('Retainer', r.id, { label: r.company?.name ?? 'A retainer', context: 'Retainer', href: `/retainers/${r.id}`, gone: false });
  for (const m of months) {
    put('MonthCard', m.id, {
      label: `${m.retainer?.company?.name ?? 'A retainer'} · ${monthLabel(m.month)}`,
      context: 'Retainer month',
      href: `/retainers/${m.retainerId}`,
      gone: false,
    });
  }
  for (const i of internal) put('InternalProject', i.id, { label: i.name, context: 'Internal', href: `/internal-projects/${i.id}`, gone: false });
  for (const i of invoices) {
    put('Invoice', i.id, { label: `Invoice ${i.number}`, context: i.company?.name ?? null, href: `/companies/${i.companyId}?tab=MONEY`, gone: false });
  }
  for (const p of proformas) {
    put('Proforma', p.id, { label: `Proforma ${p.number}`, context: p.company?.name ?? null, href: `/companies/${p.companyId}?tab=MONEY`, gone: false });
  }
  for (const c of costs) {
    put('Cost', c.id, {
      label: `${c.vendor} · ${c.category}`,
      context: c.project?.name ?? c.monthCard?.retainer?.company?.name ?? 'Overhead',
      href: c.deletedAt
        ? null
        : c.projectId
          ? `/projects/${c.projectId}`
          : c.monthCard
            ? `/retainers/${c.monthCard.retainerId}`
            : '/money',
      gone: Boolean(c.deletedAt),
    });
  }
  for (const a of assets) {
    put('Asset', a.id, { label: `${a.tag} · ${a.name}`, context: null, href: a.deletedAt ? null : `/assets/${a.id}`, gone: Boolean(a.deletedAt) });
  }
  for (const u of users) put('User', u.id, { label: u.name, context: null, href: '/members', gone: false });
  for (const l of leads) {
    put('OutreachEntry', l.id, {
      label: l.name,
      context: 'Lead',
      href: l.deletedAt ? null : l.promotedCompanyId ? `/companies/${l.promotedCompanyId}` : '/outreach',
      gone: Boolean(l.deletedAt),
    });
  }
  if (org) put('Organization', org.id, { label: org.name, context: null, href: '/settings', gone: false });

  // Anything not found — hard-deleted, or from before its table existed.
  for (const r of rows) {
    const key = `${r.entityType}:${r.entityId}`;
    if (!out.has(key)) out.set(key, { ...fallback(r), href: null, gone: true });
  }
  return out;
}

// ── What happened ────────────────────────────────────────────────────────────

/**
 * The sentence, without its subject: "{person} {action} {subject}".
 *
 * Keyed by entity type and verb, because the older rows use bare verbs —
 * `created`, `deleted`, `restored` — that only mean something next to what
 * they were done to.
 */
const ACTION: Record<string, string> = {
  // Tasks
  'Task.task_created': 'created the task',
  'Task.task_edited': 'edited the task',
  'Task.task_deleted': 'deleted the task',
  'Task.task_restored': 'restored the task',
  'Task.task_completed': 'finished the task',
  'Task.task_cancelled': 'cancelled the task',
  'Task.task_reopened': 'reopened the task',
  'Task.task_status_changed': 'changed the status of',
  'Task.task_waiting': 'put on hold',
  'Task.task_resumed': 'took off hold',

  // Clients, leads, the pipeline
  'Company.created': 'added the company',
  'Company.company_created': 'added the company',
  'Company.company_migrated': 'added an existing client',
  'Company.company_updated': 'edited the company',
  'Company.company_archived': 'archived the company',
  'Company.company_deleted_permanently': 'permanently deleted the company',
  'Company.person_added': 'added a contact at',
  'Company.person_updated': 'edited a contact at',
  'Company.status_derived_past': 'moved to past clients',
  'Company.outreach_promoted': 'promoted the lead to a company:',
  'OutreachEntry.outreach_added': 'added the lead',
  'OutreachEntry.outreach_edited': 'edited the lead',
  'OutreachEntry.outreach_status_changed': 'updated the lead',
  'OutreachEntry.outreach_promoted': 'promoted the lead',
  'OutreachEntry.deleted': 'deleted the lead',
  'OutreachEntry.restored': 'restored the lead',
  'Organization.outreach_imported': 'imported leads from a file',
  'Proposal.proposal_created': 'raised a proposal for',
  'Proposal.proposal_version_added': 'revised the quote for',
  'Proposal.proposal_edited': 'edited the proposal for',
  'Proposal.proposal_won': 'won the deal with',
  'Proposal.proposal_lost': 'marked as lost the deal with',
  'Proposal.proposal_deleted': 'deleted the proposal for',
  'Proposal.proposal_restored': 'restored the proposal for',
  'Proposal.verbal_yes': 'recorded a verbal yes from',
  'Proposal.probability_overridden': 'changed the chance of winning',

  // Work
  'Project.project_created': 'created the project',
  'Project.project_edited': 'edited the project',
  'Project.project_delivered': 'delivered the project',
  'Project.project_cancelled': 'cancelled the project',
  'Project.deleted': 'deleted the project',
  'Project.restored': 'restored the project',
  'Project.milestone_added': 'added a billing milestone to',
  'Project.milestone_edited': 'edited a billing milestone on',
  'Project.milestone_deleted': 'removed a billing milestone from',
  'Project.milestone_status_changed': 'moved a billing milestone on',
  'Retainer.retainer_created': 'started a retainer for',
  'Retainer.retainer_started': 'started a retainer for',
  'Retainer.retainer_edited': 'edited the retainer for',
  'Retainer.retainer_stopped': 'stopped the retainer for',
  'Retainer.retainer_project_created': 'added a project to the retainer for',
  'Retainer.retainer_project_edited': 'edited a project in the retainer for',
  'Retainer.retainer_project_deleted': 'removed a project from the retainer for',
  'MonthCard.month_card_created': 'opened the month',
  'MonthCard.month_card_reopened': 'reopened the closed month',
  'InternalProject.internal_project_created': 'created the internal project',
  'InternalProject.internal_project_deleted': 'deleted the internal project',
  'InternalProject.internal_project_status_changed': 'changed the status of',

  // Money
  'Invoice.created': 'recorded',
  'Invoice.payment_received': 'recorded a payment on',
  'Invoice.fully_paid': 'recorded the final payment on',
  'Invoice.invoice_document_saved': 'prepared the printable document for',
  'Invoice.invoice_status_changed': 'changed the status of',
  'Invoice.document_emailed': 'emailed',
  'Proforma.proforma_generated': 'issued',
  'Proforma.proforma_edited': 'edited',
  'Proforma.document_emailed': 'emailed',
  'Cost.created': 'entered a cost:',
  'Cost.cost_updated': 'edited a cost:',
  'Cost.cost_confirmed': 'confirmed a recurring cost:',
  'Cost.deleted': 'deleted a cost:',
  'Cost.restored': 'restored a cost:',
  'Cost.recurring_cost_rolled': 'carried a recurring cost into the new month:',

  // Assets
  'Asset.asset.created': 'added the asset',
  'Asset.asset.updated': 'edited the asset',
  'Asset.asset.deleted': 'deleted the asset',
  'Asset.asset.restored': 'restored the asset',
  'Asset.asset.retired': 'retired the asset',
  'Asset.asset.assigned': 'handed over',
  'Asset.asset.checked_out': 'checked out',
  'Asset.asset.returned': 'took back',
  'Asset.asset.transferred': 'transferred',
  'Asset.asset.maintenance_opened': 'sent for repair',
  'Asset.asset.maintenance_closed': 'got back from repair',

  // People and access
  'User.user_invited': 'invited',
  'User.invite_accepted': 'accepted the invite and joined',
  'User.user_access_updated': 'changed the account of',
  'User.profile_updated': 'updated the profile of',
  'User.allocations_updated': 'changed the time split for',
  'User.alert_digest_sent': 'emailed the alert digest to',
  'User.signed_in': 'signed in',
  'User.sign_in_failed': 'typed a wrong password for',
  'User.password_changed': 'changed the password of',
  'User.password_reset': 'reset the password of',
  'User.password_reset_requested': 'asked for a password reset for',
  'User.password_reset_link_issued': 'issued a password reset link for',

  // The organisation
  'Organization.organisation_updated': 'changed the organisation settings',
  'Organization.document_settings_updated': 'changed the document settings',
  'Organization.mail_settings_updated': 'changed the email settings',
  'Organization.allocations_confirmed': 'confirmed the time split',
  'Organization.monday_brief_mailed': 'mailed the Monday brief',
  'Organization.assistant_asked': 'asked Zen',
};

/** Rows whose sentence is complete without naming the subject. */
const NO_SUBJECT = new Set([
  'Organization.organisation_updated',
  'Organization.document_settings_updated',
  'Organization.mail_settings_updated',
  'Organization.allocations_confirmed',
  'Organization.monday_brief_mailed',
  'Organization.assistant_asked',
  'Organization.outreach_imported',
]);

/** Account events a person does to themselves read without "of Harish". */
const SELF_ACTION: Record<string, string> = {
  'User.signed_in': 'signed in',
  'User.invite_accepted': 'accepted the invite and joined',
  'User.profile_updated': 'updated their profile',
  'User.password_changed': 'changed their password',
  'User.password_reset': 'reset their password',
  'User.password_reset_requested': 'asked for a password reset',
};

const actionFor = (entityType: string, verb: string): string => {
  const key = `${entityType}.${verb}`;
  if (ACTION[key]) return ACTION[key];
  // Calls, meetings, emails and notes typed into the "log activity" dialog.
  const logged = /^([a-z]+)_logged$/.exec(verb);
  if (logged) return `logged ${logged[1] === 'email' ? 'an email' : `a ${logged[1]}`} with`;
  return verb.replace(/[._]/g, ' ');
};

// ── What changed ─────────────────────────────────────────────────────────────

const FIELD: Record<string, string> = {
  title: 'Title',
  name: 'Name',
  dueDate: 'Due date',
  assignee: 'Assigned to',
  assigneeId: 'Assigned to',
  assigneeIds: 'People on it',
  reviewer: 'Reviewer',
  assignedBy: 'Assigned by',
  ownerId: 'Owner',
  status: 'Status',
  priority: 'Priority',
  notes: 'Notes',
  description: 'Description',
  taskType: 'Task type',
  quotedValue: 'Quote',
  startDate: 'Start date',
  endDate: 'End date',
  isSample: 'Sample work',
  gstPercent: 'GST %',
  email: 'Email',
  phone: 'Phone',
  linkedin: 'LinkedIn',
  preset: 'Role',
  permissions: 'Permissions',
  monthlyCost: 'Monthly cost',
  dept: 'Department',
  active: 'Account',
  vertical: 'Industry',
  source: 'Source',
  contactPersonName: 'Contact person',
  gstin: 'GSTIN',
  stateName: 'State',
  website: 'Website',
  address: 'Address',
  designation: 'Designation',
  role: 'Role',
  // A proposal's version, corrected in place.
  value: 'Value',
  scopeSummary: 'Scope',
  fileUrl: 'Document link',
  sentAt: 'Sent on',
  kind: 'Kind',
  company: 'Company',
};

/** Fields whose values are people. */
const PERSON_FIELDS = new Set(['assignee', 'assigneeId', 'reviewer', 'assignedBy', 'ownerId', 'ownerFrom', 'ownerTo']);
const MONEY_FIELDS = new Set(['quotedValue', 'monthlyCost', 'amount', 'value', 'monthlyValue']);
/** Said once, not repeated: the code rides along with the state's name. */
const QUIET_FIELDS = new Set(['stateCode']);

const ENUM_WORD: Record<string, string> = { TODO: 'To do', ON_HOLD: 'On hold', IN_PROGRESS: 'In progress' };

const inr = (v: unknown) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? `₹${n.toLocaleString('en-IN')}` : null;
};

const day = (v: string) => {
  const d = new Date(`${v.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? v
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

const enumWord = (v: string) =>
  ENUM_WORD[v] ?? STAGE_LABEL[v] ?? (/^[A-Z][A-Z0-9_]+$/.test(v) ? (v.charAt(0) + v.slice(1).toLowerCase()).replace(/_/g, ' ') : v);

const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function valueText(field: string, v: unknown, people: Map<string, string>): string {
  if (v === null || v === undefined || v === '') return '—';
  if (PERSON_FIELDS.has(field) && typeof v === 'string') return people.get(v) ?? 'someone no longer on the team';
  if (MONEY_FIELDS.has(field)) return inr(v) ?? String(v);
  if (field === 'active') return v ? 'Active' : 'Deactivated';
  if (field === 'notes' || field === 'description' || field === 'scopeSummary') {
    if (typeof v === 'boolean') return v ? 'Written' : 'Empty';
    return `“${clip(String(v), 60)}”`;
  }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (field === 'gstPercent') return `${v}%`;
  if (Array.isArray(v)) {
    if (field === 'assigneeIds') return v.map((id) => people.get(String(id)) ?? '?').join(', ') || '—';
    return v.join(', ') || '—';
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return day(v);
  if (typeof v === 'string') return clip(enumWord(v));
  return clip(String(v));
}

function changeLines(changed: Record<string, { from: unknown; to: unknown }>, people: Map<string, string>): string[] {
  const lines: string[] = [];
  for (const [field, c] of Object.entries(changed)) {
    if (QUIET_FIELDS.has(field) || !c || typeof c !== 'object') continue;
    const label = FIELD[field] ?? field.replace(/([A-Z])/g, ' $1').replace(/^./, (x) => x.toUpperCase());
    if (field === 'permissions' && Array.isArray(c.from) && Array.isArray(c.to)) {
      const from = c.from as string[];
      const to = c.to as string[];
      const added = to.filter((p) => !from.includes(p));
      const removed = from.filter((p) => !to.includes(p));
      const parts = [...added.map((p) => `+${p}`), ...removed.map((p) => `−${p}`)];
      lines.push(`${label}: ${parts.join(', ') || 'no change'}`);
      continue;
    }
    lines.push(`${label}: ${valueText(field, c.from, people)} → ${valueText(field, c.to, people)}`);
  }
  return lines;
}

/**
 * The lines under the sentence: what moved, what it was worth, what was said.
 *
 * Read off the payload by KEY, so a new activity that records `changed` or
 * `from`/`to` reads properly the day it is written. Money keys are simply
 * absent for anyone the route stripped them for.
 */
export function detailLines(
  entityType: string,
  verb: string,
  payload: unknown,
  people: Map<string, string>,
): string[] {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const lines: string[] = [];

  if (p.changed && typeof p.changed === 'object') {
    lines.push(...changeLines(p.changed as Record<string, { from: unknown; to: unknown }>, people));
  } else if (Array.isArray(p.fields) && p.fields.length > 0) {
    // Older rows recorded only which fields were sent.
    lines.push(`Changed: ${(p.fields as string[]).map((f) => (FIELD[f] ?? f).toLowerCase()).join(', ')}`);
  }

  // Which milestone a billing move was about.
  if (verb.startsWith('milestone_') && str(p.label)) lines.push(String(p.label));

  // A move from one state to another.
  if (verb !== 'document_emailed' && entityType !== 'Asset' && str(p.from) && str(p.to)) {
    lines.push(`${enumWord(String(p.from))} → ${enumWord(String(p.to))}`);
  }
  const stageFrom = str(p.stageFrom) ?? str(p.lostFromStage);
  const stageTo = str(p.stageTo);
  if (stageFrom && stageTo && stageFrom !== stageTo) lines.push(`${enumWord(stageFrom)} → ${enumWord(stageTo)}`);

  // Figures.
  const value = inr(p.value);
  const was = inr(p.previousValue);
  if (verb === 'proposal_version_added' && value) lines.push(was ? `Revised to ${value}, was ${was}` : `Quoted ${value}`);
  else if (verb === 'proposal_won' && value) lines.push(`Won at ${value}`);
  else if (value && !p.changed) lines.push(value);
  const amount = inr(p.amount) ?? inr(p.paymentAmount);
  if (amount) lines.push(amount);

  // Who, and where to.
  if (str(p.ownerFrom) && str(p.ownerTo)) {
    lines.push(`Owner: ${valueText('ownerFrom', p.ownerFrom, people)} → ${valueText('ownerTo', p.ownerTo, people)}`);
  }
  if (Array.isArray(p.assigneeIds) && verb === 'task_created') {
    lines.push(`Assigned to ${valueText('assigneeIds', p.assigneeIds, people)}`);
  }
  // Equipment: who it went to, and in what state it came back.
  if (entityType === 'Asset') {
    if (str(p.to)) lines.push(`To ${people.get(String(p.to)) ?? 'someone no longer on the team'}`);
    if (str(p.dueAt)) lines.push(`Due back ${day(String(p.dueAt))}`);
    if (str(p.condition)) lines.push(`Came back ${enumWord(String(p.condition)).toLowerCase()}`);
    if (str(p.outcome)) lines.push(enumWord(String(p.outcome)));
    if (str(p.kind)) lines.push(enumWord(String(p.kind)));
  }

  // Why, and what was said.
  for (const k of ['lostReason', 'reason', 'stopReason', 'note']) {
    if (str(p[k])) lines.push(`“${clip(String(p[k]), 140)}”`);
  }
  if (str(p.message)) lines.push(`“${clip(String(p.message), 140)}”`);
  if (str(p.because)) lines.push(String(p.because));
  if ((verb === 'payment_received' || verb === 'fully_paid') && str(p.mode)) lines.push(`By ${enumWord(String(p.mode)).toLowerCase()}`);
  if (verb === 'assistant_asked' && str(p.question)) lines.push(`“${clip(String(p.question), 160)}”`);
  if (verb === 'task_waiting' && str(p.waitingOn)) {
    lines.push(p.waitingOn === 'CLIENT' ? 'Waiting on the client' : 'Waiting on somebody else');
  }
  if (verb === 'retainer_project_created' || verb === 'retainer_project_deleted' || verb === 'retainer_project_edited') {
    if (str(p.name)) lines.unshift(String(p.name));
  }
  if (typeof p.milestonesRemoved === 'number' && p.milestonesRemoved > 0) {
    lines.push(`${p.milestonesRemoved} billing milestone${p.milestonesRemoved === 1 ? '' : 's'} removed`);
  }
  const COMPANY: Record<string, string> = { CLIENT: 'Client', PROSPECT: 'Prospect', PAST: 'Past client' };
  const cFrom = typeof p.companyStatusFrom === 'string' ? COMPANY[p.companyStatusFrom] : null;
  const cTo = typeof p.companyStatusTo === 'string' ? COMPANY[p.companyStatusTo] : null;
  if (cFrom && cTo) lines.push(`Company: ${cFrom} → ${cTo}`);

  // Emails and imports.
  if (verb === 'document_emailed') {
    const to = Array.isArray(p.to) ? p.to.join(', ') : str(p.to);
    if (to) lines.push(`Sent to ${to}`);
  }
  if (verb === 'outreach_imported' && typeof p.created === 'number') {
    const names = Array.isArray(p.names) ? (p.names as string[]) : [];
    lines.push(
      [`${p.created} added`, p.skipped ? `${p.skipped} skipped` : null, p.invalid ? `${p.invalid} rejected` : null]
        .filter(Boolean)
        .join(' · '),
    );
    if (names.length) lines.push(clip(names.join(', '), 160));
  }

  // Sign-ins: where from.
  if (str(p.device) || str(p.ip)) lines.push([str(p.device), str(p.ip)].filter(Boolean).join(' · '));

  // Once each, in the order found.
  return [...new Set(lines)];
}

// ── One row, readable ────────────────────────────────────────────────────────

export type LogEntry = {
  id: string;
  at: string;
  actor: { id: string; name: string } | null;
  /**
   * Who to say when nobody signed in did it: Flowzen, for its own scheduled
   * jobs; "Someone", for a wrong password nobody has owned up to.
   */
  nobody: 'Flowzen' | 'Someone';
  area: Area;
  action: string;
  subject: Subject | null;
  detail: string[];
  entityType: string;
  verb: string;
};

export function describe(
  row: { id: string; at: Date; entityType: string; entityId: string; verb: string; payload: unknown; actor: { id: string; name: string } | null },
  subjects: Map<string, Subject>,
  people: Map<string, string>,
): LogEntry {
  const key = `${row.entityType}.${row.verb}`;
  const self = row.entityType === 'User' && row.actor?.id === row.entityId && SELF_ACTION[key];
  const subject = NO_SUBJECT.has(key) || self ? null : (subjects.get(`${row.entityType}:${row.entityId}`) ?? null);
  return {
    id: row.id,
    at: row.at.toISOString(),
    actor: row.actor,
    nobody: row.verb === 'sign_in_failed' ? 'Someone' : 'Flowzen',
    area: areaOf(row.entityType, row.verb),
    action: self || actionFor(row.entityType, row.verb),
    subject,
    detail: detailLines(row.entityType, row.verb, row.payload, people),
    entityType: row.entityType,
    verb: row.verb,
  };
}

// ── Dates in the organisation's own day ─────────────────────────────────────

/** Minutes the zone is ahead of UTC at that instant. */
const offsetMinutes = (at: Date, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return (Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - at.getTime()) / 60000;
};

/**
 * The instant a calendar day begins in the organisation's zone.
 *
 * "From 28 Sept" means from midnight in Chennai, not from 05:30 — the log is
 * read in local days, so it is filtered in them.
 */
export function dayStartIn(dayKey: string, timeZone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return null;
  const guess = new Date(`${dayKey}T00:00:00Z`);
  if (Number.isNaN(guess.getTime())) return null;
  try {
    return new Date(guess.getTime() - offsetMinutes(guess, timeZone) * 60000);
  } catch {
    return guess;
  }
}
