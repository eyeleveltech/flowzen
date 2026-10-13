import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { STATE_OPTIONS, TotalsPreview, previewTotals } from './DocumentFields';

/**
 * The form has to say what the document will say.
 *
 * These two drifted apart once already: the printed proforma was changed to
 * show one GST line and the state without its code, and this form — which has
 * its own copy of both — went on showing "Tamil Nadu (33)" and a CGST/SGST
 * split. Nothing failed, the figures were right, and the only way to notice
 * was to print the document and compare it to the screen that made it.
 *
 * So these tests pin the form against the rendering rules in the API's
 * documentPdf.ts. If one side changes, this goes red.
 */

const preview = (over: Partial<React.ComponentProps<typeof TotalsPreview>> = {}) =>
  render(
    <TotalsPreview
      kind="PROFORMA"
      subtotal={180000}
      gstApplicable
      gstRatePercent={18}
      interState={false}
      {...over}
    />,
  );

describe('the state picker', () => {
  it('labels a state by name, not "Tamil Nadu (33)"', () => {
    const tn = STATE_OPTIONS.find((o) => o.value === '33');
    expect(tn?.label).toBe('Tamil Nadu');
  });

  it('still carries the code as the value, because that is what decides the tax', () => {
    expect(STATE_OPTIONS.find((o) => o.label === 'Karnataka')?.value).toBe('29');
  });

  it('shows no bracketed code anywhere in the list', () => {
    expect(STATE_OPTIONS.filter((o) => /\(\d+\)/.test(o.label))).toEqual([]);
  });
});

describe('the totals preview', () => {
  it('shows a proforma one GST line, as the proforma prints', () => {
    preview();
    expect(screen.getByText('GST @ 18%')).toBeTruthy();
    expect(screen.queryByText(/CGST/)).toBeNull();
    expect(screen.queryByText(/SGST/)).toBeNull();
    expect(screen.getByText('₹32,400.00')).toBeTruthy();
  });

  it('shows an invoice the heads separately, as Rule 46 requires', () => {
    preview({ kind: 'INVOICE' });
    expect(screen.getByText('CGST @ 9%')).toBeTruthy();
    expect(screen.getByText('SGST @ 9%')).toBeTruthy();
    expect(screen.queryByText('GST @ 18%')).toBeNull();
  });

  it('keeps IGST one line on an inter-state invoice', () => {
    preview({ kind: 'INVOICE', interState: true });
    expect(screen.getByText('IGST @ 18%')).toBeTruthy();
    expect(screen.queryByText(/CGST/)).toBeNull();
  });

  it('shows the same total either way — only the presentation differs', () => {
    const { unmount } = preview();
    const proformaTotal = screen.getAllByText('₹2,12,400.00').length;
    unmount();
    preview({ kind: 'INVOICE' });
    expect(screen.getAllByText('₹2,12,400.00').length).toBe(proformaTotal);
  });

  it('says so plainly when GST does not apply', () => {
    preview({ gstApplicable: false });
    expect(screen.getByText('Not applicable')).toBeTruthy();
    expect(screen.queryByText(/@ 18%/)).toBeNull();
  });
});

// Money Plan 2, decision 7: each line at its own rate, as the server prices it.
describe('lines at 18% and 5%', () => {
  const lines = [
    { particulars: 'Campaign film', units: '1', unitCost: '10000', hsnSac: '', gstRate: '' },
    { particulars: 'Brochures', units: '2', unitCost: '2000', hsnSac: '', gstRate: '5' },
  ];

  it('totals the way the document will', () => {
    const t = previewTotals(lines, true, 18);
    expect(t.subtotal).toBe(14000);
    expect(t.rates.map((r) => [r.rate, r.taxable, r.tax])).toEqual([
      [18, 10000, 1800],
      [5, 4000, 200],
    ]);
    expect(t.total).toBe(16000);
  });

  it('shows a tax row per rate on a tax invoice', () => {
    render(<TotalsPreview kind="INVOICE" subtotal={14000} gstApplicable gstRatePercent={18} interState={false} lines={lines} />);
    expect(screen.getByText('CGST @ 9%')).toBeTruthy();
    expect(screen.getByText('CGST @ 2.5%')).toBeTruthy();
    expect(screen.getByText('SGST @ 2.5%')).toBeTruthy();
  });
});
