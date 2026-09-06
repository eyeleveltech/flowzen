import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { RolePreset } from '@prisma/client';

/**
 * The outreach list, and the rows it was carrying but never showing.
 *
 * An entry that has been promoted is a Company now; it belongs on /companies,
 * and this screen has always hidden it. But it hid it in the BROWSER, after
 * the fetch, which had three consequences:
 *
 *   - `meta.total` counted rows nobody would ever see, so the list's own
 *     "N more rows" footer could only ever say zero;
 *   - the paging maths could never line up, on the one list in the app that
 *     genuinely arrives by the hundred;
 *   - the Companies screen's outreach tile, which counts this list, disagreed
 *     with the list itself — 7 against 5.
 */

const BD = {
  id: 'usr-bd',
  preset: RolePreset.BD,
  permissions: ['work.own', 'company.read', 'company.write', 'pipeline.read'],
};

const auth = () =>
  [
    'Authorization',
    `Bearer ${signJwt({
      userId: BD.id,
      organizationId: 'org-1',
      email: 'bd@eyelevel.local',
      preset: BD.preset,
      permissions: [...BD.permissions],
    })}`,
  ] as const;

beforeEach(() => {
  (prisma.user.findUnique as any).mockResolvedValue({
    id: BD.id,
    organizationId: 'org-1',
    name: 'Tanuja',
    email: 'bd@eyelevel.local',
    preset: BD.preset,
    permissions: [...BD.permissions],
    active: true,
    sessionsValidFrom: null,
  });
  (prisma.outreachEntry.findMany as any).mockResolvedValue([]);
  (prisma.outreachEntry.count as any).mockResolvedValue(0);
  (prisma.outreachEntry.groupBy as any).mockResolvedValue([
    { status: 'NOT_CONTACTED', _count: 1 },
    { status: 'CONTACTED', _count: 2 },
    { status: 'DEAD', _count: 1 },
  ]);
});

describe('which rows the list carries', () => {
  it('leaves out entries that already became companies', async () => {
    const res = await request(app).get('/api/outreach').set(...auth());

    expect(res.status).toBe(200);
    const where = (prisma.outreachEntry.findMany as any).mock.calls.at(-1)[0].where;
    expect(where.promotedCompanyId).toBeNull();
  });

  it('counts the same rows it returns', async () => {
    // The count and the list have to agree, or the footer lies about how much
    // is left. Both take the same `where`.
    await request(app).get('/api/outreach').set(...auth());

    const listWhere = (prisma.outreachEntry.findMany as any).mock.calls.at(-1)[0].where;
    const countWhere = (prisma.outreachEntry.count as any).mock.calls.at(-1)[0].where;
    expect(countWhere).toEqual(listWhere);
  });

  it('brings the promoted ones back for an export that wants the whole history', async () => {
    await request(app).get('/api/outreach?includePromoted=true').set(...auth());

    const where = (prisma.outreachEntry.findMany as any).mock.calls.at(-1)[0].where;
    expect(where.promotedCompanyId).toBeUndefined();
  });

  it('still narrows by status on top of that', async () => {
    await request(app).get('/api/outreach?status=REPLIED').set(...auth());

    const where = (prisma.outreachEntry.findMany as any).mock.calls.at(-1)[0].where;
    expect(where.status).toBe('REPLIED');
    expect(where.promotedCompanyId).toBeNull();
  });
});

describe('the order the list comes back in', () => {
  it('sorts newest first, with a tiebreak that survives an edit', async () => {
    /*
     * `importedAt` on its own is not an order. A scrape is imported in one
     * statement, so every row in it carries the same timestamp to the
     * millisecond — six of the seven rows in the live database share
     * 2026-09-02T05:51:12.647Z — and a sort with no tiebreak lets Postgres
     * return those six in whatever order the heap happens to hold them.
     *
     * Changing a row rewrites it at the end of that heap. Setting Chennai
     * Silks to Dead moved it from second in the list to last, and it stayed
     * last after the status was put back: the list quietly reshuffled itself
     * every time anybody touched it.
     *
     * `id` descending is the tiebreak because a cuid carries its creation time
     * in its prefix, so it agrees with "newest first" and, being unique, makes
     * the order total.
     */
    await request(app).get('/api/outreach').set(...auth());

    const { orderBy } = (prisma.outreachEntry.findMany as any).mock.calls.at(-1)[0];
    expect(Array.isArray(orderBy), 'a single orderBy is a near-tie, not an order').toBe(true);
    expect(orderBy[0]).toEqual({ importedAt: 'desc' });
    expect(orderBy.at(-1)).toEqual({ id: 'desc' });
  });
});

describe('the numbers on the status chips', () => {
  it('counts every status, not just the one being filtered to', async () => {
    /*
     * A count taken after its own filter reports the number you already
     * picked. Ask for Contacted and a naive count gives Contacted 2, Not
     * contacted 0, Dead 0 — three chips claiming the list is empty while the
     * rows are sitting right there behind them. It is the same fault the
     * Companies tabs had, in a smaller frame.
     *
     * So the facet drops `status` and keeps everything else: it answers "how
     * many would I get if I pressed this", which is the only question a
     * number on a filter chip is ever asked.
     */
    const res = await request(app).get('/api/outreach?status=CONTACTED').set(...auth());

    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({ ALL: 4, NOT_CONTACTED: 1, CONTACTED: 2, REPLIED: 0, DEAD: 1 });

    const facetWhere = (prisma.outreachEntry.groupBy as any).mock.calls.at(-1)[0].where;
    expect(facetWhere.status, 'the facet must not filter by the thing it is counting').toBeUndefined();
    expect(facetWhere.promotedCompanyId, 'but it still excludes promoted rows').toBeNull();
  });

  it('keeps the banner off the filters entirely', async () => {
    /*
     * "N scraped names nobody has spoken to" is a fact about the list, not
     * about the chip that happens to be pressed. Searching for one name must
     * not rewrite it to "1 scraped name".
     */
    (prisma.outreachEntry.count as any)
      .mockResolvedValueOnce(1)   // the filtered total
      .mockResolvedValueOnce(7);  // every cold name

    const res = await request(app).get('/api/outreach?search=prestige').set(...auth());

    expect(res.body.meta.total).toBe(1);
    expect(res.body.summary.cold).toBe(7);

    const coldWhere = (prisma.outreachEntry.count as any).mock.calls.at(-1)[0].where;
    expect(coldWhere.name, 'the banner does not follow the search').toBeUndefined();
  });
});
