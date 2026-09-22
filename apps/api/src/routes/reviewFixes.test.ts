import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { RolePreset } from '@prisma/client';

/**
 * Five defects a code review found, and the reasons each one could come back.
 *
 * They have nothing in common except that every one of them was a value
 * quietly kept when it should have been replaced, or replaced when it should
 * have been kept — so each test here pins the direction rather than the code.
 */

const ADMIN = {
  id: 'usr-admin',
  preset: RolePreset.MANAGEMENT,
  permissions: ['work.own', 'work.all', 'money.status', 'money.figures', 'company.read', 'company.write', 'setup.admin'],
};

const auth = () =>
  [
    'Authorization',
    `Bearer ${signJwt({
      userId: ADMIN.id,
      organizationId: 'org-1',
      email: 'admin@eyelevel.local',
      preset: ADMIN.preset,
      permissions: [...ADMIN.permissions],
    })}`,
  ] as const;

let written: { invoice?: any; company?: any; org?: any };

beforeEach(() => {
  written = {};
  (prisma.user.findUnique as any).mockResolvedValue({
    id: ADMIN.id,
    organizationId: 'org-1',
    name: 'Akmal',
    email: 'admin@eyelevel.local',
    preset: ADMIN.preset,
    permissions: [...ADMIN.permissions],
    active: true,
    sessionsValidFrom: null,
  });
  (prisma.activity.create as any).mockResolvedValue({});
  (prisma.documentLineItem.deleteMany as any).mockResolvedValue({ count: 0 });
  (prisma.$transaction as any).mockImplementation(async (fn: any) =>
    fn({
      invoice: {
        update: vi.fn(async ({ data }: any) => {
          written.invoice = data;
          return { id: 'inv-1', ...data };
        }),
      },
      documentLineItem: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    }),
  );
});

// ── 1. The seed's blank password ────────────────────────────────────────────

describe('the seeded password', () => {
  /*
   * `.env.example` ships these keys empty and copying it is the documented
   * setup, so `??` — which only catches undefined — handed every account a
   * password of "". The rule has to be that blank means unset.
   */
  const seed = fs.readFileSync(path.join(__dirname, '../../prisma/seed.ts'), 'utf8');

  it('does not fall back with ?? on the raw environment variable', () => {
    expect(seed).not.toMatch(/process\.env\.SEED_ADMIN_PASSWORD\s*\?\?/);
    expect(seed).not.toMatch(/process\.env\.SEED_DEMO_PASSWORD\s*\?\?/);
  });

  it('treats a blank value as unset', () => {
    // The helper the seed now reads both keys through.
    expect(seed).toMatch(/const raw = process\.env\[key\];\s*\n\s*return raw && raw\.trim\(\) \? raw : null;/);
  });

  it('decides whether to print the generated password by the same rule', () => {
    // It used to read the raw variable here too, so an empty string meant the
    // generated password was never printed — and it was the one in use.
    expect(seed).toMatch(/if \(!configuredAdmin\) \{/);
  });
});

// ── 2. A settled invoice being rewritten ────────────────────────────────────

const INVOICE = {
  id: 'inv-1',
  number: 'INV/26-27/0188',
  organizationId: 'org-1',
  amount: 35400,
  status: 'PAID',
  paidAt: new Date('2026-09-20'),
  company: { billingAddress: null, gstin: null, stateName: 'Tamil Nadu', stateCode: '33' },
  payments: [{ amount: 35400 }],
};

const ORG = {
  name: 'EyeLevel Growth Studio',
  legalName: 'EyeLevel Growth Studio LLP',
  address: 'No. 12, KK Nagar',
  state: 'Tamil Nadu',
  gstNumber: '33AABCE1234F1Z5',
  gstStateCode: '33',
  pan: 'AABCE1234F',
  contactEmail: null,
  declarationText: null,
  defaultPaymentTerms: 'Immediate',
  defaultProformaValidityDays: 30,
  bankAccountHolderName: null,
  bankName: null,
  bankBranch: null,
  bankAccountNumber: null,
  bankIfscCode: null,
};

const saveDocument = (lineItems: unknown[], invoice: Record<string, unknown> = {}) => {
  (prisma.organization.findUnique as any).mockResolvedValue(ORG);
  (prisma.invoice.findFirst as any).mockResolvedValue({ ...INVOICE, ...invoice });
  return request(app)
    .put('/api/invoices/inv-1/document')
    .set(...auth())
    .send({ billingName: 'Client Pvt Ltd', lineItems, placeOfSupply: { code: '33' } });
};

describe('rewriting the document on an invoice that is already paid', () => {
  it('stops being PAID when the new total is more than what was received', async () => {
    // ₹30,000 + 18% = ₹35,400, already paid in full. Re-priced to ₹50,000 the
    // total becomes ₹59,000 — so ₹23,600 is owed, and a row still marked PAID
    // is excluded from outstanding and from overdue, which is where that
    // balance would have gone to die.
    const res = await saveDocument([{ particulars: 'Retainer', units: 1, unitCost: 50000 }]);
    expect(res.status).toBe(200);
    expect(written.invoice.amount).toBe(59000);
    expect(written.invoice.status).toBe('RAISED');
    expect(written.invoice.paidAt).toBeNull();
  });

  it('stays PAID when the total does not change', async () => {
    // Correcting the buyer's address on a settled invoice, say. The figures
    // land where they already were, so nothing about its settlement moves.
    const res = await saveDocument([{ particulars: 'Retainer', units: 1, unitCost: 30000 }]);
    expect(res.status).toBe(200);
    expect(written.invoice.amount).toBe(35400);
    expect(written.invoice.status).toBe('PAID');
    // The original payment date, not today's — it did not get paid again.
    expect(written.invoice.paidAt).toEqual(new Date('2026-09-20'));
  });

  it('becomes PAID when a document is priced down to what was already received', async () => {
    const res = await saveDocument([{ particulars: 'Retainer', units: 1, unitCost: 20000 }], {
      status: 'RAISED',
      paidAt: null,
      payments: [{ amount: 23600 }],
    });
    expect(res.status).toBe(200);
    expect(written.invoice.status).toBe('PAID');
    expect(written.invoice.paidAt).toBeInstanceOf(Date);
  });

  it('leaves an unpaid invoice alone', async () => {
    const res = await saveDocument([{ particulars: 'Retainer', units: 1, unitCost: 30000 }], {
      status: 'RAISED',
      paidAt: null,
      payments: [],
    });
    expect(res.status).toBe(200);
    expect(written.invoice.status).toBe('RAISED');
  });

  it('still refuses to drop the total below money already received', async () => {
    const res = await saveDocument([{ particulars: 'Retainer', units: 1, unitCost: 100 }]);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already received/i);
  });
});

// ── 3. Clearing a company's state ───────────────────────────────────────────

const COMPANY = {
  id: 'co-1',
  organizationId: 'org-1',
  name: 'Client Pvt Ltd',
  stateCode: '29',
  stateName: 'Karnataka',
  gstin: '29AABCU9603R1ZM',
};

const editCompany = (body: Record<string, unknown>) => {
  (prisma.company.findFirst as any).mockResolvedValue(COMPANY);
  (prisma.company.update as any).mockImplementation(async ({ data }: any) => {
    written.company = data;
    return { id: 'co-1', ...data };
  });
  return request(app)
    .patch('/api/companies/co-1')
    .set(...auth())
    .send(body);
};

describe('a company’s state', () => {
  it('can be cleared — an explicit null is not "not supplied"', async () => {
    // This used to fall back through `??` and silently write '29' back, so a
    // state set wrongly could never be removed and went on deciding the tax.
    const res = await editCompany({ stateCode: null, stateName: null });
    expect(res.status).toBe(200);
    expect(written.company.stateCode).toBeNull();
    expect(written.company.stateName).toBeNull();
  });

  it('does not resurrect itself from the GSTIN when cleared', async () => {
    // The company's GSTIN still starts 29. Deriving from it here would undo
    // the clearing on the very same request.
    const res = await editCompany({ stateCode: null });
    expect(res.status).toBe(200);
    expect(written.company.stateCode).toBeNull();
  });

  it('still resolves both halves when one is changed', async () => {
    const res = await editCompany({ stateCode: '27' });
    expect(res.status).toBe(200);
    expect(written.company.stateCode).toBe('27');
    expect(written.company.stateName).toBe('Maharashtra');
  });

  it('leaves the state alone when the request never mentions it', async () => {
    const res = await editCompany({ city: 'Chennai' });
    expect(res.status).toBe(200);
    expect(written.company.stateCode).toBeUndefined();
    expect(written.company.stateName).toBeUndefined();
  });
});

// ── 4. One writer per seller field ──────────────────────────────────────────

describe('the document settings endpoint', () => {
  beforeEach(() => {
    (prisma.organization.update as any).mockImplementation(async ({ data }: any) => {
      written.org = data;
      return { ...ORG, ...data, defaultTermsAndConditions: [], sacCodes: [], signatureImage: null };
    });
  });

  it('does not write the state, the GSTIN or the address', async () => {
    /*
     * Those three belong to `PATCH /config`, which is also what derives
     * `gstStateCode` from the state name. A second writer here did not do that
     * derivation, so setting a GSTIN through this route left the state code
     * behind — still deciding CGST+SGST against IGST on every document.
     */
    const res = await request(app)
      .patch('/api/config/document-settings')
      .set(...auth())
      .send({
        legalName: 'EyeLevel Growth Studio LLP',
        gstNumber: '27AAAAA0000A1Z5',
        stateName: 'Maharashtra',
        address: 'Somewhere else',
        gstStateCode: '27',
      });

    expect(res.status).toBe(200);
    expect(written.org.legalName).toBe('EyeLevel Growth Studio LLP');
    for (const field of ['gstNumber', 'state', 'address', 'gstStateCode']) {
      expect(written.org).not.toHaveProperty(field);
    }
  });

  it('still writes the fields it does own', async () => {
    const res = await request(app)
      .patch('/api/config/document-settings')
      .set(...auth())
      .send({ pan: 'AABCE1234F', declarationText: 'All true.', sacCodes: ['998365'] });
    expect(res.status).toBe(200);
    expect(written.org.pan).toBe('AABCE1234F');
    expect(written.org.declarationText).toBe('All true.');
    expect(written.org.sacCodes).toEqual(['998365']);
  });
});
