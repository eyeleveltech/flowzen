/**
 * The document. One template, both kinds — CR-02 §0.
 *
 * This replaces `proformaPdf.ts`, which could only render a proforma and could
 * only render one line item (its "items table" was a hardcoded single row). The
 * brand treatment is unchanged: the colours, the dark header band and the lime
 * grand-total bar were reverse-engineered from invoices the business has
 * actually issued, and a document that suddenly looks different is a document
 * a client queries.
 *
 * Everything it prints comes off the `RenderableDocument` it is handed. It
 * looks nothing up, computes no tax and decides no state — see documentModel.ts
 * for why that separation is the whole point.
 */

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { SupplyType } from '@prisma/client';
import { gstStateName } from '@flowzen/shared';
import {
  loadRenderableDocument,
  type DocumentKind,
  type RenderableDocument,
} from './documentModel.js';

// __dirname is a native CJS global — this package has no "type": "module" in
// package.json, so NodeNext compiles it to CommonJS despite the ESM-style
// import/export syntax, and `import.meta.url` isn't valid there.

const BRAND_DARK_GREEN = '#163027';
const BRAND_LIME = '#e2fea5';
const BRAND_BODY_TEXT = '#364c45';
const BRAND_META_BG = '#f3f6f4';
const BRAND_RULE = '#d8e0dc';

let cachedLogoDataUri: string | null = null;
function getLogoDataUri(): string {
  if (cachedLogoDataUri) return cachedLogoDataUri;
  const logoPath = path.join(__dirname, '../../assets/brand/eyelevel-logo-color-new.png');
  const buf = fs.readFileSync(logoPath);
  cachedLogoDataUri = `data:image/png;base64,${buf.toString('base64')}`;
  return cachedLogoDataUri;
}

/**
 * Two decimal places, always. A tax document that prints ₹35,400 where the
 * client's accounts system holds 35,400.00 invites a reconciliation query;
 * every real invoice on file shows the paise even when they are zero.
 */
const money = (amount: number): string =>
  '₹' + Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Adding two paise figures back together must not reintroduce float dust. */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Units are a quantity, not a price: 1 stays "1", 2.5 stays "2.5". */
const qty = (units: number): string =>
  Number(units).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 3 });

const formatDate = (d: Date): string =>
  new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Newlines in an address are the address's own line breaks, not markup. */
const multiline = (s: string): string => escapeHtml(s).replace(/\r?\n/g, '<br />');

/**
 * A state, the way a person reads one.
 *
 * This printed "Tamil Nadu (33)". The number is filing machinery — GSTR-1
 * wants it, a client reading the document does not, and it is recoverable
 * twice over anyway: from the state name through the statutory list, and from
 * the first two digits of the GSTIN printed a few lines above. Rule 46 asks
 * for the name of the State, not the code.
 *
 * A code with no name is still resolved to a name rather than printed raw,
 * so "State code 33" only appears for a code that is not a real one.
 */
const stateLine = (name: string | null, code: string | null): string | null => {
  if (name) return name;
  if (!code) return null;
  return gstStateName(code) ?? `State code ${code}`;
};

export function renderDocumentHtml(doc: RenderableDocument): string {
  const logoDataUri = getLogoDataUri();
  const { seller, buyer, totals } = doc;

  const sellerState = stateLine(seller.stateName, seller.stateCode);
  const buyerState = stateLine(buyer.stateName, buyer.stateCode);
  const placeOfSupply = stateLine(doc.placeOfSupply.state, doc.placeOfSupply.code);

  // §4's header fields, plus whatever open pairs the user added. The date label
  // differs by kind only because "Valid until" is meaningless on an invoice and
  // "Due date" is meaningless on a proforma.
  const headerFields: [string, string][] = [
    [doc.kind === 'PROFORMA' ? 'Proforma no.' : 'Invoice no.', doc.number],
    ['Date', formatDate(doc.date)],
  ];
  if (doc.validTill) headerFields.push(['Valid until', formatDate(doc.validTill)]);
  if (doc.dueAt) headerFields.push(['Due date', formatDate(doc.dueAt)]);
  if (placeOfSupply) headerFields.push(['Place of supply', placeOfSupply]);
  if (doc.poNumber) headerFields.push(['PO number', doc.poNumber]);
  if (doc.poDate) headerFields.push(['PO date', formatDate(doc.poDate)]);
  headerFields.push(['Payment terms', seller.paymentTerms]);
  for (const field of doc.customFields) {
    if (field.label || field.value) headerFields.push([field.label || '—', field.value]);
  }

  /*
   * §6: "Only the applicable rows print. Do not print zero value tax rows."
   *
   * A proforma prints one GST line; a tax invoice prints the heads separately.
   * That split is not a style choice — Rule 46(m) of the CGST Rules requires a
   * tax invoice to show "the amount of tax charged in respect of taxable goods
   * or services (central tax, State tax, integrated tax, Union territory tax or
   * cess)", which means broken out by head. A proforma is a quotation with no
   * statutory format at all, so the client sees the one number they care about.
   *
   * The figures are unchanged either way: the halves are computed once in
   * documentTotals.ts and sum to the tax exactly, so adding them back here
   * cannot disagree with the invoice for the same work.
   */
  const taxRows: [string, number][] = [];
  if (doc.gstApplicable) {
    const totalTax = round2(totals.cgstAmount + totals.sgstAmount + totals.igstAmount);
    if (doc.kind === 'PROFORMA') {
      if (totalTax) taxRows.push([`GST @ ${doc.gstRatePercent}%`, totalTax]);
    } else if (doc.supplyType === SupplyType.INTER) {
      if (totals.igstAmount) taxRows.push([`IGST @ ${doc.gstRatePercent}%`, totals.igstAmount]);
    } else {
      const half = doc.gstRatePercent / 2;
      if (totals.cgstAmount) taxRows.push([`CGST @ ${half}%`, totals.cgstAmount]);
      if (totals.sgstAmount) taxRows.push([`SGST @ ${half}%`, totals.sgstAmount]);
    }
  }

  const bankRows: [string, string | null][] = [
    ['Account name', seller.bank.accountHolderName],
    ['Account number', seller.bank.accountNumber],
    ['Bank & branch', [seller.bank.bankName, seller.bank.branch].filter(Boolean).join(', ') || null],
    ['IFSC', seller.bank.ifsc],
  ];
  const hasBankDetails = bankRows.some(([, v]) => v);

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          * { box-sizing: border-box; }
          body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: ${BRAND_BODY_TEXT}; margin: 0; font-size: 12px; }
          .content { padding: 0 40px 12px; }

          .header { background: ${BRAND_DARK_GREEN}; padding: 18px 40px; display: flex; justify-content: space-between; align-items: flex-start; }
          .header img { height: 36px; }
          .header-right { text-align: right; }
          .header-org-name { color: #fff; font-size: 13px; font-weight: 700; }
          .header-email { color: #cbd5cf; font-size: 10.5px; margin-top: 6px; }
          .doc-title { color: ${BRAND_LIME}; font-size: 25px; font-weight: 800; letter-spacing: -0.01em; margin-top: 10px; }

          .label { font-size: 9px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: #8a9a94; }

          /* §1 — seller on the left, the header fields on the right. */
          .top { display: flex; gap: 24px; margin-top: 20px; align-items: stretch; }
          .party { flex: 1; }
          .party .name { font-weight: 700; font-size: 13px; color: #1a1a1a; margin-top: 5px; }
          .party .line { line-height: 1.55; }
          .fields { width: 265px; background: ${BRAND_META_BG}; border-radius: 4px; padding: 12px 14px; }
          .field-row { display: flex; justify-content: space-between; gap: 10px; padding: 3px 0; font-size: 11.5px; }
          .field-row .k { color: #6d7f79; }
          .field-row .v { font-weight: 700; color: #1a1a1a; text-align: right; }

          .buyer { margin-top: 18px; border-top: 1px solid ${BRAND_RULE}; padding-top: 14px; }

          table.items { width: 100%; border-collapse: collapse; margin-top: 18px; border: 1px solid ${BRAND_DARK_GREEN}; }
          /* §10 — the header repeats on every page a long table spills onto. */
          table.items thead { display: table-header-group; }
          table.items tr { page-break-inside: avoid; break-inside: avoid; }
          table.items thead th { background: ${BRAND_DARK_GREEN}; color: #fff; font-size: 10px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; text-align: left; padding: 9px 10px; border: 1px solid ${BRAND_DARK_GREEN}; }
          table.items thead th.num { text-align: right; }
          table.items tbody td { padding: 9px 10px; border: 1px solid ${BRAND_RULE}; vertical-align: top; font-size: 12px; }
          table.items tbody td.num { text-align: right; white-space: nowrap; }
          table.items tbody td.sr { text-align: center; color: #6d7f79; }

          .totals { display: flex; justify-content: flex-end; margin-top: 10px; page-break-inside: avoid; break-inside: avoid; }
          .totals-box { width: 300px; }
          .totals-row { display: flex; justify-content: space-between; padding: 5px 4px; font-size: 12px; }
          .totals-row.rule { border-top: 1px solid ${BRAND_RULE}; }
          .totals-row.grand { background: ${BRAND_DARK_GREEN}; color: ${BRAND_LIME}; border-radius: 4px; padding: 11px 16px; font-size: 15px; font-weight: 800; margin-top: 6px; }
          .amount-words { margin-top: 12px; padding: 9px 12px; background: ${BRAND_META_BG}; border-radius: 4px; font-size: 11.5px; page-break-inside: avoid; break-inside: avoid; }
          .amount-words .label { display: block; margin-bottom: 3px; }

          .section { margin-top: 20px; page-break-inside: avoid; break-inside: avoid; }
          .terms-list { margin: 6px 0 0; padding-left: 16px; line-height: 1.65; font-size: 11.5px; }
          .notes { margin-top: 5px; line-height: 1.6; font-size: 11.5px; }

          /* §8 — bank details left, signature right, on the same baseline. */
          .close { display: flex; gap: 28px; margin-top: 22px; page-break-inside: avoid; break-inside: avoid; }
          .bank { flex: 1; }
          .bank-row { display: flex; font-size: 11.5px; padding: 2px 0; }
          .bank-row .k { width: 118px; color: #6d7f79; }
          .bank-row .v { font-weight: 700; color: #1a1a1a; }
          .sign { width: 235px; text-align: center; border: 1px solid ${BRAND_RULE}; border-radius: 4px; padding: 12px; display: flex; flex-direction: column; }
          .sign .for { font-weight: 700; color: #1a1a1a; font-size: 11.5px; }
          .sign .space { flex: 1; min-height: 56px; display: flex; align-items: center; justify-content: center; }
          .sign .space img { max-height: 52px; max-width: 180px; }
          .sign .who { font-size: 11px; border-top: 1px solid ${BRAND_RULE}; padding-top: 6px; }

          .declaration { margin-top: 16px; font-size: 10.5px; font-style: italic; color: #6d7f79; page-break-inside: avoid; break-inside: avoid; }

          /* The footer band is not in this document's flow at all — it is a
             Chrome print footer, so it lands on every page. See
             renderFooterTemplate below for why. */
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <img src="${logoDataUri}" alt="${escapeHtml(seller.tradingName)}" />
            <div class="doc-title">${escapeHtml(doc.title)}</div>
          </div>
          <div class="header-right">
            <div class="header-org-name">${escapeHtml(seller.tradingName)}</div>
            ${seller.contactEmail ? `<div class="header-email">${escapeHtml(seller.contactEmail)}</div>` : ''}
          </div>
        </div>

        <div class="content">
          <div class="top">
            <div class="party">
              <span class="label">Seller</span>
              <div class="name">${escapeHtml(seller.legalName)}</div>
              ${seller.address ? `<div class="line">${multiline(seller.address)}</div>` : ''}
              ${seller.gstin ? `<div class="line">GSTIN: ${escapeHtml(seller.gstin)}</div>` : ''}
              ${sellerState ? `<div class="line">${escapeHtml(sellerState)}</div>` : ''}
              ${seller.pan ? `<div class="line">PAN: ${escapeHtml(seller.pan)}</div>` : ''}
            </div>
            <div class="fields">
              ${headerFields
                .map(
                  ([k, v]) =>
                    `<div class="field-row"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v)}</span></div>`,
                )
                .join('')}
            </div>
          </div>

          <div class="buyer">
            <span class="label">Billed to</span>
            <div class="name">${escapeHtml(buyer.name)}</div>
            ${buyer.contactName ? `<div class="line">Attn: ${escapeHtml(buyer.contactName)}</div>` : ''}
            ${buyer.address ? `<div class="line">${multiline(buyer.address)}</div>` : ''}
            ${buyer.gstin ? `<div class="line">GSTIN: ${escapeHtml(buyer.gstin)}</div>` : ''}
            ${buyerState ? `<div class="line">${escapeHtml(buyerState)}</div>` : ''}
          </div>

          <table class="items">
            <thead>
              <tr>
                <th style="width: 30px;">Sr</th>
                <th>Particulars</th>
                <th class="num" style="width: 58px;">Units</th>
                <th class="num" style="width: 92px;">Unit cost</th>
                <th style="width: 76px;">HSN/SAC</th>
                <th class="num" style="width: 104px;">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${doc.lines
                .map(
                  (line) => `
                <tr>
                  <td class="sr">${line.serialNo}</td>
                  <td>${multiline(line.particulars)}</td>
                  <td class="num">${qty(line.units)}</td>
                  <td class="num">${money(line.unitCost)}</td>
                  <td>${line.hsnSac ? escapeHtml(line.hsnSac) : '—'}</td>
                  <td class="num">${money(line.amount)}</td>
                </tr>`,
                )
                .join('')}
            </tbody>
          </table>

          <div class="totals">
            <div class="totals-box">
              <div class="totals-row"><span>Subtotal</span><span>${money(totals.subtotal)}</span></div>
              ${taxRows
                .map(([k, v]) => `<div class="totals-row"><span>${escapeHtml(k)}</span><span>${money(v)}</span></div>`)
                .join('')}
              ${!doc.gstApplicable ? '<div class="totals-row"><span>GST</span><span>Not applicable</span></div>' : ''}
              ${totals.roundOff ? `<div class="totals-row rule"><span>Round off</span><span>${money(totals.roundOff)}</span></div>` : ''}
              <div class="totals-row grand"><span>Total</span><span>${money(totals.total)}</span></div>
            </div>
          </div>

          <div class="amount-words">
            <span class="label">Amount in words</span>
            ${escapeHtml(totals.amountInWords)}
          </div>

          <div class="section">
            <span class="label">Terms &amp; conditions</span>
            <ol class="terms-list">
              ${doc.terms.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}
            </ol>
          </div>

          ${
            doc.notes
              ? `<div class="section"><span class="label">Notes</span><div class="notes">${multiline(doc.notes)}</div></div>`
              : ''
          }

          <div class="close">
            <div class="bank">
              ${hasBankDetails ? `<span class="label">Bank details</span>` : ''}
              ${bankRows
                .filter(([, v]) => v)
                .map(
                  ([k, v]) =>
                    `<div class="bank-row"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v as string)}</span></div>`,
                )
                .join('')}
            </div>
            ${
              doc.showSignatureBlock
                ? `<div class="sign">
              <div class="for">For ${escapeHtml(seller.legalName)}</div>
              <div class="space">
                ${doc.signatureImage ? `<img src="${doc.signatureImage}" alt="" />` : ''}
              </div>
              <div class="who">Authorised Signatory</div>
            </div>`
                : ''
            }
          </div>

          <div class="declaration">${escapeHtml(doc.declaration)}</div>
        </div>

      </body>
    </html>
  `;
}

/**
 * The band across the foot of EVERY page — CR-02 §8's "EyeLevel GSTIN and PAN
 * repeated at the bottom of the page", plus a page count so a client can see
 * at a glance whether they have the whole document.
 *
 * It is a Chrome print footer rather than a div at the end of the document
 * because a div at the end of the document is at the end of the DOCUMENT, not
 * the bottom of the page: on a short proforma it printed a whole second sheet
 * carrying nothing but a green strip. `min-height: 100vh` does not fix that —
 * in print, `vh` is the emulated viewport, not the paper.
 *
 * Chrome renders this template in its own context: it inherits no stylesheet,
 * defaults to a tiny font, and needs `print-color-adjust` before it will put
 * ink on a background. Hence the inline everything.
 */
export function renderFooterTemplate(doc: RenderableDocument): string {
  const { seller } = doc;
  const ids = [
    seller.gstin ? `GSTIN: ${escapeHtml(seller.gstin)}` : null,
    seller.pan ? `PAN: ${escapeHtml(seller.pan)}` : null,
  ]
    .filter(Boolean)
    .join(' &nbsp;·&nbsp; ');

  return `
    <div style="
      width: 100%; margin: 0; padding: 8px 40px;
      background: ${BRAND_DARK_GREEN}; -webkit-print-color-adjust: exact; print-color-adjust: exact;
      color: #cbd5cf; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 8px;
      display: flex; justify-content: space-between; align-items: center;">
      <span style="color: ${BRAND_LIME}; font-weight: 700;">${escapeHtml(seller.legalName)}</span>
      <span>${ids}</span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
    </div>`;
}

export async function generateDocumentPdf(
  kind: DocumentKind,
  id: string,
  organizationId: string,
): Promise<Buffer> {
  const doc = await loadRenderableDocument(kind, id, organizationId);
  const html = renderDocumentHtml(doc);

  /*
   * `--disable-dev-shm-usage`, or this works on a laptop and fails on the server.
   *
   * Chromium puts its shared-memory files in /dev/shm, and Docker gives a
   * container 64MB of it by default. Rendering an A4 page with a brand band
   * and a table goes past that, Chromium dies mid-render, and the download
   * fails with nothing useful said. The flag moves that buffer to /tmp, which
   * is backed by the container's normal filesystem.
   *
   * compose also asks for a larger /dev/shm, so the flag is the belt and that
   * is the braces — each alone fixes it, and neither costs anything.
   */
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      // Chrome insists on a header template when a footer one is given; an
      // empty span is how you say "no running header". The brand band at the
      // top is part of the document itself, so it prints on page one only,
      // which is what a letterhead does.
      headerTemplate: '<span></span>',
      footerTemplate: renderFooterTemplate(doc),
      // Zero at the top and sides so the brand band still bleeds to the edge.
      // The bottom margin is the strip the footer band is drawn into: too
      // small and Chrome clips it, too large and every page carries a gutter.
      margin: { top: '0', right: '0', bottom: '16mm', left: '0' },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}
