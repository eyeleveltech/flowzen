/**
 * A proposal as a Word file (AI Proposal Builder, phase 2).
 *
 * Built straight from the same pieces the PDF is — the sections, the priced
 * lines, the reference — with the `docx` library, never by converting the
 * HTML: that breaks tables and spacing. One Word style whatever the layout
 * chosen for the PDF; the two files carry the same sections, in the same
 * order, with the same numbers.
 *
 * Same house rule as the PDF: the fee before GST and "18% GST additional",
 * never a GST-inclusive figure.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  ImageRun,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from 'docx';
import { getLogoDataUri } from './documentPdf.js';
import { NEEDS_INPUT, describeSplit, proseParts, rupees, type RenderableProposal } from './proposalDocument.js';
import type { FeeGroup } from './proposalPricing.js';

const INK = '163027';
const LIME = 'E2FEA5';
const BODY = '364C45';
const MUTED = '6B7D76';
const RULE = 'D8E0DC';
const FONT = 'Arial';

/** A line of prose, with any "[[Needs input: …]]" marker highlighted. */
function runsOf(text: string): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  let at = 0;
  for (const m of text.matchAll(NEEDS_INPUT)) {
    if (m.index! > at) out.push(new TextRun({ text: text.slice(at, m.index), font: FONT, color: BODY }));
    out.push(new TextRun({ text: `Needs input: ${m[1].trim()}`, font: FONT, bold: true, highlight: 'yellow' }));
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push(new TextRun({ text: text.slice(at), font: FONT, color: BODY }));
  return out;
}

/** Plain text to paragraphs and bullets: the same split the PDF makes (proseParts). */
function prose(body: string): Paragraph[] {
  const out: Paragraph[] = [];
  for (const part of proseParts(body)) {
    if (part.kind === 'list') {
      for (const item of part.items) out.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: runsOf(item) }));
    } else if (part.kind === 'lead') {
      out.push(
        new Paragraph({
          spacing: { before: 120, after: 60 },
          keepNext: true,
          children: [new TextRun({ text: part.text, font: FONT, bold: true, color: INK })],
        }),
      );
    } else {
      out.push(
        new Paragraph({
          spacing: { after: 140 },
          children: part.lines.flatMap((l, i) => [...(i ? [new TextRun({ break: 1 })] : []), ...runsOf(l)]),
        }),
      );
    }
  }
  return out;
}

const heading = (text: string) =>
  new Paragraph({
    spacing: { before: 360, after: 140 },
    keepNext: true,
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 4 } },
    children: [new TextRun({ text, font: FONT, bold: true, size: 30, color: INK })],
  });

const eyebrow = (text: string) =>
  new Paragraph({
    spacing: { before: 200, after: 80 },
    keepNext: true,
    children: [new TextRun({ text: text.toUpperCase(), font: FONT, bold: true, size: 18, color: INK, characterSpacing: 20 })],
  });

const thin = { style: BorderStyle.SINGLE, size: 4, color: RULE };
const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };

function cell(text: string, opts: { right?: boolean; bold?: boolean; color?: string; fill?: string; size?: number; sub?: string; width?: number; span?: number } = {}) {
  return new TableCell({
    columnSpan: opts.span,
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: opts.fill } : undefined,
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    borders: { top: none, left: none, right: none, bottom: opts.fill ? none : thin },
    children: [
      new Paragraph({
        alignment: opts.right ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [new TextRun({ text, font: FONT, bold: opts.bold, color: opts.color ?? BODY, size: opts.size ?? 19 })],
      }),
      ...(opts.sub
        ? [new Paragraph({ children: [new TextRun({ text: opts.sub, font: FONT, color: MUTED, size: 16 })] })]
        : []),
    ],
  });
}

function feeTable(group: FeeGroup, label: string, per: string): (Paragraph | Table)[] {
  if (!group.lines.length) return [];
  const head = new TableRow({
    tableHeader: true,
    children: ['Service', 'Qty', 'Rate', 'Amount'].map((h, i) =>
      cell(h.toUpperCase(), { right: i > 0, bold: true, color: MUTED, size: 15, width: i === 0 ? 52 : 16 }),
    ),
  });
  const rows = group.lines.flatMap((l) => {
    const qty = l.qty === 1 && !l.unit ? '' : `${l.qty}${l.unit ? ` ${l.unit}` : ''}`;
    const row = new TableRow({
      cantSplit: true,
      children: [
        cell(l.name, { bold: true, color: INK, sub: l.description ?? undefined }),
        cell(qty, { right: true }),
        cell(rupees(l.unitRate), { right: true }),
        cell(rupees(l.gross), { right: true }),
      ],
    });
    if (!(l.discountAmount > 0)) return [row];
    return [
      row,
      new TableRow({
        cantSplit: true,
        children: [cell(`Less: ${l.discountTrade ?? 'discount'}`, { color: MUTED, size: 16, span: 3 }), cell(`−${rupees(l.discountAmount)}`, { right: true, color: MUTED, size: 16 })],
      }),
    ];
  });
  const total = new TableRow({
    cantSplit: true,
    children: [
      cell(`${label} fee${per}`, { bold: true, color: LIME, fill: INK, span: 3 }),
      cell(rupees(group.subtotal), { right: true, bold: true, color: LIME, fill: INK }),
    ],
  });
  return [
    eyebrow(label),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [head, ...rows, total] }),
    new Paragraph({ spacing: { before: 80, after: 200 }, children: [new TextRun({ text: `${group.gstRatePercent}% GST additional`, font: FONT, color: MUTED, size: 17 })] }),
  ];
}

function investment(p: RenderableProposal): (Paragraph | Table)[] {
  if (!p.price) {
    return [new Paragraph({ children: [new TextRun({ text: p.pricingNote ?? 'No services priced yet.', font: FONT, color: MUTED, italics: true })] })];
  }
  const { monthly, oneTime, passthrough } = p.price;
  const out: (Paragraph | Table)[] = [...feeTable(monthly, 'Monthly', ' (per month)'), ...feeTable(oneTime, 'One-time', '')];
  if (oneTime.lines.length && p.milestoneSplit) {
    out.push(
      new Paragraph({
        spacing: { after: 200 },
        children: [new TextRun({ text: `The one-time fee is paid ${describeSplit(p.milestoneSplit)}`, font: FONT, color: BODY, size: 18 })],
      }),
    );
  }
  if (passthrough.lines.length) {
    out.push(
      eyebrow('Paid by you directly'),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: passthrough.lines.map(
          (l) => new TableRow({ cantSplit: true, children: [cell(l.name, { bold: true, color: INK, sub: l.description ?? undefined, width: 80 }), cell(rupees(l.amount), { right: true, width: 20 })] }),
        ),
      }),
      new Paragraph({ spacing: { before: 80, after: 200 }, children: [new TextRun({ text: 'Not part of our fee. Paid by you to the platform, and not taxed by us.', font: FONT, color: MUTED, size: 17 })] }),
    );
  }
  if (monthly.lines.length && oneTime.lines.length) {
    out.push(new Paragraph({ children: [new TextRun({ text: 'The monthly fee and the one-time fee are billed separately.', font: FONT, color: MUTED, size: 17 })] }));
  }
  return out;
}

/** The brand mark, at its own proportions. Null when the file cannot be read. */
function logo(): ImageRun | null {
  try {
    const data = Buffer.from(getLogoDataUri().split(',')[1], 'base64');
    // A PNG's width and height sit at bytes 16 and 20 of its header.
    const w = data.readUInt32BE(16);
    const h = data.readUInt32BE(20);
    const height = 40;
    return new ImageRun({ type: 'png', data, transformation: { width: Math.round((w / h) * height), height } });
  } catch {
    return null;
  }
}

export async function renderProposalDocx(p: RenderableProposal, opts: { draft: boolean }): Promise<Buffer> {
  const mark = logo();
  const cover = p.sections.find((s) => s.visible && s.type === 'COVER');
  const forWho = p.client.contactName ? `${p.client.contactName}, ${p.client.name}` : p.client.name;

  const coverPage: Paragraph[] = [
    new Paragraph({ children: mark ? [mark] : [new TextRun({ text: p.seller.tradingName, font: FONT, bold: true, color: INK, size: 28 })] }),
    new Paragraph({ spacing: { before: 3600 }, children: [new TextRun({ text: (p.kind === 'RETAINER' ? 'Retainer proposal' : 'Project proposal').toUpperCase(), font: FONT, color: MUTED, size: 18, characterSpacing: 30 })] }),
    new Paragraph({ spacing: { before: 120, after: 240 }, children: [new TextRun({ text: p.title, font: FONT, bold: true, size: 60, color: INK })] }),
    new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: `Prepared for ${forWho}`, font: FONT, size: 24, color: INK })] }),
    ...(cover?.body.trim() ? prose(cover.body) : []),
    new Paragraph({
      spacing: { before: 2400 },
      children: [
        new TextRun({ text: 'Reference  ', font: FONT, color: MUTED, size: 16 }),
        new TextRun({ text: p.ref, font: FONT, bold: true, color: INK, size: 18 }),
        new TextRun({ text: '      Date  ', font: FONT, color: MUTED, size: 16 }),
        new TextRun({ text: p.dateLabel, font: FONT, bold: true, color: INK, size: 18 }),
        ...(p.preparedBy
          ? [new TextRun({ text: '      Prepared by  ', font: FONT, color: MUTED, size: 16 }), new TextRun({ text: p.preparedBy, font: FONT, bold: true, color: INK, size: 18 })]
          : []),
      ],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  const body: (Paragraph | Table)[] = [];
  for (const s of p.sections.filter((x) => x.visible && x.type !== 'COVER')) {
    if (s.type === 'COMMERCIAL') {
      body.push(heading(s.title), ...investment(p));
      continue;
    }
    const paras = prose(s.body);
    if (!paras.length) continue;
    body.push(heading(s.title), ...paras);
  }
  const contacts = [p.org.contactEmail, p.org.phone, p.org.website].filter(Boolean).join('  ·  ');
  body.push(
    new Paragraph({
      spacing: { before: 480 },
      children: [new TextRun({ text: `${p.seller.legalName}${contacts ? `  ·  ${contacts}` : ''}`, font: FONT, color: MUTED, size: 17 })],
    }),
  );

  const footer = new Footer({
    children: [
      new Paragraph({
        children: [
          new TextRun({ text: `${p.seller.tradingName}  ·  ${p.ref}${p.org.website ? `  ·  ${p.org.website.replace(/^https?:\/\//, '')}` : ''}      `, font: FONT, color: MUTED, size: 14 }),
          new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], font: FONT, color: MUTED, size: 14 }),
        ],
      }),
    ],
  });

  const doc = new Document({
    creator: p.seller.tradingName,
    title: `${p.title} (${p.ref})`,
    styles: { default: { document: { run: { font: FONT, size: 21, color: BODY } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1134, bottom: 1134, left: 1134, right: 1134, footer: 500, header: 500 },
          },
        },
        headers: opts.draft
          ? {
              default: new Header({
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'DRAFT · not final', font: FONT, bold: true, color: MUTED, size: 16 })] })],
              }),
            }
          : undefined,
        footers: { default: footer },
        children: [...coverPage, ...body],
      },
    ],
  });
  return Packer.toBuffer(doc);
}
