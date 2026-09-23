import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { RolePreset } from '@prisma/client';

/**
 * The company list, and the figures that used to move when you clicked a tab.
 *
 * Every number on /companies was counted in the browser from the rows this
 * endpoint had just returned — and this endpoint filters. So opening the Client
 * tab left the page holding ten clients and reporting "Prospect 0", "Past 0",
 * "All 10" on an organisation with twenty companies, eight of them prospects.
 * The tabs claimed to be empty while remaining the only way to reach the
 * records they were denying.
 *
 * Two shapes fix it, and they answer different questions:
 *
 *   counts   what each tab WOULD show — follows the search, ignores the tab
 *   summary  the state of the business — follows nothing
 */

const BOSS = {
  id: 'usr-boss',
  preset: RolePreset.MANAGEMENT,
  permissions: ['work.own', 'company.read', 'money.figures', 'setup.admin'],
};
const BD = {
  id: 'usr-bd',
  preset: RolePreset.BD,
  permissions: ['work.own', 'company.read', 'company.write', 'pipeline.read'],
};
/** Runs the work, sells nothing — no `company.read` at all. */
const HEAD = { id: 'usr-head', preset: RolePreset.HEAD, permissions: ['work.own', 'work.all'] };

const auth = (who: typeof BOSS | typeof BD | typeof HEAD) =>
  [
    'Authorization',
    `Bearer ${signJwt({
      userId: who.id,
      organizationId: 'org-1',
      email: 'x@eyelevel.local',
      preset: who.preset,
      permissions: [...who.permissions],
    })}`,
  ] as const;

/** Twenty companies: ten clients, eight prospects, two past. */
const ORG_SPREAD = [
  { status: 'CLIENT', _count: 10 },
  { status: 'PROSPECT', _count: 8 },
  { status: 'PAST', _count: 2 },
];

beforeEach(() => {
  (prisma.user.findUnique as any).mockImplementation(async ({ where }: any) => {
    const who = [BOSS, BD, HEAD].find((p) => p.id === where.id);
    if (!who) return null;
    return {
      id: who.id,
      organizationId: 'org-1',
      name: 'Somebody',
      email: 'x@eyelevel.local',
      preset: who.preset,
      permissions: [...who.permissions],
      active: true,
      sessionsValidFrom: null,
    };
  });

  // The ROWS obey the filter — that part was never broken.
  (prisma.company.findMany as any).mockImplementation(async ({ where }: any) => {
    const status = where.status ?? 'CLIENT';
    return [
      {
        id: 'co-1',
        name: 'Suvai',
        vertical: 'FOOD',
        source: 'REFERRAL',
        city: 'Chennai',
        website: null,
        gstin: null,
        status,
        lostReason: null,
        owner: null,
        people: [],
        retainers: [],
        projects: [],
        proposals: [],
        updatedAt: new Date(),
      },
    ];
  });
  (prisma.company.count as any).mockResolvedValue(1);

  // groupBy is called twice: once with the facet where, once org-wide. Both
  // return the whole spread — the point is that NEITHER is narrowed by status.
  (prisma.company.groupBy as any).mockResolvedValue(ORG_SPREAD);
  (prisma.retainer.aggregate as any).mockResolvedValue({
    _sum: { monthlyValue: 485_000 },
    _count: 6,
  });
  (prisma.outreachEntry.count as any).mockResolvedValue(5);
});

const list = (query = '', who: typeof BOSS | typeof BD | typeof HEAD = BOSS) =>
  request(app)
    .get(`/api/companies${query}`)
    .set(...auth(who));

describe('the tab counts', () => {
  it('does not narrow itself by the tab being looked at', async () => {
    const res = await list('?status=CLIENT');

    expect(res.status).toBe(200);
    // The rows are clients only. The counts are not.
    expect(res.body.companies.every((c: any) => c.status === 'CLIENT')).toBe(true);
    expect(res.body.counts).toEqual({ CLIENT: 10, PROSPECT: 8, PAST: 2, ALL: 20 });
  });

  it('leaves the status out of the query it counts with', async () => {
    await list('?status=PAST&search=suv');

    const calls = (prisma.company.groupBy as any).mock.calls;
    const facetWhere = calls[0][0].where;
    // The search narrows the facets — a tab label should describe the rows
    // under it. The status must not, or every other tab reads zero.
    expect(facetWhere.name).toEqual({ contains: 'suv', mode: 'insensitive' });
    expect(facetWhere.status).toBeUndefined();
  });
});

describe('the summary strip', () => {
  it('reports the whole organisation whatever tab is open', async () => {
    const res = await list('?status=PROSPECT');

    expect(res.body.summary.clients).toBe(10);
    expect(res.body.summary.prospects).toBe(8);
    expect(res.body.summary.total).toBe(20);
  });

  it('keeps the contracted monthly whole', async () => {
    // This fell to ₹0 on the Prospect tab, because it was summed from whatever
    // rows were on screen and no prospect has a retainer. Zero is a claim
    // about the business, and it was false.
    const res = await list('?status=PROSPECT');
    expect(res.body.summary.contractedMonthly).toBe(485_000);
    expect(res.body.summary.retainerCount).toBe(6);
  });

  it('sends null, not zero, to somebody who may not see figures', async () => {
    const res = await list('', BD);
    expect(res.body.summary.contractedMonthly).toBeNull();
  });

  it('counts the outreach list instead of asserting 380', async () => {
    // The page had `outreachCount: 380` written into it as a literal. The real
    // number was 7 rows, 5 of them still waiting.
    const res = await list('');
    expect(res.body.summary.outreachCount).toBe(5);
  });

  it('leaves out the entries that already became companies', async () => {
    // The tile reads "kept out of this list". An entry that has been promoted
    // is IN the list — /outreach hides those rows — so counting all 7 made the
    // two screens disagree with each other.
    await list('');
    const where = (prisma.outreachEntry.count as any).mock.calls.at(-1)[0].where;
    expect(where.promotedCompanyId).toBeNull();
  });
});

describe('who may ask', () => {
  it('still refuses somebody without company.read', async () => {
    const res = await list('', HEAD);
    expect(res.status).toBe(403);
  });
});

/**
 * Importing a file over companies that already exist.
 *
 * `@@unique([organizationId, name])` means an exact repeat is impossible, and
 * the duplicate check does not know that — it reports a repeated name as a
 * SIMILAR name, which "add these anyway" was allowed to wave through. Forcing
 * one threw P2002 inside the transaction: an opaque 500, and since it is ONE
 * transaction, every other row in the file went with it. Somebody re-importing
 * a spreadsheet to pick up three new companies lost all of them and was told
 * "Something went wrong".
 */
describe('re-importing a file whose companies are already here', () => {
  const CSV = ['name,status,city,industry', 'Dinamalar,CLIENT,Chennai,B2B', 'Brand New Co,PROSPECT,Madurai,RETAIL'].join('\n');

  beforeEach(() => {
    (prisma.company.findMany as any).mockResolvedValue([
      { id: 'co-dina', name: 'Dinamalar', people: [] },
    ]);
    (prisma.$transaction as any).mockImplementation(async (fn: any) =>
      fn({
        company: { create: async ({ data }: any) => ({ id: 'co-new', ...data }) },
        activity: { create: async () => ({}) },
      }),
    );
  });

  it('refuses an exact repeat however hard you press, rather than failing the file', async () => {
    const res = await request(app)
      .post('/api/companies/import')
      .set(...auth(BD))
      .send({ csv: CSV, force: true });

    // The whole point: a 200 with a readable outcome, not a 500.
    expect(res.status).toBe(200);
    const dina = res.body.results.find((r: { name: string }) => r.name === 'Dinamalar');
    expect(dina.action).toBe('SKIPPED');
    expect(dina.reason).toMatch(/exactly this name/i);
  });

  it('still imports the rows that are fine', async () => {
    // One row the database would reject must not cost the others theirs.
    const res = await request(app)
      .post('/api/companies/import')
      .set(...auth(BD))
      .send({ csv: CSV, force: true });

    expect(res.body.created).toBe(1);
    const fresh = res.body.results.find((r: { name: string }) => r.name === 'Brand New Co');
    expect(fresh.action).toBe('CREATED');
  });

  it('carries the status from the file, so a client does not arrive as a prospect', async () => {
    // Every row used to land as PROSPECT, so importing a real book of business
    // meant opening each one afterwards and changing it by hand.
    const created: Record<string, unknown>[] = [];
    (prisma.$transaction as any).mockImplementation(async (fn: any) =>
      fn({
        company: {
          create: async ({ data }: any) => {
            created.push(data);
            return { id: 'co-new', ...data };
          },
        },
        activity: { create: async () => ({}) },
      }),
    );

    await request(app)
      .post('/api/companies/import')
      .set(...auth(BD))
      .send({ csv: 'name,status,city\nAcme Co,CLIENT,Chennai' });

    expect(created).toHaveLength(1);
    expect(created[0].status).toBe('CLIENT');
  });
});
