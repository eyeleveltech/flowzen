/**
 * The document series, and the rule it exists to keep: a number is never reused.
 *
 * This lived in two files holding the same algorithm, and they drifted — the
 * proforma side was corrected to compare the sequence numerically, the invoice
 * side went on sorting it as text. Text sorting looks right for 999 documents
 * and then quietly hands out 1000 twice, which is a number an auditor traces.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { nextDocumentNumber, issueWithRetry } from './documentNumber.js';

const org = (over: Record<string, unknown> = {}) => {
  (prisma.organization.findUnique as any).mockResolvedValue({
    proformaPrefix: 'EL/PI',
    financialYearStart: 4,
    ...over,
  });
};

const issued = (kind: 'invoice' | 'proforma', numbers: string[]) => {
  (prisma[kind].findMany as any).mockResolvedValue(numbers.map((number) => ({ number })));
};

describe('nextDocumentNumber', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('starts a fresh series at 001', async () => {
    org();
    issued('proforma', []);
    expect(await nextDocumentNumber('org-1', 'PROFORMA')).toMatch(/^EL\/PI\/\d{2}-\d{2}\/001$/);
  });

  it('derives the invoice prefix from the proforma one, so an org configures one thing', async () => {
    org({ proformaPrefix: 'ACME/PI' });
    issued('invoice', []);
    expect(await nextDocumentNumber('org-1', 'INVOICE')).toMatch(/^ACME\/INV\//);
  });

  it('counts the financial year from April, not January', async () => {
    vi.useFakeTimers();

    // March 2027 still belongs to the year that began in April 2026.
    vi.setSystemTime(new Date('2027-03-15T10:00:00Z'));
    org();
    issued('proforma', []);
    expect(await nextDocumentNumber('org-1', 'PROFORMA')).toBe('EL/PI/26-27/001');

    // April 2027 starts the next one.
    vi.setSystemTime(new Date('2027-04-01T10:00:00Z'));
    org();
    issued('proforma', []);
    expect(await nextDocumentNumber('org-1', 'PROFORMA')).toBe('EL/PI/27-28/001');

    vi.useRealTimers();
  });

  it('continues from the highest issued, not the last created', async () => {
    org();
    issued('proforma', ['EL/PI/26-27/003', 'EL/PI/26-27/001', 'EL/PI/26-27/002']);
    expect(await nextDocumentNumber('org-1', 'PROFORMA')).toMatch(/\/004$/);
  });

  it('does not reissue a number once the series passes 999', async () => {
    // The regression, in one line: sorted as TEXT, '999' is the largest of
    // these and the series hands out 1000 for the second time.
    org();
    issued('invoice', ['EL/INV/26-27/998', 'EL/INV/26-27/999', 'EL/INV/26-27/1000']);
    expect(await nextDocumentNumber('org-1', 'INVOICE')).toMatch(/\/1001$/);
  });

  it('keeps growing past four digits rather than wrapping', async () => {
    org();
    issued('invoice', ['EL/INV/26-27/9999']);
    expect(await nextDocumentNumber('org-1', 'INVOICE')).toMatch(/\/10000$/);
  });

  it('ignores anything in the series that is not a number', async () => {
    // A hand-typed number from Tally sits in the same column.
    org();
    issued('invoice', ['EL/INV/26-27/007', 'EL/INV/26-27/MANUAL']);
    expect(await nextDocumentNumber('org-1', 'INVOICE')).toMatch(/\/008$/);
  });

  it('falls back to the house prefix for an org that has none', async () => {
    (prisma.organization.findUnique as any).mockResolvedValue(null);
    issued('proforma', []);
    expect(await nextDocumentNumber('org-1', 'PROFORMA')).toMatch(/^EL\/PI\//);
  });
});

describe('issueWithRetry', () => {
  it('hands the number to the caller and returns what it made', async () => {
    org();
    issued('proforma', []);
    const made = await issueWithRetry('org-1', 'PROFORMA', async (n) => ({ number: n }));
    expect(made.number).toMatch(/\/001$/);
  });

  it('takes the next number when somebody else won the race', async () => {
    org();
    // First read sees an empty series; by the second, 001 has been taken.
    (prisma.proforma.findMany as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ number: 'EL/PI/26-27/001' }]);

    const attempts: string[] = [];
    const made = await issueWithRetry('org-1', 'PROFORMA', async (n) => {
      attempts.push(n);
      if (attempts.length === 1) throw Object.assign(new Error('unique'), { code: 'P2002' });
      return { number: n };
    });

    expect(attempts).toHaveLength(2);
    expect(made.number).toMatch(/\/002$/);
  });

  it('gives up rather than looping forever', async () => {
    org();
    issued('proforma', []);
    await expect(
      issueWithRetry(
        'org-1',
        'PROFORMA',
        async () => {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        },
        3,
      ),
    ).rejects.toThrow();
  });

  it('never retries a failure that is not a number collision', async () => {
    org();
    issued('proforma', []);
    let calls = 0;
    await expect(
      issueWithRetry('org-1', 'PROFORMA', async () => {
        calls += 1;
        throw new Error('the database is on fire');
      }),
    ).rejects.toThrow('the database is on fire');
    expect(calls).toBe(1);
  });
});
