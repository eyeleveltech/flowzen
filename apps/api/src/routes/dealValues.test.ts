import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { RolePreset } from '@prisma/client';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';

/**
 * What a deal is worth is Management's (Founder, 19 Oct 2026).
 *
 * BD run the pipeline without `money.figures`. The board, the Proposals list
 * and its CSV, and the trash all printed every deal's quoted figure to them;
 * now each sends null, and a value they cannot see they cannot change.
 */

const BD = {
  id: 'usr-bd',
  organizationId: 'org-1',
  name: 'Varsha',
  email: 'bd@x',
  preset: RolePreset.BD,
  permissions: ['work.own', 'company.read', 'company.write', 'pipeline.read', 'pipeline.write', 'money.status'],
  active: true,
  sessionsValidFrom: null,
};
const MGMT = { ...BD, id: 'usr-akmal', name: 'Akmal', preset: RolePreset.MANAGEMENT, permissions: [] as string[] };
const tokenFor = (u: { id: string; email: string; preset: RolePreset; permissions: string[] }) =>
  `Bearer ${signJwt({ userId: u.id, organizationId: 'org-1', email: u.email, preset: u.preset, permissions: u.permissions } as never)}`;
const p = prisma as any;

const deal = (over: Record<string, unknown> = {}) => ({
  id: 'prop-1',
  organizationId: 'org-1',
  companyId: 'co-1',
  ownerId: 'usr-bd',
  kind: 'RETAINER',
  stage: 'IN_NEGOTIATION',
  outcome: null,
  deletedAt: null,
  wonAt: null,
  wonVersion: null,
  verbalYesAt: null,
  probabilityOverride: null,
  createdAt: new Date('2026-08-01'),
  updatedAt: new Date('2026-10-01'),
  nextStep: null,
  nextStepDate: null,
  lastTouchedAt: null,
  owner: { id: 'usr-bd', name: 'Varsha' },
  company: { id: 'co-1', name: 'Carlton Hotels', vertical: 'Hospitality' },
  versions: [
    { id: 'v2', n: 2, value: 120000, sentAt: new Date('2026-09-01'), scopeSummary: '' },
    { id: 'v1', n: 1, value: 150000, sentAt: new Date('2026-08-01'), scopeSummary: '' },
  ],
  ...over,
});

beforeEach(() => {
  p.user.findUnique.mockImplementation(async ({ where }: any) => [BD, MGMT].find((u) => u.id === where.id) ?? null);
  p.organization.findUnique.mockResolvedValue({ timezone: 'Asia/Kolkata', dealStaleDays: 25 });
  p.proposal.findMany.mockResolvedValue([deal()]);
  p.proposal.count.mockResolvedValue(1);
  p.proforma.findMany.mockResolvedValue([]);
  p.retainer.findMany.mockResolvedValue([]);
  p.project.findMany.mockResolvedValue([]);
});

describe('the pipeline board', () => {
  it('shows BD the deal without its value', async () => {
    const res = await request(app).get('/api/proposals/pipeline').set('Authorization', tokenFor(BD));
    expect(res.status).toBe(200);
    expect(res.body.canSeeValues).toBe(false);
    expect(res.body.columns.IN_NEGOTIATION[0]).toMatchObject({ companyName: 'Carlton Hotels', quotedValue: null });
  });

  it('shows Management the value', async () => {
    const res = await request(app).get('/api/proposals/pipeline').set('Authorization', tokenFor(MGMT));
    expect(res.body.canSeeValues).toBe(true);
    expect(res.body.columns.IN_NEGOTIATION[0].quotedValue).toBe(120000);
  });
});

describe('the Proposals list', () => {
  it('sends BD every version without its value', async () => {
    const res = await request(app).get('/api/proposals').set('Authorization', tokenFor(BD));
    expect(res.status).toBe(200);
    expect(res.body.canSeeValues).toBe(false);
    expect(res.body.proposals[0].versions.map((v: any) => v.value)).toEqual([null, null]);
  });

  it('leaves the value column of the CSV empty for BD', async () => {
    const res = await request(app).get('/api/proposals?format=csv').set('Authorization', tokenFor(BD));
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('120000');
  });

  it('sends Management the values', async () => {
    const res = await request(app).get('/api/proposals').set('Authorization', tokenFor(MGMT));
    expect(res.body.proposals[0].versions.map((v: any) => v.value)).toEqual([120000, 150000]);
  });
});

it('keeps the value out of the trash for BD', async () => {
  p.proposal.findMany.mockResolvedValue([deal({ deletedAt: new Date('2026-10-10') })]);
  const res = await request(app).get('/api/proposals/trash').set('Authorization', tokenFor(BD));
  expect(res.status).toBe(200);
  expect(res.body.proposals[0].versions[0].value).toBeNull();
});

it('refuses BD a change to a value they cannot see', async () => {
  const res = await request(app).patch('/api/proposals/prop-1').set('Authorization', tokenFor(BD)).send({ value: 90000 });
  expect(res.status).toBe(403);
  expect(p.proposalVersion.update).not.toHaveBeenCalled();
});
