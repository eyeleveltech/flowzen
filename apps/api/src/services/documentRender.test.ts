import { describe, it, expect } from 'vitest';
import { SupplyType } from '@prisma/client';
import { renderDocumentHtml } from './documentPdf.js';
import type { RenderableDocument } from './documentModel.js';

/**
 * Three things the printed document says, and who decides them.
 *
 * All three are about the page rather than the figures: the same money renders
 * either way, and these tests would not catch an arithmetic change. They exist
 * because the one difference that is NOT cosmetic — a tax invoice has to break
 * the tax out by head, a proforma does not — is easy to "tidy up" later by
 * someone making the two kinds look the same.
 */

const doc = (over: Partial<RenderableDocument> = {}): RenderableDocument => ({
  kind: 'PROFORMA',
  title: 'PROFORMA INVOICE',
  number: 'EL/PI/26-27/017',
  date: new Date('2026-09-15'),
  validTill: new Date('2026-10-15'),
  dueAt: null,
  seller: {
    legalName: 'EyeLevel Growth Studio LLP',
    tradingName: 'EyeLevel Growth Studio',
    address: 'No. 12, KK Nagar, Chennai',
    gstin: '33AABCE1234F1Z5',
    stateName: 'Tamil Nadu',
    stateCode: '33',
    pan: 'AABCE1234F',
    contactEmail: null,
    declarationText: null,
    paymentTerms: 'Immediate',
    bank: {
      accountHolderName: 'EyeLevel Growth Studio LLP',
      bankName: 'DBS Bank',
      branch: 'KK Nagar',
      accountNumber: '8387210000034496',
      ifsc: 'DBSS0IN0387',
    },
  },
  buyer: {
    name: 'Client Pvt Ltd',
    contactName: null,
    address: 'Chennai',
    gstin: '33AAACB7459F1ZT',
    stateName: 'Tamil Nadu',
    stateCode: '33',
  },
  placeOfSupply: { state: 'Tamil Nadu', code: '33' },
  supplyType: SupplyType.INTRA,
  gstApplicable: true,
  gstRatePercent: 18,
  lines: [
    { serialNo: 1, particulars: 'Performance marketing retainer', units: 1, unitCost: 180000, hsnSac: '998365', amount: 180000, gstRate: 18 },
  ],
  totals: {
    subtotal: 180000,
    cgstAmount: 16200,
    sgstAmount: 16200,
    igstAmount: 0,
    roundOff: 0,
    total: 212400,
    amountInWords: 'Rupees Two Lakh Twelve Thousand Four Hundred Only.',
  },
  customFields: [],
  poNumber: null,
  poDate: null,
  terms: ['Payment due within the validity period stated above.'],
  notes: null,
  declaration: 'This is not a tax invoice.',
  signatureImage: null,
  showSignatureBlock: true,
  frozen: true,
  ...over,
});

const invoice = (over: Partial<RenderableDocument> = {}) =>
  doc({ kind: 'INVOICE', title: 'TAX INVOICE', number: 'INV/26-27/0188', validTill: null, dueAt: new Date('2026-09-30'), ...over });

// ── 1. The state, without its code ──────────────────────────────────────────

describe('a state on the document', () => {
  it('prints the name and not the code in brackets', () => {
    const html = renderDocumentHtml(doc());
    expect(html).toContain('Tamil Nadu');
    expect(html).not.toContain('Tamil Nadu (33)');
  });

  it('does the same on a tax invoice', () => {
    // The code is recoverable from the state name and from the first two
    // digits of the GSTIN printed a few lines above; Rule 46 asks for the
    // name of the State.
    expect(renderDocumentHtml(invoice())).not.toContain('(33)');
  });

  it('resolves a name from a bare code rather than printing the number raw', () => {
    const html = renderDocumentHtml(doc({ placeOfSupply: { state: null, code: '29' } }));
    expect(html).toContain('Karnataka');
    expect(html).not.toContain('State code 29');
  });

  it('falls back to the raw code only when it is not a real one', () => {
    const html = renderDocumentHtml(doc({ placeOfSupply: { state: null, code: '99' } }));
    expect(html).toContain('State code 99');
  });
});

// ── 2. One GST line on a quote, the heads on a tax invoice ──────────────────

describe('the tax rows', () => {
  it('shows a proforma one GST line', () => {
    const html = renderDocumentHtml(doc());
    expect(html).toContain('GST @ 18%');
    expect(html).not.toContain('CGST');
    expect(html).not.toContain('SGST');
    // ₹16,200 + ₹16,200, added back to the figure it was split from.
    expect(html).toContain('₹32,400.00');
  });

  it('still breaks a tax invoice out by head', () => {
    /*
     * Not a style choice. Rule 46(m) of the CGST Rules requires a tax invoice
     * to show "the amount of tax charged in respect of taxable goods or
     * services (central tax, State tax, integrated tax...)" — by head. A
     * proforma is a quotation with no statutory format at all.
     */
    const html = renderDocumentHtml(invoice());
    expect(html).toContain('CGST @ 9%');
    expect(html).toContain('SGST @ 9%');
    expect(html).not.toContain('>GST @ 18%<');
  });

  it('adds the halves back exactly, odd paisa included', () => {
    // documentTotals rounds one half and gives the remainder to the other, so
    // the two never sum to anything but the tax itself.
    const html = renderDocumentHtml(
      doc({ totals: { ...doc().totals, cgstAmount: 1416.6, sgstAmount: 1416.61, total: 18566 } }),
    );
    expect(html).toContain('₹2,833.21');
  });

  it('keeps IGST as one line on an inter-state invoice', () => {
    const html = renderDocumentHtml(
      invoice({ supplyType: SupplyType.INTER, totals: { ...doc().totals, cgstAmount: 0, sgstAmount: 0, igstAmount: 32400 } }),
    );
    expect(html).toContain('IGST @ 18%');
    expect(html).not.toContain('CGST');
  });

  it('prints no tax row at all when GST does not apply', () => {
    const html = renderDocumentHtml(
      doc({ gstApplicable: false, totals: { ...doc().totals, cgstAmount: 0, sgstAmount: 0, total: 180000 } }),
    );
    expect(html).not.toContain('GST @');
  });
});

// ── 3. The signatory box is a choice ────────────────────────────────────────

describe('the signatory box', () => {
  it('prints when it is switched on', () => {
    const html = renderDocumentHtml(doc());
    expect(html).toContain('Authorised Signatory');
    expect(html).toContain('For EyeLevel Growth Studio LLP');
  });

  it('is gone entirely when it is switched off', () => {
    const html = renderDocumentHtml(doc({ showSignatureBlock: false }));
    expect(html).not.toContain('Authorised Signatory');
    expect(html).not.toContain('For EyeLevel Growth Studio LLP');
    // The bank details are a separate block and must survive.
    expect(html).toContain('DBSS0IN0387');
  });

  it('drops the signature image with it, rather than leaving one floating', () => {
    const html = renderDocumentHtml(
      doc({ showSignatureBlock: false, signatureImage: 'data:image/png;base64,AAAA' }),
    );
    expect(html).not.toContain('data:image/png;base64,AAAA');
  });

  it('applies to a tax invoice the same way', () => {
    expect(renderDocumentHtml(invoice({ showSignatureBlock: false }))).not.toContain('Authorised Signatory');
  });
});
