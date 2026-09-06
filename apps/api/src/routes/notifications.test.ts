import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { RolePreset } from '@prisma/client';

/**
 * The bell, and the two things it was getting wrong.
 *
 * It was organisation-scoped and otherwise ungated, so every signed-in person
 * received an identical payload — verified against the live database, where a
 * designer with nothing but `work.own` got the same twenty alerts as the
 * founder, including a project's cost estimate and the founder's own
 * utilisation percentage.
 *
 * And "read" lived in one column on a shared row, so the first person to press
 * "Mark all read" cleared the badge for the whole company. Forty-one of the
 * forty-four open alerts carried one manager's id, which is why all four roles
 * reported an unread count of exactly 3.
 */

const PEOPLE = {
  boss: {
    id: 'usr-boss',
    preset: RolePreset.MANAGEMENT,
    permissions: [
      'work.own', 'work.team', 'work.all', 'company.read', 'pipeline.read',
      'money.status', 'money.figures', 'cost.enter', 'reports.read', 'setup.admin',
    ],
  },
  head: {
    id: 'usr-head',
    preset: RolePreset.HEAD,
    permissions: ['work.own', 'work.team', 'work.all', 'money.status', 'cost.enter'],
  },
  employee: { id: 'usr-emp', preset: RolePreset.EMPLOYEE, permissions: ['work.own'] },
} as const;

type Who = keyof typeof PEOPLE;
const auth = (w: Who) =>
  [
    'Authorization',
    `Bearer ${signJwt({
      userId: PEOPLE[w].id,
      organizationId: 'org-1',
      email: `${w}@eyelevel.local`,
      preset: PEOPLE[w].preset,
      permissions: [...PEOPLE[w].permissions],
    })}`,
  ] as const;

const ALERTS = [
  { id: 'a-money', rule: 'PROJECT_OVER_ESTIMATE', severity: 'HIGH', entityType: 'Project', entityId: 'p1', message: 'Drone Show Films has spent past its estimate of 190000.', createdAt: new Date(), resolvedAt: null },
  { id: 'a-inv', rule: 'INVOICE_OVERDUE', severity: 'HIGH', entityType: 'Invoice', entityId: 'i1', message: 'Invoice INV/26-27/0144 is overdue.', createdAt: new Date(), resolvedAt: null },
  { id: 'a-load', rule: 'PERSON_UNDERLOADED', severity: 'LOW', entityType: 'User', entityId: 'u1', message: 'Akmal (Founder) is at 20% of a normal load.', createdAt: new Date(), resolvedAt: null },
  { id: 'a-deal', rule: 'PROPOSAL_STALLED', severity: 'MED', entityType: 'Proposal', entityId: 'pr1', message: 'Proposal for Stylori has had no new version for 38 days.', createdAt: new Date(), resolvedAt: null },
  { id: 'a-kit', rule: 'ASSET_OVERDUE', severity: 'MED', entityType: 'Asset', entityId: 'as1', message: 'EL/CAM/001 is 3 days late back.', createdAt: new Date(), resolvedAt: null },
  { id: 'a-co', rule: 'CLIENT_QUIET', severity: 'MED', entityType: 'Company', entityId: 'co1', message: 'Brigade has had no activity in 21 days.', createdAt: new Date(), resolvedAt: null },
  // Two overdue tasks: one the employee is on, one they are not.
  { id: 'a-mine', rule: 'TASK_OVERDUE', severity: 'MED', entityType: 'Task', entityId: 't-mine', message: 'Task "Ad Creatives Batch 1" assigned to Sneha (Designer) is overdue.', createdAt: new Date(), resolvedAt: null },
  { id: 'a-theirs', rule: 'TASK_OVERDUE', severity: 'MED', entityType: 'Task', entityId: 't-theirs', message: 'Task "Colour Grade Pass" assigned to Ramya (Designer) is overdue.', createdAt: new Date(), resolvedAt: null },
];

/** The tasks the employee is actually on. */
const MY_TASK_IDS = ['t-mine'];

beforeEach(() => {
  (prisma.user.findUnique as any).mockImplementation(async ({ where }: any) => {
    const p = Object.entries(PEOPLE).find(([, v]) => v.id === where.id)?.[1];
    if (!p) return null;
    return {
      id: p.id, organizationId: 'org-1', name: 'Somebody', email: 'x@eyelevel.local',
      preset: p.preset, permissions: [...p.permissions], active: true, sessionsValidFrom: null,
    };
  });

  (prisma.task.findMany as any).mockResolvedValue(MY_TASK_IDS.map((id) => ({ id })));

  /*
   * The route now asks for two things at once: the rules this permission set
   * admits, OR a task rule about a task this person is on. The mock has to
   * evaluate that the way the database would, or every assertion below is
   * measuring the mock rather than the route.
   */
  const matches = (where: any) => {
    const clauses: any[] = where?.OR ?? (where?.rule ? [{ rule: where.rule }] : []);
    return ALERTS.filter((a) =>
      clauses.some((c) => {
        if (c.rule?.in && !c.rule.in.includes(a.rule)) return false;
        if (c.entityType && c.entityType !== a.entityType) return false;
        if (c.entityId?.in && !c.entityId.in.includes(a.entityId)) return false;
        return true;
      }),
    );
  };

  (prisma.alert.findMany as any).mockImplementation(async ({ where }: any) => matches(where));
  (prisma.alert.count as any).mockImplementation(async ({ where }: any) => matches(where).length);
  (prisma.alertRead.findMany as any).mockResolvedValue([]);
  (prisma.alertRead.createMany as any).mockResolvedValue({ count: 0 });
  (prisma.alertRead.upsert as any).mockResolvedValue({ id: 'r1' });
});

const rulesFor = async (who: Who) => {
  const res = await request(app).get('/api/notifications').set(...auth(who));
  expect(res.status).toBe(200);
  return res.body.notifications.map((n: any) => n.type);
};

describe('who is told what', () => {
  it('keeps a cost estimate away from somebody without money.figures', async () => {
    // The message names the figure, so the whole alert is the leak — there is
    // no stripping half of "has spent past its estimate of 190000".
    expect(await rulesFor('head')).not.toContain('PROJECT_OVER_ESTIMATE');
    expect(await rulesFor('boss')).toContain('PROJECT_OVER_ESTIMATE');
  });

  it('gives an employee the kit alerts and their own work, and nothing else', async () => {
    // The register is open to everybody, so an overdue lens is too. Invoices,
    // deals and other people's workload are not — but their own overdue task
    // is, which is the whole of the fix below.
    const seen = await rulesFor('employee');
    expect([...new Set(seen)].sort()).toEqual(['ASSET_OVERDUE', 'TASK_OVERDUE']);
  });

  it('does not tell a designer how loaded the founder is', async () => {
    expect(await rulesFor('employee')).not.toContain('PERSON_UNDERLOADED');
    expect(await rulesFor('head')).toContain('PERSON_UNDERLOADED');
  });

  it('keeps the pipeline for the people who sell', async () => {
    // A Head runs the work and has no pipeline.read — the same split the
    // sidebar and the API already enforce everywhere else.
    expect(await rulesFor('head')).not.toContain('PROPOSAL_STALLED');
    expect(await rulesFor('boss')).toContain('PROPOSAL_STALLED');
  });

  it('withholds a rule nobody has claimed rather than showing it', async () => {
    // Failing closed: a new scanner rule stays quiet until somebody decides
    // who it is for.
    await request(app).get('/api/notifications').set(...auth('boss'));
    const asked: string[] = (prisma.alert.findMany as any).mock.calls.at(-1)[0].where.OR[0].rule.in;
    expect(asked).not.toContain('SOME_FUTURE_RULE');
    expect(asked).toContain('ASSET_OVERDUE');
  });
});

describe('read is mine, not the organisation’s', () => {
  it('counts unread against my own reads', async () => {
    await request(app).get('/api/notifications').set(...auth('head'));
    const countCall = (prisma.alert.count as any).mock.calls.at(-1)[0];
    expect(countCall.where.reads).toEqual({ none: { userId: 'usr-head' } });
  });

  it('marks all read for me alone', async () => {
    (prisma.alert.findMany as any).mockResolvedValueOnce([{ id: 'a-kit' }]);
    const res = await request(app).patch('/api/notifications/read-all').set(...auth('employee'));

    expect(res.status).toBe(200);
    // Rows in the join table, not a write to the shared alert. The old version
    // called alert.updateMany here, which is what cleared everybody's badge.
    expect(prisma.alert.updateMany).not.toHaveBeenCalled();
    expect(prisma.alertRead.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [{ alertId: 'a-kit', userId: 'usr-emp' }] }),
    );
  });

  it('refuses to mark an alert this person was never shown', async () => {
    (prisma.alert.findFirst as any).mockResolvedValue({ id: 'a-money', rule: 'PROJECT_OVER_ESTIMATE' });
    const res = await request(app).patch('/api/notifications/a-money/read').set(...auth('employee'));
    expect(res.status).toBe(403);
    expect(prisma.alertRead.upsert).not.toHaveBeenCalled();
  });

  it('404s an alert from another organisation', async () => {
    (prisma.alert.findFirst as any).mockResolvedValue(null);
    const res = await request(app).patch('/api/notifications/whatever/read').set(...auth('boss'));
    expect(res.status).toBe(404);
  });
});

describe('where a notification goes', () => {
  it('sends every alert somewhere real', async () => {
    // The link was `/${entityType.toLowerCase()}s/${id}`, which produced a
    // live page for two of the eight entity types in use — Company became
    // "/companys/…", and Task, Proforma, User, Proposal and Invoice have no
    // detail page at all. Following each one gave a hard 404.
    const REAL = ['/projects/', '/retainers/', '/companies/', '/assets/', '/my-work', '/members', '/money', '/quotations', '/live-work', '/allocations'];
    const res = await request(app).get('/api/notifications').set(...auth('boss'));

    for (const n of res.body.notifications) {
      expect(n.link, `${n.type} link`).toBeTruthy();
      expect(REAL.some((r) => n.link.startsWith(r)), `${n.type} -> ${n.link}`).toBe(true);
    }
  });

  it('labels where each one came from', async () => {
    // The rows carried the sentence and nothing else, so forty-four of them
    // read as one undifferentiated column.
    const res = await request(app).get('/api/notifications').set(...auth('boss'));
    const bySource = Object.fromEntries(
      res.body.notifications.map((n: any) => [n.type, n.source]),
    );
    expect(bySource.PROJECT_OVER_ESTIMATE).toBe('Projects');
    expect(bySource.INVOICE_OVERDUE).toBe('Money');
    expect(bySource.PERSON_UNDERLOADED).toBe('Team');
    expect(bySource.PROPOSAL_STALLED).toBe('Pipeline');
    expect(bySource.ASSET_OVERDUE).toBe('Assets');
    expect(bySource.CLIENT_QUIET).toBe('Clients');
  });

  it('never labels one thing and opens another', async () => {
    // Both come from the entity type, so the label a person reads and the
    // screen they land on cannot drift apart.
    const WHERE: Record<string, string> = {
      Projects: '/projects/',
      Money: '/money',
      Team: '/members',
      Pipeline: '/quotations',
      Assets: '/assets/',
      Clients: '/companies/',
      // A task has no page of its own, so the list that holds it is the
      // useful landing.
      Tasks: '/my-work',
    };
    const res = await request(app).get('/api/notifications').set(...auth('boss'));
    for (const n of res.body.notifications) {
      expect(n.link.startsWith(WHERE[n.source]), `${n.source} -> ${n.link}`).toBe(true);
    }
  });

  it('pluralises a company correctly', async () => {
    const res = await request(app).get('/api/notifications').set(...auth('boss'));
    const co = res.body.notifications.find((n: any) => n.type === 'CLIENT_QUIET');
    expect(co.link).toBe('/companies/co1');
  });
});

describe('your own work reaches you, whatever else is closed', () => {
  /*
   * Six of fourteen people are EMPLOYEE, holding `work.own` and nothing else,
   * so every task rule was gated away from them and their bell was empty by
   * construction — permanently. Meanwhile the scanner was raising nineteen
   * TASK_OVERDUE alerts, one of which read "Task ... assigned to Sneha
   * (Designer) is overdue", and showing it to everybody except Sneha.
   */
  it('tells an employee about their own overdue task', async () => {
    const res = await request(app).get('/api/notifications').set(...auth('employee'));
    const mine = res.body.notifications.find((n: any) => n.id === 'a-mine');
    expect(mine, 'the alert naming this person').toBeTruthy();
    expect(mine.type).toBe('TASK_OVERDUE');
  });

  it('does not tell them about somebody else’s', async () => {
    // The permission was never wrong — another person's overdue task IS a fact
    // about the team. It just never asked whether the task was yours.
    const res = await request(app).get('/api/notifications').set(...auth('employee'));
    expect(res.body.notifications.find((n: any) => n.id === 'a-theirs')).toBeUndefined();
  });

  it('asks only for the tasks it needs, and only when it needs them', async () => {
    (prisma.task.findMany as any).mockClear();
    await request(app).get('/api/notifications').set(...auth('employee'));
    const call = (prisma.task.findMany as any).mock.calls.at(-1)[0];
    expect(call.where.assignees).toEqual({ some: { userId: 'usr-emp' } });
    expect(call.where.deletedAt).toBeNull();
  });

  it('does not run that query for somebody who can see the team anyway', async () => {
    // A Head holds `work.team`, so the rules are already open to them and the
    // extra lookup would buy nothing.
    (prisma.task.findMany as any).mockClear();
    await request(app).get('/api/notifications').set(...auth('head'));
    expect(prisma.task.findMany).not.toHaveBeenCalled();
  });

  it('still gives a Head every task alert, not just their own', async () => {
    const res = await request(app).get('/api/notifications').set(...auth('head'));
    const ids = res.body.notifications.map((n: any) => n.id);
    expect(ids).toContain('a-mine');
    expect(ids).toContain('a-theirs');
  });
});

describe('a notification never offers a door that is locked', () => {
  /*
   * Three rules told somebody about something and then sent them nowhere. A
   * Head and a BD both receive INVOICE_OVERDUE, which lands on /money behind
   * `money.figures` that neither holds; Accounts receives PROJECT_OVER_ESTIMATE,
   * which lands on a project page behind `work.all`.
   *
   * The rule map decides what a person is TOLD. It never asked whether they
   * could reach where it was sending them.
   */
  const linkFor = async (who: Who, rule: string) => {
    const res = await request(app).get('/api/notifications').set(...auth(who));
    return res.body.notifications.find((n: any) => n.type === rule)?.link;
  };

  it('drops the link when the screen behind it is closed', async () => {
    // A Head is told the invoice is overdue — /money needs `money.figures`.
    expect(await linkFor('head', 'INVOICE_OVERDUE')).toBeNull();
  });

  it('keeps the sentence, so the row still says what happened', async () => {
    const res = await request(app).get('/api/notifications').set(...auth('head'));
    const inv = res.body.notifications.find((n: any) => n.type === 'INVOICE_OVERDUE');
    expect(inv.title).toMatch(/overdue/i);
    expect(inv.source).toBe('Money');
  });

  it('keeps the link for somebody who can follow it', async () => {
    expect(await linkFor('boss', 'INVOICE_OVERDUE')).toBe('/money');
  });

  it('leaves the screens open to everybody alone', async () => {
    // /my-work and /assets need nothing, so a task or a lens always opens.
    expect(await linkFor('employee', 'ASSET_OVERDUE')).toBe('/assets/as1');
    expect(await linkFor('employee', 'TASK_OVERDUE')).toBe('/my-work');
  });
});
