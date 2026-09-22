import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { RolePreset } from '@prisma/client';

/**
 * Correcting and removing the two records that could only ever be created.
 *
 * A proposal could be logged but not un-logged, and a retainer's monthly value
 * — the number MRR, the forecast and every month card are built from — could be
 * typed once and never again. Both gaps are the same shape, so the rules that
 * matter are about what must NOT move: a won or lost proposal is history the
 * win rate counts, and a month that has been closed or billed is a record
 * rather than an intention.
 */

const ADMIN = {
  id: 'usr-admin',
  preset: RolePreset.MANAGEMENT,
  permissions: ['work.own', 'work.all', 'money.status', 'money.figures', 'company.read', 'company.write', 'pipeline.read', 'pipeline.write', 'setup.admin'],
};

const auth = () =>
  [
    'Authorization',
    `Bearer ${signJwt({
      userId: ADMIN.id,
      organizationId: 'org-1',
      email: 'admin@eyelevel.local',
      preset: ADMIN.preset,
      permissions: [...ADMIN.permissions],
    })}`,
  ] as const;

let written: { proposal?: any; retainer?: any; cards?: any; activity?: any };

beforeEach(() => {
  written = {};
  (prisma.user.findUnique as any).mockResolvedValue({
    id: ADMIN.id,
    organizationId: 'org-1',
    name: 'Akmal',
    email: 'admin@eyelevel.local',
    preset: ADMIN.preset,
    permissions: [...ADMIN.permissions],
    active: true,
    sessionsValidFrom: null,
  });
  (prisma.activity.create as any).mockImplementation(async ({ data }: any) => {
    written.activity = data;
    return {};
  });
  (prisma.proposal.update as any).mockImplementation(async ({ data }: any) => {
    written.proposal = data;
    return { id: 'prop-1', ...data };
  });
});

// ── Proposal edit ───────────────────────────────────────────────────────────

const OPEN_PROPOSAL = {
  id: 'prop-1',
  organizationId: 'org-1',
  companyId: 'co-1',
  kind: 'RETAINER',
  ownerId: 'usr-old',
  stage: 'PROPOSAL_SENT',
  outcome: null,
  deletedAt: null,
  company: { name: 'Carlton Hotels' },
};

const editProposal = (body: Record<string, unknown>, proposal: Record<string, unknown> | null = {}) => {
  (prisma.proposal.findFirst as any).mockResolvedValue(proposal === null ? null : { ...OPEN_PROPOSAL, ...proposal });
  (prisma.user.findFirst as any).mockResolvedValue({ id: 'usr-new' });
  return request(app)
    .patch('/api/proposals/prop-1')
    .set(...auth())
    .send(body);
};

describe('editing a proposal', () => {
  it('reassigns the owner', async () => {
    const res = await editProposal({ ownerId: 'usr-new' });
    expect(res.status).toBe(200);
    expect(written.proposal.ownerId).toBe('usr-new');
    expect(written.activity.payload.ownerFrom).toBe('usr-old');
    expect(written.activity.payload.ownerTo).toBe('usr-new');
  });

  it('refuses an owner who is not on the team', async () => {
    (prisma.proposal.findFirst as any).mockResolvedValue(OPEN_PROPOSAL);
    (prisma.user.findFirst as any).mockResolvedValue(null);
    const res = await request(app)
      .patch('/api/proposals/prop-1')
      .set(...auth())
      .send({ ownerId: 'usr-ghost' });
    expect(res.status).toBe(404);
    expect(prisma.proposal.update).not.toHaveBeenCalled();
  });

  it('changes retainer to project while the deal is still open', async () => {
    const res = await editProposal({ kind: 'PROJECT' });
    expect(res.status).toBe(200);
    expect(written.proposal.kind).toBe('PROJECT');
  });

  it('refuses to change the kind once the proposal is won', async () => {
    // Winning is what built the retainer or the project. Relabelling it here
    // would describe work that was never done.
    const res = await editProposal({ kind: 'PROJECT' }, { outcome: 'WON', stage: 'WON' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already closed/i);
    expect(prisma.proposal.update).not.toHaveBeenCalled();
  });

  it('does not write the company, whatever is sent', async () => {
    const res = await editProposal({ ownerId: 'usr-new', companyId: 'co-somebody-else' });
    expect(res.status).toBe(200);
    expect(written.proposal).not.toHaveProperty('companyId');
  });

  it('rejects a request that changes nothing', async () => {
    const res = await editProposal({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nothing to change/i);
  });

  it('writes nothing when the values sent are the ones already there', async () => {
    // `updatedAt` is "days in this stage" on the pipeline board and "no
    // activity in N days" in the daily brief. A save that changed nothing
    // would reset that clock and make a stalled deal look freshly worked.
    const res = await editProposal({ ownerId: OPEN_PROPOSAL.ownerId, kind: OPEN_PROPOSAL.kind });
    expect(res.status).toBe(200);
    expect(prisma.proposal.update).not.toHaveBeenCalled();
    expect(prisma.activity.create).not.toHaveBeenCalled();
  });

  it('does not reset that clock even on a proposal that is already closed', async () => {
    // The kind guard must not fire either — nothing is being changed.
    const res = await editProposal({ kind: 'RETAINER' }, { outcome: 'WON', stage: 'WON' });
    expect(res.status).toBe(200);
    expect(prisma.proposal.update).not.toHaveBeenCalled();
  });

  it('cannot reach a deleted proposal', async () => {
    const res = await editProposal({ ownerId: 'usr-new' }, null);
    expect(res.status).toBe(404);
  });
});

// ── Proposal delete ─────────────────────────────────────────────────────────

const deleteProposal = (proposal: Record<string, unknown> | null = {}, proforma: unknown = null) => {
  (prisma.proposal.findFirst as any).mockResolvedValue(proposal === null ? null : { ...OPEN_PROPOSAL, ...proposal });
  (prisma.proforma.findFirst as any).mockResolvedValue(proforma);
  return request(app)
    .delete('/api/proposals/prop-1')
    .set(...auth());
};

describe('deleting a proposal', () => {
  it('soft deletes one nothing has happened to', async () => {
    const res = await deleteProposal();
    expect(res.status).toBe(200);
    expect(written.proposal.deletedAt).toBeInstanceOf(Date);
    // §16: the row stays. Nothing is ever hard deleted by a user.
    expect(prisma.proposal.delete).not.toHaveBeenCalled();
    expect(written.activity.verb).toBe('proposal_deleted');
  });

  it('refuses a won proposal', async () => {
    // A client was graduated and a project or retainer seeded from it.
    const res = await deleteProposal({ outcome: 'WON', stage: 'WON' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/was won/i);
    expect(prisma.proposal.update).not.toHaveBeenCalled();
  });

  it('refuses a lost proposal', async () => {
    // The win rate counts it. Removing it silently improves a number.
    const res = await deleteProposal({ outcome: 'LOST', stage: 'LOST' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/win rate/i);
    expect(prisma.proposal.update).not.toHaveBeenCalled();
  });

  it('refuses one that already has a proforma against it', async () => {
    const res = await deleteProposal({}, { number: 'EL-PI-26-27-017' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('EL-PI-26-27-017');
    expect(prisma.proposal.update).not.toHaveBeenCalled();
  });

  it('restores one, and only one that was deleted', async () => {
    (prisma.proposal.findFirst as any).mockResolvedValue({ ...OPEN_PROPOSAL, deletedAt: new Date() });
    const res = await request(app)
      .post('/api/proposals/prop-1/restore')
      .set(...auth());
    expect(res.status).toBe(200);
    expect(written.proposal.deletedAt).toBeNull();
    // Scoped to rows that are actually deleted, so restore cannot be used as a
    // no-op write against a live proposal.
    expect((prisma.proposal.findFirst as any).mock.calls[0][0].where.deletedAt).toEqual({ not: null });
  });

  it('lists the trash without touching live proposals', async () => {
    (prisma.proposal.findMany as any).mockResolvedValue([]);
    const res = await request(app)
      .get('/api/proposals/trash')
      .set(...auth());
    expect(res.status).toBe(200);
    expect((prisma.proposal.findMany as any).mock.calls[0][0].where.deletedAt).toEqual({ not: null });
  });
});

describe('proposals that are deleted', () => {
  it('are gone from the pipeline board', async () => {
    (prisma.proposal.findMany as any).mockResolvedValue([]);
    (prisma.proforma.findMany as any).mockResolvedValue([]);
    const res = await request(app)
      .get('/api/proposals/pipeline')
      .set(...auth());
    expect(res.status).toBe(200);
    expect((prisma.proposal.findMany as any).mock.calls[0][0].where.deletedAt).toBeNull();
  });

  it('are gone from the register', async () => {
    (prisma.proposal.findMany as any).mockResolvedValue([]);
    (prisma.proposal.count as any).mockResolvedValue(0);
    const res = await request(app)
      .get('/api/proposals')
      .set(...auth());
    expect(res.status).toBe(200);
    expect((prisma.proposal.findMany as any).mock.calls[0][0].where.deletedAt).toBeNull();
  });

  it('are gone from the funnel, so the win rate does not move', async () => {
    (prisma.proposal.findMany as any).mockResolvedValue([]);
    (prisma.proforma.findMany as any).mockResolvedValue([]);
    const res = await request(app)
      .get('/api/proposals/funnel')
      .set(...auth());
    expect(res.status).toBe(200);
    expect((prisma.proposal.findMany as any).mock.calls[0][0].where.deletedAt).toBeNull();
  });
});

// ── Retainer edit ───────────────────────────────────────────────────────────

const RETAINER = {
  id: 'ret-1',
  organizationId: 'org-1',
  companyId: 'co-1',
  monthlyValue: 50000,
  startDate: new Date('2026-04-01'),
  termMonths: 12,
  renewalDate: new Date('2027-04-01'),
  ownerId: 'usr-old',
  status: 'ACTIVE',
  company: { name: 'Carlton Hotels' },
};

const editRetainer = (body: Record<string, unknown>, retainer: Record<string, unknown> | null = {}) => {
  (prisma.retainer.findFirst as any).mockResolvedValue(retainer === null ? null : { ...RETAINER, ...retainer });
  (prisma.user.findFirst as any).mockResolvedValue({ id: 'usr-new' });
  (prisma.$transaction as any).mockImplementation(async (fn: any) =>
    fn({
      retainer: {
        update: vi.fn(async ({ data }: any) => {
          written.retainer = data;
          return { id: 'ret-1', ...data };
        }),
      },
      monthCard: {
        updateMany: vi.fn(async (args: any) => {
          written.cards = args;
          return { count: 1 };
        }),
      },
      activity: {
        create: vi.fn(async ({ data }: any) => {
          written.activity = data;
          return {};
        }),
      },
    }),
  );
  return request(app)
    .patch('/api/retainers/ret-1')
    .set(...auth())
    .send(body);
};

describe('editing a retainer', () => {
  it('corrects the monthly value and reprices the open month', async () => {
    const res = await editRetainer({ monthlyValue: 60000 });
    expect(res.status).toBe(200);
    expect(written.retainer.monthlyValue).toBe(60000);
    expect(res.body.repricedCards).toBe(1);
  });

  it('never reprices a month that is closed or already invoiced', async () => {
    // A month card snapshots revenue on purpose. A closed month has been
    // worked and a billed one has gone to the client; both are records.
    await editRetainer({ monthlyValue: 60000 });
    expect(written.cards.where).toEqual({ retainerId: 'ret-1', status: 'OPEN', invoiceId: null });
    expect(written.cards.data).toEqual({ revenue: 60000 });
  });

  it('leaves every card alone when the new rate starts next month', async () => {
    const res = await editRetainer({ monthlyValue: 60000, repriceOpenMonth: false });
    expect(res.status).toBe(200);
    expect(written.cards).toBeUndefined();
    expect(res.body.repricedCards).toBe(0);
  });

  it('does not reprice when the value is resent unchanged', async () => {
    const res = await editRetainer({ monthlyValue: 50000 });
    expect(res.status).toBe(200);
    expect(written.cards).toBeUndefined();
  });

  it('writes nothing at all when every value sent is the one already there', async () => {
    const res = await editRetainer({ monthlyValue: 50000, termMonths: 12, ownerId: 'usr-old' });
    expect(res.status).toBe(200);
    expect(res.body.repricedCards).toBe(0);
    expect(written.retainer).toBeUndefined();
    expect(written.activity).toBeUndefined();
  });

  it('refuses to edit a retainer that has been stopped', async () => {
    const res = await editRetainer({ monthlyValue: 60000 }, { status: 'STOPPED' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/been stopped/i);
  });

  it('recomputes the renewal date rather than accepting one', async () => {
    // §8: renewalDate is derived from startDate + termMonths. Two writers for
    // one value means the one that skipped the formula wins.
    const res = await editRetainer({ termMonths: 6, renewalDate: '2099-01-01' });
    expect(res.status).toBe(200);
    expect(written.retainer.renewalDate).toEqual(new Date(2026, 9, 1));
  });

  it('clears the renewal date when the term is removed', async () => {
    const res = await editRetainer({ termMonths: null });
    expect(res.status).toBe(200);
    expect(written.retainer.renewalDate).toBeNull();
  });

  it('refuses a start date later than the first month already worked', async () => {
    (prisma.monthCard.findFirst as any).mockResolvedValue({ month: '2026-04' });
    const res = await editRetainer({ startDate: '2026-07-01' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('2026-04');
  });

  it('accepts a start date that is not later than the first month', async () => {
    (prisma.monthCard.findFirst as any).mockResolvedValue({ month: '2026-04' });
    const res = await editRetainer({ startDate: '2026-03-01' });
    expect(res.status).toBe(200);
    expect(written.retainer.startDate).toEqual(new Date('2026-03-01'));
  });

  it('does not write the company, whatever is sent', async () => {
    const res = await editRetainer({ monthlyValue: 60000, companyId: 'co-somebody-else' });
    expect(res.status).toBe(200);
    expect(written.retainer).not.toHaveProperty('companyId');
  });

  it('does not write the status, so stopping stays the one way to end it', async () => {
    const res = await editRetainer({ monthlyValue: 60000, status: 'STOPPED' });
    expect(res.status).toBe(200);
    expect(written.retainer).not.toHaveProperty('status');
  });

  it('rejects a negative monthly value', async () => {
    const res = await editRetainer({ monthlyValue: -1 });
    expect(res.status).toBe(400);
  });

  it('rejects a request that changes nothing', async () => {
    const res = await editRetainer({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nothing to change/i);
  });
});

// ── Deleted tasks, and who can see them ─────────────────────────────────────

describe('the task trash', () => {
  const asPerson = (id: string, permissions: string[]) => {
    (prisma.user.findUnique as any).mockResolvedValue({
      id,
      organizationId: 'org-1',
      name: 'Somebody',
      email: 'p@eyelevel.local',
      preset: RolePreset.EMPLOYEE,
      permissions,
      active: true,
      sessionsValidFrom: null,
    });
    (prisma.task.findMany as any).mockResolvedValue([]);
    return request(app)
      .get('/api/tasks/trash')
      .set(
        'Authorization',
        `Bearer ${signJwt({ userId: id, organizationId: 'org-1', email: 'p@eyelevel.local', preset: RolePreset.EMPLOYEE, permissions })}`,
      );
  };

  const lastWhere = () => (prisma.task.findMany as any).mock.calls.at(-1)[0].where;

  it('lists only what has been deleted', async () => {
    const res = await asPerson('usr-des', ['work.own']);
    expect(res.status).toBe(200);
    expect(lastWhere().deletedAt).toEqual({ not: null });
  });

  it('shows one person only the tasks they could actually put back', async () => {
    // The restore route refuses anyone but the creator, the assignee or a
    // Head. Listing rows whose Restore button would 403 is worse than not
    // listing them.
    await asPerson('usr-des', ['work.own']);
    expect(lastWhere().OR).toEqual([{ createdById: 'usr-des' }, { assigneeId: 'usr-des' }]);
  });

  it('shows a Head everything, because a Head can restore anything', async () => {
    await asPerson('usr-head', ['work.own', 'work.all']);
    expect(lastWhere().OR).toBeUndefined();
  });

  it('never leaves the caller’s organisation', async () => {
    await asPerson('usr-des', ['work.own']);
    expect(lastWhere().organizationId).toBe('org-1');
  });

  it('is not read as a task id by the routes below it', async () => {
    // `/trash` is a GET and the id routes are PATCH/DELETE/POST, but the list
    // route is a GET too — so this pins that asking for the trash does not
    // return the whole task register.
    const res = await asPerson('usr-des', ['work.own']);
    expect(res.status).toBe(200);
    expect(lastWhere().deletedAt).toEqual({ not: null });
  });
});
