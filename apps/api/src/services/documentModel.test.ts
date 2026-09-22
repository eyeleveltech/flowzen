import { describe, it, expect } from 'vitest';
import { SupplyType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import {
  buildDocumentSnapshot,
  buildSellerSnapshot,
  resolveState,
  resolveSupplyType,
  sellerBlockGaps,
  loadRenderableDocument,
} from './documentModel.js';

/**
 * CR-02 §3, §4 and §9 — where a document's state comes from, and what gets
 * frozen onto it.
 *
 * The bug this change request fixes lives in one line of the old PDF service:
 *
 *   const clientState = proforma.gstin?.slice(0, 2);
 *   const isInterState = Boolean(clientState && clientState !== orgState);
 *
 * A client with no GSTIN has no first two digits, so `isInterState` is false,
 * so an unregistered buyer anywhere in India was charged CGST and SGST on a
 * supply that owes IGST. The tests below are as much about that as about the
 * new fields.
 */

const ORG = {
  name: 'EyeLevel Growth Studio',
  legalName: 'EyeLevel Growth Studio LLP',
  address: 'No. 12, KK Nagar\nChennai 600078',
  state: 'Tamil Nadu',
  gstNumber: '33AABCE1234F1Z5',
  gstStateCode: '33',
  pan: 'AABCE1234F',
  contactEmail: 'accounts@eyelevelstudio.in',
  declarationText: 'Everything here is true.',
  defaultPaymentTerms: 'Immediate',
  bankAccountHolderName: 'EYE LEVEL GROWTH STUDIO',
  bankName: 'DBS Bank',
  bankBranch: 'KK Nagar',
  bankAccountNumber: '1234567890',
  bankIfscCode: 'DBSS0IN0387',
};

const lines = [{ particulars: 'Retainer', units: 1, unitCost: 100000 }];

describe('resolveSupplyType', () => {
  it('is intra-state when the place of supply is the seller state', () => {
    expect(resolveSupplyType('33', '33')).toBe(SupplyType.INTRA);
  });

  it('is inter-state when it is anywhere else', () => {
    expect(resolveSupplyType('29', '33')).toBe(SupplyType.INTER);
  });

  it('tolerates a code typed without its leading zero', () => {
    expect(resolveSupplyType('7', '07')).toBe(SupplyType.INTRA);
    expect(resolveSupplyType('07', '7')).toBe(SupplyType.INTRA);
  });

  it('falls back to intra-state when there is no place of supply to compare', () => {
    // Only reachable for a row raised before CR-02; the write path always
    // records one. Intra is what the old code did, so an old document reprints
    // as it was sent.
    expect(resolveSupplyType(null, '33')).toBe(SupplyType.INTRA);
  });
});

describe('resolveState', () => {
  it('reads the state off a GSTIN when that is all there is', () => {
    expect(resolveState({ gstin: '29AABCU9603R1ZM' })).toEqual({ code: '29', name: 'Karnataka' });
  });

  it('prefers an explicit code over the GSTIN, because the two can legitimately differ', () => {
    expect(resolveState({ code: '27', gstin: '29AABCU9603R1ZM' })).toEqual({ code: '27', name: 'Maharashtra' });
  });

  it('matches a typed state name back to its code', () => {
    expect(resolveState({ name: 'tamil nadu' })).toEqual({ code: '33', name: 'Tamil Nadu' });
  });

  it('keeps an unrecognised name rather than discarding what somebody typed', () => {
    expect(resolveState({ name: 'Somewhere Else' })).toEqual({ code: null, name: 'Somewhere Else' });
  });

  it('is empty when there is nothing to go on', () => {
    expect(resolveState({})).toEqual({ code: null, name: null });
  });

  it('prints the statutory spelling, not the one that was typed', () => {
    expect(resolveState({ code: '33', name: 'Tamilnadu' }).name).toBe('Tamil Nadu');
  });
});

describe('buildSellerSnapshot', () => {
  it('uses the registered name on the document and keeps the trading name separately', () => {
    const seller = buildSellerSnapshot(ORG);
    expect(seller.legalName).toBe('EyeLevel Growth Studio LLP');
    expect(seller.tradingName).toBe('EyeLevel Growth Studio');
  });

  it('falls back to the trading name when no registered name has been entered', () => {
    const seller = buildSellerSnapshot({ ...ORG, legalName: null });
    expect(seller.legalName).toBe('EyeLevel Growth Studio');
  });

  it('names the state from its code rather than from whatever was typed', () => {
    const seller = buildSellerSnapshot({ ...ORG, state: 'TN' });
    expect(seller.stateName).toBe('Tamil Nadu');
    expect(seller.stateCode).toBe('33');
  });

  it('finds the seller state from the GSTIN when no state code is set', () => {
    const seller = buildSellerSnapshot({ ...ORG, gstStateCode: null, state: null });
    expect(seller.stateCode).toBe('33');
  });
});

describe('what the seller block still needs', () => {
  /*
   * Rule 46 of the CGST Rules lists the supplier's name, address and GSTIN
   * among the particulars a tax invoice must contain. A page headed TAX
   * INVOICE without them is one a client's accounts team rejects and which
   * cannot support an input tax credit claim — so it is not printed at all.
   */
  it('finds nothing wrong with a complete seller block', () => {
    expect(sellerBlockGaps(buildSellerSnapshot(ORG)).filter((g) => g.severity === 'required')).toEqual([]);
  });

  it('blocks on a missing GSTIN, and says which tab sets it', () => {
    const gaps = sellerBlockGaps(buildSellerSnapshot({ ...ORG, gstNumber: null }));
    const gstin = gaps.find((g) => g.key === 'gstNumber');
    expect(gstin?.severity).toBe('required');
    expect(gstin?.where).toBe('Tax & numbering');
  });

  it('blocks on a missing address', () => {
    const gaps = sellerBlockGaps(buildSellerSnapshot({ ...ORG, address: null }));
    expect(gaps.find((g) => g.key === 'address')?.severity).toBe('required');
  });

  it('treats whitespace as missing, because a space does not print as an address', () => {
    const gaps = sellerBlockGaps(buildSellerSnapshot({ ...ORG, address: '   ' }));
    expect(gaps.find((g) => g.key === 'address')?.severity).toBe('required');
  });

  it('asks for a PAN and a declaration without blocking on them', () => {
    const gaps = sellerBlockGaps(buildSellerSnapshot({ ...ORG, pan: null, declarationText: null }));
    expect(gaps.find((g) => g.key === 'pan')?.severity).toBe('recommended');
    expect(gaps.find((g) => g.key === 'declarationText')?.severity).toBe('recommended');
    expect(gaps.filter((g) => g.severity === 'required')).toEqual([]);
  });

  it('blocks a tax invoice but never a proforma', async () => {
    // A proforma is a quotation. It prints "This is not a tax invoice", it is
    // routinely sent before any of this is filled in, and no rule asks it to
    // carry the supplier's GSTIN. Blocking it would be the app inventing a
    // requirement rather than enforcing one.
    const incomplete = { ...ORG, gstNumber: null, address: null, gstStateCode: null, state: null };
    const row = {
      id: 'doc-1',
      number: 'EL/PI/26-27/001',
      amount: 30000,
      raisedAt: new Date('2026-09-01'),
      validTill: new Date('2026-10-01'),
      dueAt: new Date('2026-09-15'),
      gstApplicable: true,
      gstRatePercent: 18,
      subtotal: 30000,
      cgstAmount: 2700,
      sgstAmount: 2700,
      igstAmount: 0,
      roundOff: 0,
      total: 35400,
      amountInWords: 'Rupees Thirty Five Thousand Four Hundred Only.',
      supplyType: 'INTRA',
      placeOfSupplyState: 'Tamil Nadu',
      placeOfSupplyCode: '33',
      billingName: 'Client Pvt Ltd',
      billingContactName: null,
      billingAddress: null,
      billingStateName: null,
      billingStateCode: null,
      gstin: null,
      sellerSnapshot: null,
      customFields: null,
      poNumber: null,
      poDate: null,
      terms: 'Payment on receipt',
      notes: null,
      description: 'Retainer',
      sacCode: null,
      organization: { ...incomplete, defaultTermsAndConditions: [], signatureImage: null },
      company: { name: 'Client Pvt Ltd', billingAddress: null, gstin: null },
      lineItems: [
        { serialNo: 1, particulars: 'Retainer', units: 1, unitCost: 30000, hsnSac: null, amount: 30000, gstRate: 18 },
      ],
    };
    (prisma.proforma.findFirst as any).mockResolvedValue(row);
    (prisma.invoice.findFirst as any).mockResolvedValue(row);

    const proforma = await loadRenderableDocument('PROFORMA', 'doc-1', 'org-1');
    expect(proforma.title).toBe('PROFORMA INVOICE');
    expect(proforma.declaration).toBe('This is not a tax invoice.');

    await expect(loadRenderableDocument('INVOICE', 'doc-1', 'org-1')).rejects.toThrow(
      /has to carry your own/,
    );
  });

  it('names each gap against exactly one Settings tab', () => {
    // No field is editable in two places, so no gap may point at two.
    const gaps = sellerBlockGaps(
      buildSellerSnapshot({
        ...ORG,
        gstNumber: null,
        address: null,
        gstStateCode: null,
        state: null,
        pan: null,
        declarationText: null,
        bankAccountNumber: null,
        bankIfscCode: null,
      }),
    );
    expect(new Set(gaps.map((g) => g.key)).size).toBe(gaps.length);
    for (const gap of gaps) {
      expect(['Organisation', 'Tax & numbering', 'Documents & billing']).toContain(gap.where);
    }
  });
});

describe('buildDocumentSnapshot', () => {
  it('defaults the place of supply to the buyer, and taxes against it', () => {
    const snap = buildDocumentSnapshot({
      org: ORG,
      lineItems: lines,
      gstApplicable: true,
      gstRatePercent: 18,
      buyer: { name: 'Client Pvt Ltd', stateCode: '29' },
    });
    expect(snap.placeOfSupplyCode).toBe('29');
    expect(snap.placeOfSupplyState).toBe('Karnataka');
    expect(snap.supplyType).toBe(SupplyType.INTER);
    expect(snap.igstAmount).toBe(18000);
  });

  it('lets the place of supply differ from the buyer state, which is the whole point of §4', () => {
    const snap = buildDocumentSnapshot({
      org: ORG,
      lineItems: lines,
      gstApplicable: true,
      gstRatePercent: 18,
      // Registered in Tamil Nadu, but the supply happens in Karnataka.
      buyer: { name: 'Client Pvt Ltd', stateCode: '33' },
      placeOfSupply: { code: '29' },
    });
    expect(snap.billingStateCode).toBe('33');
    expect(snap.placeOfSupplyCode).toBe('29');
    expect(snap.supplyType).toBe(SupplyType.INTER);
    expect(snap.cgstAmount).toBe(0);
  });

  it('charges IGST to an out-of-state client with no GSTIN — the bug CR-02 exists to fix', () => {
    const snap = buildDocumentSnapshot({
      org: ORG,
      lineItems: lines,
      gstApplicable: true,
      gstRatePercent: 18,
      // No GSTIN at all. The old rule read the state off `gstin.slice(0, 2)`,
      // got undefined, and billed this as a Tamil Nadu supply.
      buyer: { name: 'Unregistered Client', gstin: null, stateCode: '29' },
    });
    expect(snap.gstin).toBeNull();
    expect(snap.supplyType).toBe(SupplyType.INTER);
    expect(snap.igstAmount).toBe(18000);
    expect(snap.cgstAmount).toBe(0);
    expect(snap.sgstAmount).toBe(0);
  });

  it('still reads the state off the GSTIN when nothing better was given', () => {
    const snap = buildDocumentSnapshot({
      org: ORG,
      lineItems: lines,
      gstApplicable: true,
      gstRatePercent: 18,
      buyer: { name: 'Client Pvt Ltd', gstin: '29AABCU9603R1ZM' },
    });
    expect(snap.billingStateCode).toBe('29');
    expect(snap.supplyType).toBe(SupplyType.INTER);
  });

  it('freezes the seller block onto the document', () => {
    const snap = buildDocumentSnapshot({
      org: ORG,
      lineItems: lines,
      gstApplicable: true,
      gstRatePercent: 18,
      buyer: { name: 'Client Pvt Ltd' },
    });
    const seller = snap.sellerSnapshot as unknown as Record<string, unknown>;
    expect(seller.gstin).toBe('33AABCE1234F1Z5');
    expect(seller.pan).toBe('AABCE1234F');
    expect((seller.bank as Record<string, unknown>).ifsc).toBe('DBSS0IN0387');
  });

  it('numbers the lines and totals them', () => {
    const snap = buildDocumentSnapshot({
      org: ORG,
      lineItems: [
        { particulars: 'Retainer', units: 1, unitCost: 45000 },
        { particulars: 'Reels', units: 3, unitCost: 8500 },
      ],
      gstApplicable: true,
      gstRatePercent: 18,
      buyer: { name: 'Client Pvt Ltd', stateCode: '33' },
    });
    expect(snap.lines.map((l) => l.serialNo)).toEqual([1, 2]);
    expect(snap.subtotal).toBe(70500);
    expect(snap.total).toBe(83190);
    expect(snap.amountInWords).toBe('Rupees Eighty Three Thousand One Hundred Ninety Only.');
  });

  it('drops a custom field row that was added and left blank', () => {
    const snap = buildDocumentSnapshot({
      org: ORG,
      lineItems: lines,
      gstApplicable: true,
      gstRatePercent: 18,
      buyer: { name: 'Client Pvt Ltd' },
      customFields: [{ label: 'PO number', value: 'PO-1' }],
    });
    expect(snap.customFields).toEqual([{ label: 'PO number', value: 'PO-1' }]);
  });
});
