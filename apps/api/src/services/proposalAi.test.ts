import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { applyChanges, askProposalAi, refusalFor, tidyDashes } from './proposalAi.js';
import type { AiReply, AiRequest } from './ai/index.js';

/**
 * Writing with the AI (AI Proposal Builder, phase 2): what it may suggest,
 * what it may not, and that a suggestion is only ever a suggestion.
 */

const replies: AiReply[] = [];
const asked: AiRequest[] = [];
vi.mock('./moneyAssistant.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./moneyAssistant.js')>()),
  settingsFor: vi.fn(async () => ({
    model: 'test-model',
    apiKey: 'k',
    provider: {
      complete: vi.fn(async (req: AiRequest) => {
        asked.push(structuredClone(req));
        return replies.shift() ?? { text: 'Done.', calls: [] };
      }),
    },
  })),
}));

const p = prisma as any;

const SECTIONS = [
  { id: 'intro', type: 'INTRO', title: 'About EyeLevel', body: '', visible: true },
  { id: 'scope', type: 'SCOPE', title: 'Scope of work', body: 'Old scope', visible: true },
  { id: 'commercial', type: 'COMMERCIAL', title: 'Investment', body: '', visible: true },
  { id: 'terms', type: 'TERMS', title: 'Terms', body: '- Ad spend billed separately', visible: true },
];

beforeEach(() => {
  replies.length = 0;
  asked.length = 0;
  p.proposalDocument.findFirst.mockResolvedValue({
    id: 'doc-1',
    n: 1,
    status: 'DRAFT',
    title: 'Proposal for Acme Homes',
    sections: SECTIONS,
    aiThread: [],
    lineItems: [],
    proposal: {
      kind: 'RETAINER',
      companyId: 'co-1',
      owner: { name: 'Varsha' },
      company: {
        name: 'Acme Homes',
        vertical: 'Real Estate & Infrastructure',
        city: 'Chennai',
        stateName: 'Tamil Nadu',
        website: null,
        people: [{ name: 'Priya', role: 'APPROVER' }],
        retainers: [],
        projects: [],
      },
    },
  });
  p.organization.findUniqueOrThrow.mockResolvedValue({ name: 'EyeLevel', timezone: 'Asia/Kolkata', defaultTermsAndConditions: [] });
  p.serviceCatalogItem.findMany.mockResolvedValue([
    { id: 'cat-smm', name: 'Social media management', billing: 'MONTHLY', unit: 'month', description: null, standardRate: 85000 },
    { id: 'cat-seo', name: 'SEO', billing: 'MONTHLY', unit: 'month', description: null, standardRate: null },
  ]);
  p.proposalDocument.update.mockResolvedValue({});
});

const ask = (message: string, setsPrices = false) =>
  askProposalAi({ organizationId: 'org-1', userId: 'usr-1', userName: 'Varsha', setsPrices, documentId: 'doc-1', message });

describe('a suggestion', () => {
  it('is refused with a price in it, and kept without one, dashes tidied', async () => {
    replies.push(
      {
        text: '',
        calls: [
          {
            id: 't1',
            name: 'propose_sections',
            args: {
              changes: [
                { id: 'scope', type: 'SCOPE', title: 'Scope of work', body: 'Everything for just ₹50,000 a month.' },
                { id: 'intro', type: 'INTRO', title: 'About EyeLevel', body: 'We are a studio — based in Chennai.' },
              ],
            },
          },
        ],
      },
      { text: 'I rewrote the intro.', calls: [] },
    );
    const { entry, thread } = await ask('Write the intro and scope');
    expect(entry.from).toBe('ai');
    if (entry.from !== 'ai') return;
    expect(entry.changes).toHaveLength(1);
    expect(entry.changes[0]).toMatchObject({ sectionId: 'intro', after: 'We are a studio, based in Chennai.', status: 'PENDING' });
    // The model was told why the scope was refused.
    const toolTurn = asked[1].turns.find((t) => t.role === 'tool') as any;
    expect(JSON.stringify(toolTurn.results)).toMatch(/₹50,000.*see Investment/);
    // Saved as a suggestion; the sections themselves are untouched.
    expect(thread.map((e) => e.from)).toEqual(['you', 'ai']);
    const saved = p.proposalDocument.update.mock.calls[0][0].data;
    expect(Object.keys(saved)).toEqual(['aiThread']);
  });

  it('never offers anybody outside Management a way to set a price', async () => {
    replies.push({ text: 'Management sets prices on the Pricing tab.', calls: [] });
    await ask('Make social ₹90,000 a month');
    expect(asked[0].tools.map((t) => t.name)).not.toContain('stage_line_items');
    expect(asked[0].context).toMatch(/Sets prices: no/);
  });

  it('stages a rate only when the person typed it, else the service list’s', async () => {
    replies.push(
      {
        text: '',
        calls: [
          {
            id: 't1',
            name: 'stage_line_items',
            args: {
              items: [
                { service: 'Social media management', rate: 90000 },
                { service: 'SEO', rate: 40000 },
              ],
            },
          },
        ],
      },
      { text: 'Staged both on the Pricing tab.', calls: [] },
    );
    const { entry } = await ask('Make social ₹90,000 a month and add SEO', true);
    if (entry.from !== 'ai') throw new Error('expected an answer');
    expect(entry.lines?.items).toEqual([
      expect.objectContaining({ catalogItemId: 'cat-smm', unitRate: 90000, rateFrom: 'YOU', billing: 'MONTHLY' }),
      // ₹40,000 was never typed and SEO has no standard rate: no rate at all.
      expect.objectContaining({ catalogItemId: 'cat-seo', unitRate: 0, rateFrom: null }),
    ]);
  });

  it('is told what the client record already says, so it need not ask', async () => {
    replies.push({ text: 'Done.', calls: [] });
    await ask('Write the first draft');
    expect(asked[0].context).toMatch(/Client: Acme Homes\. Industry: Real Estate & Infrastructure\. Based in Chennai, Tamil Nadu/);
    expect(asked[0].context).toMatch(/id scope · SCOPE · "Scope of work": Old scope/);
  });
});

describe('the house style', () => {
  it('refuses prices, stock phrases and an Investment text', () => {
    expect(refusalFor('SCOPE', 'Fee of Rs. 75,000')).toMatch(/Rs\. 75,000/);
    expect(refusalFor('INTRO', 'We leverage data.')).toMatch(/"leverage"/);
    expect(refusalFor('INTRO', 'We use clever data.')).toBeNull();
    expect(refusalFor('COMMERCIAL', 'anything')).toMatch(/Pricing tab/);
  });

  it('takes the dashes out', () => {
    expect(tidyDashes('Fast — and careful. Jan–Mar.')).toBe('Fast, and careful. Jan-Mar.');
  });

  it('puts a new section before the terms', () => {
    const out = applyChanges(SECTIONS as any, [
      { id: 'abcdef12-x', sectionId: null, type: 'CUSTOM', title: 'Reporting', before: null, after: 'Monthly.', status: 'PENDING' },
    ]);
    expect(out.map((s) => s.id)).toEqual(['intro', 'scope', 'commercial', 'custom-abcdef12', 'terms']);
  });
});
