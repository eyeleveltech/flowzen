import { prisma } from '../lib/prisma.js';
import { resolveTaxType } from './taxCatalog.js';

// Atomic, race-safe document number per org/scope/year: EL/QT/2026/005, EL/PI/…, EL/INV/…
export async function generateDocNumber(organizationId: string, scope: 'QT' | 'PI' | 'INV'): Promise<string> {
  const year = String(new Date().getFullYear());
  const rows = await prisma.$queryRaw<{ counter: number }[]>`
    INSERT INTO "doc_counters" ("id", "organizationId", "scope", "period", "counter")
    VALUES (gen_random_uuid()::text, ${organizationId}, ${scope}, ${year}, 1)
    ON CONFLICT ("organizationId", "scope", "period")
    DO UPDATE SET "counter" = "doc_counters"."counter" + 1
    RETURNING "counter";
  `;
  const seq = String(rows[0].counter).padStart(3, '0');
  return `EL/${scope}/${year}/${seq}`;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface LineInput {
  quantity: number;
  unitPrice: number;
  discountPct?: number;
  taxPct?: number;   // editable rate
  taxType?: string;  // type code, e.g. 'IGST_S' (drives the split)
}

export interface QuoteFinancials {
  untaxedAmount: number;
  totalDiscount: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  grandTotal: number;
  amountInWords: string;
  lineAmounts: number[];
  rcm: boolean; // any reverse-charge line present
}

// Server-authoritative totals. Each line's tax TYPE decides the split:
// GST -> CGST+SGST, IGST -> IGST, ZERO/RC -> no tax added (RC also flags RCM).
export function computeQuoteFinancials(items: LineInput[]): QuoteFinancials {
  let untaxed = 0, totalDiscount = 0, cgst = 0, sgst = 0, igst = 0;
  let rcm = false;
  const lineAmounts: number[] = [];
  // Round at the LINE level so the printed line column, the tax rows and the grand total all
  // reconcile exactly (no sub-rupee drift between displayed rows).
  for (const it of items) {
    const qty = Number(it.quantity) || 0;
    const price = Number(it.unitPrice) || 0;
    const discPct = Number(it.discountPct) || 0;
    const gross = qty * price;
    const disc = gross * (discPct / 100);
    const amount = round2(gross - disc);
    lineAmounts.push(amount);
    untaxed += amount;
    totalDiscount += disc;

    const rate = it.taxPct === undefined || it.taxPct === null ? 18 : Number(it.taxPct);
    const mode = resolveTaxType(it.taxType).mode;
    const t = round2(amount * (rate / 100));
    if (mode === 'GST') { const half = round2(t / 2); cgst += half; sgst += round2(t - half); } // halves sum to t
    else if (mode === 'IGST') { igst += t; }
    else if (mode === 'RC') { rcm = true; }
    // ZERO -> nothing
  }

  untaxed = round2(untaxed);
  cgst = round2(cgst); sgst = round2(sgst); igst = round2(igst);
  const totalTax = round2(cgst + sgst + igst);
  const grandTotal = round2(untaxed + totalTax);

  return {
    untaxedAmount: untaxed,
    totalDiscount: round2(totalDiscount),
    cgst,
    sgst,
    igst,
    totalTax,
    grandTotal,
    amountInWords: amountInWords(Math.round(grandTotal)),
    lineAmounts,
    rcm,
  };
}

// Indian numbering (lakh / crore) to words, whole rupees.
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoToWords(n: number): string {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`;
}

export function amountInWords(rupees: number): string {
  if (!rupees || rupees <= 0) return 'Rupees Zero Only.';
  let n = Math.floor(rupees);
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const hundred = Math.floor(n / 100); n %= 100;
  if (crore) parts.push(`${twoToWords(crore)} Crore`);
  if (lakh) parts.push(`${twoToWords(lakh)} Lakh`);
  if (thousand) parts.push(`${twoToWords(thousand)} Thousand`);
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (n) parts.push(twoToWords(n));
  return `Rupees ${parts.join(' ')} Only.`;
}
