import { describe, expect, it } from 'vitest';
import { isAwaiting, isCollectible, isOverdue, outstandingOf, sumOutstanding } from './invoice-state';

/**
 * The ten invoices that were actually in the database when the Money screen
 * was reported as contradicting itself. Kept verbatim, because the bug was not
 * in an edge case — it was in this, the ordinary shape of the data.
 */
const LEDGER = [
  { number: 'INV/26-27/0188', status: 'RAISED', balanceDue: 220000, isOverdue: false },
  { number: 'INV/26-27/0137', status: 'CANCELLED', balanceDue: 28000, isOverdue: false },
  { number: 'INV/26-27/0143', status: 'PAID', balanceDue: 0, isOverdue: false },
  { number: 'INV/26-27/0144', status: 'OVERDUE', balanceDue: 30000, isOverdue: true },
  { number: 'INV/26-27/0142', status: 'PAID', balanceDue: 0, isOverdue: false },
  { number: 'INV/26-27/0141', status: 'PAID', balanceDue: 0, isOverdue: false },
  { number: 'INV/26-27/0140', status: 'PAID', balanceDue: 0, isOverdue: false },
  { number: 'INV/26-27/0139', status: 'OVERDUE', balanceDue: 30000, isOverdue: true },
  // Marked settled with no payment recorded against them. Whatever the
  // arithmetic says, nobody owes money on an invoice stamped PAID.
  { number: 'INV/26-27/0135', status: 'PAID', balanceDue: 60000, isOverdue: false },
  { number: 'INV/26-27/0136', status: 'PAID', balanceDue: 47500, isOverdue: false },
];

describe('what an invoice means', () => {
  it('counts as owed only what is actually owed', () => {
    // The screen showed ₹4,15,500 by summing every row's balance. Cancelled
    // work was never billed and settled work is in the bank.
    expect(sumOutstanding(LEDGER)).toBe(280000);
  });

  it('leaves cancelled and settled invoices out of the receivable', () => {
    expect(outstandingOf({ status: 'CANCELLED', balanceDue: 28000 })).toBe(0);
    expect(outstandingOf({ status: 'PAID', balanceDue: 60000 })).toBe(0);
    expect(outstandingOf({ status: 'RAISED', balanceDue: 220000 })).toBe(220000);
  });

  it('finds the overdue invoices that were on screen while the tile read zero', () => {
    // The tile read `isOverdue`, which the API computed and never sent, so it
    // was `undefined` on every row and the count was structurally zero.
    expect(LEDGER.filter(isOverdue).map((i) => i.number)).toEqual(['INV/26-27/0144', 'INV/26-27/0139']);
  });

  it('reads the derived status too, not only the flag', () => {
    // The list route turns a past-due RAISED into OVERDUE. Either spelling of
    // the same fact has to give the same answer.
    expect(isOverdue({ status: 'OVERDUE', balanceDue: 100 })).toBe(true);
    expect(isOverdue({ status: 'RAISED', balanceDue: 100, isOverdue: true })).toBe(true);
    expect(isOverdue({ status: 'RAISED', balanceDue: 100, isOverdue: false })).toBe(false);
  });

  it('never calls a cancelled invoice late', () => {
    // Its due date has passed and it does not matter — nobody is chasing it.
    expect(isOverdue({ status: 'CANCELLED', balanceDue: 28000, isOverdue: true })).toBe(false);
    expect(isCollectible({ status: 'CANCELLED', balanceDue: 28000 })).toBe(false);
  });

  it('splits what is owed into waiting and late, with nothing counted twice', () => {
    const awaiting = LEDGER.filter(isAwaiting);
    const late = LEDGER.filter(isOverdue);
    expect(awaiting.map((i) => i.number)).toEqual(['INV/26-27/0188']);
    expect(awaiting.length + late.length).toBe(LEDGER.filter(isCollectible).length);
  });

  it('says nothing rather than zero when the figures are masked', () => {
    /*
     * A reader without `money.figures` gets `balanceDue: null` on every row.
     * `null ?? 0` totals that to a confident ₹0 — the business looks debt-free
     * to the one person who simply is not allowed to know.
     */
    const hidden = LEDGER.map((i) => ({ ...i, balanceDue: null }));
    expect(sumOutstanding(hidden)).toBeNull();
  });

  it('is zero, not null, when there is genuinely nothing owed', () => {
    expect(sumOutstanding([{ status: 'PAID', balanceDue: 0 }])).toBe(0);
    expect(sumOutstanding([])).toBe(0);
  });
});
