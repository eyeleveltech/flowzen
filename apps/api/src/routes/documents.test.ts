import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { RolePreset } from '@prisma/client';

/**
 * CHANGE REQUEST 02 — the two write paths that produce a printable document.
 *
 * What is worth holding down at this level, rather than in the unit tests:
 *
 *   · a proforma raised with line items stores those lines, and `amount` keeps
 *     meaning the PRE-TAX subtotal, because the register, the forecast and the
 *     awaiting-invoice totals all read that column;
 *   · an invoice's `amount` is the opposite — the payable TOTAL, since it is
 *     what payments are settled against — so saving a document sets it to the
 *     document total and refuses to drop it below money already received;
 *   · the old single-description request still works unchanged;
 *   · money on a document is masked the way money everywhere else is: null
 *     when withheld, never zero.
 */

const ACCOUNTS = {
  id: 'usr-accounts',
  preset: RolePreset.ACCOUNTS,
  permissions: ['work.own', 'money.status', 'money.figures', 'pipeline.read', 'pipeline.write', 'company.read'],
};

/** Everything the register shows, and no figure on any of it. */
const STATUS_ONLY = {
  id: 'usr-head',
  preset: RolePreset.HEAD,
  permissions: ['work.own', 'money.status'],
};

type Caller = { id: string; preset: RolePreset; permissions: string[] };

const auth = (who: Caller = ACCOUNTS) =>
  [
    'Authorization',
    `Bearer ${signJwt({
      userId: who.id,
      organizationId: 'org-1',
      email: 'accounts@eyelevel.local',
      preset: who.preset,
      permissions: [...who.permissions],
    })}`,
  ] as const;

const ORG = {
  id: 'org-1',
  name: 'EyeLevel Growth Studio',
  legalName: 'EyeLevel Growth Studio LLP',
  address: 'No. 12, KK Nagar',
  state: 'Tamil Nadu',
  gstNumber: '33AABCE1234F1Z5',
  gstStateCode: '33',
  pan: 'AABCE1234F',
  contactEmail: 'accounts@eyelevelstudio.in',
  declarationText: null,
  defaultPaymentTerms: 'Immediate',
  defaultProformaValidityDays: 30,
  bankAccountHolderName: null,
  bankName: null,
  bankBranch: null,
  bankAccountNumber: null,
  bankIfscCode: null,
  proformaPrefix: 'EL/PI',
  financialYearStart: 4,
};

/** What each write actually put in the database. */
let written: { proforma?: any; invoice?: any; deletedLinesFor?: any };

const asUser = (who: Caller) =>
  (prisma.user.findUnique as any).mockResolvedValue({
    id: who.id,
    organizationId: 'org-1',
    name: 'Anitha',
    email: 'accounts@eyelevel.local',
    preset: who.preset,
    permissions: [...who.permissions],
    active: true,
    sessionsValidFrom: null,
  });

beforeEach(() => {
  written = {};
  asUser(ACCOUNTS);

  (prisma.organization.findUnique as any).mockResolvedValue(ORG);
  (prisma.company.findFirst as any).mockResolvedValue({
    id: 'co-1',
    billingAddress: '5 Client Road, Bengaluru',
    gstin: null,
    stateName: 'Karnataka',
    stateCode: '29',
  });
  (prisma.proforma.findMany as any).mockResolvedValue([]);
  (prisma.invoice.findMany as any).mockResolvedValue([]);
  (prisma.activity.create as any).mockResolvedValue({});
  (prisma.documentLineItem.deleteMany as any).mockResolvedValue({ count: 0 });

  (prisma.$transaction as any).mockImplementation(async (fn: any) =>
    fn({
      proforma: {
        create: vi.fn(async ({ data }: any) => {
          written.proforma = data;
          return { id: 'pf-new', ...data };
        }),
        update: vi.fn(async ({ data }: any) => {
          written.proforma = data;
          return { id: 'pf-1', ...data };
        }),
      },
      invoice: {
        update: vi.fn(async ({ data }: any) => {
          written.invoice = data;
          return { id: 'inv-1', ...data };
        }),
      },
      documentLineItem: {
        deleteMany: vi.fn(async ({ where }: any) => {
          written.deletedLinesFor = where;
          return { count: 0 };
        }),
      },
      proposal: { update: vi.fn(async () => ({})) },
      milestone: { update: vi.fn(async () => ({})) },
      activity: { create: vi.fn(async () => ({})) },
      monthCard: { update: vi.fn(async () => ({})) },
    }),
  );
});

// ── Raising a proforma ──────────────────────────────────────────────────────

const raise = (body: Record<string, unknown>) =>
  request(app)
    .post('/api/proformas')
    .set(...auth())
    .send({
      companyId: 'co-1',
      sourceType: 'PROJECT',
      sourceId: 'proj-1',
      billingName: 'Client Pvt Ltd',
      ...body,
    });

describe('raising a proforma with line items', () => {
  it('stores every line, numbered by position', async () => {
    const res = await raise({
      lineItems: [
        { particulars: 'Retainer', units: 1, unitCost: 45000, hsnSac: '998365' },
        { particulars: 'Reels', units: 3, unitCost: 8500 },
      ],
    });
    expect(res.status).toBe(201);
    const created = written.proforma.lineItems.create;
    expect(created).toHaveLength(2);
    expect(created.map((l: any) => l.serialNo)).toEqual([1, 2]);
    expect(created[1].amount).toBe(25500);
  });

  it('keeps `amount` as the pre-tax subtotal, and puts the payable figure in `total`', async () => {
    const res = await raise({
      lineItems: [{ particulars: 'Retainer', units: 1, unitCost: 100000 }],
      placeOfSupply: { code: '33' },
    });
    expect(res.status).toBe(201);
    expect(written.proforma.amount).toBe(100000);
    expect(written.proforma.subtotal).toBe(100000);
    expect(written.proforma.total).toBe(118000);
  });

  it('takes the place of supply from the company when the request does not name one', async () => {
    const res = await raise({ lineItems: [{ particulars: 'Retainer', units: 1, unitCost: 100000 }] });
    expect(res.status).toBe(201);
    // The company is in Karnataka; the seller is in Tamil Nadu.
    expect(written.proforma.placeOfSupplyCode).toBe('29');
    expect(written.proforma.supplyType).toBe('INTER');
    expect(written.proforma.igstAmount).toBe(18000);
    expect(written.proforma.cgstAmount).toBe(0);
  });

  it('lets an explicit place of supply override the company, and re-splits the tax', async () => {
    const res = await raise({
      lineItems: [{ particulars: 'Retainer', units: 1, unitCost: 100000 }],
      placeOfSupply: { code: '33' },
    });
    expect(res.status).toBe(201);
    expect(written.proforma.supplyType).toBe('INTRA');
    expect(written.proforma.cgstAmount).toBe(9000);
    expect(written.proforma.sgstAmount).toBe(9000);
    expect(written.proforma.igstAmount).toBe(0);
  });

  it('freezes the seller block, so editing Settings later cannot rewrite the document', async () => {
    const res = await raise({ lineItems: [{ particulars: 'Retainer', units: 1, unitCost: 1000 }] });
    expect(res.status).toBe(201);
    expect(written.proforma.sellerSnapshot.gstin).toBe('33AABCE1234F1Z5');
    expect(written.proforma.sellerSnapshot.legalName).toBe('EyeLevel Growth Studio LLP');
  });

  it('still accepts the old single description and amount, and makes one line of it', async () => {
    const res = await raise({ amount: 30000, description: 'Retainer for August', sacCode: '998365' });
    expect(res.status).toBe(201);
    const created = written.proforma.lineItems.create;
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ particulars: 'Retainer for August', units: 1, unitCost: 30000, hsnSac: '998365' });
    expect(written.proforma.amount).toBe(30000);
  });

  it('refuses a request that carries neither line items nor an amount', async () => {
    const res = await raise({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/line items or an amount/i);
  });

  it('refuses a line with no description rather than printing a blank row', async () => {
    const res = await raise({ lineItems: [{ particulars: '   ', units: 1, unitCost: 100 }] });
    expect(res.status).toBe(400);
  });

  it('will not raise a proforma against another organisation’s company', async () => {
    (prisma.company.findFirst as any).mockResolvedValue(null);
    const res = await raise({ amount: 1000 });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/company not found/i);
  });
});

// ── The invoice document ────────────────────────────────────────────────────

const INVOICE = {
  id: 'inv-1',
  number: 'INV/26-27/0188',
  organizationId: 'org-1',
  amount: 220000,
  status: 'RAISED',
  company: { billingAddress: '5 Client Road', gstin: null, stateName: 'Karnataka', stateCode: '29' },
  payments: [],
};

const saveDocument = (body: Record<string, unknown> = {}, invoice: Record<string, unknown> = {}) => {
  (prisma.invoice.findFirst as any).mockResolvedValue({ ...INVOICE, ...invoice });
  return request(app)
    .put('/api/invoices/inv-1/document')
    .set(...auth())
    .send({
      billingName: 'Client Pvt Ltd',
      lineItems: [{ particulars: 'Retainer — September', units: 1, unitCost: 30000, hsnSac: '998365' }],
      placeOfSupply: { code: '33' },
      ...body,
    });
};

describe('the invoice document', () => {
  it('sets the invoice amount to the document total, because that is what gets paid', async () => {
    const res = await saveDocument();
    expect(res.status).toBe(200);
    expect(written.invoice.subtotal).toBe(30000);
    expect(written.invoice.total).toBe(35400);
    expect(written.invoice.amount).toBe(35400);
    expect(written.invoice.amountInWords).toBe('Rupees Thirty Five Thousand Four Hundred Only.');
  });

  it('replaces the existing lines rather than adding to them', async () => {
    const res = await saveDocument();
    expect(res.status).toBe(200);
    expect(written.deletedLinesFor).toEqual({ invoiceId: 'inv-1' });
    expect(written.invoice.lineItems.create).toHaveLength(1);
  });

  it('will not put the amount below money already received', async () => {
    const res = await saveDocument({}, { payments: [{ amount: 100000 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already received/i);
    expect(written.invoice).toBeUndefined();
  });

  it('refuses to rewrite a cancelled invoice', async () => {
    const res = await saveDocument({}, { status: 'CANCELLED' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cancelled/i);
  });

  it('needs at least one line item — an invoice with no lines is not a shorter invoice', async () => {
    const res = await saveDocument({ lineItems: [] });
    expect(res.status).toBe(400);
  });

  it('charges IGST to an out-of-state buyer who has no GSTIN on file', async () => {
    const res = await saveDocument({ gstin: null, placeOfSupply: { code: '29' } });
    expect(res.status).toBe(200);
    expect(written.invoice.supplyType).toBe('INTER');
    expect(written.invoice.igstAmount).toBe(5400);
    expect(written.invoice.cgstAmount).toBe(0);
  });
});

describe('the response shape the web client is written against', () => {
  /*
   * `request()` in lib/api-v2.ts returns `payload.data` whenever the body
   * carries one. A route that ALSO answers under the entity's own name is
   * offering a key no caller can reach — and a typed client that declares it
   * compiles and then hands back undefined. That is exactly how the invoice
   * document form silently failed to prefill: `res.invoice.subtotal` threw,
   * a bare .catch() swallowed it, and the form simply opened empty.
   */
  it('answers under data, and not under a second unreachable key', async () => {
    (prisma.invoice.findFirst as any).mockResolvedValue({
      ...INVOICE,
      subtotal: 30000,
      cgstAmount: 2700,
      sgstAmount: 2700,
      igstAmount: 0,
      roundOff: 0,
      total: 35400,
      amountInWords: 'Rupees Thirty Five Thousand Four Hundred Only.',
      payments: [],
      lineItems: [],
      project: null,
      proforma: null,
      monthCard: null,
    });

    const res = await request(app)
      .get('/api/invoices/inv-1')
      .set(...auth());

    expect(Object.keys(res.body).sort()).toEqual(['data', 'success']);
    expect(res.body.data.subtotal).toBe(30000);
  });

  it('answers a saved document the same way', async () => {
    const res = await saveDocument();
    expect(Object.keys(res.body).sort()).toEqual(['data', 'success']);
  });
});

describe('a tax invoice the seller cannot legally issue', () => {
  /** A saved document on an invoice, so the only thing wrong is the seller. */
  const withDocument = (org: Record<string, unknown>) => {
    (prisma.organization.findUnique as any).mockResolvedValue({ ...ORG, ...org });
    (prisma.invoice.findFirst as any).mockResolvedValue({
      ...INVOICE,
      subtotal: 30000,
      cgstAmount: 2700,
      sgstAmount: 2700,
      igstAmount: 0,
      roundOff: 0,
      total: 35400,
      amountInWords: 'Rupees Thirty Five Thousand Four Hundred Only.',
      gstApplicable: true,
      gstRatePercent: 18,
      terms: null,
      notes: null,
      poNumber: null,
      poDate: null,
      billingName: 'Client Pvt Ltd',
      billingContactName: null,
      billingAddress: null,
      gstin: null,
      billingStateName: 'Tamil Nadu',
      billingStateCode: '33',
      placeOfSupplyState: 'Tamil Nadu',
      placeOfSupplyCode: '33',
      supplyType: 'INTRA',
      // Null so the renderer falls back to the live org, which is the whole
      // point here: a document raised before the GSTIN was entered.
      sellerSnapshot: null,
      customFields: null,
      raisedAt: new Date('2026-09-01'),
      dueAt: new Date('2026-09-15'),
      organization: { ...ORG, ...org, defaultTermsAndConditions: [], signatureImage: null },
      company: { name: 'Client Pvt Ltd', billingAddress: null, gstin: null },
      lineItems: [
        { serialNo: 1, particulars: 'Retainer', units: 1, unitCost: 30000, hsnSac: '998365', amount: 30000, gstRate: 18 },
      ],
    });
    return request(app)
      .get('/api/invoices/inv-1/pdf')
      .set(...auth());
  };

  it('refuses when the seller has no GSTIN, and names the tab that sets it', async () => {
    const res = await withDocument({ gstNumber: null });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/GSTIN/);
    expect(res.body.error).toMatch(/Tax & numbering/);
  });

  it('refuses when the seller has no address', async () => {
    const res = await withDocument({ address: null });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Registered address/);
    expect(res.body.error).toMatch(/Organisation/);
  });

  it('lists everything missing at once, rather than one refusal at a time', async () => {
    const res = await withDocument({ gstNumber: null, address: null });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/GSTIN/);
    expect(res.body.error).toMatch(/Registered address/);
  });

  // A missing PAN does NOT block, and a proforma never blocks at all — both
  // are held down in documentModel.test.ts, where the assertion does not have
  // to get past the check and launch a browser to prove it.
});

describe('the invoice PDF', () => {
  it('says so plainly when there is no document to print yet', async () => {
    (prisma.invoice.findFirst as any).mockResolvedValue({
      ...INVOICE,
      subtotal: null,
      gstApplicable: true,
      gstRatePercent: 18,
      terms: null,
      notes: null,
      poNumber: null,
      poDate: null,
      billingName: null,
      billingContactName: null,
      billingAddress: null,
      gstin: null,
      billingStateName: null,
      billingStateCode: null,
      placeOfSupplyState: null,
      placeOfSupplyCode: null,
      supplyType: null,
      sellerSnapshot: null,
      customFields: null,
      amountInWords: null,
      raisedAt: new Date('2026-09-01'),
      dueAt: new Date('2026-09-15'),
      organization: ORG,
      company: { name: 'Client Pvt Ltd', billingAddress: null, gstin: null },
      lineItems: [],
    });
    const res = await request(app)
      .get('/api/invoices/inv-1/pdf')
      .set(...auth());
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no document details yet/i);
  });
});

// ── Masking ─────────────────────────────────────────────────────────────────

describe('a document’s figures are money like any other', () => {
  it('withholds the totals and the priced lines from someone who may not see figures', async () => {
    asUser(STATUS_ONLY);
    (prisma.invoice.findFirst as any).mockResolvedValue({
      ...INVOICE,
      subtotal: 30000,
      cgstAmount: 2700,
      sgstAmount: 2700,
      igstAmount: 0,
      roundOff: 0,
      total: 35400,
      amountInWords: 'Rupees Thirty Five Thousand Four Hundred Only.',
      payments: [],
      lineItems: [{ id: 'li-1', serialNo: 1, particulars: 'Retainer', units: 1, unitCost: 30000, amount: 30000 }],
      project: null,
      proforma: null,
      monthCard: null,
    });

    const res = await request(app)
      .get('/api/invoices/inv-1')
      .set(...auth(STATUS_ONLY));

    expect(res.status).toBe(200);
    // Null, not zero. A zero is a claim about the figure; an absence is not.
    expect(res.body.data.amount).toBeNull();
    expect(res.body.data.subtotal).toBeNull();
    expect(res.body.data.total).toBeNull();
    expect(res.body.data.cgstAmount).toBeNull();
    expect(res.body.data.amountInWords).toBeNull();
    // A priced table with the prices removed is still the shape of the deal.
    expect(res.body.data.lineItems).toEqual([]);
    // What they may see: that a document exists at all.
    expect(res.body.data.hasDocument).toBe(true);
  });

  it('sends the figures to someone who may see them', async () => {
    (prisma.invoice.findFirst as any).mockResolvedValue({
      ...INVOICE,
      subtotal: 30000,
      cgstAmount: 2700,
      sgstAmount: 2700,
      igstAmount: 0,
      roundOff: 0,
      total: 35400,
      amountInWords: 'Rupees Thirty Five Thousand Four Hundred Only.',
      payments: [],
      lineItems: [{ id: 'li-1', serialNo: 1, particulars: 'Retainer', units: 1, unitCost: 30000, amount: 30000 }],
      project: null,
      proforma: null,
      monthCard: null,
    });

    const res = await request(app)
      .get('/api/invoices/inv-1')
      .set(...auth());

    expect(res.status).toBe(200);
    expect(res.body.data.subtotal).toBe(30000);
    expect(res.body.data.total).toBe(35400);
    expect(res.body.data.lineItems).toHaveLength(1);
    expect(res.body.data.lineItems[0].amount).toBe(30000);
  });
});
