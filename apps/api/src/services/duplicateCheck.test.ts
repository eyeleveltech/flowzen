import { describe, it, expect } from 'vitest';
import {
  checkForDuplicates,
  checkForImport,
  namesAreSimilar,
  normaliseCompanyName,
  normalisePhone,
  normaliseEmail,
  type ExistingCompany,
} from './duplicateCheck.js';

const co = (over: Partial<ExistingCompany> = {}): ExistingCompany => ({
  id: 'c1',
  name: 'Zomato',
  email: null,
  phone: null,
  ...over,
});

describe('normalisePhone', () => {
  // One number typed three ways is one company, not three.
  it('treats a country code as optional', () => {
    expect(normalisePhone('+91 98765 43210')).toBe('9876543210');
    expect(normalisePhone('09876543210')).toBe('9876543210');
    expect(normalisePhone('9876543210')).toBe('9876543210');
  });

  it('strips formatting', () => {
    expect(normalisePhone('(987) 654-3210')).toBe('9876543210');
  });

  it('ignores anything too short to identify anyone', () => {
    expect(normalisePhone('12345')).toBeNull();
    expect(normalisePhone('')).toBeNull();
    expect(normalisePhone(null)).toBeNull();
  });
});

describe('normaliseEmail', () => {
  it('ignores case and surrounding space', () => {
    expect(normaliseEmail('  Hello@Zomato.COM ')).toBe('hello@zomato.com');
  });

  it('treats empty as absent', () => {
    expect(normaliseEmail('   ')).toBeNull();
  });
});

describe('normaliseCompanyName', () => {
  it('drops the legal suffix people type inconsistently', () => {
    expect(normaliseCompanyName('Zomato Pvt Ltd')).toBe('zomato');
    expect(normaliseCompanyName('ZOMATO PRIVATE LIMITED')).toBe('zomato');
    expect(normaliseCompanyName('Zomato')).toBe('zomato');
  });

  it('normalises ampersands and punctuation', () => {
    expect(normaliseCompanyName('Sharma & Sons.')).toBe('sharma and sons');
  });
});

describe('namesAreSimilar', () => {
  it('matches across legal suffixes', () => {
    expect(namesAreSimilar('Zomato', 'Zomato Pvt Ltd')).toBe(true);
  });

  it('matches when one name contains the other', () => {
    expect(namesAreSimilar('Zomato', 'Zomato Media')).toBe(true);
  });

  it('does not match genuinely different companies', () => {
    expect(namesAreSimilar('Zomato', 'Swiggy')).toBe(false);
    expect(namesAreSimilar('Sharma Traders', 'Verma Traders')).toBe(false);
  });

  it('does not let a very short name match half the database', () => {
    expect(namesAreSimilar('AB', 'ABC Industries')).toBe(false);
  });
});

describe('checkForDuplicates', () => {
  it('creates when nothing matches', () => {
    expect(checkForDuplicates({ name: 'Swiggy' }, [co()]).action).toBe('CREATE');
  });

  it('BLOCKS on an exact email, whatever the case', () => {
    const v = checkForDuplicates({ name: 'Something Else', email: 'HELLO@zomato.com' }, [
      co({ email: 'hello@zomato.com' }),
    ]);
    expect(v.action).toBe('BLOCK');
    if (v.action === 'BLOCK') expect(v.matches[0].reason).toBe('email');
  });

  it('BLOCKS on the same phone written differently', () => {
    const v = checkForDuplicates({ name: 'Something Else', phone: '+91 98765 43210' }, [
      co({ phone: '9876543210' }),
    ]);
    expect(v.action).toBe('BLOCK');
    if (v.action === 'BLOCK') expect(v.matches[0].reason).toBe('phone');
  });

  it('only WARNS on a similar name — it might really be a different company', () => {
    const v = checkForDuplicates({ name: 'Zomato Pvt Ltd' }, [co({ name: 'Zomato' })]);
    expect(v.action).toBe('WARN');
    if (v.action === 'WARN') expect(v.matches[0].reason).toBe('name');
  });

  it('prefers the block when a record matches on both name and email', () => {
    const v = checkForDuplicates({ name: 'Zomato', email: 'hello@zomato.com' }, [
      co({ name: 'Zomato', email: 'hello@zomato.com' }),
    ]);
    expect(v.action).toBe('BLOCK');
    if (v.action === 'BLOCK') expect(v.matches).toHaveLength(1);
  });

  it('reports every match, so the person choosing can see them all', () => {
    const v = checkForDuplicates({ name: 'Zomato' }, [
      co({ id: 'a', name: 'Zomato Pvt Ltd' }),
      co({ id: 'b', name: 'Zomato Media' }),
    ]);
    expect(v.action).toBe('WARN');
    if (v.action === 'WARN') expect(v.matches.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('ignores a blank email on the candidate rather than matching other blanks', () => {
    expect(checkForDuplicates({ name: 'Swiggy', email: '' }, [co({ email: null })]).action).toBe(
      'CREATE',
    );
  });
});

describe('checkForImport', () => {
  // A spreadsheet that refuses to load because row 40 looks familiar is one
  // nobody uses twice.
  it('flags rather than blocks', () => {
    const r = checkForImport({ name: 'X', email: 'hello@zomato.com' }, [
      co({ email: 'hello@zomato.com' }),
    ]);
    expect(r.flagged).toBe(true);
    expect(r.matches).toHaveLength(1);
  });

  it('flags a name warning too', () => {
    expect(checkForImport({ name: 'Zomato Pvt Ltd' }, [co({ name: 'Zomato' })]).flagged).toBe(true);
  });

  it('passes a clean row through', () => {
    expect(checkForImport({ name: 'Swiggy' }, [co()]).flagged).toBe(false);
  });
});
