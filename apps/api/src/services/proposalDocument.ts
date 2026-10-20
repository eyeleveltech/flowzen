/**
 * A proposal document: its sections, its reference, and how it prints.
 * (AI Proposal Builder, phase 1 — written by hand; the AI drafting comes later.)
 *
 * A document is prose in sections plus a price in line items. The prose is
 * whatever the writer typed. The price is never typed into the prose: the
 * Investment section is drawn from the line items through proposalPricing.ts,
 * and Finalise refuses a document whose text names a rupee amount the line
 * items do not back.
 *
 * The renderer here looks nothing up and computes nothing. It is handed the
 * document, the deal, the studio and the priced lines, and lays them out —
 * the same separation documentModel.ts keeps for proformas and invoices.
 */

import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { financialYearOf, orgToday } from '../utils/moneyDates.js';
import { escapeHtml } from '../utils/html.js';
import { buildSellerSnapshot, resolveState, resolveSupplyType, type SellerSnapshot } from './documentModel.js';
import { getLogoDataUri, htmlToPdf } from './documentPdf.js';
import {
  allowedAmounts,
  amountsInText,
  priceProposal,
  type FeeGroup,
  type PricingContext,
  type ProposalLineInput,
  type ProposalPrice,
} from './proposalPricing.js';

// ── Sections ────────────────────────────────────────────────────────────────

export const SECTION_TYPES = [
  'COVER',
  'INTRO',
  'UNDERSTANDING',
  'SCOPE',
  'TIMELINE',
  'COMMERCIAL',
  'TERMS',
  'NEXT_STEPS',
  'CUSTOM',
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export interface ProposalSection {
  id: string;
  type: SectionType;
  title: string;
  /** Plain text. A blank line starts a paragraph; a line starting "- " is a bullet. */
  body: string;
  visible: boolean;
}

export const sectionSchema = z.object({
  id: z.string().min(1).max(40),
  type: z.enum(SECTION_TYPES),
  title: z.string().trim().max(120),
  body: z.string().max(20_000, 'That section is too long — split it into two'),
  visible: z.boolean(),
});

export const sectionsSchema = z
  .array(sectionSchema)
  .max(30)
  .refine((s) => s.filter((x) => x.type === 'COMMERCIAL').length <= 1, 'A proposal has one Investment section')
  .refine((s) => s.filter((x) => x.type === 'COVER').length <= 1, 'A proposal has one cover');

/** Sections whose body is never printed: the cover is drawn from the deal, the Investment from the line items. */
const DRAWN: SectionType[] = ['COVER', 'COMMERCIAL'];

export function parseSections(raw: unknown): ProposalSection[] {
  const parsed = z.array(sectionSchema).safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/**
 * What a new proposal starts with. Headings, and the parts the studio already
 * knows — its terms, how work starts. The rest is the writer's to fill.
 */
export function defaultSections(input: { orgName: string; terms: string[] }): ProposalSection[] {
  const s = (id: string, type: SectionType, title: string, body = ''): ProposalSection => ({
    id,
    type,
    title,
    body,
    visible: true,
  });
  return [
    s('cover', 'COVER', 'Cover'),
    s('intro', 'INTRO', `About ${input.orgName}`),
    s('understanding', 'UNDERSTANDING', 'What we heard'),
    s('scope', 'SCOPE', 'Scope of work'),
    s('timeline', 'TIMELINE', 'Timeline'),
    s('commercial', 'COMMERCIAL', 'Investment'),
    s('terms', 'TERMS', 'Terms', input.terms.map((t) => `- ${t}`).join('\n')),
    s(
      'next',
      'NEXT_STEPS',
      'Next steps',
      ['- You confirm the scope and the fee.', '- We raise a proforma invoice.', '- Work begins on confirmation and payment.'].join('\n'),
    ),
  ];
}

/**
 * "[[Needs input: the launch date]]" — a gap the writer (or the AI) left on
 * purpose rather than inventing something. It prints as a yellow chip on a
 * draft, and Finalise refuses while any remain in a shown section.
 */
export const NEEDS_INPUT = /\[\[\s*(?:needs input\s*:?\s*)?([^\]]+?)\s*\]\]/gi;

/** What the shown sections and the title still need, in words. */
export function needsInputIn(title: string | null, sections: ProposalSection[]): string[] {
  const text = [title ?? '', ...sections.filter((s) => s.visible && s.type !== 'COMMERCIAL').map((s) => s.body)].join('\n');
  return Array.from(new Set(Array.from(text.matchAll(NEEDS_INPUT), (m) => m[1].trim())));
}

export type ProsePart =
  | { kind: 'para'; lines: string[] }
  | { kind: 'list'; items: string[] }
  /** One line straight above a list: "Social media management" over its bullets. */
  | { kind: 'lead'; text: string };

const BULLET = /^\s*[-•*]\s+/;

/**
 * Plain text, split the way both the PDF and the Word file print it: a blank
 * line starts a block; inside a block, lines starting "- " are a list, and a
 * single line right above a list is its lead-in. Nothing else is interpreted.
 */
export function proseParts(body: string): ProsePart[] {
  const parts: ProsePart[] = [];
  for (const block of body.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((l) => l.trim());
    let i = 0;
    while (i < lines.length) {
      if (BULLET.test(lines[i])) {
        const items: string[] = [];
        while (i < lines.length && BULLET.test(lines[i])) items.push(lines[i++].replace(BULLET, ''));
        parts.push({ kind: 'list', items });
        continue;
      }
      const run: string[] = [];
      while (i < lines.length && !BULLET.test(lines[i])) run.push(lines[i++]);
      // A one-line run with a list right after it heads that list.
      if (run.length === 1 && i < lines.length) parts.push({ kind: 'lead', text: run[0] });
      else parts.push({ kind: 'para', lines: run });
    }
  }
  return parts;
}

/** Visible sections that still have nothing written in them. */
export function emptySections(sections: ProposalSection[]): string[] {
  return sections.filter((s) => s.visible && !DRAWN.includes(s.type) && !s.body.trim()).map((s) => s.title || 'Untitled section');
}

/**
 * Rupee amounts in the prose that the line items do not back. The title and
 * every visible section are read; a hidden one does not print.
 */
export function unbackedAmounts(title: string | null, sections: ProposalSection[], price: ProposalPrice): string[] {
  const allowed = allowedAmounts(price);
  const text = [title ?? '', ...sections.filter((s) => s.visible && s.type !== 'COMMERCIAL').map((s) => `${s.title}\n${s.body}`)].join('\n');
  return Array.from(new Set(amountsInText(text).filter((a) => !allowed.has(a.value)).map((a) => a.text)));
}

// ── The reference ───────────────────────────────────────────────────────────

/** "EL/PR/2026-27/014" + version → "EL/PR/2026-27/014-v2". */
export const documentRef = (refNo: string | null, n: number): string => (refNo ? `${refNo}-v${n}` : `v${n}`);

/**
 * The next proposal reference: EL/PR/<financial year>/<count>, the year in
 * the studio's calendar. The prefix follows the proforma one — EL/PI makes
 * EL/PR — so a studio that renamed its series gets proposals to match.
 */
export async function nextProposalRef(organizationId: string, now = new Date()): Promise<string> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { proformaPrefix: true, timezone: true, financialYearStart: true },
  });
  const base = (org?.proformaPrefix || 'EL/PI').trim().replace(/\/+$/, '');
  const series = base.includes('/') ? `${base.slice(0, base.lastIndexOf('/'))}/PR` : 'EL/PR';
  const day = orgToday(org?.timezone || 'Asia/Kolkata', now);
  const fy = financialYearOf(day, org?.financialYearStart ?? 4);
  const prefix = `${series}/20${fy}/`;
  const taken = await prisma.proposal.findMany({
    where: { organizationId, refNo: { startsWith: prefix } },
    select: { refNo: true },
  });
  let highest = 0;
  for (const { refNo } of taken) {
    const parsed = parseInt((refNo ?? '').slice(prefix.length), 10);
    if (!Number.isNaN(parsed) && parsed > highest) highest = parsed;
  }
  return `${prefix}${String(highest + 1).padStart(3, '0')}`;
}

// ── Pricing context ─────────────────────────────────────────────────────────

/** The floors as stored: a JSON object of industry → amount. Anything else reads as none. */
export function readFloors(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(v);
    if (k.trim() && Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return out;
}

export interface PricingSetting extends PricingContext {
  /** False when the client's state is not known — GST then reads as same-state. */
  clientStateKnown: boolean;
  clientStateName: string | null;
}

export function pricingContextFor(
  org: Parameters<typeof buildSellerSnapshot>[0] & { proposalFloorBase: unknown; proposalFloors: unknown },
  company: { vertical: string; stateCode: string | null; stateName: string | null; gstin: string | null },
): PricingSetting {
  const seller = buildSellerSnapshot(org);
  const client = resolveState({ code: company.stateCode, name: company.stateName, gstin: company.gstin });
  return {
    vertical: company.vertical || null,
    floorBase: Number(org.proposalFloorBase) || 0,
    floors: readFloors(org.proposalFloors),
    isInterState: resolveSupplyType(client.code, seller.stateCode) === 'INTER',
    clientStateKnown: Boolean(client.code),
    clientStateName: client.name,
  };
}

/** Stored line items as the calculator takes them. */
export const linesForPricing = (
  items: {
    name: string;
    description: string | null;
    billing: 'ONE_TIME' | 'MONTHLY';
    qty: unknown;
    unit: string | null;
    unitRate: unknown;
    discountAmount: unknown;
    discountTrade: string | null;
    isPassthrough: boolean;
  }[],
): ProposalLineInput[] =>
  items.map((i) => ({
    name: i.name,
    description: i.description,
    billing: i.billing,
    qty: Number(i.qty),
    unit: i.unit,
    unitRate: Number(i.unitRate),
    discountAmount: Number(i.discountAmount),
    discountTrade: i.discountTrade,
    isPassthrough: i.isPassthrough,
  }));

// ── How a one-time fee is paid (phase 3) ───────────────────────────────────

export interface MilestoneShare {
  label: string;
  percent: number;
}

/** Whole percentages adding up to 100, at most six parts. */
export const milestoneSplitSchema = z
  .array(
    z.object({
      label: z.string().trim().min(1, 'Name every part of the payment').max(60),
      percent: z.number().int('Use whole percentages').min(1).max(100),
    }),
  )
  .min(1)
  .max(6, 'Six parts at most')
  .refine((parts) => parts.reduce((s, p) => s + p.percent, 0) === 100, 'The parts of the payment must add up to 100%');

export function parseMilestoneSplit(raw: unknown): MilestoneShare[] | null {
  const parsed = milestoneSplitSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * The split as rupees: whole rupees, the last part taking the rounding so the
 * parts add up to the fee exactly — the same rule the project form uses.
 */
export function splitAmounts(total: number, split: MilestoneShare[]): (MilestoneShare & { amount: number })[] {
  let given = 0;
  return split.map((part, i) => {
    const amount = i === split.length - 1 ? Math.round(total) - given : Math.round((total * part.percent) / 100);
    given += amount;
    return { ...part, amount };
  });
}

/** "40% advance, 30% at design sign-off and 30% at launch." */
export const describeSplit = (split: MilestoneShare[]): string => {
  const parts = split.map((p) => `${p.percent}% ${p.label.trim().replace(/^./, (c) => c.toLowerCase())}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}.` : `${parts[0]}.`;
};

// ── Loading for render ──────────────────────────────────────────────────────

export interface RenderableProposal {
  ref: string;
  n: number;
  status: 'DRAFT' | 'IN_REVIEW' | 'FINAL';
  title: string;
  dateLabel: string;
  sections: ProposalSection[];
  client: { name: string; city: string | null; contactName: string | null };
  preparedBy: string | null;
  seller: SellerSnapshot;
  org: { website: string | null; phone: string | null; contactEmail: string | null };
  kind: 'RETAINER' | 'PROJECT';
  layout: 'MINIMAL' | 'PREMIUM' | 'COMPACT';
  /** How the one-time fee is paid, when it has been set. */
  milestoneSplit: MilestoneShare[] | null;
  /** Null when the figures are not shown: no line items yet, or a reader who may not see them. */
  price: ProposalPrice | null;
  pricingNote: string | null;
}

const longDate = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone }).format(d);

/**
 * Everything the renderer needs, for one document. `showPricing` is false for
 * anybody outside Management: they see the document with the Investment
 * section marked as waiting for its figures.
 */
export async function loadRenderableProposal(
  documentId: string,
  organizationId: string,
  showPricing: boolean,
): Promise<RenderableProposal | null> {
  const doc = await prisma.proposalDocument.findFirst({
    where: { id: documentId, proposal: { organizationId, deletedAt: null } },
    include: {
      lineItems: { orderBy: { sortOrder: 'asc' } },
      proposal: {
        include: {
          owner: { select: { name: true } },
          company: {
            include: { people: { where: { active: true }, orderBy: [{ role: 'asc' }, { createdAt: 'asc' }], take: 1 } },
          },
        },
      },
    },
  });
  if (!doc) return null;
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const company = doc.proposal.company;
  const tz = org.timezone || 'Asia/Kolkata';

  // A final prints what it was finalised with, not what the lines say today.
  const frozen = doc.status === 'FINAL' && doc.commercialSnapshot ? (doc.commercialSnapshot as unknown as ProposalPrice) : null;
  const live =
    doc.lineItems.length > 0 ? priceProposal(linesForPricing(doc.lineItems), pricingContextFor(org, company)) : null;
  const price = frozen ?? live;

  return {
    ref: documentRef(doc.proposal.refNo, doc.n),
    n: doc.n,
    status: doc.status,
    title: doc.title?.trim() || `Proposal for ${company.name}`,
    dateLabel: longDate(doc.finalisedAt ?? doc.updatedAt ?? new Date(), tz),
    sections: parseSections(doc.sections),
    client: { name: company.name, city: company.city || null, contactName: company.people[0]?.name ?? null },
    preparedBy: doc.proposal.owner?.name ?? null,
    seller: buildSellerSnapshot(org),
    org: { website: org.website ?? null, phone: org.phone ?? null, contactEmail: org.contactEmail ?? null },
    kind: doc.proposal.kind,
    layout: doc.layout,
    milestoneSplit: parseMilestoneSplit(doc.milestoneSplit),
    price: showPricing ? price : null,
    pricingNote: !showPricing
      ? 'Pricing is added by Management.'
      : !price
        ? 'No services priced yet.'
        : null,
  };
}

// ── Rendering: three layouts, one set of content ────────────────────────────
//
// Minimal (the default), Premium (larger deals: a full-bleed cover and numbered
// sections) and Compact (one page, no cover: small one-time jobs). Switching
// layout never rewrites a word; it is the same sections, the same priced
// lines and the same footer, laid out three ways.
//
// The house rule for the Investment box (Founder, B3.6): print the fee before
// GST and the line "18% GST additional". Never a GST-inclusive rupee figure.
// The Pricing tab still shows the full GST working; the client's copy does not.

const INK = '#163027';
const LIME = '#e2fea5';
const BODY = '#364c45';
const MUTED = '#6b7d76';
const RULE = '#d8e0dc';
const TINT = '#f3f6f4';
const FLAG = '#fff4c2';
const FLAG_INK = '#7a5b00';


/** Whole rupees on a proposal: a quote, not a tax document. */
export const rupees = (n: number): string =>
  '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

/** A "[[Needs input: …]]" marker, as a yellow chip. The text is already escaped. */
const flagChips = (escaped: string): string =>
  escaped.replace(NEEDS_INPUT, (_m, what: string) => `<span class="needs">Needs input: ${what.trim()}</span>`);

/** Plain text to paragraphs and bullet lists. Nothing else is interpreted. */
export function proseToHtml(body: string): string {
  return proseParts(body)
    .map((part) =>
      part.kind === 'list'
        ? `<ul>${part.items.map((l) => `<li>${flagChips(escapeHtml(l))}</li>`).join('')}</ul>`
        : part.kind === 'lead'
          ? `<p class="lead"><strong>${flagChips(escapeHtml(part.text))}</strong></p>`
          : `<p>${part.lines.map((l) => flagChips(escapeHtml(l))).join('<br />')}</p>`,
    )
    .join('');
}

function feeTable(group: FeeGroup, heading: string, per: string): string {
  if (!group.lines.length) return '';
  const rows = group.lines
    .map((l) => {
      const qty = l.qty === 1 && !l.unit ? '' : `${l.qty}${l.unit ? ` ${escapeHtml(l.unit)}` : ''}`;
      const discount =
        l.discountAmount > 0
          ? `<tr class="disc"><td colspan="3">Less: ${escapeHtml(l.discountTrade ?? 'discount')}</td><td class="num">−${rupees(l.discountAmount)}</td></tr>`
          : '';
      return `<tr>
        <td><div class="svc">${escapeHtml(l.name)}</div>${l.description ? `<div class="desc">${escapeHtml(l.description)}</div>` : ''}</td>
        <td class="num">${qty}</td>
        <td class="num">${rupees(l.unitRate)}</td>
        <td class="num">${rupees(l.gross)}</td>
      </tr>${discount}`;
    })
    .join('');
  return `
    <div class="fee">
      <h3>${heading}</h3>
      <table>
        <thead><tr><th>Service</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr class="sub"><td colspan="3">${heading} fee${per}</td><td class="num">${rupees(group.subtotal)}</td></tr>
          <tr class="tax"><td colspan="4">${group.gstRatePercent}% GST additional</td></tr>
        </tfoot>
      </table>
    </div>`;
}

function commercialHtml(p: RenderableProposal): string {
  if (!p.price) return `<p class="pending">${escapeHtml(p.pricingNote ?? 'No services priced yet.')}</p>`;
  const { monthly, oneTime, passthrough } = p.price;
  const pass = passthrough.lines.length
    ? `<div class="fee">
        <h3>Paid by you directly</h3>
        <table>
          <tbody>${passthrough.lines
            .map((l) => `<tr><td><div class="svc">${escapeHtml(l.name)}</div>${l.description ? `<div class="desc">${escapeHtml(l.description)}</div>` : ''}</td><td class="num">${rupees(l.amount)}</td></tr>`)
            .join('')}</tbody>
        </table>
        <p class="note">Not part of our fee. Paid by you to the platform, and not taxed by us.</p>
      </div>`
    : '';
  const both = monthly.lines.length && oneTime.lines.length;
  const split =
    oneTime.lines.length && p.milestoneSplit
      ? `<p class="note split">The one-time fee is paid ${escapeHtml(describeSplit(p.milestoneSplit))}</p>`
      : '';
  return `
    ${feeTable(monthly, 'Monthly', ' (per month)')}
    ${feeTable(oneTime, 'One-time', '')}
    ${split}
    ${pass}
    ${both ? '<p class="note">The monthly fee and the one-time fee are billed separately.</p>' : ''}`;
}

const logoTag = (p: RenderableProposal): string => {
  try {
    return `<img src="${getLogoDataUri()}" alt="${escapeHtml(p.seller.tradingName)}" />`;
  } catch {
    return `<span class="name">${escapeHtml(p.seller.tradingName)}</span>`;
  }
};

const forLine = (p: RenderableProposal) =>
  escapeHtml(p.client.contactName ? `${p.client.contactName}, ${p.client.name}` : p.client.name);

const kindLabel = (p: RenderableProposal) => (p.kind === 'RETAINER' ? 'Retainer proposal' : 'Project proposal');

const metaList = (p: RenderableProposal) => `
  <dl class="meta">
    <div><dt>Reference</dt><dd>${escapeHtml(p.ref)}</dd></div>
    <div><dt>Date</dt><dd>${escapeHtml(p.dateLabel)}</dd></div>
    ${p.preparedBy ? `<div><dt>Prepared by</dt><dd>${escapeHtml(p.preparedBy)}</dd></div>` : ''}
  </dl>`;

/** The sections after the cover, numbered for Premium. Hidden ones are left out. */
function bodySections(p: RenderableProposal, numbered: boolean): string {
  let n = 0;
  return p.sections
    .filter((s) => s.visible && s.type !== 'COVER')
    .map((s) => {
      const content = s.type === 'COMMERCIAL' ? commercialHtml(p) : proseToHtml(s.body);
      if (s.type !== 'COMMERCIAL' && !content) return '';
      n += 1;
      const num = numbered ? `<span class="num-badge">${String(n).padStart(2, '0')}</span>` : '';
      return `<section class="${s.type === 'COMMERCIAL' ? 'invest' : ''}"><h2>${num}${escapeHtml(s.title)}</h2>${content}</section>`;
    })
    .join('');
}

const BASE_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: ${BODY}; font-size: 10.5pt; line-height: 1.55;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #fff; }
  .page { padding: 0 20mm; }
  section { margin: 0 0 9mm; }
  h2 { font-size: 15pt; color: ${INK}; margin: 0 0 8px; padding-bottom: 6px; border-bottom: 1px solid ${RULE}; break-after: avoid; page-break-after: avoid; }
  h3 { font-size: 10pt; text-transform: uppercase; letter-spacing: 0.08em; color: ${INK}; margin: 14px 0 6px; }
  p { margin: 0 0 8px; max-width: 165mm; }
  p.lead { margin: 10px 0 4px; color: ${INK}; break-after: avoid; page-break-after: avoid; }
  ul { margin: 0 0 8px; padding-left: 18px; }
  li { margin: 0 0 3px; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; font-variant-numeric: tabular-nums; }
  th { text-align: left; font-size: 7.5pt; letter-spacing: 0.08em; text-transform: uppercase; color: ${MUTED}; font-weight: 600; padding: 6px 8px; border-bottom: 1.5px solid ${INK}; }
  td { padding: 7px 8px; border-bottom: 1px solid ${RULE}; vertical-align: top; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  .num { text-align: right; white-space: nowrap; }
  .svc { color: ${INK}; font-weight: 600; }
  .desc { color: ${MUTED}; font-size: 8.5pt; margin-top: 2px; }
  tr.disc td { color: ${MUTED}; font-size: 8.5pt; padding-top: 2px; }
  tfoot td { border-bottom: none; }
  tr.sub td { background: ${INK}; color: ${LIME}; font-weight: 700; padding-top: 9px; padding-bottom: 9px; }
  tr.tax td { color: ${MUTED}; font-size: 8.5pt; padding-top: 5px; }
  .fee { break-inside: avoid; page-break-inside: avoid; margin-bottom: 6mm; }
  .note { font-size: 8.5pt; color: ${MUTED}; margin-top: 6px; }
  .note.split { color: ${BODY}; font-size: 9pt; margin: -3mm 0 6mm; }
  .pending { background: ${TINT}; border: 1px dashed ${RULE}; padding: 14px; color: ${MUTED}; }
  .needs { background: ${FLAG}; color: ${FLAG_INK}; border-radius: 4px; padding: 1px 6px; font-size: 0.9em; font-weight: 600; }
  .sign { margin-top: 12mm; font-size: 9pt; color: ${MUTED}; }
  .watermark { position: fixed; top: 42%; left: 0; right: 0; text-align: center; transform: rotate(-30deg);
               font-size: 110pt; font-weight: 800; letter-spacing: 0.1em; color: rgba(22, 48, 39, 0.06); z-index: 0; pointer-events: none; }
  dl.meta { display: grid; grid-template-columns: repeat(3, auto); justify-content: start; gap: 6px 28px; font-size: 9pt; margin: 0; }
  dl.meta dt { text-transform: uppercase; letter-spacing: 0.08em; font-size: 7.5pt; }
  dl.meta dd { margin: 0; font-weight: 600; }
  @media screen {
    body { background: #e7ebe9; padding: 16px 0; }
    .sheet { width: 210mm; max-width: 100%; margin: 0 auto; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.12); padding: 16mm 0 14mm; }
  }
`;

const MINIMAL_CSS = `
  @page { size: A4; margin: 16mm 0; }
  .cover { min-height: 262mm; display: flex; flex-direction: column; padding: 4mm 20mm 0; page-break-after: always; break-after: page; }
  .cover .logo img { height: 34px; }
  .cover .logo .name { font-weight: 700; color: ${INK}; font-size: 14pt; }
  .cover .middle { margin-top: 72mm; }
  .cover .eyebrow { font-size: 9pt; letter-spacing: 0.14em; text-transform: uppercase; color: ${MUTED}; }
  .cover h1 { font-size: 30pt; line-height: 1.12; color: ${INK}; margin: 8px 0 14px; font-weight: 700; letter-spacing: -0.01em; }
  .cover .bar { width: 64px; height: 6px; background: ${LIME}; margin-bottom: 18px; }
  .cover .for { font-size: 12pt; color: ${INK}; }
  .cover .tagline { margin-top: 10px; max-width: 120mm; }
  .cover dl.meta { margin-top: auto; margin-bottom: 4mm; }
  .cover dl.meta dt { color: ${MUTED}; }
  .cover dl.meta dd { color: ${INK}; }
  @media screen {
    .cover { min-height: 0; padding-bottom: 14mm; border-bottom: 1px dashed ${RULE}; margin-bottom: 14mm; }
    .cover .middle { margin-top: 36mm; }
    .cover dl.meta { margin-top: 36mm; margin-bottom: 0; }
  }
`;

/*
 * Premium: the cover bleeds to the paper's edge in the studio green, and every
 * section carries its number. The first page has no margin (so no footer);
 * the rest keep the Minimal margins.
 */
const PREMIUM_CSS = `
  @page { size: A4; margin: 16mm 0; }
  @page :first { margin: 0; }
  .cover { height: 297mm; background: ${INK}; color: #dfe8e3; display: flex; flex-direction: column; padding: 22mm 22mm 20mm;
           page-break-after: always; break-after: page; position: relative; overflow: hidden; }
  .cover::after { content: ''; position: absolute; right: -40mm; top: -40mm; width: 140mm; height: 140mm; border-radius: 50%;
                  border: 18mm solid rgba(226, 254, 165, 0.08); }
  .cover .logo img { height: 40px; }
  .cover .logo .name { font-weight: 700; color: ${LIME}; font-size: 15pt; }
  .cover .middle { margin-top: auto; }
  .cover .eyebrow { font-size: 9pt; letter-spacing: 0.18em; text-transform: uppercase; color: ${LIME}; }
  .cover h1 { font-size: 38pt; line-height: 1.06; color: #fff; margin: 10px 0 18px; font-weight: 800; letter-spacing: -0.02em; max-width: 160mm; }
  .cover .for { font-size: 13pt; color: #fff; }
  .cover .tagline { margin-top: 10px; max-width: 130mm; color: #c9d6cf; }
  .cover .tagline p { max-width: none; }
  .cover dl.meta { margin-top: 26mm; padding-top: 6mm; border-top: 1px solid rgba(226, 254, 165, 0.3); }
  .cover dl.meta dt { color: ${LIME}; opacity: 0.8; }
  .cover dl.meta dd { color: #fff; }
  section { margin-bottom: 11mm; }
  h2 { font-size: 18pt; border-bottom: none; display: flex; align-items: baseline; gap: 10px; padding-bottom: 0; margin-bottom: 10px; }
  h2::after { content: ''; flex: 1; height: 2px; background: ${LIME}; margin-left: 8px; transform: translateY(-5px); }
  .num-badge { font-size: 10pt; font-weight: 800; color: ${INK}; background: ${LIME}; border-radius: 4px; padding: 2px 7px; letter-spacing: 0.04em; }
  section.invest { background: ${TINT}; margin-left: -8mm; margin-right: -8mm; padding: 6mm 8mm 2mm; border-radius: 6px; }
  @media screen {
    .sheet { padding-top: 0; }
    .cover { height: auto; min-height: 220mm; margin-bottom: 14mm; }
  }
`;

/*
 * Compact: one page where it can be. No cover page; a header strip carries the
 * reference and the date, and the type steps down a size.
 */
const COMPACT_CSS = `
  @page { size: A4; margin: 12mm 0 16mm; }
  body { font-size: 9.5pt; line-height: 1.45; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; padding: 0 16mm 5mm; border-bottom: 3px solid ${INK}; margin-bottom: 6mm; }
  .head .logo img { height: 28px; }
  .head .logo .name { font-weight: 700; color: ${INK}; }
  .head .right { text-align: right; font-size: 8pt; color: ${MUTED}; }
  .head .right b { display: block; font-size: 9pt; letter-spacing: 0.14em; text-transform: uppercase; color: ${INK}; }
  .page { padding: 0 16mm; }
  .intro { margin-bottom: 6mm; }
  .intro h1 { font-size: 18pt; line-height: 1.15; color: ${INK}; margin: 0 0 4px; }
  .intro .for { color: ${BODY}; }
  .intro .tagline p { margin: 4px 0 0; }
  section { margin-bottom: 5mm; }
  h2 { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.1em; border-bottom: 1px solid ${RULE}; padding-bottom: 3px; margin-bottom: 5px; }
  h3 { font-size: 8pt; margin: 8px 0 4px; }
  td { padding: 5px 7px; }
  th { padding: 4px 7px; }
  .fee { margin-bottom: 4mm; }
  .sign { margin-top: 6mm; }
  @media screen {
    .sheet { padding-top: 10mm; }
  }
`;

const LAYOUT_CSS = { MINIMAL: MINIMAL_CSS, PREMIUM: PREMIUM_CSS, COMPACT: COMPACT_CSS } as const;

/**
 * The document as HTML, for the preview pane and for the PDF.
 */
export function renderProposalHtml(p: RenderableProposal, opts: { watermark: boolean }): string {
  const layout = p.layout ?? 'MINIMAL';
  const cover = p.sections.find((s) => s.visible && s.type === 'COVER');
  const tagline = cover?.body.trim() ? `<div class="tagline">${proseToHtml(cover.body)}</div>` : '';
  const contactLine = [p.org.contactEmail, p.org.phone, p.org.website].filter(Boolean).map((v) => escapeHtml(String(v))).join(' &nbsp;·&nbsp; ');

  const top =
    layout === 'COMPACT'
      ? `<div class="head">
          <div class="logo">${logoTag(p)}</div>
          <div class="right"><b>${kindLabel(p)}</b>${escapeHtml(p.ref)}<br />${escapeHtml(p.dateLabel)}</div>
        </div>
        <div class="page intro">
          <h1>${escapeHtml(p.title)}</h1>
          <div class="for">For ${forLine(p)}${p.preparedBy ? ` &nbsp;·&nbsp; Prepared by ${escapeHtml(p.preparedBy)}` : ''}</div>
          ${tagline}
        </div>`
      : `<div class="cover">
          <div class="logo">${logoTag(p)}</div>
          <div class="middle">
            <div class="eyebrow">${kindLabel(p)}</div>
            <h1>${escapeHtml(p.title)}</h1>
            ${layout === 'MINIMAL' ? '<div class="bar"></div>' : ''}
            <div class="for">Prepared for ${forLine(p)}</div>
            ${tagline}
          </div>
          ${metaList(p)}
        </div>`;

  return `<!doctype html>
<html><head><meta charset="utf-8" /><title>${escapeHtml(p.ref)}</title>
<style>${BASE_CSS}${LAYOUT_CSS[layout]}</style></head>
<body>
${opts.watermark ? '<div class="watermark">DRAFT</div>' : ''}
<div class="sheet layout-${layout.toLowerCase()}">
  ${top}
  <div class="page">
    ${bodySections(p, layout === 'PREMIUM')}
    <div class="sign">${escapeHtml(p.seller.legalName)}${contactLine ? ` &nbsp;·&nbsp; ${contactLine}` : ''}</div>
  </div>
</div>
</body></html>`;
}

function footerTemplate(p: RenderableProposal): string {
  const site = p.org.website ? ` &nbsp;·&nbsp; ${escapeHtml(p.org.website.replace(/^https?:\/\//, ''))}` : '';
  return `
    <div style="width: 100%; margin: 0; padding: 0 20mm 6mm; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
                font-size: 7.5px; color: ${MUTED}; display: flex; justify-content: space-between;">
      <span>${escapeHtml(p.seller.tradingName)} &nbsp;·&nbsp; ${escapeHtml(p.ref)}${site}</span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
    </div>`;
}

export async function renderProposalPdf(p: RenderableProposal, opts: { watermark: boolean }): Promise<Buffer> {
  return htmlToPdf(renderProposalHtml(p, opts), {
    headerTemplate: '<span></span>',
    footerTemplate: footerTemplate(p),
    // The page margins live in each layout's own @page rules — Premium's
    // cover has none, so it can bleed to the edge.
    preferCSSPageSize: true,
    margin: { top: '16mm', right: '0', bottom: '16mm', left: '0' },
  });
}
