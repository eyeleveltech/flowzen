/**
 * What a proposal costs — the one place it is worked out (AI Proposal Builder).
 *
 * Every figure a proposal shows comes from here: the Pricing tab's live totals,
 * the Investment section of the document and its PDF, the floor check, and the
 * snapshot frozen at Finalise. Nothing else does proposal money maths, and the
 * AI never does any.
 *
 * Built on the calculator proformas and invoices already share
 * (utils/documentTotals.ts): the same per-line rounding, the same GST split by
 * place of supply, the same round-off rule. So a proposal and the proforma that
 * follows it can never disagree about what ₹1,30,000 + GST comes to.
 *
 * The house rules it enforces (Founder, 19 Oct 2026):
 *   - Monthly and one-time are priced apart and never added together.
 *   - Ad spend and anything else the client pays directly (passthrough) is
 *     shown apart and never counted in the studio's fee or taxed by it.
 *   - A monthly fee below the floor for the client's vertical fails the floor
 *     check. One-time project fees are exempt.
 *   - A discount needs a trade (longer term, more work, case-study rights…).
 */

import { computeDocumentTotals } from '../utils/documentTotals.js';

export type Billing = 'ONE_TIME' | 'MONTHLY';

/** One line as the Pricing tab sends it, or as it is stored. */
export interface ProposalLineInput {
  name: string;
  description?: string | null;
  billing: Billing;
  qty: number | string;
  unit?: string | null;
  unitRate: number | string;
  discountAmount?: number | string | null;
  discountTrade?: string | null;
  isPassthrough?: boolean;
}

export interface PricedLine {
  name: string;
  description: string | null;
  billing: Billing;
  qty: number;
  unit: string | null;
  unitRate: number;
  /** qty × rate, before any discount. */
  gross: number;
  discountAmount: number;
  discountTrade: string | null;
  /** What the line comes to: gross less its discount. */
  amount: number;
  isPassthrough: boolean;
}

/** One group of the fee — monthly, or one-time. */
export interface FeeGroup {
  lines: PricedLine[];
  /** Before discounts. */
  gross: number;
  discount: number;
  /** The fee, before GST — what a proposal prints. */
  subtotal: number;
  gstRatePercent: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  roundOff: number;
  /** With GST, rounded to the rupee. For the Pricing tab, not the document. */
  total: number;
}

export interface FloorCheck {
  /** Only a monthly fee has a floor; one-time project fees are exempt. */
  applies: boolean;
  vertical: string | null;
  floor: number;
  monthlyFee: number;
  passes: boolean;
}

export interface ProposalPrice {
  monthly: FeeGroup;
  oneTime: FeeGroup;
  /** Paid by the client directly — never in the fee, never taxed here. */
  passthrough: { lines: PricedLine[]; total: number };
  supplyType: 'INTRA' | 'INTER';
  floor: FloorCheck;
  /** Lines with a discount and no trade named — Finalise refuses these. */
  discountsWithoutTrade: string[];
}

export interface PricingContext {
  /** The company's industry, as stored ("Real Estate & Infrastructure"…). */
  vertical: string | null;
  floorBase: number;
  /** Per-industry floors, by industry name. */
  floors: Record<string, number>;
  /** Decided by the client's state against the studio's, as on a proforma. */
  isInterState: boolean;
  gstRatePercent?: number;
}

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function priceLine(line: ProposalLineInput): PricedLine {
  const qty = num(line.qty);
  const unitRate = num(line.unitRate);
  const gross = round2(qty * unitRate);
  const discountAmount = round2(Math.max(0, num(line.discountAmount)));
  return {
    name: line.name.trim(),
    description: line.description?.trim() || null,
    billing: line.billing,
    qty,
    unit: line.unit?.trim() || null,
    unitRate,
    gross,
    discountAmount,
    discountTrade: line.discountTrade?.trim() || null,
    amount: round2(gross - discountAmount),
    isPassthrough: Boolean(line.isPassthrough),
  };
}

function group(lines: PricedLine[], isInterState: boolean, gstRatePercent: number): FeeGroup {
  // Each line goes in at its net amount, so the shared calculator rounds and
  // taxes exactly as it does a proforma's rows.
  const totals = computeDocumentTotals(
    lines.map((l) => ({ particulars: l.name, units: 1, unitCost: l.amount })),
    { gstApplicable: true, gstRatePercent, isInterState },
  );
  const gross = round2(lines.reduce((s, l) => s + l.gross, 0));
  const discount = round2(lines.reduce((s, l) => s + l.discountAmount, 0));
  const empty = lines.length === 0;
  return {
    lines,
    gross,
    discount,
    subtotal: totals.subtotal,
    gstRatePercent,
    cgst: totals.cgstAmount,
    sgst: totals.sgstAmount,
    igst: totals.igstAmount,
    totalTax: totals.totalTax,
    roundOff: empty ? 0 : totals.roundOff,
    total: empty ? 0 : totals.total,
  };
}

/** The floor for a vertical: its own, else the base. */
export const floorFor = (vertical: string | null, floorBase: number, floors: Record<string, number>): number =>
  vertical && Number.isFinite(Number(floors[vertical])) && floors[vertical] !== undefined
    ? Number(floors[vertical])
    : floorBase;

export function priceProposal(input: ProposalLineInput[], ctx: PricingContext): ProposalPrice {
  const gstRatePercent = ctx.gstRatePercent ?? 18;
  const lines = input.map(priceLine);
  const fee = lines.filter((l) => !l.isPassthrough);
  const passthrough = lines.filter((l) => l.isPassthrough);

  const monthly = group(fee.filter((l) => l.billing === 'MONTHLY'), ctx.isInterState, gstRatePercent);
  const oneTime = group(fee.filter((l) => l.billing === 'ONE_TIME'), ctx.isInterState, gstRatePercent);

  const floor = floorFor(ctx.vertical, ctx.floorBase, ctx.floors);
  const applies = monthly.lines.length > 0;

  return {
    monthly,
    oneTime,
    passthrough: { lines: passthrough, total: round2(passthrough.reduce((s, l) => s + l.amount, 0)) },
    supplyType: ctx.isInterState ? 'INTER' : 'INTRA',
    floor: {
      applies,
      vertical: ctx.vertical,
      floor,
      monthlyFee: monthly.subtotal,
      passes: !applies || monthly.subtotal >= floor,
    },
    discountsWithoutTrade: lines.filter((l) => l.discountAmount > 0 && !l.discountTrade).map((l) => l.name),
  };
}

/**
 * The figure a sent version records as the deal's value: the monthly fee for a
 * retainer, the one-time total for a project — never the two added together.
 * Whichever exists when the other does not.
 */
export function dealValueOf(price: ProposalPrice, kind: 'RETAINER' | 'PROJECT'): number {
  if (kind === 'RETAINER') return price.monthly.subtotal || price.oneTime.subtotal;
  return price.oneTime.subtotal || price.monthly.subtotal;
}

/**
 * Every rupee figure a proposal is entitled to print: its rates, its line
 * amounts, its subtotals and totals. Prose that names any other amount is
 * stating a price the line items do not back — Finalise refuses it.
 */
export function allowedAmounts(price: ProposalPrice): Set<number> {
  const out = new Set<number>();
  const add = (n: number) => {
    if (n > 0) out.add(Math.round(n));
  };
  for (const g of [price.monthly, price.oneTime]) {
    for (const l of g.lines) [l.unitRate, l.gross, l.amount, l.discountAmount].forEach(add);
    [g.gross, g.subtotal, g.totalTax, g.total, g.discount].forEach(add);
  }
  for (const l of price.passthrough.lines) [l.unitRate, l.amount].forEach(add);
  add(price.passthrough.total);
  return out;
}

/**
 * Rupee amounts written in prose — "₹1,20,000", "Rs. 90,000", "INR 75000",
 * "₹50k", "1.2 lakh" — as whole rupees, with the text they were written as.
 * A bare number counts only with a lakh or crore after it: "12 posts" is not
 * a price, "1.5 lakh" is.
 */
export function amountsInText(text: string): { text: string; value: number }[] {
  const found: { text: string; value: number }[] = [];
  const pattern = /(₹|\brs\.?|\binr)?\s*(\d[\d,]*(?:\.\d+)?)(?:\s*(lakhs?|lacs?|crores?|cr|k|l)\b)?/gi;
  for (const m of text.matchAll(pattern)) {
    const [, currency, digits, unitRaw] = m;
    const unit = (unitRaw ?? '').toLowerCase();
    const bigUnit = unit.startsWith('la') || unit.startsWith('cr');
    if (!currency && !bigUnit) continue;
    const base = Number(digits.replace(/,/g, ''));
    if (!Number.isFinite(base)) continue;
    const mult = unit.startsWith('cr') ? 1e7 : unit.startsWith('la') || unit === 'l' ? 1e5 : unit === 'k' ? 1e3 : 1;
    found.push({ text: m[0].trim().replace(/,+$/, ''), value: Math.round(base * mult) });
  }
  return found;
}
