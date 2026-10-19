import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { RolePreset } from '@prisma/client';
import { describeSplit, splitAmounts } from '../services/proposalDocument.js';

/**
 * AI Proposal Builder, phase 3: compare, start from a proforma, agreed client
 * rates, past prices, and a won proposal setting up its work.
 */

const USERS = {
  mgmt: { id: 'usr-akmal', preset: RolePreset.MANAGEMENT, permissions: [] as string[] },
  bd: { id: 'usr-bd', preset: RolePreset.BD, permissions: ['work.own', 'company.read', 'company.write', 'pipeline.read', 'pipeline.write'] },
};
type Who = keyof typeof USERS;
const p = prisma as any;

const as = (who: Who) => {
  p.user.findUnique.mockResolvedValue({
    id: USERS[who].id,
    organizationId: 'org-1',
    name: who,
    email: `${who}@x`,
    preset: USERS[who].preset,
    permissions: [...USERS[who].permissions],
    active: true,
    sessionsValidFrom: null,
  });
  return [
    'Authorization',
    `Bearer ${signJwt({ userId: USERS[who].id, organizationId: 'org-1', email: `${who}@x`, preset: USERS[who].preset, permissions: [...USERS[who].permissions] } as never)}`,
  ] as const;
};

const ORG = {
  id: 'org-1',
  name: 'EyeLevel',
  legalName: null,
  address: null,
  state: 'Tamil Nadu',
  gstNumber: null,
  gstStateCode: '33',
  pan: null,
  contactEmail: null,
  declarationText: null,
  defaultPaymentTerms: '7 days',
  bankAccountHolderName: null,
  bankName: null,
  bankBranch: null,
  bankAccountNumber: null,
  bankIfscCode: null,
  timezone: 'Asia/Kolkata',
  proposalFloorBase: 75000,
  proposalFloors: {},
  defaultTermsAndConditions: ['Ad spend is billed separately'],
};

const line = (name: string, billing: 'MONTHLY' | 'ONE_TIME', unitRate: number) => ({
  id: `li-${name}`,
  catalogItemId: null,
  name,
  description: null,
  billing,
  qty: 1,
  unit: billing === 'MONTHLY' ? 'month' : null,
  unitRate,
  discountAmount: 0,
  discountTrade: null,
  isPassthrough: false,
  priceSource: 'USER',
  sortOrder: 0,
});

const docFixture = (over: Record<string, unknown> = {}) => ({
  id: 'doc-1',
  proposalId: 'prop-1',
  n: 1,
  status: 'DRAFT',
  layout: 'MINIMAL',
  title: 'Proposal for Acme',
  sections: [{ id: 'scope', type: 'SCOPE', title: 'Scope', body: 'Social and ads.', visible: true }],
  commercialSnapshot: null,
  milestoneSplit: null,
  aiThread: [],
  floorOverrideAt: null,
  lineItems: [line('Social media management', 'MONTHLY', 90000)],
  proposal: { id: 'prop-1', organizationId: 'org-1', refNo: 'EL/PR/2026-27/014', kind: 'RETAINER', company: { id: 'co-1', name: 'Acme', vertical: 'Retail', stateCode: '33', stateName: null, gstin: null } },
  ...over,
});

beforeEach(() => {
  p.organization.findUniqueOrThrow.mockResolvedValue(ORG);
  p.organization.findUnique.mockResolvedValue(ORG);
  p.activity.create.mockResolvedValue({});
});

describe('the payment split', () => {
  it('adds up to the fee exactly, the last part taking the rounding', () => {
    const parts = splitAmounts(100001, [
      { label: 'Advance', percent: 40 },
      { label: 'Design sign-off', percent: 30 },
      { label: 'At launch', percent: 30 },
    ]);
    expect(parts.map((x) => x.amount)).toEqual([40000, 30000, 30001]);
    expect(describeSplit(parts)).toBe('40% advance, 30% design sign-off and 30% at launch.');
  });

  it('is refused when the parts do not make 100%', async () => {
    p.proposalDocument.findFirst.mockResolvedValue(docFixture());
    const res = await request(app)
      .put('/api/proposals/documents/doc-1/line-items')
      .set(...as('mgmt'))
      .send({ items: [], milestoneSplit: [{ label: 'Advance', percent: 50 }, { label: 'Final', percent: 40 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/add up to 100%/);
  });
});

describe('compare', () => {
  beforeEach(() => {
    const v1 = docFixture({ id: 'v1', n: 1, status: 'FINAL', commercialSnapshot: null });
    const v2 = docFixture({ id: 'v2', n: 2, lineItems: [line('Social media management', 'MONTHLY', 80000), line('Brand film', 'ONE_TIME', 150000)] });
    p.proposalDocument.findMany.mockResolvedValue([v1, v2]);
  });

  it('shows Management what changed in price, line by line', async () => {
    const res = await request(app).get('/api/proposals/prop-1/compare?a=v1&b=v2').set(...as('mgmt'));
    expect(res.status).toBe(200);
    expect(res.body.price.a.monthly).toBe(90000);
    expect(res.body.price.b).toMatchObject({ monthly: 80000, oneTime: 150000 });
    const film = res.body.price.lines.find((l: any) => l.name === 'Brand film');
    expect(film.a).toBeNull();
    expect(film.b.unitRate).toBe(150000);
  });

  it('shows the pipeline the text but not a draft’s figures', async () => {
    const res = await request(app).get('/api/proposals/prop-1/compare?a=v1&b=v2').set(...as('bd'));
    expect(res.status).toBe(200);
    expect(res.body.price).toBeNull();
    expect(res.body.b.sections[0].body).toBe('Social and ads.');
  });
});

describe('starting a proposal', () => {
  beforeEach(() => {
    p.proposal.findFirst.mockResolvedValue({
      id: 'prop-1',
      organizationId: 'org-1',
      companyId: 'co-1',
      kind: 'RETAINER',
      outcome: null,
      refNo: 'EL/PR/2026-27/014',
      company: { id: 'co-1', name: 'Acme' },
      documents: [],
    });
    p.proposalDocument.create.mockImplementation(async ({ data }: any) => ({ id: 'doc-new', ...data }));
    p.proposalDocument.findUniqueOrThrow.mockResolvedValue(docFixture());
  });

  it('from a proforma: its lines and its terms, the proforma untouched', async () => {
    p.proforma.findFirst.mockResolvedValue({
      id: 'pf-1',
      number: 'EL/PI/2026-27/007',
      sourceType: 'MONTH_CARD',
      amount: 120000,
      description: null,
      terms: 'Advance payment request. 18% GST applicable as per statutory rates.',
      lineItems: [{ particulars: 'Social media management\nOctober 2026', units: 1, unitCost: 120000 }],
    });
    const res = await request(app).post('/api/proposals/prop-1/documents').set(...as('bd')).send({ proformaId: 'pf-1' });
    expect(res.status).toBe(201);
    const data = p.proposalDocument.create.mock.calls[0][0].data;
    expect(data.lineItems.create[0]).toMatchObject({ name: 'Social media management', description: 'October 2026', billing: 'MONTHLY', unitRate: 120000, priceSource: 'VERSION' });
    expect(data.sections.find((s: any) => s.type === 'TERMS').body).toBe('- Advance payment request.\n- 18% GST applicable as per statutory rates.');
    expect(data.revisionNote).toBe('Started from proforma EL/PI/2026-27/007.');
    expect(p.proforma.update).not.toHaveBeenCalled();
  });

  it('with a price logged by hand, carries it as one line marked so', async () => {
    p.proposalVersion.findFirst.mockResolvedValue({ n: 1, value: 65000, scopeSummary: 'SMM retainer' });
    await request(app).post('/api/proposals/prop-1/documents').set(...as('bd')).send({});
    const created = p.proposalDocument.create.mock.calls[0][0].data.lineItems.create[0];
    expect(created).toMatchObject({ name: 'Monthly retainer', unitRate: 65000, priceSource: 'VERSION' });
    expect(created.description).toMatch(/Price from v1, logged by hand/);
  });
});

describe('agreed client rates', () => {
  it('are Management’s to set', async () => {
    const res = await request(app).post('/api/proposals/client-rates').set(...as('bd')).send({ companyId: 'co-1', catalogItemId: 'cat-1', agreedRate: 70000 });
    expect(res.status).toBe(403);
  });

  it('cannot end before they start', async () => {
    p.company.findFirst.mockResolvedValue({ id: 'co-1', name: 'Acme' });
    p.serviceCatalogItem.findFirst.mockResolvedValue({ id: 'cat-1', name: 'SEO' });
    const res = await request(app)
      .post('/api/proposals/client-rates')
      .set(...as('mgmt'))
      .send({ companyId: 'co-1', catalogItemId: 'cat-1', agreedRate: 70000, validFrom: '2026-10-19', validTo: '2026-09-01' });
    expect(res.status).toBe(400);
  });
});

it('suggests what earlier finals charged for the same service', async () => {
  p.proposalDocument.findFirst.mockResolvedValue(docFixture());
  p.proposalDocument.findMany.mockResolvedValue([
    {
      n: 2,
      finalisedAt: new Date('2026-09-10T06:00:00Z'),
      proposal: { refNo: 'EL/PR/2026-27/009', company: { name: 'Stylori' } },
      commercialSnapshot: { monthly: { lines: [{ name: 'Social Media Management', unitRate: 85000, qty: 1, unit: 'month', discountAmount: 0 }] }, oneTime: { lines: [] } },
    },
  ]);
  const res = await request(app).get('/api/proposals/documents/doc-1/price-history').set(...as('mgmt'));
  expect(res.body.history['social media management']).toEqual([
    expect.objectContaining({ rate: 85000, client: 'Stylori', ref: 'EL/PR/2026-27/009-v2', on: '2026-09-10' }),
  ]);
});

describe('a won proposal, set up as work', () => {
  const won = (kind: 'RETAINER' | 'PROJECT', split: unknown = null) => ({
    id: 'prop-1',
    organizationId: 'org-1',
    kind,
    outcome: 'WON',
    refNo: 'EL/PR/2026-27/014',
    company: { id: 'co-1', name: 'Acme' },
    wonVersion: {
      value: 130000,
      sentFrom: {
        id: 'doc-1',
        n: 2,
        title: 'Proposal for Acme website',
        milestoneSplit: split,
        commercialSnapshot: {
          monthly: { subtotal: 130000, gstRatePercent: 18, lines: [{ name: 'Social media management' }, { name: 'Performance marketing' }] },
          oneTime: { subtotal: 200000, gstRatePercent: 18, lines: [{ name: 'Website' }] },
          passthrough: { lines: [], total: 0 },
        },
      },
    },
  });

  it('gives a retainer its fee and its services as projects', async () => {
    p.proposal.findFirst.mockResolvedValue(won('RETAINER'));
    const res = await request(app).get('/api/proposals/prop-1/handoff').set(...as('mgmt'));
    expect(res.body.retainer).toEqual({ monthlyValue: 130000, gstPercent: 18, projects: ['Social media management', 'Performance marketing'] });
  });

  it('gives a project its fee and its payment split as milestones', async () => {
    p.proposal.findFirst.mockResolvedValue(won('PROJECT', [{ label: 'Advance', percent: 50 }, { label: 'At launch', percent: 50 }]));
    const res = await request(app).get('/api/proposals/prop-1/handoff').set(...as('mgmt'));
    expect(res.body.project).toMatchObject({
      name: 'Acme website',
      quotedValue: 200000,
      milestones: [
        { label: 'Advance', percent: 50, amount: 100000 },
        { label: 'At launch', percent: 50, amount: 100000 },
      ],
    });
  });

  it('keeps the figures from anybody who cannot see deal values', async () => {
    p.proposal.findFirst.mockResolvedValue(won('RETAINER'));
    const res = await request(app).get('/api/proposals/prop-1/handoff').set(...as('bd'));
    expect(res.body.retainer.monthlyValue).toBeNull();
    expect(res.body.retainer.projects).toHaveLength(2);
  });
});
