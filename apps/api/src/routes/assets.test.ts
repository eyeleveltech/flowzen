import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { evaluateAgencyHealthRules } from '../workers/scanner.cron.js';
import { RolePreset } from '@prisma/client';

/**
 * The asset register's two gates, and the invariant underneath them.
 *
 * ─── Why the permission tests are so repetitive ─────────────────────────────
 *
 * `money.figures` and `asset.manage` are INDEPENDENT, and the temptation when
 * writing this router was a single `canDoAssetStuff` boolean. Accounts is the
 * case that breaks it: they see every price and may not issue a lens. A head
 * granted `asset.manage` by hand is the case that breaks it in the other
 * direction — they hand gear out all day and never learn what it cost.
 *
 * So each preset is asserted against each gate separately. A matrix that only
 * checked "can this person touch assets at all" would pass with the two keys
 * collapsed into one, which is exactly the bug worth catching.
 */

const PEOPLE = {
  boss: {
    id: 'usr-boss',
    name: 'Akmal',
    preset: RolePreset.MANAGEMENT,
    permissions: ['work.own', 'work.team', 'work.all', 'money.figures', 'setup.admin', 'asset.manage'],
  },
  accounts: {
    id: 'usr-accounts',
    name: 'Priya',
    preset: RolePreset.ACCOUNTS,
    // Sees every price. Cannot hand anything over.
    permissions: ['work.own', 'company.read', 'money.status', 'money.figures', 'cost.enter'],
  },
  head: {
    id: 'usr-head',
    name: 'Janani',
    preset: RolePreset.HEAD,
    permissions: ['work.own', 'work.team', 'work.all', 'money.status', 'cost.enter'],
  },
  studioManager: {
    id: 'usr-studio',
    name: 'Ravi',
    preset: RolePreset.HEAD,
    // The per-user escape hatch: one extra switch, no preset change.
    permissions: ['work.own', 'work.team', 'work.all', 'money.status', 'cost.enter', 'asset.manage'],
  },
  employee: {
    id: 'usr-emp',
    name: 'Dave',
    preset: RolePreset.EMPLOYEE,
    permissions: ['work.own'],
  },
  bd: {
    id: 'usr-bd',
    name: 'Sana',
    preset: RolePreset.BD,
    permissions: ['work.own', 'company.read', 'company.write', 'pipeline.read', 'pipeline.write', 'money.status'],
  },
} as const;

type PersonKey = keyof typeof PEOPLE;

const tokenFor = (key: PersonKey) =>
  signJwt({
    userId: PEOPLE[key].id,
    organizationId: 'org-1',
    email: `${key}@eyelevel.local`,
    preset: PEOPLE[key].preset,
    permissions: [...PEOPLE[key].permissions],
  });

const auth = (key: PersonKey) => ['Authorization', `Bearer ${tokenFor(key)}`] as const;

/** A camera, mid-life, in the cupboard. */
const CAMERA = {
  id: 'ast-1',
  organizationId: 'org-1',
  tag: 'EL/CAM/001',
  name: 'Sony A7 IV',
  category: 'CAMERA_BODY',
  make: 'Sony',
  model: 'A7 IV',
  serialNumber: 'SN-1',
  status: 'IN_STOCK',
  condition: 'GOOD',
  bookable: true,
  costId: null,
  purchasePrice: 240_000,
  purchasedAt: new Date('2026-04-01'),
  vendor: 'Foto Centre',
  invoiceNumber: null,
  usefulLifeMonths: 60,
  salvageValue: 40_000,
  disposedAt: null,
  disposalValue: null,
  disposalNote: null,
  warrantyUntil: null,
  insuredUntil: null,
  billUrl: null,
  photoUrl: null,
  notes: null,
  currentHolderId: null,
  currentHolder: null,
  deletedAt: null,
  createdAt: new Date('2026-04-01'),
  updatedAt: new Date('2026-04-01'),
};

beforeEach(() => {
  (prisma.user.findUnique as any).mockImplementation(async ({ where }: any) => {
    const person = Object.values(PEOPLE).find((p) => p.id === where.id);
    if (!person) return null;
    return {
      id: person.id,
      organizationId: 'org-1',
      name: person.name,
      email: 'x@eyelevel.local',
      preset: person.preset,
      permissions: [...person.permissions],
      active: true,
      sessionsValidFrom: null,
    };
  });
  (prisma.activity.create as any).mockResolvedValue({ id: 'act-1' });
  // The tab counts, which the list now takes from the register rather than
  // from the rows it just filtered. One camera, in stock.
  (prisma.asset.groupBy as any).mockResolvedValue([{ status: 'IN_STOCK', _count: 1 }]);
});

describe('reading the catalogue', () => {
  beforeEach(() => {
    (prisma.asset.findMany as any).mockResolvedValue([CAMERA]);
    (prisma.asset.count as any).mockResolvedValue(1);
    (prisma.assetMovement.findMany as any).mockResolvedValue([]);
  });

  it('counts the tabs from the register, not from the rows it just filtered', async () => {
    // Opening "In repair" puts status=IN_REPAIR on the fetch. The tab row used
    // to count what came back, so All reported the repair count and Retired
    // reported zero — the same defect /companies had, in a screen where the
    // tabs are the only way to reach the other statuses.
    (prisma.asset.groupBy as any).mockResolvedValue([
      { status: 'IN_STOCK', _count: 12 },
      { status: 'BOOKED_OUT', _count: 3 },
      { status: 'IN_REPAIR', _count: 2 },
      { status: 'RETIRED', _count: 4 },
    ]);

    const res = await request(app).get('/api/assets?status=IN_REPAIR').set(...auth('boss'));

    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({ all: 17, out: 3, repair: 2, retired: 4 });

    // And the query it counted with left the status out.
    const facetWhere = (prisma.asset.groupBy as any).mock.calls.at(-1)[0].where;
    expect(facetWhere.status).toBeUndefined();
  });

  it('lets a category narrow the tab counts, because that is a filter and not a tab', async () => {
    await request(app).get('/api/assets?category=CAMERA_BODY&status=IN_REPAIR').set(...auth('boss'));
    const facetWhere = (prisma.asset.groupBy as any).mock.calls.at(-1)[0].where;
    expect(facetWhere.category).toBe('CAMERA_BODY');
    expect(facetWhere.status).toBeUndefined();
  });

  it.each<PersonKey>(['employee', 'head', 'bd', 'accounts', 'boss'])(
    'is open to %s — nobody needs a permission to know where the kit is',
    async (who) => {
      const res = await request(app).get('/api/assets').set(...auth(who));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].tag).toBe('EL/CAM/001');
    },
  );

  it.each<PersonKey>(['employee', 'head', 'bd'])(
    'sends %s no price at all — the key is absent, not null',
    async (who) => {
      const res = await request(app).get('/api/assets').set(...auth(who));
      expect(res.body.data[0]).not.toHaveProperty('purchasePrice');
      expect(res.body.data[0]).not.toHaveProperty('bookValue');
      expect(res.body.data[0]).not.toHaveProperty('salvageValue');
      // But they still learn what they need to: where it is, and whose it is.
      expect(res.body.data[0].status).toBe('IN_STOCK');
    },
  );

  it.each<PersonKey>(['accounts', 'boss'])('sends %s the money, having money.figures', async (who) => {
    const res = await request(app).get('/api/assets').set(...auth(who));
    expect(res.body.data[0].purchasePrice).toBe(240_000);
    expect(res.body.data[0].bookValue).toBeGreaterThan(40_000);
  });

  it('tells the client which buttons to render', async () => {
    const accounts = await request(app).get('/api/assets').set(...auth('accounts'));
    expect(accounts.body.access).toEqual({ canManage: false, canSeeFigures: true });

    const studio = await request(app).get('/api/assets').set(...auth('studioManager'));
    expect(studio.body.access).toEqual({ canManage: true, canSeeFigures: false });
  });
});

describe('the out-now board', () => {
  it('is open to everybody, and marks the late ones', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    (prisma.assetMovement.findMany as any).mockResolvedValue([
      {
        id: 'mv-1',
        kind: 'BOOKING',
        dueAt: twoDaysAgo,
        returnedAt: null,
        asset: { id: 'ast-1', tag: 'EL/CAM/001', name: 'Sony A7 IV', category: 'CAMERA_BODY' },
        user: { id: 'usr-emp', name: 'Dave', active: true },
        issuedBy: { id: 'usr-boss', name: 'Akmal' },
        project: null,
      },
    ]);

    const res = await request(app).get('/api/assets/out-now').set(...auth('employee'));
    expect(res.status).toBe(200);
    expect(res.body.data[0].overdue).toBe(true);
    expect(res.body.data[0].daysOverdue).toBe(2);
  });
});

describe('handing gear over needs asset.manage', () => {
  const CHECKOUT = { userId: 'usr-emp', dueAt: '2026-09-10' };

  /*
   * HEAD used to be in this list, and that was the bug rather than the rule.
   *
   * `asset.manage` gates thirteen endpoints and sat in no preset at all, so
   * 0 of 14 real people held it: the only people who could move a piece of kit
   * were the two with `setup.admin` and its master bypass. Everybody else got
   * the ASSET_OVERDUE alert — deliberately ungated, because a designer needs to
   * know the lens is late back — and no way to act on it.
   *
   * A Head runs a department and hands out its gear, so the preset now carries
   * it. Nobody else does: selling and bookkeeping are not reasons to sign a
   * camera out.
   */
  it.each<PersonKey>(['employee', 'bd', 'accounts'])(
    'refuses %s a checkout',
    async (who) => {
      const res = await request(app).post('/api/assets/ast-1/checkout').set(...auth(who)).send(CHECKOUT);
      expect(res.status).toBe(403);
    },
  );

  it.each<PersonKey>(['employee', 'bd', 'accounts'])('refuses %s an assign', async (who) => {
    const res = await request(app)
      .post('/api/assets/ast-1/assign')
      .set(...auth(who))
      .send({ userId: 'usr-emp' });
    expect(res.status).toBe(403);
  });

  it.each<PersonKey>(['employee', 'bd', 'accounts'])('refuses %s a retire', async (who) => {
    const res = await request(app)
      .post('/api/assets/ast-1/retire')
      .set(...auth(who))
      .send({ outcome: 'RETIRED' });
    expect(res.status).toBe(403);
  });

  it('lets a Head hand kit over, because that is their department’s gear', async () => {
    mockOpenMovement(null);
    const res = await request(app).post('/api/assets/ast-1/checkout').set(...auth('head')).send(CHECKOUT);
    expect(res.status).toBe(201);
  });

  it('lets management through', async () => {
    mockOpenMovement(null);
    const res = await request(app).post('/api/assets/ast-1/checkout').set(...auth('boss')).send(CHECKOUT);
    expect(res.status).toBe(201);
  });

  it('still lets somebody granted asset.manage per-user through', async () => {
    // Effective permissions are the union of the preset and the stored ones,
    // so granting it to one person outside HEAD keeps working.
    mockOpenMovement(null);
    const res = await request(app)
      .post('/api/assets/ast-1/checkout')
      .set(...auth('studioManager'))
      .send(CHECKOUT);
    expect(res.status).toBe(201);
  });

  it('still keeps prices from that studio manager — the gates are independent', async () => {
    (prisma.asset.findMany as any).mockResolvedValue([CAMERA]);
    (prisma.asset.count as any).mockResolvedValue(1);
    (prisma.assetMovement.findMany as any).mockResolvedValue([]);
    const res = await request(app).get('/api/assets').set(...auth('studioManager'));
    expect(res.body.data[0]).not.toHaveProperty('purchasePrice');
  });
});

/**
 * Stand up a transaction whose `assetMovement.findFirst` answers with
 * `existing` — which is what "is it already out?" reads inside the commit.
 */
function mockOpenMovement(existing: unknown, opts: { createThrows?: boolean } = {}) {
  const assetUpdate = vi.fn(async ({ data }: any) => ({ ...CAMERA, ...data }));
  const movementCreate = vi.fn(async ({ data }: any) => {
    if (opts.createThrows) throw new Error('write failed');
    return { id: 'mv-new', ...data };
  });

  (prisma.$transaction as any).mockImplementation(async (cb: any) =>
    cb({
      asset: { findFirst: async () => CAMERA, update: assetUpdate },
      user: { findFirst: async () => ({ id: 'usr-emp' }) },
      assetMovement: {
        findFirst: async () => existing,
        create: movementCreate,
        update: async ({ data }: any) => ({ id: 'mv-1', ...data }),
      },
    }),
  );

  return { assetUpdate, movementCreate };
}

describe('the one-open-movement invariant', () => {
  it('refuses to hand out something already out, with a 409 and a code', async () => {
    mockOpenMovement({ id: 'mv-existing', userId: 'usr-head', returnedAt: null, kind: 'BOOKING' });

    const res = await request(app)
      .post('/api/assets/ast-1/assign')
      .set(...auth('boss'))
      .send({ userId: 'usr-emp' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_OUT');
    expect(res.body.error).toContain('EL/CAM/001');
  });

  it('holds when two people check the same camera out at once', async () => {
    // The second call reads the movement the FIRST one just wrote, because the
    // check happens inside the transaction rather than before it. Checking
    // first and trusting the answer is exactly the race this proves is closed.
    let openRow: unknown = null;
    (prisma.$transaction as any).mockImplementation(async (cb: any) =>
      cb({
        asset: { findFirst: async () => CAMERA, update: async ({ data }: any) => ({ ...CAMERA, ...data }) },
        user: { findFirst: async () => ({ id: 'usr-emp' }) },
        assetMovement: {
          findFirst: async () => openRow,
          create: async ({ data }: any) => {
            openRow = { id: 'mv-first', ...data };
            return openRow;
          },
        },
      }),
    );

    const body = { userId: 'usr-emp', dueAt: '2026-09-10' };
    const first = await request(app).post('/api/assets/ast-1/checkout').set(...auth('boss')).send(body);
    const second = await request(app).post('/api/assets/ast-1/checkout').set(...auth('boss')).send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('ALREADY_OUT');
  });

  it('refuses a check-in when nothing is out', async () => {
    mockOpenMovement(null);
    const res = await request(app)
      .post('/api/assets/ast-1/return')
      .set(...auth('boss'))
      .send({ conditionIn: 'GOOD' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NOT_OUT');
  });
});

describe('the movement transaction', () => {
  it('never touches the asset when the movement write fails', async () => {
    // Asset.status and currentHolderId are denormalised copies of what the
    // movement says. If the movement does not land and the asset does, the
    // register claims somebody has a camera that was never issued to them.
    const { assetUpdate } = mockOpenMovement(null, { createThrows: true });

    const res = await request(app)
      .post('/api/assets/ast-1/assign')
      .set(...auth('boss'))
      .send({ userId: 'usr-emp' });

    expect(res.status).toBe(500);
    expect(assetUpdate).not.toHaveBeenCalled();
  });

  it('sends damaged kit to IN_REPAIR rather than back on the shelf', async () => {
    // The most useful line in the whole service: the alternative is a register
    // that offers a free lens to the next shoot and a shoot that finds out.
    const { assetUpdate } = mockOpenMovement({ id: 'mv-1', returnedAt: null, notes: null });

    const res = await request(app)
      .post('/api/assets/ast-1/return')
      .set(...auth('boss'))
      .send({ conditionIn: 'DAMAGED' });

    expect(res.status).toBe(200);
    expect(assetUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'IN_REPAIR' }) }),
    );
  });
});

describe('retiring', () => {
  it('is refused while somebody still has it', async () => {
    (prisma.asset.findFirst as any).mockResolvedValue(CAMERA);
    (prisma.assetMovement.findFirst as any).mockResolvedValue({ id: 'mv-1', returnedAt: null });

    const res = await request(app)
      .post('/api/assets/ast-1/retire')
      .set(...auth('boss'))
      .send({ outcome: 'RETIRED' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ASSET_STILL_OUT');
  });
});

describe('availability', () => {
  it('keeps an OVERDUE open booking out of the free list', () => {
    // The case an overlap test gets wrong, and the reason there is no overlap
    // test any more. A camera due back yesterday and still out does not
    // overlap next Friday by any calendar arithmetic, and it is still not in
    // the cupboard on Friday.
    const nextFriday = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    (prisma.asset.findMany as any).mockResolvedValue([{ ...CAMERA, status: 'BOOKED_OUT' }]);
    (prisma.assetMovement.findMany as any).mockResolvedValue([
      {
        assetId: 'ast-1',
        outAt: new Date(Date.now() - 10 * 86_400_000),
        dueAt: new Date(Date.now() - 86_400_000), // yesterday
        user: { id: 'usr-emp', name: 'Dave' },
      },
    ]);

    return request(app)
      .get(`/api/assets/availability?from=${nextFriday}&to=${nextFriday}`)
      .set(...auth('employee'))
      .then((res) => {
        expect(res.status).toBe(200);
        expect(res.body.data[0].available).toBe(false);
        expect(res.body.data[0].busyWith.name).toBe('Dave');
        // It is *supposed* to be back before then — worth saying, and still
        // not the same as being available.
        expect(res.body.data[0].dueBackBeforeWindow).toBe(true);
      });
  });

  it('offers something nobody has taken', async () => {
    (prisma.asset.findMany as any).mockResolvedValue([CAMERA]);
    (prisma.assetMovement.findMany as any).mockResolvedValue([]);

    const res = await request(app).get('/api/assets/availability').set(...auth('employee'));
    expect(res.body.data[0].available).toBe(true);
    expect(res.body.data[0].busyUntil).toBeNull();
  });
});

describe('the FY register', () => {
  it('needs BOTH money.figures and asset.manage', async () => {
    // Accounts has the money key and not the asset one.
    const accounts = await request(app).get('/api/assets/register').set(...auth('accounts'));
    expect(accounts.status).toBe(403);

    // The studio manager has the asset key and not the money one.
    const studio = await request(app).get('/api/assets/register').set(...auth('studioManager'));
    expect(studio.status).toBe(403);
  });

  it('gives management the schedule, with the year read off the org setting', async () => {
    (prisma.organization.findUnique as any).mockResolvedValue({ financialYearStart: 4 });
    (prisma.asset.findMany as any).mockResolvedValue([
      { ...CAMERA, purchasedAt: new Date('2026-10-01') },
    ]);

    const res = await request(app).get('/api/assets/register?fy=2026-27').set(...auth('boss'));
    expect(res.status).toBe(200);
    expect(res.body.data.fy).toBe('2026-27');
    // Bought in October, so six months of the April-to-April year.
    expect(res.body.data.rows[0].openingWdv).toBe(0);
    expect(Math.round(res.body.data.rows[0].depreciationForYear)).toBe(20_000);
  });
});

describe('the offboarding gate', () => {
  it('refuses to switch somebody off while they are holding kit, and says what', async () => {
    (prisma.user.findFirst as any).mockResolvedValue({
      id: 'usr-emp',
      name: 'Dave',
      organizationId: 'org-1',
      active: true,
    });
    (prisma.asset.findMany as any).mockResolvedValue([
      { ...CAMERA, currentHolderId: 'usr-emp' },
    ]);

    const res = await request(app)
      .patch('/api/users/usr-emp')
      .set(...auth('boss'))
      .send({ active: false });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ASSETS_STILL_HELD');
    expect(res.body.data.assets[0].tag).toBe('EL/CAM/001');
    expect(res.body.data.totalBookValue).toBeGreaterThan(0);
  });

  it('goes through anyway on force — people do leave with a laptop', async () => {
    (prisma.user.findFirst as any).mockResolvedValue({
      id: 'usr-emp',
      name: 'Dave',
      organizationId: 'org-1',
      active: true,
    });
    (prisma.asset.findMany as any).mockResolvedValue([{ ...CAMERA, currentHolderId: 'usr-emp' }]);
    (prisma.user.update as any).mockResolvedValue({
      id: 'usr-emp',
      name: 'Dave',
      dept: 'Design',
      preset: RolePreset.EMPLOYEE,
      permissions: [],
      monthlyCost: 0,
    });

    const res = await request(app)
      .patch('/api/users/usr-emp')
      .set(...auth('boss'))
      .send({ active: false, force: true });

    expect(res.status).toBe(200);
  });
});

describe('the asset health rules', () => {
  /** Everything the evaluator queries before it reaches the asset rules. */
  function quietenEveryOtherRule() {
    (prisma.proposal.findMany as any).mockResolvedValue([]);
    (prisma.proforma.findMany as any).mockResolvedValue([]);
    (prisma.retainer.findMany as any).mockResolvedValue([]);
    (prisma.task.findMany as any).mockResolvedValue([]);
    (prisma.task.findFirst as any).mockResolvedValue(null);
    (prisma.task.groupBy as any).mockResolvedValue([]);
    (prisma.invoice.findMany as any).mockResolvedValue([]);
    (prisma.peopleAllocation.groupBy as any).mockResolvedValue([]);
    (prisma.peopleAllocation.count as any).mockResolvedValue(0);
    (prisma.project.findMany as any).mockResolvedValue([]);
    (prisma.user.findMany as any).mockResolvedValue([]);
    (prisma.company.findMany as any).mockResolvedValue([]);
    (prisma.monthCard.findMany as any).mockResolvedValue([]);
    (prisma.asset.findMany as any).mockResolvedValue([]);
    (prisma.assetMaintenance.findMany as any).mockResolvedValue([]);
    (prisma.assetMovement.findMany as any).mockResolvedValue([]);
  }

  const overdueBooking = (daysLate: number) => ({
    id: 'mv-late',
    kind: 'BOOKING',
    returnedAt: null,
    dueAt: new Date(Date.now() - daysLate * 86_400_000),
    asset: { id: 'ast-1', tag: 'EL/CAM/001', name: 'Sony A7 IV' },
    user: { name: 'Dave' },
  });

  it('raises ASSET_OVERDUE at MED one day late', async () => {
    quietenEveryOtherRule();
    (prisma.assetMovement.findMany as any).mockResolvedValue([overdueBooking(1)]);

    const alerts = await evaluateAgencyHealthRules('org-1');
    const overdue = alerts.find((a) => a.rule === 'ASSET_OVERDUE');
    expect(overdue?.severity).toBe('MED');
    expect(overdue?.entityType).toBe('Asset');
  });

  it('escalates it to HIGH on the third day', async () => {
    quietenEveryOtherRule();
    (prisma.assetMovement.findMany as any).mockResolvedValue([overdueBooking(3)]);

    const alerts = await evaluateAgencyHealthRules('org-1');
    expect(alerts.find((a) => a.rule === 'ASSET_OVERDUE')?.severity).toBe('HIGH');
  });

  it('raises ASSET_HELD_BY_INACTIVE_USER when the holder has left', async () => {
    quietenEveryOtherRule();
    (prisma.asset.findMany as any).mockImplementation(async ({ where }: any) =>
      where?.currentHolder?.active === false
        ? [{ ...CAMERA, currentHolderId: 'usr-gone', currentHolder: { name: 'Ex-employee' } }]
        : [],
    );

    const alerts = await evaluateAgencyHealthRules('org-1');
    const stranded = alerts.find((a) => a.rule === 'ASSET_HELD_BY_INACTIVE_USER');
    expect(stranded?.severity).toBe('HIGH');
    expect(stranded?.message).toContain('Ex-employee');
  });

  it('raises ASSET_WARRANTY_EXPIRING quietly, as a LOW', async () => {
    quietenEveryOtherRule();
    (prisma.asset.findMany as any).mockImplementation(async ({ where }: any) =>
      where?.warrantyUntil
        ? [{ id: 'ast-1', tag: 'EL/LAP/002', name: 'MacBook Pro', warrantyUntil: new Date(Date.now() + 10 * 86_400_000) }]
        : [],
    );

    const alerts = await evaluateAgencyHealthRules('org-1');
    expect(alerts.find((a) => a.rule === 'ASSET_WARRANTY_EXPIRING')?.severity).toBe('LOW');
  });
});
