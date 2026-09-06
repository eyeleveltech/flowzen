import { describe, it, expect } from 'vitest';
import {
  bookValue,
  financialYearOf,
  financialYearWindow,
  fullyDepreciated,
  monthlyDepreciation,
  registerRow,
  wholeMonthsBetween,
} from './assetValue.js';

/**
 * The arithmetic the fixed-asset register stands on.
 *
 * These are the cases an accountant would object to if they were wrong, which
 * is the only reason to write them down: a book value that goes negative, an
 * asset that keeps depreciating after its life is over, and a purchase made
 * mid-year that claims a full year of depreciation. All three are the same
 * kind of bug — arithmetic that is right in the middle and wrong at the edges.
 */

// A Sony A7 IV: ₹2,40,000, five years, ₹40,000 left at the end.
// (240000 − 40000) ÷ 60 = ₹3,333.33 a month.
const camera = {
  purchasePrice: 240_000,
  salvageValue: 40_000,
  usefulLifeMonths: 60,
  purchasedAt: new Date('2026-04-01'),
};

describe('wholeMonthsBetween', () => {
  it('counts nothing until the day of the month comes round', () => {
    expect(wholeMonthsBetween(new Date('2026-01-20'), new Date('2026-02-19'))).toBe(0);
    expect(wholeMonthsBetween(new Date('2026-01-20'), new Date('2026-02-20'))).toBe(1);
  });

  it('never goes backwards', () => {
    // A purchase date in the future is a typo, not a negative depreciation.
    expect(wholeMonthsBetween(new Date('2026-06-01'), new Date('2026-01-01'))).toBe(0);
  });

  it('crosses a year boundary', () => {
    expect(wholeMonthsBetween(new Date('2025-11-15'), new Date('2026-02-15'))).toBe(3);
  });
});

describe('monthlyDepreciation', () => {
  it('spreads cost less salvage over the life', () => {
    expect(monthlyDepreciation(camera)).toBeCloseTo(3333.33, 2);
  });

  it('is zero when the life is zero, rather than infinite', () => {
    expect(monthlyDepreciation({ ...camera, usefulLifeMonths: 0 })).toBe(0);
  });

  it('is zero when salvage is not below cost', () => {
    // Nothing to write off. Without this the figure goes negative and the book
    // value starts CLIMBING, which is the most confusing possible failure.
    expect(monthlyDepreciation({ ...camera, salvageValue: 300_000 })).toBe(0);
  });
});

describe('bookValue', () => {
  it('is the full price on the day it is bought', () => {
    expect(bookValue(camera, new Date('2026-04-01'))).toBe(240_000);
  });

  it('falls by one month of depreciation after one month', () => {
    expect(bookValue(camera, new Date('2026-05-01'))).toBeCloseTo(236_666.67, 2);
  });

  it('is halfway down at the middle of its life', () => {
    // 30 months in: 240000 − (3333.33 × 30) = 140000.
    expect(bookValue(camera, new Date('2028-10-01'))).toBeCloseTo(140_000, 0);
  });

  it('lands exactly on salvage at the end of its life', () => {
    expect(bookValue(camera, new Date('2031-04-01'))).toBeCloseTo(40_000, 2);
  });

  it('CLAMPS at salvage rather than going negative afterwards', () => {
    // The one that matters. Ten years on it is still worth ₹40,000 on the
    // books, not minus ₹1,60,000.
    expect(bookValue(camera, new Date('2036-04-01'))).toBe(40_000);
  });
});

describe('fullyDepreciated', () => {
  it('is false inside the life and true at the end of it', () => {
    expect(fullyDepreciated(camera, new Date('2031-03-01'))).toBe(false);
    expect(fullyDepreciated(camera, new Date('2031-04-01'))).toBe(true);
  });
});

describe('financialYearOf', () => {
  it('puts April in the year that is starting', () => {
    expect(financialYearOf(new Date('2026-04-01'), 4)).toBe('2026-27');
  });

  it('puts March in the year that started the previous April', () => {
    expect(financialYearOf(new Date('2027-03-31'), 4)).toBe('2026-27');
  });
});

describe('the FY register row', () => {
  const window = financialYearWindow('2026-27', 4); // 1 Apr 2026 → 1 Apr 2027

  it('opens an asset bought DURING the year at zero', () => {
    // It was not on the books on 1 April, so there is no opening WDV to carry.
    const row = registerRow(camera, window);
    expect(row.openingWdv).toBe(0);
  });

  it('charges a mid-year purchase only the months it was owned', () => {
    // Bought 1 October 2026, so six months of the year: 6 × 3333.33 = 20000.
    const midYear = { ...camera, purchasedAt: new Date('2026-10-01') };
    const row = registerRow(midYear, window);
    expect(row.depreciationForYear).toBeCloseTo(20_000, 0);
    expect(row.closingWdv).toBeCloseTo(220_000, 0);
  });

  it('charges a full twelve months for an asset owned all year', () => {
    // Bought a year earlier, so the whole of 26-27 is its second full year.
    const older = { ...camera, purchasedAt: new Date('2025-04-01') };
    const row = registerRow(older, window);
    expect(row.openingWdv).toBeCloseTo(200_000, 0);
    expect(row.depreciationForYear).toBeCloseTo(40_000, 0);
    expect(row.closingWdv).toBeCloseTo(160_000, 0);
  });

  it('charges nothing for an asset already at salvage', () => {
    // Past the end of its life the whole year through: opening and closing are
    // both salvage, and the year's charge is zero rather than a negative.
    const ancient = { ...camera, purchasedAt: new Date('2018-04-01') };
    const row = registerRow(ancient, window);
    expect(row.openingWdv).toBe(40_000);
    expect(row.closingWdv).toBe(40_000);
    expect(row.depreciationForYear).toBe(0);
  });

  it('leaves an asset bought after the year ended off the schedule entirely', () => {
    const future = { ...camera, purchasedAt: new Date('2028-01-01') };
    expect(registerRow(future, window)).toEqual({
      openingWdv: 0,
      depreciationForYear: 0,
      closingWdv: 0,
    });
  });
});
