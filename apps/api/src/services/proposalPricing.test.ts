import { describe, it, expect } from 'vitest';
import { amountsInText, dealValueOf, floorFor, priceProposal, type ProposalLineInput } from './proposalPricing.js';
import { unbackedAmounts, proseToHtml, proseParts, defaultSections, readFloors } from './proposalDocument.js';

/**
 * The house rules a proposal's price is held to (AI Proposal Builder, phase 1):
 * monthly and one-time apart, ad spend outside the fee, a floor per industry,
 * a trade for every discount — and no rupee figure in the prose that the line
 * items do not back.
 */

const floors = { 'Real Estate & Infrastructure': 200000, 'Healthcare & Wellness': 150000 };
const ctx = (vertical: string | null, isInterState = false) => ({ vertical, floorBase: 75000, floors, isInterState });

const retainer: ProposalLineInput[] = [
  { name: 'Social media management', billing: 'MONTHLY', qty: 1, unit: 'month', unitRate: 90000 },
  { name: 'Performance marketing', billing: 'MONTHLY', qty: 1, unit: 'month', unitRate: 40000 },
  { name: 'Brand film', billing: 'ONE_TIME', qty: 1, unitRate: 150000 },
  { name: 'Meta ad spend', billing: 'MONTHLY', qty: 1, unitRate: 200000, isPassthrough: true },
];

describe('priceProposal', () => {
  it('prices monthly and one-time apart and never adds them together', () => {
    const p = priceProposal(retainer, ctx('Retail'));
    expect(p.monthly.subtotal).toBe(130000);
    expect(p.oneTime.subtotal).toBe(150000);
    expect(p.monthly.total).toBe(153400);
    expect(p.oneTime.total).toBe(177000);
    expect(p).not.toHaveProperty('total');
  });

  it('keeps ad spend out of the fee and untaxed', () => {
    const p = priceProposal(retainer, ctx('Retail'));
    expect(p.passthrough.total).toBe(200000);
    expect(p.monthly.lines.map((l) => l.name)).not.toContain('Meta ad spend');
    expect(p.monthly.totalTax).toBe(23400);
  });

  it('splits GST by place of supply, as a proforma does', () => {
    const intra = priceProposal(retainer, ctx('Retail', false));
    expect([intra.monthly.cgst, intra.monthly.sgst, intra.monthly.igst]).toEqual([11700, 11700, 0]);
    const inter = priceProposal(retainer, ctx('Retail', true));
    expect([inter.monthly.cgst, inter.monthly.sgst, inter.monthly.igst]).toEqual([0, 0, 23400]);
    expect(inter.supplyType).toBe('INTER');
  });

  it("checks the monthly fee against the industry's floor, else the base", () => {
    expect(priceProposal(retainer, ctx('Real Estate & Infrastructure')).floor).toMatchObject({ applies: true, floor: 200000, passes: false });
    expect(priceProposal(retainer, ctx('Healthcare & Wellness')).floor.passes).toBe(false);
    expect(priceProposal(retainer, ctx('Retail')).floor).toMatchObject({ floor: 75000, passes: true });
    expect(floorFor(null, 75000, floors)).toBe(75000);
  });

  it('exempts a one-time project fee from the floor', () => {
    const p = priceProposal([{ name: 'Website', billing: 'ONE_TIME', qty: 1, unitRate: 50000 }], ctx('Real Estate & Infrastructure'));
    expect(p.floor).toMatchObject({ applies: false, passes: true });
  });

  it('nets a discount off its line and names any discount with no trade', () => {
    const p = priceProposal(
      [
        { name: 'SEO', billing: 'MONTHLY', qty: 1, unitRate: 100000, discountAmount: 10000, discountTrade: '12-month term' },
        { name: 'Content', billing: 'MONTHLY', qty: 2, unitRate: 30000, discountAmount: 5000 },
      ],
      ctx('Retail'),
    );
    expect(p.monthly.gross).toBe(160000);
    expect(p.monthly.discount).toBe(15000);
    expect(p.monthly.subtotal).toBe(145000);
    expect(p.discountsWithoutTrade).toEqual(['Content']);
  });

  it('records the retainer fee as a retainer deal value, the project fee for a project', () => {
    const p = priceProposal(retainer, ctx('Retail'));
    expect(dealValueOf(p, 'RETAINER')).toBe(130000);
    expect(dealValueOf(p, 'PROJECT')).toBe(150000);
    const onlyMonthly = priceProposal(retainer.slice(0, 2), ctx('Retail'));
    expect(dealValueOf(onlyMonthly, 'PROJECT')).toBe(130000);
  });
});

describe('prices in the prose', () => {
  it('reads rupees however they are written', () => {
    expect(amountsInText('₹1,20,000 a month, Rs. 90,000 once, INR 75000, ₹50k, or 1.2 lakh').map((a) => a.value)).toEqual([
      120000, 90000, 75000, 50000, 120000,
    ]);
    expect(amountsInText('about ₹1.5 lakh').map((a) => a.value)).toEqual([150000]);
    expect(amountsInText('₹2 cr').map((a) => a.value)).toEqual([20000000]);
    // Numbers that are not prices.
    expect(amountsInText('12 posts, 4 hours 5 days, 3 reels a week, 2026')).toEqual([]);
  });

  it('flags a figure the line items do not back, and lets one they do', () => {
    const price = priceProposal(retainer, ctx('Retail'));
    const sections = [
      { id: 'a', type: 'SCOPE' as const, title: 'Scope', body: 'All this for ₹1,30,000 a month.', visible: true },
      { id: 'b', type: 'INTRO' as const, title: 'Intro', body: 'Last year a client paid ₹50,000.', visible: true },
      { id: 'c', type: 'TIMELINE' as const, title: 'Hidden', body: '₹99,999', visible: false },
    ];
    expect(unbackedAmounts(null, sections, price)).toEqual(['₹50,000']);
  });
});

describe('the document', () => {
  it('starts with the studio terms as bullets', () => {
    const s = defaultSections({ orgName: 'EyeLevel', terms: ['Ad spend is billed separately'] });
    expect(s.map((x) => x.type)).toEqual(['COVER', 'INTRO', 'UNDERSTANDING', 'SCOPE', 'TIMELINE', 'COMMERCIAL', 'TERMS', 'NEXT_STEPS']);
    expect(s.find((x) => x.type === 'TERMS')!.body).toBe('- Ad spend is billed separately');
  });

  it('turns plain text into paragraphs and bullets, escaping everything', () => {
    expect(proseToHtml('One <b>line</b>\n\n- a\n- b')).toBe('<p>One &lt;b&gt;line&lt;/b&gt;</p><ul><li>a</li><li>b</li></ul>');
  });

  it('heads a list with the line above it', () => {
    expect(proseParts('Social media\n- 12 posts\n- 8 reels\nReporting\n- Monthly')).toEqual([
      { kind: 'lead', text: 'Social media' },
      { kind: 'list', items: ['12 posts', '8 reels'] },
      { kind: 'lead', text: 'Reporting' },
      { kind: 'list', items: ['Monthly'] },
    ]);
  });

  it('reads stored floors, ignoring anything that is not an amount', () => {
    expect(readFloors({ Retail: 90000, Bad: 'x', '': 5 })).toEqual({ Retail: 90000 });
    expect(readFloors(null)).toEqual({});
  });
});
