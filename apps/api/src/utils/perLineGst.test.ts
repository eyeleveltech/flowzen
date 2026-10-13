import { describe, it, expect } from 'vitest';
import { SupplyType } from '@prisma/client';
import { computeDocumentTotals, taxByRate } from './documentTotals.js';
import { buildDocumentSnapshot, type RenderableDocument } from '../services/documentModel.js';
import { renderDocumentHtml } from '../services/documentPdf.js';

/**
 * Money Plan 2, decision 7 — GST per line, at each line's own rate.
 *
 * And the data-safety rule beside it: a document issued before this keeps the
 * maths it was issued with. Its stored totals are never recomputed, and its PDF
 * is never restated with the new rows.
 */

const mixed = [
  { particulars: 'Campaign film', units: 1, unitCost: 10000, gstRate: 18 },
  { particulars: 'Printed brochures', units: 2, unitCost: 2000, gstRate: 5 },
];

describe('a document with lines at 18% and 5%', () => {
  it('taxes each line at its own rate (same state: CGST + SGST)', () => {
    const t = computeDocumentTotals(mixed, { gstApplicable: true, gstRatePercent: 18, isInterState: false, perLineGst: true });
    expect(t.subtotal).toBe(14000);
    // 18% of 10,000 = 1,800, and 5% of 4,000 = 200.
    expect(t.totalTax).toBe(2000);
    expect(t.cgstAmount).toBe(1000);
    expect(t.sgstAmount).toBe(1000);
    expect(t.igstAmount).toBe(0);
    expect(t.total).toBe(16000);
  });

  it('and as IGST when the supply is in another state', () => {
    const t = computeDocumentTotals(mixed, { gstApplicable: true, gstRatePercent: 18, isInterState: true, perLineGst: true });
    expect(t.igstAmount).toBe(2000);
    expect(t.cgstAmount + t.sgstAmount).toBe(0);
  });

  it('a line with no rate of its own takes the document rate', () => {
    const t = computeDocumentTotals(
      [{ particulars: 'Fee', units: 1, unitCost: 10000 }, { particulars: 'Print', units: 1, unitCost: 1000, gstRate: 5 }],
      { gstApplicable: true, gstRatePercent: 18, isInterState: true, perLineGst: true },
    );
    expect(t.igstAmount).toBe(1800 + 50);
  });

  it('rounds the tax once per rate, then the total once to the rupee', () => {
    const t = computeDocumentTotals(
      [
        { particulars: 'A', units: 1, unitCost: 333.33, gstRate: 18 },
        { particulars: 'B', units: 1, unitCost: 333.33, gstRate: 18 },
        { particulars: 'C', units: 1, unitCost: 99.99, gstRate: 5 },
      ],
      { gstApplicable: true, gstRatePercent: 18, isInterState: false, perLineGst: true },
    );
    const groups = taxByRate(t.lines, false);
    expect(groups.map((g) => [g.rate, g.taxable, g.totalTax])).toEqual([
      [18, 666.66, 120],
      [5, 99.99, 5],
    ]);
    expect(t.totalTax).toBe(125);
    expect(t.total).toBe(Math.round(766.65 + 125));
    expect(Math.round((t.total - (t.subtotal + t.totalTax)) * 100) / 100).toBe(t.roundOff);
  });

  it('a new document is priced this way', () => {
    const snap = buildDocumentSnapshot({
      org: {
        name: 'EyeLevel Growth Studio',
        legalName: 'EyeLevel Growth Studio LLP',
        address: 'Chennai',
        state: 'Tamil Nadu',
        gstNumber: '33AABCE1234F1Z5',
        gstStateCode: '33',
        pan: 'AABCE1234F',
        contactEmail: null,
        declarationText: null,
        defaultPaymentTerms: 'Immediate',
        bankAccountHolderName: 'EYE LEVEL',
        bankName: 'DBS Bank',
        bankBranch: 'KK Nagar',
        bankAccountNumber: '1',
        bankIfscCode: 'DBSS0IN0387',
      } as never,
      lineItems: mixed,
      gstApplicable: true,
      gstRatePercent: 18,
      buyer: { name: 'Client', stateCode: '33' },
    });
    expect(snap.cgstAmount + snap.sgstAmount).toBe(2000);
    expect(snap.total).toBe(16000);
  });
});

describe('one rate gives exactly what it always did', () => {
  it('for a spread of amounts, same state and not', () => {
    const amounts = [1, 99.99, 100.01, 12345.67, 180000, 333.33, 0.5, 7777.77];
    for (const isInterState of [false, true]) {
      for (const unitCost of amounts) {
        const items = [
          { particulars: 'A', units: 3, unitCost, gstRate: 18 },
          { particulars: 'B', units: 1, unitCost: unitCost / 3, gstRate: 18 },
        ];
        const before = computeDocumentTotals(items, { gstApplicable: true, gstRatePercent: 18, isInterState });
        const now = computeDocumentTotals(items, { gstApplicable: true, gstRatePercent: 18, isInterState, perLineGst: true });
        expect(now).toEqual(before);
      }
    }
  });
});

describe('a document issued before this release', () => {
  it('re-priced the old way (no per-line flag) still taxes every line at the document rate', () => {
    // How loadRenderableDocument reprints a pre-CR-02 document: unchanged.
    const t = computeDocumentTotals(mixed, { gstApplicable: true, gstRatePercent: 18, isInterState: false });
    expect(t.totalTax).toBe(2520);
    expect(t.total).toBe(16520);
  });

  const base: RenderableDocument = {
    kind: 'INVOICE',
    title: 'TAX INVOICE',
    number: 'EL/INV/26-27/001',
    date: new Date('2026-09-15'),
    validTill: null,
    dueAt: new Date('2026-09-30'),
    seller: {
      legalName: 'EyeLevel Growth Studio LLP',
      tradingName: 'EyeLevel Growth Studio',
      address: 'Chennai',
      gstin: '33AABCE1234F1Z5',
      stateName: 'Tamil Nadu',
      stateCode: '33',
      pan: 'AABCE1234F',
      contactEmail: null,
      declarationText: null,
      paymentTerms: 'Immediate',
      bank: { accountHolderName: 'X', bankName: 'DBS', branch: 'KK Nagar', accountNumber: '1', ifsc: 'DBSS0IN0387' },
    },
    buyer: { name: 'Client', contactName: null, address: null, gstin: null, stateName: 'Tamil Nadu', stateCode: '33' },
    placeOfSupply: { state: 'Tamil Nadu', code: '33' },
    supplyType: SupplyType.INTRA,
    gstApplicable: true,
    gstRatePercent: 18,
    lines: [
      { serialNo: 1, particulars: 'Campaign film', units: 1, unitCost: 10000, hsnSac: null, amount: 10000, gstRate: 18 },
      { serialNo: 2, particulars: 'Printed brochures', units: 2, unitCost: 2000, hsnSac: null, amount: 4000, gstRate: 5 },
    ],
    totals: { subtotal: 14000, cgstAmount: 1000, sgstAmount: 1000, igstAmount: 0, roundOff: 0, total: 16000, amountInWords: 'x' },
    customFields: [],
    poNumber: null,
    poDate: null,
    terms: [],
    notes: null,
    declaration: 'x',
    signatureImage: null,
    showSignatureBlock: true,
    frozen: true,
  };

  it('a new mixed-rate invoice prints a tax row per rate', () => {
    const html = renderDocumentHtml(base);
    expect(html).toContain('CGST @ 9%');
    expect(html).toContain('CGST @ 2.5%');
    expect(html).toContain('SGST @ 2.5%');
  });

  it('an old one, taxed at its one rate, prints exactly its stored figures under that rate', () => {
    // Issued before per-line GST: the 5% line was taxed at 18% and that is
    // what the client holds and Tally has. The PDF must say so, not restate it.
    const old = { ...base, totals: { ...base.totals, cgstAmount: 1260, sgstAmount: 1260, total: 16520 } };
    const html = renderDocumentHtml(old);
    expect(html).toContain('CGST @ 9%');
    expect(html).not.toContain('2.5%');
    expect(html).toContain('1,260');
  });
});
