/**
 * CR-02 §0 — "One template serves both documents. Build it once."
 *
 * This is the "once". A proforma and a tax invoice are the same page with
 * three differences (title, where the number comes from, and the declaration),
 * so everything else is normalised here into a single `RenderableDocument` and
 * the renderer in `documentPdf.ts` never asks which kind it is holding.
 *
 * It does two jobs, and they are two halves of the same rule:
 *
 *   `buildDocumentSnapshot` runs on WRITE. It is where the seller block, the
 *   buyer block, the place of supply and every figure are frozen onto the row.
 *
 *   `loadRenderableDocument` runs on READ. It prefers what was frozen, and
 *   falls back to deriving it only for documents raised before CR-02 existed —
 *   which is not a leniency but the point: a document already sent to a client
 *   must reprint as it was sent, not as today's rules would have priced it.
 */

import type { Prisma } from '@prisma/client';
import { SupplyType } from '@prisma/client';
import { GST_STATES, gstStateName, normaliseStateCode, stateCodeFromGstin } from '@flowzen/shared';
import { prisma } from '../lib/prisma.js';
import { amountInWords } from '../utils/amountInWords.js';
import {
  computeDocumentTotals,
  type ComputedLineItem,
  type LineItemInput,
} from '../utils/documentTotals.js';

export type DocumentKind = 'PROFORMA' | 'INVOICE';

/** A proforma is not a tax invoice, and nobody gets to edit that sentence away. */
export const PROFORMA_DECLARATION = 'This is not a tax invoice.';
const DEFAULT_INVOICE_DECLARATION =
  'We declare that this invoice shows the actual price of the services described and that all particulars are true and correct.';

export interface SellerSnapshot {
  /** The registered entity on the tax document. Falls back to the trading name. */
  legalName: string;
  tradingName: string;
  address: string | null;
  gstin: string | null;
  stateName: string | null;
  stateCode: string | null;
  pan: string | null;
  contactEmail: string | null;
  declarationText: string | null;
  paymentTerms: string;
  bank: {
    accountHolderName: string | null;
    bankName: string | null;
    branch: string | null;
    accountNumber: string | null;
    ifsc: string | null;
  };
}

export interface CustomField {
  label: string;
  value: string;
}

export interface RenderableDocument {
  kind: DocumentKind;
  /** "PROFORMA INVOICE" or "TAX INVOICE" — CR-02 §0. */
  title: string;
  number: string;
  date: Date;
  /** Proformas only; an invoice has a due date instead. */
  validTill: Date | null;
  dueAt: Date | null;
  seller: SellerSnapshot;
  buyer: {
    name: string;
    contactName: string | null;
    address: string | null;
    gstin: string | null;
    stateName: string | null;
    stateCode: string | null;
  };
  placeOfSupply: { state: string | null; code: string | null };
  supplyType: SupplyType;
  gstApplicable: boolean;
  gstRatePercent: number;
  lines: ComputedLineItem[];
  totals: {
    subtotal: number;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    roundOff: number;
    total: number;
    amountInWords: string;
  };
  customFields: CustomField[];
  poNumber: string | null;
  poDate: Date | null;
  terms: string[];
  notes: string | null;
  declaration: string;
  /** Logo and signature are read live, never snapshotted — see below. */
  signatureImage: string | null;
  /**
   * Whether to print the "For <legal name> / Authorised Signatory" box.
   *
   * Live rather than snapshotted, and for the same reason the signature image
   * is: it is a presentation choice about the letterhead, not a claim about the
   * transaction. Turning it off means every reprint drops it, exactly as
   * replacing the signature image means every reprint carries the new one.
   */
  showSignatureBlock: boolean;
  /**
   * False for a document raised before CR-02, whose figures were derived at
   * read time rather than read off the row. The renderer does not care; the
   * distinction matters when reasoning about why a reprint says what it says.
   */
  frozen: boolean;
}

// ── Seller ──────────────────────────────────────────────────────────────────

type OrgForDocument = {
  name: string;
  legalName: string | null;
  address: string | null;
  state: string | null;
  gstNumber: string | null;
  gstStateCode: string | null;
  pan: string | null;
  contactEmail: string | null;
  declarationText: string | null;
  defaultPaymentTerms: string;
  bankAccountHolderName: string | null;
  bankName: string | null;
  bankBranch: string | null;
  bankAccountNumber: string | null;
  bankIfscCode: string | null;
};

/**
 * The seller block exactly as it will print.
 *
 * The logo and the signature image are deliberately NOT in here. They are
 * pictures rather than claims — nobody queries an old invoice to find out what
 * the letterhead looked like — and a base64 signature copied onto every
 * document row would put tens of kilobytes per invoice into a column that is
 * read once. They are loaded live at render time instead.
 */
export function buildSellerSnapshot(org: OrgForDocument): SellerSnapshot {
  const stateCode = normaliseStateCode(org.gstStateCode) ?? stateCodeFromGstin(org.gstNumber);
  return {
    legalName: org.legalName?.trim() || org.name,
    tradingName: org.name,
    address: org.address ?? null,
    gstin: org.gstNumber ?? null,
    stateName: gstStateName(stateCode) ?? org.state ?? null,
    stateCode,
    pan: org.pan ?? null,
    contactEmail: org.contactEmail ?? null,
    declarationText: org.declarationText ?? null,
    paymentTerms: org.defaultPaymentTerms,
    bank: {
      accountHolderName: org.bankAccountHolderName ?? null,
      bankName: org.bankName ?? null,
      branch: org.bankBranch ?? null,
      accountNumber: org.bankAccountNumber ?? null,
      ifsc: org.bankIfscCode ?? null,
    },
  };
}

/** One thing the seller block is missing, and where somebody goes to set it. */
export interface SellerGap {
  key: string;
  label: string;
  /** The Settings tab that owns it — no field is editable in two places. */
  where: string;
  /**
   * `required` blocks a TAX INVOICE. Rule 46 of the CGST Rules lists the
   * supplier's name, address and GSTIN among the particulars a tax invoice
   * must contain; a document missing one is not a tax invoice, whatever it
   * says at the top. `recommended` is everything a client would expect to
   * see but the law does not compel.
   */
  severity: 'required' | 'recommended';
}

/**
 * What the seller block still needs before a document is worth sending.
 *
 * Kept here, beside the snapshot it describes, so the PDF route, the email
 * route and the Settings screen all ask the same question and get the same
 * answer — rather than the screen saying "looks fine" while the renderer
 * quietly leaves a legally required line off the page.
 */
export function sellerBlockGaps(seller: SellerSnapshot): SellerGap[] {
  const gaps: SellerGap[] = [];
  const missing = (v: string | null | undefined) => !v || !String(v).trim();

  if (missing(seller.gstin)) {
    gaps.push({ key: 'gstNumber', label: 'GSTIN', where: 'Tax & numbering', severity: 'required' });
  }
  if (missing(seller.address)) {
    gaps.push({ key: 'address', label: 'Registered address', where: 'Organisation', severity: 'required' });
  }
  if (missing(seller.stateCode)) {
    gaps.push({ key: 'stateCode', label: 'State', where: 'Tax & numbering', severity: 'required' });
  }
  if (missing(seller.pan)) {
    gaps.push({ key: 'pan', label: 'PAN', where: 'Documents & billing', severity: 'recommended' });
  }
  if (missing(seller.declarationText)) {
    gaps.push({ key: 'declarationText', label: 'Declaration', where: 'Documents & billing', severity: 'recommended' });
  }
  if (missing(seller.bank.accountNumber) || missing(seller.bank.ifsc)) {
    gaps.push({ key: 'bank', label: 'Bank details', where: 'Documents & billing', severity: 'recommended' });
  }
  return gaps;
}

/** Tolerates a snapshot written by an older shape rather than throwing on read. */
function readSellerSnapshot(raw: Prisma.JsonValue | null, fallback: SellerSnapshot): SellerSnapshot {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback;
  const s = raw as Record<string, unknown>;
  const bank = (s.bank && typeof s.bank === 'object' ? s.bank : {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
  return {
    legalName: str(s.legalName) ?? fallback.legalName,
    tradingName: str(s.tradingName) ?? fallback.tradingName,
    address: str(s.address),
    gstin: str(s.gstin),
    stateName: str(s.stateName),
    stateCode: str(s.stateCode),
    pan: str(s.pan),
    contactEmail: str(s.contactEmail),
    declarationText: str(s.declarationText),
    paymentTerms: str(s.paymentTerms) ?? fallback.paymentTerms,
    bank: {
      accountHolderName: str(bank.accountHolderName),
      bankName: str(bank.bankName),
      branch: str(bank.branch),
      accountNumber: str(bank.accountNumber),
      ifsc: str(bank.ifsc),
    },
  };
}

// ── Place of supply ─────────────────────────────────────────────────────────

/**
 * CR-02 §6. Intra- or inter-state is decided by comparing the PLACE OF SUPPLY
 * against the SELLER's state — not, as this app did until now, by reading the
 * first two digits of the BUYER's GSTIN. That old rule quietly made every
 * client without a GSTIN on file a same-state client, so an unregistered buyer
 * in another state was charged CGST+SGST on a supply that owes IGST.
 *
 * With no place of supply recorded at all the answer is INTRA, which is the
 * conservative reading (it is what the seller's own state implies) and is also
 * exactly what the old code did — but the write path always records one, so
 * this only ever applies to rows raised before CR-02.
 */
export function resolveSupplyType(
  placeOfSupplyCode: string | null | undefined,
  sellerStateCode: string | null | undefined,
): SupplyType {
  const place = normaliseStateCode(placeOfSupplyCode);
  const seller = normaliseStateCode(sellerStateCode);
  if (!place || !seller) return SupplyType.INTRA;
  return place === seller ? SupplyType.INTRA : SupplyType.INTER;
}

/** Whatever we can honestly say about a state from a code, a name, or a GSTIN. */
export function resolveState(input: {
  code?: string | null;
  name?: string | null;
  gstin?: string | null;
}): { code: string | null; name: string | null } {
  const code = normaliseStateCode(input.code) ?? stateCodeFromGstin(input.gstin);
  if (code) return { code, name: gstStateName(code) };
  const typed = input.name?.trim();
  if (!typed) return { code: null, name: null };
  const matched = GST_STATES.find((s) => s.name.toLowerCase() === typed.toLowerCase());
  return matched ? { code: matched.code, name: matched.name } : { code: null, name: typed };
}

// ── Write path ──────────────────────────────────────────────────────────────

export interface SnapshotInput {
  org: OrgForDocument;
  lineItems: LineItemInput[];
  gstApplicable: boolean;
  gstRatePercent: number;
  buyer: {
    name: string;
    contactName?: string | null;
    address?: string | null;
    gstin?: string | null;
    stateName?: string | null;
    stateCode?: string | null;
  };
  /** Omitted means "same as the buyer" — the form's default, applied here so both routes agree. */
  placeOfSupply?: { state?: string | null; code?: string | null } | null;
  customFields?: CustomField[] | null;
}

export interface DocumentSnapshot {
  billingName: string;
  billingContactName: string | null;
  billingAddress: string | null;
  gstin: string | null;
  billingStateName: string | null;
  billingStateCode: string | null;
  placeOfSupplyState: string | null;
  placeOfSupplyCode: string | null;
  supplyType: SupplyType;
  sellerSnapshot: Prisma.InputJsonValue;
  customFields: Prisma.InputJsonValue;
  subtotal: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  roundOff: number;
  total: number;
  amountInWords: string;
  lines: ComputedLineItem[];
}

/**
 * Everything that gets written onto a document when it is raised or edited.
 *
 * Returns the line rows alongside the columns rather than writing anything
 * itself, because both callers do the write inside a transaction that also
 * replaces the existing rows — and a helper that opens its own connection
 * inside someone else's transaction is how you get a document with new totals
 * and old line items.
 */
export function buildDocumentSnapshot(input: SnapshotInput): DocumentSnapshot {
  const seller = buildSellerSnapshot(input.org);

  const buyerState = resolveState({
    code: input.buyer.stateCode,
    name: input.buyer.stateName,
    gstin: input.buyer.gstin,
  });

  // "must not be auto-filled without being editable" (§4): the form offers the
  // buyer's state and the person can change it. What arrives here is their
  // answer; the buyer's state is only the fallback for a request that predates
  // the field.
  const placeOfSupply = input.placeOfSupply?.code || input.placeOfSupply?.state
    ? resolveState({ code: input.placeOfSupply.code, name: input.placeOfSupply.state })
    : buyerState;

  const supplyType = resolveSupplyType(placeOfSupply.code, seller.stateCode);

  const totals = computeDocumentTotals(input.lineItems, {
    gstApplicable: input.gstApplicable,
    gstRatePercent: input.gstRatePercent,
    isInterState: supplyType === SupplyType.INTER,
  });

  return {
    billingName: input.buyer.name.trim(),
    billingContactName: input.buyer.contactName?.trim() || null,
    billingAddress: input.buyer.address?.trim() || null,
    gstin: input.buyer.gstin?.trim() || null,
    billingStateName: buyerState.name,
    billingStateCode: buyerState.code,
    placeOfSupplyState: placeOfSupply.name,
    placeOfSupplyCode: placeOfSupply.code,
    supplyType,
    sellerSnapshot: seller as unknown as Prisma.InputJsonValue,
    customFields: (input.customFields ?? []) as unknown as Prisma.InputJsonValue,
    subtotal: totals.subtotal,
    cgstAmount: totals.cgstAmount,
    sgstAmount: totals.sgstAmount,
    igstAmount: totals.igstAmount,
    roundOff: totals.roundOff,
    total: totals.total,
    amountInWords: totals.amountInWords,
    lines: totals.lines,
  };
}

// ── Read path ───────────────────────────────────────────────────────────────

function readCustomFields(raw: Prisma.JsonValue | null): CustomField[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
      const r = row as Record<string, unknown>;
      const label = typeof r.label === 'string' ? r.label.trim() : '';
      const value = typeof r.value === 'string' ? r.value.trim() : '';
      return label || value ? { label, value } : null;
    })
    .filter((f): f is CustomField => f !== null);
}

const splitTerms = (raw: string | null | undefined): string[] =>
  (raw ?? '')
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean);

class DocumentNotPrintable extends Error {
  status = 400;
}

/**
 * A tax invoice missing the supplier's own particulars is not a tax invoice.
 *
 * This used to render anyway — a page headed TAX INVOICE with no GSTIN and no
 * address on it, which a client's accounts team will reject and which cannot
 * support an input tax credit claim. Refusing, and saying exactly which
 * Settings tab is missing what, is the more useful answer.
 *
 * A PROFORMA is deliberately exempt: it is a quotation, it prints "This is
 * not a tax invoice", and it is routinely sent before any of this matters.
 */
function assertPrintable(kind: DocumentKind, seller: SellerSnapshot): void {
  if (kind !== 'INVOICE') return;
  const blocking = sellerBlockGaps(seller).filter((g) => g.severity === 'required');
  if (blocking.length === 0) return;

  const list = blocking.map((g) => `${g.label} (Settings > ${g.where})`).join(', ');
  throw new DocumentNotPrintable(
    `A tax invoice has to carry your own ${blocking.length > 1 ? 'details' : 'detail'}: ${list}. ` +
      'Fill those in and this will download.',
  );
}

export async function loadRenderableDocument(
  kind: DocumentKind,
  id: string,
  organizationId: string,
): Promise<RenderableDocument> {
  const include = {
    organization: true,
    company: true,
    lineItems: { orderBy: { serialNo: 'asc' } },
  } as const;

  const row =
    kind === 'PROFORMA'
      ? await prisma.proforma.findFirst({ where: { id, organizationId }, include })
      : await prisma.invoice.findFirst({ where: { id, organizationId }, include });

  if (!row) {
    throw Object.assign(new Error(`${kind === 'PROFORMA' ? 'Proforma' : 'Invoice'} not found`), { status: 404 });
  }

  const org = row.organization;
  const liveSeller = buildSellerSnapshot(org);
  const seller = readSellerSnapshot(row.sellerSnapshot, liveSeller);
  const isProforma = kind === 'PROFORMA';
  const proforma = isProforma ? (row as Extract<typeof row, { validTill: Date }>) : null;
  const invoice = isProforma ? null : (row as Extract<typeof row, { dueAt: Date }>);

  // A proforma's `amount` is the pre-tax subtotal (its form says so on the
  // label); an invoice's is the payable total, because that is what payments
  // are settled against. They are not interchangeable and neither is renamed.
  const legacyAmount = Number(row.amount);

  const frozen = row.subtotal !== null;

  // An invoice with no document of its own is refused first, because that is
  // the problem with THIS row and it is the sender's next step; the seller
  // block is a setting missing everywhere at once, and the register says so
  // in a banner above every row rather than one row at a time.
  if (!isProforma && !frozen && row.lineItems.length === 0) {
    throw new DocumentNotPrintable(
      'This invoice has no document details yet. Add the buyer and the line items first, then download it.',
    );
  }
  assertPrintable(kind, seller);

  let lines: ComputedLineItem[];
  let totals: RenderableDocument['totals'];
  let supplyType: SupplyType;
  let placeOfSupply: { state: string | null; code: string | null };

  if (frozen) {
    lines = row.lineItems.map((li) => ({
      serialNo: li.serialNo,
      particulars: li.particulars,
      units: Number(li.units),
      unitCost: Number(li.unitCost),
      hsnSac: li.hsnSac,
      amount: Number(li.amount),
      gstRate: li.gstRate,
    }));
    totals = {
      subtotal: Number(row.subtotal),
      cgstAmount: Number(row.cgstAmount ?? 0),
      sgstAmount: Number(row.sgstAmount ?? 0),
      igstAmount: Number(row.igstAmount ?? 0),
      roundOff: Number(row.roundOff ?? 0),
      total: Number(row.total ?? 0),
      amountInWords: row.amountInWords ?? amountInWords(Number(row.total ?? 0)),
    };
    supplyType = row.supplyType ?? resolveSupplyType(row.placeOfSupplyCode, seller.stateCode);
    placeOfSupply = { state: row.placeOfSupplyState, code: row.placeOfSupplyCode };
  } else {
    // Pre-CR-02. Reproduce, exactly, how this document was priced the day it
    // was raised — including the old rule that read the state off the buyer's
    // GSTIN. That is the wrong rule, which is why CR-02 replaces it; reprinting
    // an issued document under the new one would make the reprint disagree with
    // what the client already has.
    const legacyStateCode = stateCodeFromGstin(row.gstin);
    supplyType = resolveSupplyType(legacyStateCode ?? seller.stateCode, seller.stateCode);
    placeOfSupply = {
      code: legacyStateCode ?? seller.stateCode,
      state: gstStateName(legacyStateCode ?? seller.stateCode),
    };

    const fallbackLines: LineItemInput[] =
      row.lineItems.length > 0
        ? row.lineItems.map((li) => ({
            particulars: li.particulars,
            units: Number(li.units),
            unitCost: Number(li.unitCost),
            hsnSac: li.hsnSac,
            gstRate: li.gstRate,
          }))
        : [
            {
              particulars: proforma?.description || 'Retainer fee for the billing period.',
              units: 1,
              unitCost: legacyAmount,
              hsnSac: proforma?.sacCode ?? null,
            },
          ];

    const computed = computeDocumentTotals(fallbackLines, {
      gstApplicable: row.gstApplicable,
      gstRatePercent: row.gstRatePercent,
      isInterState: supplyType === SupplyType.INTER,
    });
    lines = computed.lines;
    totals = {
      subtotal: computed.subtotal,
      cgstAmount: computed.cgstAmount,
      sgstAmount: computed.sgstAmount,
      igstAmount: computed.igstAmount,
      roundOff: computed.roundOff,
      total: computed.total,
      amountInWords: computed.amountInWords,
    };
  }

  const ownTerms = splitTerms(row.terms);
  const terms = ownTerms.length > 0
    ? ownTerms
    : org.defaultTermsAndConditions.length > 0
      ? org.defaultTermsAndConditions
      : ['Payment due within the validity period stated above.'];

  return {
    kind,
    title: isProforma ? 'PROFORMA INVOICE' : 'TAX INVOICE',
    number: row.number,
    date: row.raisedAt,
    validTill: proforma?.validTill ?? null,
    dueAt: invoice?.dueAt ?? null,
    seller,
    buyer: {
      // An invoice recorded before CR-02 has no billing name; the company's own
      // name is the only honest thing to print, and it is what the register
      // already shows for that row.
      name: row.billingName || row.company.name,
      contactName: row.billingContactName,
      address: row.billingAddress ?? row.company.billingAddress,
      gstin: row.gstin ?? row.company.gstin,
      stateName: row.billingStateName,
      stateCode: row.billingStateCode,
    },
    placeOfSupply,
    supplyType,
    gstApplicable: row.gstApplicable,
    gstRatePercent: row.gstRatePercent,
    lines,
    totals,
    customFields: readCustomFields(row.customFields),
    poNumber: row.poNumber,
    poDate: row.poDate,
    terms,
    notes: row.notes,
    declaration: isProforma
      ? PROFORMA_DECLARATION
      : seller.declarationText?.trim() || DEFAULT_INVOICE_DECLARATION,
    signatureImage: org.signatureImage,
    showSignatureBlock: org.showSignatureBlock,
    frozen,
  };
}
