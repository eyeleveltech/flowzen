import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { RolePreset } from '@prisma/client';

/**
 * Removing a company.
 *
 * There was no way to do it at all — no route, no button. A company added by
 * mistake, a typo or a duplicate, stayed for ever. `archivedAt` had been on the
 * model since the beginning and search already excluded archived rows, but
 * nothing ever set it: half a feature with the reading half live.
 *
 * The rule is §16's: nothing is hard deleted by a user. The row and its history
 * stay, and it leaves the lists.
 */

const BD = {
  id: 'usr-bd',
  preset: RolePreset.BD,
  permissions: ['work.own', 'company.read', 'company.write'],
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

let archived: Record<string, unknown> | null;
let deletedProposals: unknown;

const company = (over: Record<string, unknown> = {}) => ({
  id: 'co-1',
  name: 'Acme Interiors',
  status: 'PROSPECT',
  archivedAt: null,
  ...over,
});

/** Nothing on the books unless a test says so. */
const holds = (counts: Partial<Record<'retainer' | 'project' | 'invoice' | 'proforma' | 'proposal', number>> = {}) => {
  (prisma.retainer.count as any).mockResolvedValue(counts.retainer ?? 0);
  (prisma.project.count as any).mockResolvedValue(counts.project ?? 0);
  (prisma.invoice.count as any).mockResolvedValue(counts.invoice ?? 0);
  (prisma.proforma.count as any).mockResolvedValue(counts.proforma ?? 0);
  (prisma.proposal.count as any).mockResolvedValue(counts.proposal ?? 0);
};

beforeEach(() => {
  archived = null;
  deletedProposals = null;
  (prisma.user.findUnique as any).mockResolvedValue({
    id: BD.id,
    organizationId: 'org-1',
    name: 'Varsha',
    email: 'bd@eyelevel.local',
    preset: BD.preset,
    permissions: [...BD.permissions],
    active: true,
    sessionsValidFrom: null,
  });
  (prisma.company.findFirst as any).mockResolvedValue(company());
  holds();
  (prisma.$transaction as any).mockImplementation(async (fn: any) =>
    fn({
      proposal: { deleteMany: vi.fn(async (args: any) => ((deletedProposals = args.where), { count: 1 })) },
      company: { update: vi.fn(async ({ data }: any) => ((archived = data), { id: 'co-1', ...data })) },
      activity: { create: vi.fn(async () => ({})) },
    }),
  );
});

const remove = () => request(app).delete('/api/companies/co-1').set(...auth());

describe('removing a company', () => {
  it('archives it rather than deleting the row', async () => {
    // §16. The history stays; the company leaves the lists.
    const res = await remove();

    expect(res.status).toBe(200);
    expect(archived?.archivedAt).toBeInstanceOf(Date);
  });

  it('takes the placeholder deal with it', async () => {
    /*
     * A promoted lead sits on the board as a proposal with no versions. It is
     * not work — it carries no quote and no value — so it does not block the
     * removal, and leaving it behind would strand a card whose company is gone.
     */
    await remove();
    expect(deletedProposals).toEqual({ companyId: 'co-1', versions: { none: {} } });
  });

  it('refuses when there is real work, and says what', async () => {
    holds({ retainer: 1, invoice: 2 });
    const res = await remove();

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('HAS_WORK');
    expect(res.body.error).toContain('1 retainer');
    expect(res.body.error).toContain('2 invoices');
    // And says what to do instead, rather than leaving them to guess.
    expect(res.body.error).toMatch(/past client/i);
    expect(archived).toBeNull();
  });

  it('counts a quoted proposal as work, but not the empty placeholder', async () => {
    /*
     * The block is on proposals that HAVE versions. Blocking on any proposal
     * would make every prospect undeletable, since promoting one creates the
     * placeholder — the trap the stage before this one fell into.
     */
    holds({ proposal: 1 });
    const res = await remove();

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('1 proposal');

    const where = (prisma.proposal.count as any).mock.calls.at(-1)[0].where;
    expect(where.versions).toEqual({ some: {} });
    expect(where.deletedAt).toBeNull();
  });

  it('will not archive the same company twice', async () => {
    (prisma.company.findFirst as any).mockResolvedValue(company({ archivedAt: new Date() }));
    const res = await remove();

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already been removed/i);
  });

  it('is a 404 for a company in another organisation', async () => {
    // `findFirst` is scoped to the caller's org, so a miss is a miss.
    (prisma.company.findFirst as any).mockResolvedValue(null);
    const res = await remove();
    expect(res.status).toBe(404);
  });
});
