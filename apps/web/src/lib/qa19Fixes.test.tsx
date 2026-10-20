import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { industryOption, sourceOption, INDUSTRY_OPTIONS, SOURCE_OPTIONS } from './vertical';
import { invoicedAndDue } from './invoiceDates';
import { shortcut } from './shortcut';
import { NextStepLine, isNextStepMissing, nextStepReady } from '@/components/sales/NextStep';

/** QA19 fixes plan — the screen-side halves of F02, F03 and F04, and the shortcut hint. */

describe('F02 — what a lead form holds is what it shows', () => {
  const offered = (opts: { value: string }[], v: string) => opts.some((o) => o.value === v);

  it('a new lead starts with no industry, and on Cold Outreach — a real option', () => {
    expect(industryOption(null)).toBe('');
    expect(sourceOption(null)).toBe('Cold Outreach');
    expect(offered(SOURCE_OPTIONS, sourceOption(null))).toBe(true);
  });

  it('the legacy codes the form used to start on map to the options they mean', () => {
    // 'HEALTHCARE' and 'OUTREACH' matched no option: the select read "Select…" while they were saved.
    expect(offered(INDUSTRY_OPTIONS, 'HEALTHCARE')).toBe(false);
    expect(industryOption('HEALTHCARE')).toBe('Healthcare & Wellness');
    expect(sourceOption('OUTREACH')).toBe('Cold Outreach');
    expect(industryOption('Retail')).toBe('Retail');
    // Something that maps to nothing is left for the person to choose.
    expect(industryOption('MARS_MINING')).toBe('');
  });
});

describe('F03 — an invoice says when it was raised and when it is due', () => {
  const fmt = (d: string) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }).format(new Date(d));

  it('reads "invoiced 19 Oct · due 3 Nov", never the due date under "invoiced"', () => {
    const inv = { raisedAt: '2026-10-19T00:00:00.000Z', dueAt: '2026-11-03T00:00:00.000Z' };
    expect(invoicedAndDue(inv, fmt)).toBe('invoiced 19 Oct · due 3 Nov');
    expect(invoicedAndDue(inv, fmt, { capital: true })).toBe('Invoiced 19 Oct · due 3 Nov');
  });

  it('leaves out a date it does not have rather than guessing', () => {
    expect(invoicedAndDue({ dueAt: '2026-11-03T00:00:00.000Z' }, fmt)).toBe('due 3 Nov');
  });
});

describe('F04 — a next step written without a date', () => {
  it('is not missing, and shows "date not set"', () => {
    expect(isNextStepMissing('Call on Monday')).toBe(false);
    expect(isNextStepMissing('')).toBe(true);
    const { container } = render(<NextStepLine nextStep="Call on Monday" nextStepDate={null} missing={false} />);
    expect(container.textContent).toContain('Call on Monday');
    expect(container.textContent).toContain('date not set');
    expect(container.textContent).not.toContain('No next step');
  });

  it('saves from "Set next step" without a date, but never with a past one', () => {
    expect(nextStepReady({ nextStep: 'Call on Monday', nextStepDate: '' }, '2026-10-19')).toBe(true);
    expect(nextStepReady({ nextStep: 'Call on Monday', nextStepDate: '2026-10-18' }, '2026-10-19')).toBe(false);
    expect(nextStepReady({ nextStep: '', nextStepDate: '2026-10-25' }, '2026-10-19')).toBe(false);
  });
});

describe('the shortcut hint, per platform', () => {
  it('Ctrl+K on Windows and Linux, ⌘K on a Mac', () => {
    expect(shortcut('K', false)).toBe('Ctrl+K');
    expect(shortcut('K', true)).toBe('⌘K');
    expect(shortcut('J', false)).toBe('Ctrl+J');
  });
});
