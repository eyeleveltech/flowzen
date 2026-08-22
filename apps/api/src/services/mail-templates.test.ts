import { describe, it, expect } from 'vitest';
import { esc, inviteEmail, passwordResetEmail, quotationEmail, testEmail } from './mail-templates.js';

/**
 * These messages are assembled by concatenating strings, which is the right
 * trade for mail — a template engine buys nothing when every client renders
 * differently anyway — but it puts the escaping burden on us.
 *
 * Client names, contact names and the note somebody types before sending all
 * reach the HTML. "Smith & Sons <Chennai>" is an ordinary agency client, and
 * unescaped it silently breaks the document. So the escaping is tested rather
 * than trusted.
 */

const quoteArgs = {
  orgName: 'Eyelevel',
  clientName: 'Suvai Foods',
  contactName: 'Meera',
  number: 'EL/QT/2026-27/003',
  lines: [{ description: 'Social media', quantity: '1', rate: '₹30,000', amount: '₹30,000' }],
  subtotal: '₹30,000',
  taxRows: [{ label: 'CGST', amount: '₹2,700' }],
  total: '₹35,400',
  validUntil: '10 September 2026',
  senderName: 'Harish',
  note: null,
};

describe('mail templates', () => {
  describe('esc', () => {
    it('escapes everything that can break the document', () => {
      expect(esc('Smith & Sons <Chennai>')).toBe('Smith &amp; Sons &lt;Chennai&gt;');
      expect(esc(`"quoted" and 'single'`)).toBe('&quot;quoted&quot; and &#39;single&#39;');
    });

    it('turns absent values into an empty string rather than "null"', () => {
      expect(esc(null)).toBe('');
      expect(esc(undefined)).toBe('');
    });
  });

  describe('the invitation', () => {
    it('carries the token in a link, and nowhere else', () => {
      const { html } = inviteEmail({
        orgName: 'Eyelevel',
        inviterName: 'Harish',
        recipientName: 'Priya',
        role: 'ADMIN',
        token: 'abc123',
      });
      expect(html).toContain('/accept-invite?token=abc123');
      expect(html).toContain('seven days');
    });

    it('escapes a name, so an apostrophe cannot break the markup', () => {
      const { html, subject } = inviteEmail({
        orgName: "D'Souza & Co",
        inviterName: 'Harish',
        recipientName: '<script>alert(1)</script>',
        role: 'MEMBER',
        token: 't',
      });
      expect(html).toContain('D&#39;Souza &amp; Co');
      expect(html).not.toContain('<script>');
      // The SUBJECT is not HTML, so it is deliberately not escaped — a mail
      // client shows it as text and "&amp;" there would be a visible bug.
      expect(subject).toContain("D'Souza & Co");
    });

    it('URL-encodes the token rather than pasting it into a query string raw', () => {
      const { html } = inviteEmail({
        orgName: 'Eyelevel',
        inviterName: 'H',
        recipientName: 'P',
        role: 'MEMBER',
        token: 'a+b/c=d',
      });
      expect(html).toContain('token=a%2Bb%2Fc%3Dd');
    });
  });

  describe('the password reset', () => {
    it('names who started it — an unexplained reset reads as an attack', () => {
      const { html } = passwordResetEmail({
        orgName: 'Eyelevel',
        recipientName: 'Priya',
        token: 'x',
        issuedBy: 'Harish',
      });
      expect(html).toContain('Harish');
      expect(html).toContain('one hour');
    });

    it('falls back to the passive voice when nobody is named', () => {
      const { html } = passwordResetEmail({ orgName: 'Eyelevel', recipientName: 'Priya', token: 'x' });
      expect(html).toContain('A password reset was requested');
    });
  });

  describe('the quotation', () => {
    it('puts the figures in the body, not only in an attachment', () => {
      const { html, subject } = quotationEmail(quoteArgs);
      expect(html).toContain('₹35,400');
      expect(html).toContain('Social media');
      expect(html).toContain('CGST');
      expect(subject).toBe('Quotation EL/QT/2026-27/003 from Eyelevel');
    });

    it('shows only the tax rows that apply', () => {
      const { html } = quotationEmail(quoteArgs);
      // The caller decides which rows exist; an IGST row alongside CGST would
      // invite the reader to wonder which one is the mistake.
      expect(html).not.toContain('IGST');
    });

    it('omits the validity line when there is no date, rather than printing null', () => {
      const { html } = quotationEmail({ ...quoteArgs, validUntil: null });
      expect(html).not.toContain('valid until');
    });

    it('escapes the note somebody typed before sending', () => {
      const { html } = quotationEmail({ ...quoteArgs, note: '<b>call me</b> & confirm' });
      expect(html).toContain('&lt;b&gt;call me&lt;/b&gt; &amp; confirm');
    });

    it('greets generically when there is no named contact', () => {
      const { html } = quotationEmail({ ...quoteArgs, contactName: null });
      expect(html).toContain('Hello,');
    });
  });

  describe('the test message', () => {
    it('says plainly that nothing else was sent', () => {
      const { html } = testEmail({ orgName: 'Eyelevel', recipientName: 'Harish' });
      expect(html).toContain('only a test');
    });
  });
});
