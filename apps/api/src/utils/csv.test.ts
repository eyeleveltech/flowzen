import { describe, it, expect } from 'vitest';
import { parseCsv, normaliseHeader, toCsv } from './csv.js';

/**
 * The four things a real spreadsheet export contains that `split(',')` gets
 * wrong. Each of these is a row somebody's file actually has.
 */
describe('parseCsv', () => {
  it('reads a plain file', () => {
    expect(parseCsv('name,email\nAcme,hi@acme.com')).toEqual([
      { name: 'Acme', email: 'hi@acme.com' },
    ]);
  });

  it('keeps commas inside quoted fields', () => {
    // The single commonest one: a company name with a suffix.
    expect(parseCsv('name,city\n"Acme, Inc.",Chennai')).toEqual([
      { name: 'Acme, Inc.', city: 'Chennai' },
    ]);
  });

  it('keeps newlines inside quoted fields', () => {
    const rows = parseCsv('name,address\nAcme,"12 Long Road\nChennai"');
    expect(rows[0].address).toBe('12 Long Road\nChennai');
    expect(rows).toHaveLength(1);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsv('name,note\nAcme,"He said ""yes"""')[0].note).toBe('He said "yes"');
  });

  it('strips the BOM Excel writes', () => {
    // Left in, the first header becomes "﻿name" and every name is missing.
    expect(parseCsv('﻿name,email\nAcme,hi@acme.com')[0].name).toBe('Acme');
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('name,email\r\nAcme,hi@acme.com\r\n')).toEqual([
      { name: 'Acme', email: 'hi@acme.com' },
    ]);
  });

  it('drops empty cells rather than storing empty strings', () => {
    // So `row.email ?? null` in the importer means what it looks like.
    expect(parseCsv('name,email\nAcme,')).toEqual([{ name: 'Acme' }]);
  });

  it('returns nothing for a header-only or empty file', () => {
    expect(parseCsv('name,email')).toEqual([]);
    expect(parseCsv('')).toEqual([]);
  });

  it('ignores a trailing newline', () => {
    expect(parseCsv('name\nAcme\n')).toHaveLength(1);
  });

  it('tolerates a short row', () => {
    expect(parseCsv('name,email,phone\nAcme,hi@acme.com')).toEqual([
      { name: 'Acme', email: 'hi@acme.com' },
    ]);
  });
});

describe('normaliseHeader', () => {
  it('treats capitalisation, spaces and underscores as the same header', () => {
    for (const header of ['Company Name', 'company_name', 'COMPANY NAME', 'company-name']) {
      expect(normaliseHeader(header)).toBe('companyname');
    }
  });
});

describe('toCsv', () => {
  const strip = (s: string) => s.replace(/^﻿/, '');

  it('writes a header row and one line per record', () => {
    const rows = [{ name: 'Acme', city: 'Chennai' }];
    const out = strip(
      toCsv(rows, [
        { label: 'Name', value: (r) => r.name },
        { label: 'City', value: (r) => r.city },
      ]),
    );
    expect(out).toBe('Name,City\r\nAcme,Chennai');
  });

  it('quotes a field holding a comma', () => {
    const out = strip(toCsv([{ name: 'Acme, Inc.' }], [{ label: 'Name', value: (r) => r.name }]));
    expect(out).toBe('Name\r\n"Acme, Inc."');
  });

  it('doubles an embedded quote', () => {
    const out = strip(toCsv([{ note: 'He said "yes"' }], [{ label: 'Note', value: (r) => r.note }]));
    expect(out).toBe('Note\r\n"He said ""yes"""');
  });

  it('quotes a field holding a newline', () => {
    const out = strip(toCsv([{ addr: '12 Long Road\nChennai' }], [{ label: 'Address', value: (r) => r.addr }]));
    expect(out).toBe('Address\r\n"12 Long Road\nChennai"');
  });

  it('round-trips through parseCsv', () => {
    const rows = [
      { name: 'Acme, Inc.', note: 'He said "yes"\nTwice.' },
      { name: 'Zenith', note: 'plain' },
    ];
    const csv = toCsv(rows, [
      { label: 'Name', value: (r) => r.name },
      { label: 'Note', value: (r) => r.note },
    ]);
    expect(parseCsv(csv)).toEqual([
      { name: 'Acme, Inc.', note: 'He said "yes"\nTwice.' },
      { name: 'Zenith', note: 'plain' },
    ]);
  });

  it('writes a null or undefined value as an empty cell, not the word null', () => {
    const out = strip(
      toCsv([{ v: null as string | null }], [{ label: 'V', value: (r) => r.v }]),
    );
    expect(out).toBe('V\r\n');
  });

  it('leads with a UTF-8 BOM so Excel does not mangle non-ASCII text', () => {
    const out = toCsv([{ name: 'Café' }], [{ label: 'Name', value: (r) => r.name }]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
  });

  it('writes only the header for zero rows', () => {
    expect(strip(toCsv([], [{ label: 'Name', value: () => '' }]))).toBe('Name');
  });
});
