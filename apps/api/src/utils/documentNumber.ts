import { prisma } from '../lib/prisma.js';

/**
 * The numbered documents this business issues, and the one series behind them.
 *
 *   EL/PI/26-27/001    a proforma
 *   EL/INV/26-27/001   the tax invoice it becomes
 *
 * ─── Why this is one file ───────────────────────────────────────────────────
 *
 * It used to be two, `proformaNumber.ts` and `invoiceNumber.ts`, holding the
 * same algorithm twice. They drifted, which is what two copies of an algorithm
 * do: the proforma side was corrected to compare the sequence NUMERICALLY and
 * the invoice side was left sorting it as TEXT. Sorting text works only while
 * the zero padding holds the width fixed — at 1000 the padding stops, '1000'
 * sorts below '999', and the series hands out a number it has already issued.
 *
 * The brief's rule is that a document number is never reused. That rule is not
 * a property of one file, so it now lives in one.
 */

export type DocumentKind = 'PROFORMA' | 'INVOICE';

/** Three digits is the house format. Past 999 the width simply grows. */
const SEQUENCE_WIDTH = 3;

/**
 * India's financial year, as the two-digit pair documents print.
 *
 * It begins on 1 April, so January to March belong to the year that started the
 * previous April: March 2027 is still `26-27`.
 */
function financialYearLabel(now: Date, startMonth: number): string {
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-indexed
  const startYear = month < startMonth ? year - 1 : year;
  return `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
}

/**
 * An invoice's prefix is derived from the proforma's, so an organisation
 * configures one thing: `EL/PI` implies `EL/INV`.
 */
function basePrefix(kind: DocumentKind, proformaPrefix: string | undefined): string {
  const configured = proformaPrefix?.replace(/\/$/, '') || 'EL/PI';
  if (kind === 'PROFORMA') return configured;

  const derived = configured.replace(/\/PI\/?$/i, '/INV');
  return derived.endsWith('/INV') ? derived : `${derived}/INV`;
}

/**
 * The next number in this organisation's series for this financial year.
 *
 * Read-highest-then-insert, so two people raising a document at the same moment
 * compute the same one. That race is settled by the unique index on
 * (organizationId, number) plus `issueWithRetry` below — not here.
 */
export async function nextDocumentNumber(
  organizationId: string,
  kind: DocumentKind,
): Promise<string> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { proformaPrefix: true, financialYearStart: true },
  });

  const prefix = basePrefix(kind, org?.proformaPrefix ?? undefined);
  const fy = financialYearLabel(new Date(), org?.financialYearStart ?? 4);
  const searchPrefix = `${prefix}/${fy}/`;

  const where = { organizationId, number: { startsWith: searchPrefix } };
  const select = { number: true };
  const issued =
    kind === 'INVOICE'
      ? await prisma.invoice.findMany({ where, select })
      : await prisma.proforma.findMany({ where, select });

  // Compared as a NUMBER, never as text — see the note at the top of the file.
  let highest = 0;
  for (const { number } of issued) {
    const parsed = parseInt(number.slice(searchPrefix.length), 10);
    if (!Number.isNaN(parsed) && parsed > highest) highest = parsed;
  }

  return `${searchPrefix}${String(highest + 1).padStart(SEQUENCE_WIDTH, '0')}`;
}

/**
 * Issue a document, and lose the race gracefully.
 *
 * `create` receives the number to use and does the actual insert. If somebody
 * else took that number first the unique index rejects it (P2002), and this
 * reads the series again rather than surfacing a 500 to somebody whose only
 * mistake was pressing the button at the same moment as a colleague.
 */
export async function issueWithRetry<T>(
  organizationId: string,
  kind: DocumentKind,
  create: (documentNumber: string) => Promise<T>,
  maxAttempts = 5,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const documentNumber = await nextDocumentNumber(organizationId, kind);
    try {
      return await create(documentNumber);
    } catch (err) {
      const numberTaken = (err as { code?: string }).code === 'P2002';
      if (!numberTaken || attempt >= maxAttempts) throw err;
      // Somebody else took this number. Read the series again and retry.
    }
  }
}

/** @deprecated Prefer `nextDocumentNumber(orgId, 'INVOICE')`. */
export const generateNextInvoiceNumber = (organizationId: string) =>
  nextDocumentNumber(organizationId, 'INVOICE');

/** @deprecated Prefer `nextDocumentNumber(orgId, 'PROFORMA')`. */
export const generateNextProformaNumber = (organizationId: string) =>
  nextDocumentNumber(organizationId, 'PROFORMA');
