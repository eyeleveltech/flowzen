import { describe, it, expect } from 'vitest';
import { classifyLink } from './safeLink';

describe('classifyLink', () => {
  it('keeps the app’s own paths in the app', () => {
    expect(classifyLink('/companies/abc?tab=MONEY')).toEqual({ kind: 'internal', href: '/companies/abc?tab=MONEY' });
  });

  it('treats the backslash and protocol-relative tricks as other sites (M6)', () => {
    expect(classifyLink('/\\evil.com/x')).toMatchObject({ kind: 'external', host: 'evil.com' });
    expect(classifyLink('//evil.com')).toMatchObject({ kind: 'external', host: 'evil.com' });
    expect(classifyLink('/\t/evil.com')).toMatchObject({ kind: 'external', host: 'evil.com' });
    // As the Markdown renderer hands it over: the backslash percent-encoded.
    expect(classifyLink('/%5Cevil.com/x')).toEqual({ kind: 'none' });
    expect(classifyLink('/%2f%2fevil.com')).toEqual({ kind: 'none' });
  });

  it('names the domain of an external link', () => {
    expect(classifyLink('https://www.example.com/report?a=1')).toEqual({
      kind: 'external',
      href: 'https://www.example.com/report?a=1',
      host: 'example.com',
    });
  });

  it('refuses anything that is not a web link', () => {
    expect(classifyLink('javascript:alert(1)')).toEqual({ kind: 'none' });
    expect(classifyLink('data:text/html,<script>')).toEqual({ kind: 'none' });
    expect(classifyLink('')).toEqual({ kind: 'none' });
    expect(classifyLink('/x\u0000y')).toEqual({ kind: 'none' });
  });
});
