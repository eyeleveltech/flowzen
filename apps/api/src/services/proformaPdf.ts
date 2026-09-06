/**
 * Proforma PDF rendering.
 *
 * Matches the business's real letterhead exactly — colors, layout and every
 * section were reverse-engineered from actual invoices already issued
 * (EL/PI/2026/001 through 004), not designed fresh. The figures on it are
 * the ones already stamped onto the Proforma record at raise time (§6:
 * billingName, gstin, terms are "snapshotted at raise time") — this never
 * recomputes anything from the company or proposal, so a PDF for an old
 * proforma still reads exactly as it did the day it was sent, even if the
 * client's billing details have since changed.
 */

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { prisma } from '../lib/prisma.js';
import { calculateGst } from '../utils/tax.js';
import { amountInWords } from '../utils/amountInWords.js';

// __dirname is a native CJS global — this package has no "type": "module" in
// package.json, so NodeNext compiles it to CommonJS despite the ESM-style
// import/export syntax, and `import.meta.url` isn't valid there.

// Extracted directly from the real invoices' rendered pixels, not guessed —
// see the header band, table header row, and Grand Total bar on any of them.
const BRAND_DARK_GREEN = '#163027';
const BRAND_LIME = '#e2fea5';
const BRAND_BODY_TEXT = '#364c45';
const BRAND_META_BG = '#f3f6f4';

let cachedLogoDataUri: string | null = null;
function getLogoDataUri(): string {
  if (cachedLogoDataUri) return cachedLogoDataUri;
  const logoPath = path.join(__dirname, '../../assets/brand/eyelevel-logo-color-new.png');
  const buf = fs.readFileSync(logoPath);
  cachedLogoDataUri = `data:image/png;base64,${buf.toString('base64')}`;
  return cachedLogoDataUri;
}

const formatINR = (amount: number | string): string =>
  '₹' + Number(amount).toLocaleString('en-IN');

const formatDate = (d: Date): string =>
  new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function generateProformaPdf(proformaId: string, organizationId: string): Promise<Buffer> {
  const proforma = await prisma.proforma.findFirst({
    where: { id: proformaId, organizationId },
    include: { organization: true, company: true },
  });

  if (!proforma) {
    throw Object.assign(new Error('Proforma not found'), { status: 404 });
  }

  const org = proforma.organization;
  const amount = Number(proforma.amount);

  // Interstate iff the client's GST state code differs from the org's own.
  // A client with no GSTIN on file (the real Vyoma invoice has none) is
  // treated as same-state — that's what the actual precedent document does.
  const orgState = org.gstStateCode || '33';
  const clientState = proforma.gstin?.slice(0, 2);
  const isInterState = Boolean(clientState && clientState !== orgState);
  // Rate and whether tax applies at all are per-document (§ proforma edit) —
  // not fixed at 18%. When gstApplicable is off, this is a plain zero-tax
  // result rather than a real calculateGst(rate=0) call, so nothing downstream
  // has to special-case "0% GST" vs "no GST" as two different labels.
  const gst = proforma.gstApplicable
    ? calculateGst(amount, isInterState, proforma.gstRatePercent)
    : { baseAmount: amount, taxRatePercent: 0, cgstAmount: 0, sgstAmount: 0, igstAmount: 0, totalTaxAmount: 0, totalAmountWithTax: amount, isInterState };
  const taxLabel = !proforma.gstApplicable
    ? 'No GST'
    : isInterState
      ? `${proforma.gstRatePercent}% IGST S`
      : `${proforma.gstRatePercent}% GST S`;

  const description = proforma.description || 'Retainer fee for the billing period.';
  // proforma.terms is this document's own free-text terms (editable per §6's
  // create/edit form), one line per bullet — not the org's blanket defaults,
  // which only cover a proforma raised before this field existed.
  const ownTerms = proforma.terms
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean);
  const terms = ownTerms.length > 0
    ? ownTerms
    : org.defaultTermsAndConditions.length > 0
      ? org.defaultTermsAndConditions
      : ['Payment due within the validity period stated above.'];

  const bankRows: [string, string | null][] = [
    ['Account Holder Name', org.bankAccountHolderName],
    ['Bank Name', org.bankName],
    ['Branch', org.bankBranch],
    ['Account Number', org.bankAccountNumber],
    ['IFSC Code', org.bankIfscCode],
  ];
  const hasBankDetails = bankRows.some(([, v]) => v);

  const logoDataUri = getLogoDataUri();

  const html = `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          * { box-sizing: border-box; }
          body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: ${BRAND_BODY_TEXT}; margin: 0; font-size: 12.5px; }
          .page { min-height: 100vh; display: flex; flex-direction: column; }
          .content { flex: 1; padding: 0 48px; }

          .header { background: ${BRAND_DARK_GREEN}; padding: 18px 48px; display: flex; justify-content: space-between; align-items: flex-start; }
          .header img { height: 38px; }
          .header-right { text-align: right; }
          .header-org-name { color: #fff; font-size: 13px; font-weight: 700; }
          .header-email { color: #cbd5cf; font-size: 11px; margin-top: 8px; }
          .doc-title { color: ${BRAND_LIME}; font-size: 26px; font-weight: 800; letter-spacing: -0.01em; margin-top: 10px; }

          .meta-strip { background: ${BRAND_META_BG}; margin: 0 48px; padding: 10px 24px; display: flex; gap: 56px; border-radius: 4px; margin-top: 16px; }
          .meta-item .label { font-size: 9.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #8a9a94; margin-bottom: 4px; }
          .meta-item .value { font-size: 13px; font-weight: 700; color: #1a1a1a; }

          .parties { display: flex; justify-content: space-between; margin-top: 28px; }
          .parties .label { font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 6px; color: #1a1a1a; }
          .bill-to .company-name { font-weight: 700; font-size: 13px; color: #1a1a1a; }
          .bill-to div { line-height: 1.5; }
          .details { text-align: right; }

          table.items { width: 100%; border-collapse: collapse; margin-top: 22px; border: 1px solid #163027; }
          table.items thead th { background: ${BRAND_DARK_GREEN}; color: #fff; font-size: 10.5px; font-weight: 700; text-transform: uppercase; text-align: left; vertical-align: middle; padding: 10px 12px; border: 1px solid #163027; }
          table.items thead th.num { text-align: right; }
          table.items tbody td { padding: 12px; border: 1px solid #d8e0dc; vertical-align: middle; font-size: 12.5px; }
          table.items tbody td.num { text-align: right; white-space: nowrap; }

          .totals { display: flex; justify-content: flex-end; margin-top: 8px; }
          .totals-box { width: 300px; }
          .totals-row { display: flex; justify-content: space-between; padding: 6px 4px; font-size: 12.5px; }
          .totals-row.grand { background: ${BRAND_DARK_GREEN}; color: ${BRAND_LIME}; border-radius: 4px; padding: 12px 16px; font-size: 15px; font-weight: 800; margin-top: 6px; }
          .amount-words { text-align: right; font-style: italic; font-size: 11.5px; color: #555; margin-top: 10px; }

          .section { margin-top: 28px; }
          .section .label { font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 8px; color: #1a1a1a; }
          .terms-list { margin: 0; padding-left: 18px; line-height: 1.7; font-size: 12px; }
          .bank-row { display: flex; font-size: 12px; padding: 2px 0; }
          .bank-row .bank-label { width: 170px; font-weight: 700; }

          .footer { background: ${BRAND_DARK_GREEN}; padding: 14px 48px; display: flex; justify-content: space-between; align-items: center; margin-top: 40px; }
          .footer img { height: 26px; }
          .footer .page-num { color: #cbd5cf; font-size: 10.5px; }
        </style>
      </head>
      <body>
        <div class="page">
          <div class="header">
            <div>
              <img src="${logoDataUri}" alt="EyeLevel" />
              <div class="doc-title">PROFORMA INVOICE</div>
            </div>
            <div class="header-right">
              <div class="header-org-name">${escapeHtml(org.name)}</div>
              ${org.contactEmail ? `<div class="header-email">· ${escapeHtml(org.contactEmail)}</div>` : ''}
            </div>
          </div>

          <div class="content">
            <div class="meta-strip">
              <div class="meta-item">
                <div class="label">Document No.</div>
                <div class="value">${escapeHtml(proforma.number)}</div>
              </div>
              <div class="meta-item">
                <div class="label">Issued Date</div>
                <div class="value">${formatDate(proforma.raisedAt)}</div>
              </div>
              <div class="meta-item">
                <div class="label">Valid Until</div>
                <div class="value">${formatDate(proforma.validTill)}</div>
              </div>
            </div>

            <div class="parties">
              <div class="bill-to">
                <div class="label">Bill To</div>
                <div class="company-name">${escapeHtml(proforma.billingName)}</div>
                ${proforma.billingContactName ? `<div>${escapeHtml(proforma.billingContactName)}</div>` : ''}
                ${proforma.billingAddress ? `<div>${escapeHtml(proforma.billingAddress)}</div>` : ''}
                ${proforma.gstin ? `<div>GSTIN: ${escapeHtml(proforma.gstin)}</div>` : ''}
              </div>
              <div class="details">
                <div class="label">Details</div>
                <div>Payment Terms: ${escapeHtml(org.defaultPaymentTerms)}</div>
                ${proforma.poNumber ? `<div>PO Number: ${escapeHtml(proforma.poNumber)}</div>` : ''}
                ${proforma.poDate ? `<div>PO Date: ${formatDate(proforma.poDate)}</div>` : ''}
              </div>
            </div>

            <table class="items">
              <thead>
                <tr>
                  <th style="width: 24px;">#</th>
                  ${proforma.sacCode ? '<th style="width: 70px;">HSN/SAC</th>' : ''}
                  <th>Description</th>
                  <th class="num">Unit</th>
                  <th class="num">Qty</th>
                  <th class="num">Unit Price</th>
                  <th class="num">Disc</th>
                  <th class="num">Tax</th>
                  <th class="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>1</td>
                  ${proforma.sacCode ? `<td>${escapeHtml(proforma.sacCode)}</td>` : ''}
                  <td>${escapeHtml(description)}</td>
                  <td class="num">Units</td>
                  <td class="num">1</td>
                  <td class="num">${formatINR(amount)}</td>
                  <td class="num">0%</td>
                  <td class="num">${taxLabel}</td>
                  <td class="num">${formatINR(amount)}</td>
                </tr>
              </tbody>
            </table>

            <div class="totals">
              <div class="totals-box">
                ${proforma.gstApplicable ? `
                <div class="totals-row"><span>Taxable Value</span><span>${formatINR(gst.baseAmount)}</span></div>
                ${gst.isInterState
                  ? `<div class="totals-row"><span>IGST (${gst.taxRatePercent}%)</span><span>${formatINR(gst.igstAmount)}</span></div>`
                  : `<div class="totals-row"><span>CGST (${gst.taxRatePercent / 2}%)</span><span>${formatINR(gst.cgstAmount)}</span></div>
                <div class="totals-row"><span>SGST (${gst.taxRatePercent / 2}%)</span><span>${formatINR(gst.sgstAmount)}</span></div>`
                }
                <div class="totals-row"><span>Total GST</span><span>${formatINR(gst.totalTaxAmount)}</span></div>
                ` : ''}
                <div class="totals-row grand"><span>Grand Total</span><span>${formatINR(gst.totalAmountWithTax)}</span></div>
              </div>
            </div>
            <div class="amount-words">${escapeHtml(amountInWords(gst.totalAmountWithTax))}</div>

            <div class="section">
              <div class="label">Terms &amp; Conditions</div>
              <ol class="terms-list">
                ${terms.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}
              </ol>
            </div>

            ${hasBankDetails ? `
            <div class="section">
              <div class="label">Bank Details</div>
              ${bankRows.filter(([, v]) => v).map(([label, value]) => `
                <div class="bank-row"><span class="bank-label">${label}:</span><span>${escapeHtml(value as string)}</span></div>
              `).join('')}
            </div>` : ''}
          </div>

          <div class="footer">
            <img src="${logoDataUri}" alt="EyeLevel" />
            <div class="page-num">Page 1 / 1</div>
          </div>
        </div>
      </body>
    </html>
  `;

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}
