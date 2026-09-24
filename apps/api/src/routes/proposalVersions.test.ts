import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { RolePreset } from '@prisma/client';

/**
 * What adding a version does to the stage.
 *
 * The rule this file states elsewhere is "In negotiation is more than one
 * version", but the update was unconditional: every version, including the
 * first, moved the deal to In negotiation.
 *
 * That was harmless while every proposal was CREATED carrying version one, so
 * this endpoint only ever added a second. It stopped being harmless when
 * promoted leads began arriving at Prospect with no versions at all — writing
 * their first proposal jumped them straight past Proposal Sent, which is the
 * stage that version actually represents, and is the one place a quoted figure
 * first appears on the board.
 */

const BD = {
  id: 'usr-bd',
  preset: RolePreset.BD,
  permissions: ['work.own', 'company.read', 'company.write', 'pipeline.read', 'pipeline.write'],
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

let updated: Record<string, unknown>;

beforeEach(() => {
  updated = {};
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
  (prisma.proposalVersion.create as any).mockImplementation(async ({ data }: any) => ({ id: 'v-new', ...data }));
  (prisma.proposal.update as any).mockImplementation(async ({ data }: any) => ((updated = data), { id: 'prop-1', ...data }));
  (prisma.activity.create as any).mockResolvedValue({});
});

/** A deal with `n` versions already on it. */
const dealWith = (n: number) => {
  (prisma.proposal.findFirst as any).mockResolvedValue({
    id: 'prop-1',
    organizationId: 'org-1',
    companyId: 'co-1',
    stage: n === 0 ? 'PROSPECT' : 'PROPOSAL_SENT',
    outcome: null,
    deletedAt: null,
    versions: Array.from({ length: n }, (_, i) => ({ id: `v${i + 1}`, n: i + 1 })),
  });
};

const addVersion = (body: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/proposals/prop-1/versions')
    .set(...auth())
    .send({ value: 250000, scopeSummary: 'Drone show films', ...body });

describe('the stage a new version leaves the deal in', () => {
  it('sends a promoted lead to Proposal Sent, not past it', async () => {
    // The bug: a Prospect writing its first proposal skipped the stage that
    // version represents, and landed in In negotiation having negotiated
    // nothing.
    dealWith(0);
    const res = await addVersion();

    expect(res.status).toBe(201);
    expect(updated.stage).toBe('PROPOSAL_SENT');
  });

  it('moves it to In Negotiation once there is a second version', async () => {
    // A revision IS the negotiation — that is what the stage means.
    dealWith(1);
    const res = await addVersion({ value: 310000, scopeSummary: 'Revised after the call' });

    expect(res.status).toBe(201);
    expect(updated.stage).toBe('IN_NEGOTIATION');
  });

  it('takes the kind on the first version, since nobody chose it yet', async () => {
    /*
     * A promoted lead reaches the board with `kind` defaulted to RETAINER,
     * because outreach has no field for it. The person writing the proposal is
     * the first to actually decide, so the form that writes version one offers
     * the choice and it lands here.
     */
    dealWith(0);
    await addVersion({ kind: 'PROJECT' });
    expect(updated.kind).toBe('PROJECT');
    expect(updated.stage).toBe('PROPOSAL_SENT');
  });

  it('ignores a kind on a revision, so a sent quote cannot be relabelled', async () => {
    // By version two a quote has gone out under one heading or the other, and
    // changing it silently rewrites what the client was told they were buying.
    dealWith(1);
    await addVersion({ kind: 'PROJECT' });
    expect(updated.kind).toBeUndefined();
    expect(updated.stage).toBe('IN_NEGOTIATION');
  });

  it('keeps it in In Negotiation for a third', async () => {
    dealWith(2);
    await addVersion({ value: 290000 });
    expect(updated.stage).toBe('IN_NEGOTIATION');
  });
});
