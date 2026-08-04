import { describe, it, expect } from 'vitest';
import { normalizePhone } from './leadId.js';

// normalizePhone is the ONLY duplicate-phone protection left: the unique index on the phone
// column went with the column when a lead's contact details moved into lead_contacts. Comparing
// on digits alone let the same person in three times under three formats.
describe('normalizePhone', () => {
  const SAME = [
    ['bare national', '9840000001'],
    ['spaced', '98400 00001'],
    ['country code with +', '+91 98400 00001'],
    ['country code, no +', '919840000001'],
    ['international prefix', '0091-98400-00001'],
    ['trunk prefix', '098400 00001'],
    ['punctuated', '+91-(98400)-00001'],
  ] as const;

  it.each(SAME)('treats %s as the same number', (_label, input) => {
    expect(normalizePhone(input)).toBe('9840000001');
  });

  it('keeps genuinely different numbers apart', () => {
    expect(normalizePhone('+91 98400 00001')).not.toBe(normalizePhone('+91 98400 00002'));
  });

  it('leaves a short number short, so the min-length check still rejects it', () => {
    expect(normalizePhone('12345')).toBe('12345');
    expect(normalizePhone('12345').length).toBeLessThan(10);
  });

  it('handles absent values without throwing', () => {
    expect(normalizePhone(null)).toBe('');
    expect(normalizePhone(undefined)).toBe('');
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone('not a phone')).toBe('');
  });
});
