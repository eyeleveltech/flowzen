import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { RolePreset } from '@prisma/client';

vi.mock('../services/invoiceReader.js', () => ({ readInvoice: vi.fn() }));

import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { resolvePermissions } from '../middleware/auth.js';
import { readInvoice } from '../services/invoiceReader.js';
import { disk, MAX_FILE_BYTES } from '../services/files.js';
import { cycleOf, inrOf, monthlyEquivalent, nextRenewal, subscriptionAlerts, subscriptionsView, type PlatformRow } from '../services/subscriptions.js';

/**
 * Subscriptions (Subscriptions plan): the door, the reading, the maths, the
 * reminders, the linked cost, and the upload limits.
 *
 * The AI is a mock — what it reads is handed in — so what is checked is the
 * mapping onto the review card and what Save does with it, not the model.
 */

type Who = 'boss' | 'head' | 'bd' | 'accounts' | 'employee';
const PEOPLE: Record<Who, { id: string; name: string; preset: RolePreset; permissions?: string[] }> = {
  boss: { id: 'usr-boss', name: 'Harish', preset: RolePreset.MANAGEMENT },
  head: { id: 'usr-head', name: 'Dilshad', preset: RolePreset.HEAD, permissions: ['setup.admin', 'money.figures'] },
  bd: { id: 'usr-bd', name: 'Varsha', preset: RolePreset.BD },
  accounts: { id: 'usr-acc', name: 'Meera', preset: RolePreset.ACCOUNTS },
  employee: { id: 'usr-emp', name: 'Sneha', preset: RolePreset.EMPLOYEE },
};

const as = (who: Who) => {
  const p = PEOPLE[who];
  (prisma.user.findUnique as any).mockResolvedValue({
    id: p.id,
    organizationId: 'org-1',
    email: `${p.id}@eyelevel.local`,
    name: p.name,
    preset: p.preset,
    permissions: p.permissions ?? [],
    active: true,
    sessionsValidFrom: null,
  });
  const session = { userId: p.id, organizationId: 'org-1', preset: p.preset, permissions: resolvePermissions(p.preset, p.permissions ?? []), email: 'x@eyelevel.local' };
  return ['Authorization', `Bearer ${signJwt(session as any)}`] as const;
};

const ORG = {
  id: 'org-1',
  name: 'EyeLevel',
  timezone: 'Asia/Kolkata',
  financialYearStart: 4,
  usdInrRate: 84,
  uploadQuotaMb: 2048,
  aiProvider: 'ANTHROPIC',
  aiApiKey: 'sk-test',
  aiModel: 'claude-opus-5-5',
  aiBaseUrl: null,
};

const ADOBE = { id: 'pf-adobe', organizationId: 'org-1', name: 'Adobe', nameKey: 'adobe', status: 'ACTIVE', notes: null, createdAt: new Date(), updatedAt: new Date() };

const ADOBE_READ = {
  aiUsed: true,
  fields: {
    vendor: 'Adobe',
    invoiceNumber: 'INV-2026-0042',
    invoiceDate: '2026-11-01',
    periodStart: '2026-11-01',
    periodEnd: '2026-11-30',
    planName: 'Creative Cloud All Apps',
    currency: 'USD',
    subtotal: 54.99,
    taxAmount: 0,
    taxType: null,
    total: 54.99,
    vendorGstin: null,
  },
  uncertain: ['periodEnd'],
};

const pdf = () => Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');
const upload = (who: Who, buffer = pdf(), name = 'adobe.pdf', type = 'application/pdf') =>
  request(app).post('/api/subscriptions/invoices/read').set(...as(who)).attach('file', buffer, { filename: name, contentType: type });

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'flowzen-uploads-'));
  process.env.UPLOAD_DIR = tmp;
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

beforeEach(() => {
  (prisma.organization.findUnique as any).mockResolvedValue(ORG);
  (prisma.activity.create as any).mockResolvedValue({ id: 'act-1' });
  (prisma.storedFile.aggregate as any).mockResolvedValue({ _sum: { sizeBytes: 0 } });
  (prisma.storedFile.create as any).mockImplementation(async ({ data }: any) => ({ id: 'file-1', mime: data.mime, sizeBytes: data.sizeBytes, originalName: data.originalName, ...data }));
  (prisma.subscriptionPlatform.findMany as any).mockResolvedValue([ADOBE]);
  (prisma.subscriptionInvoice.findFirst as any).mockResolvedValue(null);
  (prisma.cost.findFirst as any).mockResolvedValue(null);
  (readInvoice as any).mockReset();
  (readInvoice as any).mockResolvedValue(ADOBE_READ);
  disk.freeBytes = async () => 50 * 1024 * 1024 * 1024;
});

describe('the door', () => {
  it('is Management’s only, every route — the file download included', async () => {
    for (const who of ['head', 'bd', 'accounts', 'employee'] as Who[]) {
      expect((await request(app).get('/api/subscriptions').set(...as(who))).status, who).toBe(403);
      expect((await request(app).get('/api/files/file-1').set(...as(who))).status, who).toBe(403);
      expect((await upload(who)).status, who).toBe(403);
      expect((await request(app).post('/api/subscriptions/invoices').set(...as(who)).send({})).status, who).toBe(403);
    }
    (prisma.storedFile.findFirst as any).mockResolvedValue(null);
    expect((await request(app).get('/api/files/file-1').set(...as('boss'))).status).toBe(404);
  });
});

describe('reading an invoice', () => {
  it('keeps the file under a random name and maps what the AI read onto the review card', async () => {
    (prisma.subscriptionInvoice.findFirst as any).mockResolvedValue({ id: 'inv-old', invoiceDate: new Date('2026-10-03T00:00:00Z') });
    (prisma.cost.findFirst as any).mockResolvedValue({ id: 'cost-rec', vendor: 'Adobe Creative Cloud', amount: 4500, category: 'Software' });
    const res = await upload('boss').expect(200);
    expect(res.body.aiUsed).toBe(true);
    expect(res.body.fields).toMatchObject({ vendor: 'Adobe', invoiceNumber: 'INV-2026-0042', total: 54.99, currency: 'USD', periodEnd: '2026-11-30' });
    expect(res.body.uncertain).toEqual(['periodEnd']);
    expect(res.body.platformMatch).toEqual({ id: 'pf-adobe', name: 'Adobe', status: 'ACTIVE' });
    expect(res.body.duplicate.message).toBe('Already uploaded on 3 Oct 2026');
    expect(res.body.recurringCost).toMatchObject({ id: 'cost-rec', amount: 4500 });
    expect(res.body.file).toMatchObject({ id: 'file-1', mime: 'application/pdf', name: 'adobe.pdf', url: '/api/files/file-1' });
    expect(res.body.usdInrRate).toBe(84);

    const stored = (prisma.storedFile.create as any).mock.calls[0][0].data;
    expect(stored.path).toMatch(/^[0-9a-f]{48}\.pdf$/);
    expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.kind).toBe('SUBSCRIPTION_INVOICE');
    expect(stored.createdById).toBe('usr-boss');
    // The AI was handed the bytes, never a path or a name.
    const [org, file] = (readInvoice as any).mock.calls[0];
    expect(org).toMatchObject({ aiProvider: 'ANTHROPIC', aiModel: 'claude-opus-5-5' });
    expect(file.mime).toBe('application/pdf');
    expect(Buffer.isBuffer(file.buffer)).toBe(true);
  });

  it('opens the card empty when the AI is off or could not read it', async () => {
    (readInvoice as any).mockResolvedValue({ aiUsed: false, reason: 'AI is not set up (Settings → Zen), so the fields are yours to fill in.', fields: {}, uncertain: [] });
    const res = await upload('boss').expect(200);
    expect(res.body.aiUsed).toBe(false);
    expect(res.body.reason).toMatch(/not set up/);
    expect(res.body.fields).toEqual({});
    expect(res.body.platformMatch).toBeNull();
    expect(res.body.platforms).toMatchObject([{ id: 'pf-adobe', name: 'Adobe' }]);
  });

  it('refuses the wrong kind of file, one over 10 MB, a full quota and a full disk — before the AI sees anything', async () => {
    expect((await upload('boss', Buffer.from('hello'), 'notes.txt', 'text/plain')).status).toBe(415);
    expect((await upload('boss', Buffer.alloc(MAX_FILE_BYTES + 1, 1))).status).toBe(413);

    (prisma.storedFile.aggregate as any).mockResolvedValue({ _sum: { sizeBytes: 2048 * 1024 * 1024 - 10 } });
    const full = await upload('boss');
    expect(full.status).toBe(507);
    expect(full.body.error).toMatch(/upload space is full/);

    (prisma.storedFile.aggregate as any).mockResolvedValue({ _sum: { sizeBytes: 0 } });
    disk.freeBytes = async () => 1024 * 1024 * 1024;
    const lowDisk = await upload('boss');
    expect(lowDisk.status).toBe(507);
    expect(lowDisk.body.error).toMatch(/free/);

    expect(readInvoice).not.toHaveBeenCalled();
    expect(prisma.storedFile.create).not.toHaveBeenCalled();
  });
});

describe('saving after review', () => {
  const body = {
    fileId: 'file-1',
    platformName: 'Adobe',
    invoiceNumber: 'INV-2026-0042',
    invoiceDate: '2026-11-01',
    periodStart: '2026-11-01',
    periodEnd: '2026-11-30',
    planName: 'Creative Cloud All Apps',
    currency: 'USD',
    subtotal: 54.99,
    total: 54.99,
    extracted: ADOBE_READ.fields,
  };

  beforeEach(() => {
    (prisma.storedFile.findFirst as any).mockResolvedValue({ id: 'file-1', invoices: [] });
    (prisma.subscriptionPlatform.findFirst as any).mockResolvedValue(null);
    (prisma.subscriptionPlatform.create as any).mockImplementation(async ({ data }: any) => ({ id: 'pf-new', ...data }));
    (prisma.cost.create as any).mockImplementation(async ({ data }: any) => ({ id: 'cost-1', ...data }));
    (prisma.subscriptionInvoice.create as any).mockImplementation(async ({ data }: any) => ({ id: 'inv-1', ...data }));
  });

  it('creates the platform, the invoice and a linked Software cost in rupees — estimated until the INR charged is entered', async () => {
    const res = await request(app).post('/api/subscriptions/invoices').set(...as('boss')).send(body).expect(201);
    expect(res.body.invoice).toMatchObject({ id: 'inv-1', platformId: 'pf-new', platformName: 'Adobe', costId: 'cost-1', inr: 4619.16, estimated: true });

    expect((prisma.subscriptionPlatform.create as any).mock.calls[0][0].data).toMatchObject({ organizationId: 'org-1', name: 'Adobe', nameKey: 'adobe' });
    const cost = (prisma.cost.create as any).mock.calls[0][0].data;
    expect(cost).toMatchObject({ type: 'COMPANY', category: 'Software', vendor: 'Adobe', amount: 4619.16, enteredById: 'usr-boss', gstPercent: null });
    expect(cost.incurredAt).toEqual(new Date('2026-11-01T00:00:00Z'));
    expect(cost.notes).toMatch(/INV-2026-0042.*estimated/);
    const inv = (prisma.subscriptionInvoice.create as any).mock.calls[0][0].data;
    expect(inv).toMatchObject({ platformId: 'pf-new', invoiceNumber: 'INV-2026-0042', currency: 'USD', total: 54.99, inrCharged: null, costId: 'cost-1', fileId: 'file-1' });
    expect(inv.extracted).toMatchObject({ vendor: 'Adobe' });
    expect((prisma.activity.create as any).mock.calls[0][0].data).toMatchObject({ entityType: 'SubscriptionInvoice', verb: 'subscription_invoice_added' });

    // With the INR charged, exact — and no "estimated".
    const exact = await request(app).post('/api/subscriptions/invoices').set(...as('boss')).send({ ...body, inrCharged: 4702 }).expect(201);
    expect(exact.body.invoice).toMatchObject({ inr: 4702, estimated: false });
    expect((prisma.cost.create as any).mock.calls[1][0].data.amount).toBe(4702);
  });

  it('reads an Indian invoice’s GST into the cost, and refuses a currency it cannot turn into rupees', async () => {
    await request(app)
      .post('/api/subscriptions/invoices')
      .set(...as('boss'))
      .send({ ...body, platformName: 'Hostinger', currency: 'INR', subtotal: 1000, taxAmount: 180, taxType: 'IGST', total: 1180, vendorGstin: '27AABCU9603R1ZM' })
      .expect(201);
    expect((prisma.cost.create as any).mock.calls[0][0].data).toMatchObject({ amount: 1180, gstPercent: 18, vendor: 'Hostinger' });
    expect((prisma.subscriptionInvoice.create as any).mock.calls[0][0].data.vendorGstin).toBe('27AABCU9603R1ZM');

    const euro = await request(app).post('/api/subscriptions/invoices').set(...as('boss')).send({ ...body, currency: 'EUR' }).expect(400);
    expect(euro.body.error).toMatch(/INR charged/);

    (prisma.organization.findUnique as any).mockResolvedValue({ ...ORG, usdInrRate: null });
    const noRate = await request(app).post('/api/subscriptions/invoices').set(...as('boss')).send(body).expect(400);
    expect(noRate.body.error).toMatch(/Settings → Money/);
  });

  it('refuses the same platform and number twice, naming the day', async () => {
    (prisma.subscriptionPlatform.findFirst as any).mockResolvedValue(ADOBE);
    (prisma.subscriptionInvoice.findFirst as any).mockResolvedValue({ invoiceDate: new Date('2026-10-03T00:00:00Z') });
    const res = await request(app).post('/api/subscriptions/invoices').set(...as('boss')).send(body).expect(409);
    expect(res.body.error).toBe('Already uploaded on 3 Oct 2026.');
    expect(prisma.cost.create).not.toHaveBeenCalled();
  });

  it('stops the old recurring cost only when asked, and says so in its history', async () => {
    (prisma.cost.findFirst as any).mockResolvedValue({ id: 'cost-rec', vendor: 'Adobe', recurring: true });
    (prisma.cost.update as any).mockResolvedValue({});
    const res = await request(app).post('/api/subscriptions/invoices').set(...as('boss')).send({ ...body, stopRecurringCostId: 'cost-rec' }).expect(201);
    expect(res.body.stoppedRecurring).toBe('cost-rec');
    expect(prisma.cost.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'cost-rec' }, data: { recurring: false } }));
    expect((prisma.activity.create as any).mock.calls.some((c: any) => c[0].data.entityType === 'Cost' && c[0].data.verb === 'cost_updated')).toBe(true);

    (prisma.cost.update as any).mockClear();
    await request(app).post('/api/subscriptions/invoices').set(...as('boss')).send(body).expect(201);
    expect(prisma.cost.update).not.toHaveBeenCalled();
  });
});

describe('editing and deleting', () => {
  const existing = {
    id: 'inv-1',
    organizationId: 'org-1',
    platformId: 'pf-adobe',
    invoiceNumber: 'INV-2026-0042',
    invoiceDate: new Date('2026-11-01T00:00:00Z'),
    periodStart: null,
    periodEnd: null,
    planName: null,
    currency: 'USD',
    subtotal: null,
    taxAmount: null,
    taxType: null,
    total: 54.99,
    inrCharged: null,
    vendorGstin: null,
    fileId: 'file-1',
    costId: 'cost-1',
    deletedAt: null,
    platform: ADOBE,
  };

  it('a correction moves the linked cost with it', async () => {
    (prisma.subscriptionInvoice.findFirst as any).mockImplementation(async ({ where }: any) => (where.id === 'inv-1' ? existing : null));
    (prisma.subscriptionInvoice.update as any).mockImplementation(async ({ data }: any) => ({ ...existing, ...data }));
    (prisma.cost.updateMany as any).mockResolvedValue({ count: 1 });
    const res = await request(app).patch('/api/subscriptions/invoices/inv-1').set(...as('boss')).send({ total: 59.99, invoiceDate: '2026-11-02', inrCharged: 5100 }).expect(200);
    expect(res.body.invoice).toMatchObject({ inr: 5100, estimated: false });
    expect(prisma.cost.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cost-1', organizationId: 'org-1' },
        data: expect.objectContaining({ amount: 5100, vendor: 'Adobe', incurredAt: new Date('2026-11-02T00:00:00Z') }),
      }),
    );
  });

  it('deleting is soft, and takes the cost and the file with it', async () => {
    (prisma.subscriptionInvoice.findFirst as any).mockResolvedValue(existing);
    (prisma.subscriptionInvoice.update as any).mockResolvedValue({});
    (prisma.cost.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.storedFile.updateMany as any).mockResolvedValue({ count: 1 });
    await request(app).delete('/api/subscriptions/invoices/inv-1').set(...as('boss')).expect(200);
    expect((prisma.subscriptionInvoice.update as any).mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
    expect((prisma.cost.updateMany as any).mock.calls[0][0]).toMatchObject({ where: { id: 'cost-1', organizationId: 'org-1' } });
    expect((prisma.cost.updateMany as any).mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
    expect((prisma.storedFile.updateMany as any).mock.calls[0][0]).toMatchObject({ where: { id: 'file-1', deletedAt: null } });
  });
});

// ── The maths ────────────────────────────────────────────────────────────────

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const invoice = (over: Partial<PlatformRow['invoices'][number]>): PlatformRow['invoices'][number] => ({
  id: 'i',
  invoiceNumber: 'n',
  invoiceDate: d('2026-11-01'),
  periodStart: null,
  periodEnd: null,
  planName: 'Pro',
  currency: 'USD',
  subtotal: null,
  taxAmount: null,
  taxType: null,
  total: 20,
  inrCharged: null,
  vendorGstin: null,
  fileId: 'f',
  costId: null,
  ...over,
});
const platform = (over: Partial<PlatformRow>): PlatformRow => ({ id: 'p', name: 'Canva', status: 'ACTIVE', notes: null, invoices: [], ...over });

describe('the cycle, the monthly figure and the renewal', () => {
  it('reads the cycle from the period, else from the gaps between invoices', () => {
    expect(cycleOf({ periodStart: d('2026-11-01'), periodEnd: d('2026-11-30') }, [])).toBe('MONTHLY');
    expect(cycleOf({ periodStart: d('2026-01-01'), periodEnd: d('2026-12-31') }, [])).toBe('YEARLY');
    expect(cycleOf({ periodStart: d('2026-01-01'), periodEnd: d('2026-03-31') }, [])).toBe('UNKNOWN');
    expect(cycleOf({ periodStart: null, periodEnd: null }, [d('2026-09-05'), d('2026-10-05'), d('2026-11-05')])).toBe('MONTHLY');
    expect(cycleOf({ periodStart: null, periodEnd: null }, [d('2025-11-05'), d('2026-11-05')])).toBe('YEARLY');
    expect(cycleOf({ periodStart: null, periodEnd: null }, [d('2026-11-05')])).toBe('UNKNOWN');
  });

  it('a yearly plan counts ÷ 12; a quarter by its days; a single sighting as is', () => {
    expect(monthlyEquivalent(1200, 'YEARLY', 365)).toBe(100);
    expect(monthlyEquivalent(20, 'MONTHLY', 30)).toBe(20);
    expect(monthlyEquivalent(90, 'UNKNOWN', 90)).toBeCloseTo(30.44, 1);
    expect(monthlyEquivalent(20, 'UNKNOWN', null)).toBe(20);
  });

  it('rupees: charged beats the invoice, dollars are estimated at the rate, euros need the bank', () => {
    expect(inrOf({ currency: 'USD', total: 20, inrCharged: 1710 }, 84)).toEqual({ inr: 1710, estimated: false });
    expect(inrOf({ currency: 'USD', total: 20, inrCharged: null }, 84)).toEqual({ inr: 1680, estimated: true });
    expect(inrOf({ currency: 'USD', total: 20, inrCharged: null }, null)).toEqual({ inr: null, estimated: false });
    expect(inrOf({ currency: 'INR', total: 1180, inrCharged: null }, null)).toEqual({ inr: 1180, estimated: false });
    expect(inrOf({ currency: 'EUR', total: 9, inrCharged: null }, 84)).toEqual({ inr: null, estimated: false });
  });

  it('renews the day after the period ends, or a cycle on from the invoice', () => {
    expect(nextRenewal({ invoiceDate: d('2026-11-01'), periodEnd: d('2026-11-30') }, 'MONTHLY')).toEqual(d('2026-12-01'));
    expect(nextRenewal({ invoiceDate: d('2026-11-05'), periodEnd: null }, 'MONTHLY')).toEqual(d('2026-12-05'));
    expect(nextRenewal({ invoiceDate: d('2026-11-05'), periodEnd: null }, 'YEARLY')).toEqual(d('2027-11-05'));
    expect(nextRenewal({ invoiceDate: d('2026-11-05'), periodEnd: null }, 'UNKNOWN')).toBeNull();
  });

  it('the view: this month, this year, the run-rate with yearly plans ÷ 12, and what renews', async () => {
    (prisma.subscriptionPlatform.findMany as any).mockResolvedValue([
      {
        ...ADOBE,
        invoices: [
          invoice({ id: 'a1', invoiceDate: d('2026-10-01'), periodStart: d('2026-10-01'), periodEnd: d('2026-10-31'), total: 54.99, currency: 'USD', inrCharged: 4700 }),
          invoice({ id: 'a2', invoiceDate: d('2026-11-01'), periodStart: d('2026-11-01'), periodEnd: d('2026-11-30'), total: 54.99, currency: 'USD' }),
        ],
      },
      {
        ...ADOBE,
        id: 'pf-gw',
        name: 'Google Workspace',
        invoices: [invoice({ id: 'g1', invoiceDate: d('2026-04-10'), periodStart: d('2026-04-10'), periodEnd: d('2027-04-09'), total: 12000, currency: 'INR' })],
      },
      { ...ADOBE, id: 'pf-old', name: 'Old tool', status: 'CANCELLED', invoices: [invoice({ id: 'o1', invoiceDate: d('2026-05-01'), total: 100, currency: 'USD', inrCharged: 8400 })] },
    ]);
    const view = await subscriptionsView('org-1', new Date('2026-11-20T06:00:00Z'));
    expect(view.totals).toMatchObject({
      spentThisMonth: 4619.16,
      monthEstimated: true,
      // 4700 + 4619.16 + 12000 + 8400, since 1 April
      spentThisYear: 29719.16,
      yearEstimated: true,
      runRate: 4619.16 + 1000,
      runRateEstimated: true,
      activePlatforms: 2,
    });
    const adobe = view.platforms.find((p) => p.name === 'Adobe')!;
    expect(adobe).toMatchObject({ cycle: 'MONTHLY', monthlyInr: 4619.16, monthlyEstimated: true, nextRenewal: '2026-12-01', invoiceCount: 2, spentThisYear: 9319.16 });
    const gw = view.platforms.find((p) => p.name === 'Google Workspace')!;
    expect(gw).toMatchObject({ cycle: 'YEARLY', monthlyInr: 1000, monthlyEstimated: false, nextRenewal: '2027-04-10' });
    expect(view.renewingSoon.map((r) => r.name)).toEqual(['Adobe']);
  });
});

describe('the reminders', () => {
  it('renewal in a week, price up, invoice missing — and nothing for a cancelled platform', () => {
    const canva = platform({
      invoices: [
        invoice({ id: 'c1', invoiceDate: d('2026-10-05'), periodStart: d('2026-10-05'), periodEnd: d('2026-11-04'), total: 12.99 }),
        invoice({ id: 'c2', invoiceDate: d('2026-11-05'), periodStart: d('2026-11-05'), periodEnd: d('2026-12-04'), total: 14.99 }),
      ],
    });
    const soon = subscriptionAlerts([canva], '2026-11-30');
    expect(soon.map((a) => a.rule)).toEqual(['SUBSCRIPTION_RENEWAL_DUE', 'SUBSCRIPTION_PRICE_UP']);
    expect(soon[0].message).toBe('Canva renews around 5 Dec (about $14.99).');
    expect(soon[0]).toMatchObject({ entityType: 'SubscriptionPlatform', entityId: 'p', severity: 'MED' });
    expect(soon[1].message).toBe('Canva went up from $12.99 to $14.99.');

    // Eight days before: not yet. The day of: still.
    expect(subscriptionAlerts([canva], '2026-11-27').map((a) => a.rule)).toEqual(['SUBSCRIPTION_PRICE_UP']);
    expect(subscriptionAlerts([canva], '2026-12-05').map((a) => a.rule)).toEqual(['SUBSCRIPTION_RENEWAL_DUE', 'SUBSCRIPTION_PRICE_UP']);

    // A week past the renewal with no new invoice: ask for it.
    const late = subscriptionAlerts([canva], '2026-12-12');
    expect(late[0]).toMatchObject({ rule: 'SUBSCRIPTION_INVOICE_MISSING', severity: 'LOW' });
    expect(late[0].message).toBe('Upload the Canva invoice for December?');
    expect(subscriptionAlerts([canva], '2026-12-11').map((a) => a.rule)).toEqual(['SUBSCRIPTION_PRICE_UP']);

    // A different plan is not a price rise; a cancelled platform says nothing.
    const changedPlan = platform({ invoices: [canva.invoices[0], { ...canva.invoices[1], planName: 'Teams' }] });
    expect(subscriptionAlerts([changedPlan], '2026-11-30').map((a) => a.rule)).toEqual(['SUBSCRIPTION_RENEWAL_DUE']);
    expect(subscriptionAlerts([{ ...canva, status: 'CANCELLED' }], '2026-11-30')).toEqual([]);
  });

  it('reach Management and nobody else', async () => {
    const { alertClausesFor } = await import('./notifications.js');
    (prisma.alert.findMany as any).mockResolvedValue([]);
    (prisma.task.findMany as any).mockResolvedValue([]);
    (prisma.internalProject.findMany as any).mockResolvedValue([]);
    const rulesFor = async (who: Who) => {
      const p = PEOPLE[who];
      const clauses = await alertClausesFor({
        userId: p.id,
        organizationId: 'org-1',
        email: 'x',
        name: p.name,
        preset: p.preset,
        permissions: resolvePermissions(p.preset, (p.permissions ?? []) as never[]),
        active: true,
      });
      const open = clauses.find((c) => c.rule && typeof c.rule === 'object' && 'in' in c.rule) as { rule: { in: string[] } } | undefined;
      return open?.rule.in ?? [];
    };
    expect(await rulesFor('boss')).toEqual(expect.arrayContaining(['SUBSCRIPTION_RENEWAL_DUE', 'SUBSCRIPTION_PRICE_UP', 'SUBSCRIPTION_INVOICE_MISSING']));
    // A Head with setup.admin runs Settings, not the studio's spending.
    expect(await rulesFor('head')).not.toEqual(expect.arrayContaining(['SUBSCRIPTION_RENEWAL_DUE']));
    expect(await rulesFor('accounts')).not.toEqual(expect.arrayContaining(['SUBSCRIPTION_PRICE_UP']));
  });
});
