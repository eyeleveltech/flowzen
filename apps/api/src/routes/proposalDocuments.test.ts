import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { RolePreset } from '@prisma/client';
import { nextProposalRef } from '../services/proposalDocument.js';

/**
 * Proposal documents (AI Proposal Builder, phase 1): who sees the figures, what
 * Finalise refuses, and what "Mark as sent" records.
 */

vi.mock('../services/proposalDocument.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/proposalDocument.js')>()),
  // No Chromium in a unit test.
  renderProposalPdf: vi.fn(async () => Buffer.from('%PDF-1.4 test')),
}));

const USERS = {
  mgmt: { id: 'usr-akmal', preset: RolePreset.MANAGEMENT, permissions: [] as string[] },
  bd: { id: 'usr-bd', preset: RolePreset.BD, permissions: ['work.own', 'company.read', 'pipeline.read', 'pipeline.write'] },
};
type Who = keyof typeof USERS;

const auth = (who: Who) =>
  [
    'Authorization',
    `Bearer ${signJwt({
      userId: USERS[who].id,
      organizationId: 'org-1',
      email: `${who}@eyelevel.local`,
      preset: USERS[who].preset,
      permissions: [...USERS[who].permissions] as any,
    })}`,
  ] as const;

const as = (who: Who) => {
  (prisma.user.findUnique as any).mockResolvedValue({
    id: USERS[who].id,
    organizationId: 'org-1',
    name: who,
    email: `${who}@eyelevel.local`,
    preset: USERS[who].preset,
    permissions: [...USERS[who].permissions],
    active: true,
    sessionsValidFrom: null,
  });
  return auth(who);
};

const ORG = {
  id: 'org-1',
  name: 'EyeLevel',
  legalName: 'EyeLevel Studio LLP',
  address: 'Chennai',
  state: 'Tamil Nadu',
  gstNumber: '33ABCDE1234F1Z5',
  gstStateCode: '33',
  pan: null,
  contactEmail: 'hello@eyelevel.local',
  declarationText: null,
  defaultPaymentTerms: '7 days',
  bankAccountHolderName: null,
  bankName: null,
  bankBranch: null,
  bankAccountNumber: null,
  bankIfscCode: null,
  timezone: 'Asia/Kolkata',
  financialYearStart: 4,
  proformaPrefix: 'EL/PI',
  website: null,
  phone: null,
  proposalFloorBase: 75000,
  proposalFloors: { 'Real Estate & Infrastructure': 200000, 'Healthcare & Wellness': 150000 },
  defaultTermsAndConditions: ['Ad spend is billed separately'],
};

const line = (o: Record<string, unknown>) => ({
  id: `li-${o.name}`,
  documentId: 'doc-1',
  catalogItemId: null,
  description: null,
  qty: 1,
  unit: 'month',
  discountAmount: 0,
  discountTrade: null,
  isPassthrough: false,
  priceSource: 'USER',
  sortOrder: 0,
  ...o,
});

const SECTIONS = [
  { id: 'cover', type: 'COVER', title: 'Cover', body: '', visible: true },
  { id: 'scope', type: 'SCOPE', title: 'Scope of work', body: 'Social, ads and a monthly report.', visible: true },
  { id: 'commercial', type: 'COMMERCIAL', title: 'Investment', body: '', visible: true },
  { id: 'timeline', type: 'TIMELINE', title: 'Timeline', body: '', visible: false },
];

let doc: any;

beforeEach(() => {
  doc = {
    id: 'doc-1',
    proposalId: 'prop-1',
    n: 1,
    status: 'DRAFT',
    layout: 'MINIMAL',
    title: 'Proposal for Acme Homes',
    sections: SECTIONS,
    revisionNote: null,
    basedOnId: null,
    createdById: 'usr-bd',
    finalisedById: null,
    finalisedAt: null,
    commercialSnapshot: null,
    floorOverrideReason: null,
    floorOverrideById: null,
    floorOverrideAt: null,
    finalPdf: null,
    sentVersionId: null,
    sentAt: null,
    createdAt: new Date('2026-10-19T05:00:00Z'),
    updatedAt: new Date('2026-10-19T05:00:00Z'),
    createdBy: { name: 'bd' },
    finalisedBy: null,
    floorOverrideBy: null,
    basedOn: null,
    lineItems: [
      line({ name: 'Social media management', billing: 'MONTHLY', unitRate: 90000 }),
      line({ name: 'Performance marketing', billing: 'MONTHLY', unitRate: 40000, sortOrder: 1 }),
    ],
    proposal: {
      id: 'prop-1',
      organizationId: 'org-1',
      kind: 'RETAINER',
      stage: 'PROSPECT',
      outcome: null,
      refNo: 'EL/PR/2026-27/014',
      nextStep: null,
      nextStepDate: null,
      owner: { name: 'Akmal' },
      company: {
        id: 'co-1',
        name: 'Acme Homes',
        vertical: 'Real Estate & Infrastructure',
        city: 'Chennai',
        stateCode: '33',
        stateName: 'Tamil Nadu',
        gstin: null,
        people: [{ name: 'Priya' }],
      },
    },
  };
  (prisma.proposalDocument.findFirst as any).mockImplementation(async () => doc);
  (prisma.proposalDocument.findUniqueOrThrow as any).mockImplementation(async () => doc);
  (prisma.proposalDocument.updateMany as any).mockResolvedValue({ count: 1 });
  (prisma.proposalDocument.update as any).mockResolvedValue({});
  (prisma.organization.findUniqueOrThrow as any).mockResolvedValue(ORG);
  (prisma.organization.findUnique as any).mockResolvedValue(ORG);
  (prisma.activity.create as any).mockResolvedValue({});
  (prisma.$transaction as any).mockImplementation(async (fn: any) => fn(prisma));
});

describe('who sees the figures', () => {
  it('shows a draft to the pipeline without its rates or its price', async () => {
    const res = await request(app).get('/api/proposals/documents/doc-1').set(...as('bd'));
    expect(res.status).toBe(200);
    expect(res.body.canPrice).toBe(false);
    expect(res.body.price).toBeUndefined();
    expect(res.body.document.lineItems[0]).not.toHaveProperty('unitRate');
    expect(res.body.document.lineItems[0].name).toBe('Social media management');
  });

  it('shows Management the price and what stands between the draft and Finalise', async () => {
    const res = await request(app).get('/api/proposals/documents/doc-1').set(...as('mgmt'));
    expect(res.status).toBe(200);
    expect(res.body.price.monthly.subtotal).toBe(130000);
    expect(res.body.document.lineItems[0].unitRate).toBe(90000);
    expect(res.body.problems.join(' ')).toMatch(/below the Real Estate & Infrastructure floor of ₹2,00,000/);
  });

  it('keeps line items to Management', async () => {
    const res = await request(app)
      .put('/api/proposals/documents/doc-1/line-items')
      .set(...as('bd'))
      .send({ items: [] });
    expect(res.status).toBe(403);
    expect(prisma.proposalLineItem.deleteMany).not.toHaveBeenCalled();
  });

  it('shows a final document, figures and all, to anybody on the deal', async () => {
    doc.status = 'FINAL';
    doc.commercialSnapshot = { monthly: { subtotal: 130000 } };
    const res = await request(app).get('/api/proposals/documents/doc-1').set(...as('bd'));
    expect(res.body.price.monthly.subtotal).toBe(130000);
    expect(res.body.document.lineItems[0].unitRate).toBe(90000);
  });
});

describe('Finalise', () => {
  it('refuses a monthly fee below the floor until somebody records why', async () => {
    const res = await request(app).post('/api/proposals/documents/doc-1/finalise').set(...as('mgmt'));
    expect(res.status).toBe(422);
    expect(res.body.problems[0]).toMatch(/below the Real Estate & Infrastructure floor/);
    expect(prisma.proposalDocument.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a price written into the text', async () => {
    doc.floorOverrideAt = new Date();
    doc.sections = SECTIONS.map((s) => (s.id === 'scope' ? { ...s, body: 'All of it for just ₹50,000.' } : s));
    const res = await request(app).post('/api/proposals/documents/doc-1/finalise').set(...as('mgmt'));
    expect(res.status).toBe(422);
    expect(res.body.problems.join(' ')).toMatch(/₹50,000, which no line item backs/);
  });

  it('refuses a discount with nothing given in return', async () => {
    doc.floorOverrideAt = new Date();
    doc.lineItems[0].discountAmount = 10000;
    const res = await request(app).post('/api/proposals/documents/doc-1/finalise').set(...as('mgmt'));
    expect(res.status).toBe(422);
    expect(res.body.problems.join(' ')).toMatch(/in return for the discount on Social media management/);
  });

  it('locks the document with its numbers frozen and its PDF kept', async () => {
    doc.floorOverrideAt = new Date();
    const res = await request(app).post('/api/proposals/documents/doc-1/finalise').set(...as('mgmt'));
    expect(res.status).toBe(200);
    const call = (prisma.proposalDocument.updateMany as any).mock.calls[0][0];
    expect(call.where).toEqual({ id: 'doc-1', status: { in: ['DRAFT', 'IN_REVIEW'] } });
    expect(call.data.status).toBe('FINAL');
    expect(call.data.commercialSnapshot.monthly.subtotal).toBe(130000);
    expect(Buffer.from(call.data.finalPdf).toString()).toContain('%PDF');
    // The Word file is made in the same moment: a .docx is a zip, "PK".
    expect(Buffer.from(call.data.finalDocx).subarray(0, 2).toString()).toBe('PK');
  });

  it('refuses a gap left for somebody to fill', async () => {
    doc.floorOverrideAt = new Date();
    doc.sections = SECTIONS.map((s) => (s.id === 'scope' ? { ...s, body: 'Launch on [[Needs input: launch date]].' } : s));
    const res = await request(app).post('/api/proposals/documents/doc-1/finalise').set(...as('mgmt'));
    expect(res.status).toBe(422);
    expect(res.body.problems.join(' ')).toMatch(/Still needs input: launch date/);
  });

  it('is Management’s alone', async () => {
    const res = await request(app).post('/api/proposals/documents/doc-1/finalise').set(...as('bd'));
    expect(res.status).toBe(403);
  });
});

describe('a final document is locked', () => {
  it('refuses an edit to its text', async () => {
    doc.status = 'FINAL';
    const res = await request(app)
      .patch('/api/proposals/documents/doc-1')
      .set(...as('bd'))
      .send({ title: 'New title' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/final and locked/);
  });

  it('asks for a reason of real length to go below the floor', async () => {
    const res = await request(app)
      .post('/api/proposals/documents/doc-1/floor-override')
      .set(...as('mgmt'))
      .send({ reason: 'friend' });
    expect(res.status).toBe(400);
  });
});

describe('Mark as sent', () => {
  beforeEach(() => {
    (prisma.proposal.findFirstOrThrow as any).mockResolvedValue({ ...doc.proposal, versions: [] });
    (prisma.proposalVersion.create as any).mockImplementation(async ({ data }: any) => ({ id: 'ver-1', ...data }));
    (prisma.proposal.update as any).mockResolvedValue({});
  });

  it('records a sent version at the monthly fee and moves the deal to Proposal sent', async () => {
    doc.status = 'FINAL';
    doc.commercialSnapshot = { monthly: { subtotal: 130000 }, oneTime: { subtotal: 0 } };
    const res = await request(app).post('/api/proposals/documents/doc-1/mark-sent').set(...as('bd')).send({});
    expect(res.status).toBe(201);
    const v = (prisma.proposalVersion.create as any).mock.calls[0][0].data;
    expect(v).toMatchObject({ proposalId: 'prop-1', n: 1, value: 130000 });
    expect(v.scopeSummary).toContain('EL/PR/2026-27/014-v1');
    expect((prisma.proposal.update as any).mock.calls[0][0].data.stage).toBe('PROPOSAL_SENT');
  });

  it('refuses a draft', async () => {
    const res = await request(app).post('/api/proposals/documents/doc-1/mark-sent').set(...as('bd')).send({});
    expect(res.status).toBe(409);
    expect(prisma.proposalVersion.create).not.toHaveBeenCalled();
  });
});

describe('the reference', () => {
  it('counts on within the financial year: EL/PR/2026-27/015 after 014', async () => {
    (prisma.proposal.findMany as any).mockResolvedValue([{ refNo: 'EL/PR/2026-27/014' }, { refNo: 'EL/PR/2026-27/009' }]);
    expect(await nextProposalRef('org-1', new Date('2026-10-19T06:00:00Z'))).toBe('EL/PR/2026-27/015');
  });
});

describe('review', () => {
  beforeEach(() => {
    (prisma.alert.create as any).mockResolvedValue({});
    (prisma.alert.updateMany as any).mockResolvedValue({ count: 0 });
    (prisma.user.findUnique as any).mockResolvedValue(null);
  });

  it('hands a draft to Management and rings their bell', async () => {
    const res = await request(app).post('/api/proposals/documents/doc-1/review').set(...as('bd'));
    expect(res.status).toBe(200);
    const write = (prisma.proposalDocument.updateMany as any).mock.calls[0][0];
    expect(write).toMatchObject({ where: { id: 'doc-1', status: 'DRAFT' }, data: { status: 'IN_REVIEW' } });
    expect((prisma.alert.create as any).mock.calls[0][0].data).toMatchObject({
      rule: 'PROPOSAL_REVIEW_REQUESTED',
      entityType: 'Proposal',
      entityId: 'prop-1',
    });
  });

  it('is Management’s to change while it is in review', async () => {
    doc.status = 'IN_REVIEW';
    const bd = await request(app).patch('/api/proposals/documents/doc-1').set(...as('bd')).send({ title: 'Mine now' });
    expect(bd.status).toBe(409);
    expect(bd.body.error).toMatch(/with Management for review/);
    const mgmt = await request(app).patch('/api/proposals/documents/doc-1').set(...as('mgmt')).send({ layout: 'PREMIUM' });
    expect(mgmt.status).toBe(200);
    expect((prisma.proposalDocument.updateMany as any).mock.calls[0][0]).toMatchObject({
      where: { status: { in: ['DRAFT', 'IN_REVIEW'] } },
      data: { layout: 'PREMIUM' },
    });
  });

  it('goes back to the writer with a note', async () => {
    doc.status = 'IN_REVIEW';
    const res = await request(app).post('/api/proposals/documents/doc-1/send-back').set(...as('mgmt')).send({ note: 'Tighten the scope' });
    expect(res.status).toBe(200);
    expect((prisma.proposalDocument.updateMany as any).mock.calls[0][0].data).toMatchObject({ status: 'DRAFT', reviewNote: 'Tighten the scope' });
    expect((prisma.alert.updateMany as any).mock.calls[0][0].where).toMatchObject({ rule: 'PROPOSAL_REVIEW_REQUESTED', entityId: 'prop-1' });
  });
});

describe('an AI suggestion', () => {
  it('reaches the document only when accepted', async () => {
    doc.aiThread = [
      { id: 'q1', from: 'you', text: 'Shorter scope', at: '2026-10-19T06:00:00Z', by: 'bd' },
      {
        id: 'a1',
        from: 'ai',
        text: 'Here is a shorter scope.',
        at: '2026-10-19T06:00:05Z',
        changes: [{ id: 'c1', sectionId: 'scope', type: 'SCOPE', title: 'Scope of work', before: 'old', after: '- Social\n- Ads', status: 'PENDING' }],
      },
    ];
    const res = await request(app).post('/api/proposals/documents/doc-1/ai/a1').set(...as('bd')).send({ action: 'accept' });
    expect(res.status).toBe(200);
    const data = (prisma.proposalDocument.updateMany as any).mock.calls[0][0].data;
    expect(data.sections.find((s: any) => s.id === 'scope').body).toBe('- Social\n- Ads');
    expect(data.aiThread[1].changes[0].status).toBe('ACCEPTED');
  });

  it('keeps staged prices to Management', async () => {
    doc.aiThread = [{ id: 'a1', from: 'ai', text: 'Staged.', at: '2026-10-19T06:00:05Z', changes: [], lines: { items: [], status: 'PENDING' } }];
    const res = await request(app).post('/api/proposals/documents/doc-1/ai/a1').set(...as('bd')).send({ action: 'accept', lines: true });
    expect(res.status).toBe(403);
  });
});
