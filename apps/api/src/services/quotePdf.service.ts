import puppeteer from 'puppeteer';
import path from 'path';
import { promises as fs } from 'fs';
import { resolveTaxType } from '../utils/taxCatalog.js';

const BRAND = '#163027';     // primary brand colour (header / footer background)
const ACCENT = '#E2FEA5';    // light accent (title / footer text)

// Whole-rupee display to match the app's formatCurrency (en-IN, 0 decimals) — the
// on-screen quote and the amount-in-words both round to the nearest rupee.
const inr = (n: any) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const fmtDate = (d: any) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

// Load the brand logo from apps/api/assets/brand and return a base64 data URI so it
// embeds directly in the PDF. Prefers a white version, then any "logo" file, then first image.
let cachedLogo: string | undefined;
async function loadBrandLogo(): Promise<string> {
  if (cachedLogo !== undefined) return cachedLogo;
  try {
    const dir = path.resolve(process.cwd(), 'assets', 'brand');
    const files = (await fs.readdir(dir)).filter((f) => /\.(png|jpe?g|svg)$/i.test(f));
    const pick = files.find((f) => /white/i.test(f)) || files.find((f) => /logo/i.test(f)) || files[0];
    if (!pick) { cachedLogo = ''; return ''; }
    const buf = await fs.readFile(path.join(dir, pick));
    const ext = path.extname(pick).slice(1).toLowerCase();
    const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    cachedLogo = `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    cachedLogo = '';
  }
  return cachedLogo;
}

function buildClassicHtml(quote: any, org: any, logoUri: string): string {
  const c = (org?.settings as any)?.company || {};
  const companyName = c.name || org?.name || 'EyeLevel Growth Studio';
  let title = 'PROFORMA INVOICE';
  if (quote.documentType === 'QUOTATION') title = 'QUOTATION';
  if (quote.documentType === 'INVOICE') title = 'INVOICE';
  const taxRows = Number(quote.totalTax) > 0 ? `<tr><td>Total Tax</td><td class="r">${inr(quote.totalTax)}</td></tr>` : '';
  const hasRcm = (quote.lineItems || []).some((li: any) => resolveTaxType(li.taxType).mode === 'RC');

  const lines = (quote.lineItems || []).map((li: any) => `
    <tr>
      <td>${li.sortOrder}</td>
      <td>${esc(li.description)}</td>
      <td>${esc(li.unit)}</td>
      <td class="r">${Number(li.quantity)}</td>
      <td class="r">${inr(li.unitPrice)}</td>
      <td class="r">${Number(li.discountPct)}%</td>
      <td class="r">${Number(li.taxPct)}% ${esc(resolveTaxType(li.taxType).label)}</td>
      <td class="r">${inr(li.amount)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: 'Helvetica Neue', Arial, 'Noto Sans', sans-serif; color: #1F2937; font-size: 12px; margin: 0; }
    .brand { background: ${BRAND}; color: #ffffff; padding: 22px 28px; display: flex; justify-content: space-between; align-items: flex-start; }
    .brand .logo { height: 40px; object-fit: contain; display: block; }
    .brand .title { font-size: 26px; font-weight: 800; letter-spacing: .5px; color: ${ACCENT}; margin-top: 16px; }
    .brand .name { font-size: 16px; font-weight: 700; }
    .brand .meta { text-align: right; font-size: 10px; color: rgba(255,255,255,.82); line-height: 1.55; }
    .wrap { padding: 26px 28px; }
    .docband { display: flex; gap: 40px; background: #F3F6F4; border-radius: 10px; padding: 12px 16px; }
    .docband .lbl { font-size: 9px; text-transform: uppercase; letter-spacing: .5px; color: #6B7280; }
    .docband .val { font-size: 12px; font-weight: 600; color: #1F2937; }
    .cols { display: flex; justify-content: space-between; gap: 24px; margin: 22px 0; }
    .box { flex: 1; }
    .box h3 { font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: ${BRAND}; margin: 0 0 6px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th { background: ${BRAND}; color: #ffffff; text-align: left; padding: 9px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: .3px; }
    th:first-child { border-top-left-radius: 8px; } th:last-child { border-top-right-radius: 8px; }
    td { padding: 9px 8px; border-bottom: 1px solid #EEF2F0; vertical-align: top; }
    .r { text-align: right; }
    .summary { width: 320px; margin-left: auto; margin-top: 18px; }
    .summary td { border: none; padding: 4px 10px; color: #374151; }
    .summary .grand td { background: ${BRAND}; color: ${ACCENT}; font-weight: 800; font-size: 14px; padding: 10px; }
    .summary .grand td:first-child { border-top-left-radius: 8px; border-bottom-left-radius: 8px; }
    .summary .grand td:last-child { border-top-right-radius: 8px; border-bottom-right-radius: 8px; }
    .words { margin-top: 8px; font-style: italic; color: #374151; font-size: 11px; }
    .tc { margin-top: 24px; } .tc h3, .bank h3, .sign h3 { font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: ${BRAND}; margin: 0 0 6px; }
    .bank-details-grid { margin-top: 6px; }
    .bank-row { display: flex; margin-bottom: 4px; font-size: 10px; }
    .bank-lbl { width: 130px; color: #4B5563; font-weight: 600; flex-shrink: 0; }
    .bank-val { color: #1F2937; }
    .tc p { white-space: pre-wrap; color: #374151; font-size: 11px; line-height: 1.55; }
    .scope-block { margin-top: 24px; color: #374151; font-size: 11px; line-height: 1.55; }
    .scope-block h3 { font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: ${BRAND}; margin: 0 0 6px; }
    .scope-block ul, .scope-block ol { margin: 6px 0 6px 20px; padding: 0; }
    .scope-block p { margin: 4px 0; }
    .bottom { display: flex; justify-content: space-between; margin-top: 28px; gap: 24px; }
    .sign { width: 210px; text-align: center; }
    .sign .line { border-top: 1px solid #9CA3AF; margin-top: 46px; padding-top: 4px; color: #6B7280; }
  </style></head><body>
    <div class="brand">
      <div>
        ${logoUri ? `<img class="logo" src="${logoUri}" alt="${esc(companyName)}"/>` : `<span class="name">${esc(companyName)}</span>`}
        <div class="title">${title}</div>
      </div>
      <div class="meta">
        <b style="color:#fff">${esc(companyName)}</b><br/>
        ${esc(org?.address || c.address || '')}<br/>
        ${c.gst ? `GSTIN: ${esc(c.gst)}` : ''}${c.pan ? ` &nbsp; PAN: ${esc(c.pan)}` : ''}<br/>
        ${esc(org?.phone || '')}${c.email ? ` &nbsp;·&nbsp; ${esc(c.email)}` : ''}
      </div>
    </div>
    <div class="wrap">
      <div class="docband">
        <div><div class="lbl">Document No.</div><div class="val">${esc(quote.documentNumber)}</div></div>
        <div><div class="lbl">Issued Date</div><div class="val">${fmtDate(quote.documentDate)}</div></div>
        <div><div class="lbl">Valid Until</div><div class="val">${fmtDate(quote.expirationDate)}</div></div>
      </div>

      <div class="cols">
        <div class="box">
          <h3>Bill To</h3>
          <div><b>${esc(quote.clientName)}</b></div>
          <div>${esc(quote.contactPerson)}</div>
          ${(() => {
            const cl = quote.client || {};
            const addr = quote.billingAddress || cl.billingAddress || [cl.address, cl.city, cl.state].filter(Boolean).join(', ');
            return addr ? `<div style="white-space:pre-line;">${esc(addr)}</div>` : '';
          })()}
          ${quote.clientGst ? `<div>GSTIN: ${esc(quote.clientGst)}</div>` : ''}
          ${quote.clientEmail ? `<div>${esc(quote.clientEmail)}</div>` : ''}
          ${quote.clientPhone ? `<div>${esc(quote.clientPhone)}</div>` : ''}
        </div>
        <div class="box r">
          <h3>Details</h3>
          <div>Payment Terms: ${esc(quote.paymentTerms)}</div>
          ${quote.salesperson?.name ? `<div>Salesperson: ${esc(quote.salesperson.name)}</div>` : ''}
        </div>
      </div>

      <table>
        <thead><tr><th>#</th><th>Description</th><th>Unit</th><th class="r">Qty</th><th class="r">Unit Price</th><th class="r">Disc</th><th class="r">Tax</th><th class="r">Amount</th></tr></thead>
        <tbody>${lines}</tbody>
      </table>

      <table class="summary">
        <tr><td>Sub Total</td><td class="r">${inr(Number(quote.untaxedAmount) + Number(quote.totalDiscount))}</td></tr>
        ${Number(quote.totalDiscount) > 0 ? `<tr><td>Discount</td><td class="r">- ${inr(quote.totalDiscount)}</td></tr><tr><td>Taxable Amount</td><td class="r">${inr(quote.untaxedAmount)}</td></tr>` : ''}
        ${taxRows}
        <tr class="grand"><td>Grand Total</td><td class="r">${inr(quote.grandTotal)}</td></tr>
      </table>
      <div class="words r">${esc(quote.amountInWords || '')}</div>
      ${hasRcm ? `<div class="r" style="margin-top:4px; font-size:10px; font-weight:600; color:${BRAND};">Tax payable under reverse charge (RCM).</div>` : ''}

      ${quote.scope ? `<div class="scope-block"><h3>Scope of Work</h3><div>${quote.scope}</div></div>` : ''}
      <div class="tc"><h3>Terms &amp; Conditions</h3><p>${esc(quote.termsConditions)}</p></div>

      <div class="bottom">
        <div class="bank">
          <h3>Bank Details</h3>
          ${c.bankHolder || c.bankName || c.bankBranch || c.bankAccount || c.bankIfsc ? `
            <div class="bank-details-grid">
              ${c.bankHolder ? `<div class="bank-row"><span class="bank-lbl">Account Holder Name:</span><span class="bank-val">${esc(c.bankHolder)}</span></div>` : ''}
              ${c.bankName ? `<div class="bank-row"><span class="bank-lbl">Bank Name:</span><span class="bank-val">${esc(c.bankName)}</span></div>` : ''}
              ${c.bankBranch ? `<div class="bank-row"><span class="bank-lbl">Branch:</span><span class="bank-val">${esc(c.bankBranch)}</span></div>` : ''}
              ${c.bankAccount ? `<div class="bank-row"><span class="bank-lbl">Account Number:</span><span class="bank-val">${esc(c.bankAccount)}</span></div>` : ''}
              ${c.bankIfsc ? `<div class="bank-row"><span class="bank-lbl">IFSC Code:</span><span class="bank-val">${esc(c.bankIfsc)}</span></div>` : ''}
            </div>
          ` : '<div style="color:#9CA3AF">Set bank details in company settings</div>'}
        </div>
        ${quote.onlineSignature ? `<div class="sign"><h3>Authorised Signature</h3><div class="line">Sign here</div></div>` : `<div class="sign"><h3>For ${esc(companyName)}</h3><div class="line">Authorised Signatory</div></div>`}
      </div>
    </div>
  </body></html>`;
}


function buildMinimalHtml(quote: any, org: any, logoUri: string): string {
  const c = (org?.settings as any)?.company || {};
  const companyName = c.name || org?.name || 'EyeLevel Growth Studio';
  let title = 'PROFORMA INVOICE';
  if (quote.documentType === 'QUOTATION') title = 'QUOTATION';
  if (quote.documentType === 'INVOICE') title = 'INVOICE';
  const taxRows = Number(quote.totalTax) > 0 ? `<tr><td>Total Tax</td><td class="r">${inr(quote.totalTax)}</td></tr>` : '';
  const hasRcm = (quote.lineItems || []).some((li: any) => resolveTaxType(li.taxType).mode === 'RC');

  const lines = (quote.lineItems || []).map((li: any) => `
    <tr>
      <td>${li.sortOrder}</td>
      <td>${esc(li.description)}</td>
      <td>${esc(li.unit)}</td>
      <td class="r">${Number(li.quantity)}</td>
      <td class="r">${inr(li.unitPrice)}</td>
      <td class="r">${Number(li.discountPct)}%</td>
      <td class="r">${Number(li.taxPct)}% ${esc(resolveTaxType(li.taxType).label)}</td>
      <td class="r">${inr(li.amount)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: 'Helvetica Neue', Arial, 'Noto Sans', sans-serif; color: #000; font-size: 11px; margin: 0; }
    .brand { padding: 30px 40px 10px 40px; display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #000; margin-bottom: 30px; }
    .brand .logo { height: 32px; object-fit: contain; display: block; filter: grayscale(100%); }
    .brand .title { font-size: 20px; font-weight: 400; letter-spacing: 2px; margin-bottom: 8px; }
    .brand .name { font-size: 18px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; }
    .brand .meta { text-align: right; font-size: 10px; color: #555; line-height: 1.6; }
    .wrap { padding: 0 40px; }
    .docband { display: flex; justify-content: space-between; margin-bottom: 30px; }
    .docband .lbl { font-size: 8px; text-transform: uppercase; letter-spacing: 1px; color: #888; }
    .docband .val { font-size: 12px; font-weight: 500; color: #000; }
    .cols { display: flex; justify-content: space-between; gap: 40px; margin: 30px 0; padding-bottom: 30px; border-bottom: 1px solid #eee; }
    .box { flex: 1; }
    .box h3 { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #888; margin: 0 0 10px; border-bottom: 1px solid #eee; padding-bottom: 4px; }
    .box div { line-height: 1.6; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th { border-bottom: 1px solid #000; color: #000; text-align: left; padding: 12px 8px; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; }
    td { padding: 12px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
    .r { text-align: right; }
    .summary { width: 320px; margin-left: auto; margin-top: 20px; border-top: 2px solid #000; }
    .summary td { border: none; padding: 6px 10px; color: #333; }
    .summary .grand td { color: #000; font-weight: 700; font-size: 14px; padding: 12px 10px; border-bottom: 2px solid #000; }
    .words { margin-top: 12px; font-style: italic; color: #666; font-size: 10px; }
    .tc { margin-top: 40px; } .tc h3, .bank h3, .sign h3 { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #888; margin: 0 0 8px; }
    .bank-details-grid { margin-top: 6px; }
    .bank-row { display: flex; margin-bottom: 4px; font-size: 10px; }
    .bank-lbl { width: 130px; color: #666; font-weight: 600; flex-shrink: 0; }
    .bank-val { color: #000; }
    .tc p { white-space: pre-wrap; color: #444; font-size: 10px; line-height: 1.6; }
    .scope-block { margin-top: 40px; color: #444; font-size: 10px; line-height: 1.6; }
    .scope-block h3 { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #888; margin: 0 0 8px; }
    .scope-block ul, .scope-block ol { margin: 8px 0 8px 20px; padding: 0; }
    .scope-block p { margin: 6px 0; }
    .bottom { display: flex; justify-content: space-between; margin-top: 40px; gap: 40px; padding-top: 30px; border-top: 1px solid #eee; }
    .sign { width: 200px; text-align: center; }
    .sign .line { border-top: 1px solid #000; margin-top: 60px; padding-top: 8px; color: #555; text-transform: uppercase; font-size: 9px; letter-spacing: 1px; }
  </style></head><body>
    <div class="brand">
      <div>
        <div class="title">${title}</div>
        ${logoUri ? `<img class="logo" src="${logoUri}" alt="${esc(companyName)}"/>` : `<span class="name">${esc(companyName)}</span>`}
      </div>
      <div class="meta">
        <b style="color:#000">${esc(companyName)}</b><br/>
        ${esc(org?.address || c.address || '')}<br/>
        ${c.gst ? `GSTIN: ${esc(c.gst)}` : ''}${c.pan ? ` &nbsp; PAN: ${esc(c.pan)}` : ''}<br/>
        ${esc(org?.phone || '')}${c.email ? ` &nbsp;·&nbsp; ${esc(c.email)}` : ''}
      </div>
    </div>
    <div class="wrap">
      <div class="docband">
        <div><div class="lbl">Document No.</div><div class="val">${esc(quote.documentNumber)}</div></div>
        <div><div class="lbl">Issued Date</div><div class="val">${fmtDate(quote.documentDate)}</div></div>
        <div><div class="lbl">Valid Until</div><div class="val">${fmtDate(quote.expirationDate)}</div></div>
      </div>

      <div class="cols">
        <div class="box">
          <h3>Bill To</h3>
          <div><b style="color:#000;">${esc(quote.clientName)}</b></div>
          <div>${esc(quote.contactPerson)}</div>
          ${(() => {
            const cl = quote.client || {};
            const addr = quote.billingAddress || cl.billingAddress || [cl.address, cl.city, cl.state].filter(Boolean).join(', ');
            return addr ? `<div style="white-space:pre-line;">${esc(addr)}</div>` : '';
          })()}
          ${quote.clientGst ? `<div>GSTIN: ${esc(quote.clientGst)}</div>` : ''}
          ${quote.clientEmail ? `<div>${esc(quote.clientEmail)}</div>` : ''}
          ${quote.clientPhone ? `<div>${esc(quote.clientPhone)}</div>` : ''}
        </div>
        <div class="box r">
          <h3>Details</h3>
          <div>Payment Terms: ${esc(quote.paymentTerms)}</div>
          ${quote.salesperson?.name ? `<div>Salesperson: ${esc(quote.salesperson.name)}</div>` : ''}
        </div>
      </div>

      <table>
        <thead><tr><th>#</th><th>Description</th><th>Unit</th><th class="r">Qty</th><th class="r">Unit Price</th><th class="r">Disc</th><th class="r">Tax</th><th class="r">Amount</th></tr></thead>
        <tbody>${lines}</tbody>
      </table>

      <table class="summary">
        <tr><td>Sub Total</td><td class="r">${inr(Number(quote.untaxedAmount) + Number(quote.totalDiscount))}</td></tr>
        ${Number(quote.totalDiscount) > 0 ? `<tr><td>Discount</td><td class="r">- ${inr(quote.totalDiscount)}</td></tr><tr><td>Taxable Amount</td><td class="r">${inr(quote.untaxedAmount)}</td></tr>` : ''}
        ${taxRows}
        <tr class="grand"><td>Grand Total</td><td class="r">${inr(quote.grandTotal)}</td></tr>
      </table>
      <div class="words r">${esc(quote.amountInWords || '')}</div>
      ${hasRcm ? `<div class="r" style="margin-top:4px; font-size:9px; font-weight:600; color:#000;">Tax payable under reverse charge (RCM).</div>` : ''}

      ${quote.scope ? `<div class="scope-block"><h3>Scope of Work</h3><div>${quote.scope}</div></div>` : ''}
      <div class="tc"><h3>Terms &amp; Conditions</h3><p>${esc(quote.termsConditions)}</p></div>

      <div class="bottom">
        <div class="bank">
          <h3>Bank Details</h3>
          ${c.bankHolder || c.bankName || c.bankBranch || c.bankAccount || c.bankIfsc ? `
            <div class="bank-details-grid">
              ${c.bankHolder ? `<div class="bank-row"><span class="bank-lbl">Account Holder Name:</span><span class="bank-val">${esc(c.bankHolder)}</span></div>` : ''}
              ${c.bankName ? `<div class="bank-row"><span class="bank-lbl">Bank Name:</span><span class="bank-val">${esc(c.bankName)}</span></div>` : ''}
              ${c.bankBranch ? `<div class="bank-row"><span class="bank-lbl">Branch:</span><span class="bank-val">${esc(c.bankBranch)}</span></div>` : ''}
              ${c.bankAccount ? `<div class="bank-row"><span class="bank-lbl">Account Number:</span><span class="bank-val">${esc(c.bankAccount)}</span></div>` : ''}
              ${c.bankIfsc ? `<div class="bank-row"><span class="bank-lbl">IFSC Code:</span><span class="bank-val">${esc(c.bankIfsc)}</span></div>` : ''}
            </div>
          ` : '<div style="color:#888">Set bank details in company settings</div>'}
        </div>
        ${quote.onlineSignature ? `<div class="sign"><h3>Authorised Signature</h3><div class="line">Sign here</div></div>` : `<div class="sign"><h3>For ${esc(companyName)}</h3><div class="line">Authorised Signatory</div></div>`}
      </div>
    </div>
  </body></html>`;
}

function buildModernHtml(quote: any, org: any, logoUri: string): string {
  const c = (org?.settings as any)?.company || {};
  const companyName = c.name || org?.name || 'EyeLevel Growth Studio';
  let title = 'PROFORMA INVOICE';
  if (quote.documentType === 'QUOTATION') title = 'QUOTATION';
  if (quote.documentType === 'INVOICE') title = 'INVOICE';
  const taxRows = Number(quote.totalTax) > 0 ? `<tr><td>Total Tax</td><td class="r">${inr(quote.totalTax)}</td></tr>` : '';
  const hasRcm = (quote.lineItems || []).some((li: any) => resolveTaxType(li.taxType).mode === 'RC');

  const lines = (quote.lineItems || []).map((li: any) => `
    <tr>
      <td>${li.sortOrder}</td>
      <td>${esc(li.description)}</td>
      <td>${esc(li.unit)}</td>
      <td class="r">${Number(li.quantity)}</td>
      <td class="r">${inr(li.unitPrice)}</td>
      <td class="r">${Number(li.discountPct)}%</td>
      <td class="r">${Number(li.taxPct)}% ${esc(resolveTaxType(li.taxType).label)}</td>
      <td class="r">${inr(li.amount)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: 'Inter', 'Segoe UI', 'Noto Sans', sans-serif; color: #374151; font-size: 11px; margin: 0; background: #fafafa; }
    .sheet { background: #fff; padding: 30px; border-radius: 16px; margin: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); }
    .brand { display: flex; justify-content: space-between; align-items: center; margin-bottom: 40px; }
    .brand .logo { height: 36px; object-fit: contain; display: block; }
    .brand .title { font-size: 24px; font-weight: 800; letter-spacing: -0.5px; color: #111827; }
    .brand .name { font-size: 20px; font-weight: 800; color: #111827; }
    .brand .meta { text-align: right; font-size: 10px; color: #6B7280; line-height: 1.5; }
    .docband { display: flex; gap: 30px; background: #F9FAFB; border: 1px solid #F3F4F6; border-radius: 12px; padding: 16px 20px; margin-bottom: 30px; }
    .docband .lbl { font-size: 9px; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px; color: #9CA3AF; margin-bottom: 4px; }
    .docband .val { font-size: 13px; font-weight: 700; color: #111827; }
    .cols { display: flex; justify-content: space-between; gap: 30px; margin-bottom: 30px; }
    .box { flex: 1; background: #F9FAFB; border-radius: 12px; padding: 16px 20px; }
    .box h3 { font-size: 9px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; color: #9CA3AF; margin: 0 0 10px; }
    .box div { line-height: 1.6; }
    table { width: 100%; border-collapse: separate; border-spacing: 0; margin-top: 10px; }
    th { background: #F9FAFB; color: #6B7280; text-align: left; padding: 12px 10px; font-size: 9px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; }
    th:first-child { border-top-left-radius: 8px; border-bottom-left-radius: 8px; }
    th:last-child { border-top-right-radius: 8px; border-bottom-right-radius: 8px; }
    td { padding: 14px 10px; border-bottom: 1px solid #F3F4F6; vertical-align: top; }
    .r { text-align: right; }
    .summary { width: 340px; margin-left: auto; margin-top: 24px; background: #F9FAFB; border-radius: 12px; overflow: hidden; }
    .summary td { border: none; padding: 8px 16px; color: #4B5563; }
    .summary .grand td { background: #111827; color: #fff; font-weight: 700; font-size: 15px; padding: 14px 16px; }
    .words { margin-top: 12px; color: #6B7280; font-size: 10px; text-align: right; }
    .tc { margin-top: 30px; } .tc h3, .bank h3, .sign h3 { font-size: 9px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; color: #9CA3AF; margin: 0 0 8px; }
    .bank-details-grid { margin-top: 6px; }
    .bank-row { display: flex; margin-bottom: 5px; font-size: 11px; }
    .bank-lbl { width: 130px; color: #6B7280; font-weight: 500; flex-shrink: 0; }
    .bank-val { color: #111827; font-weight: 600; }
    .tc p { white-space: pre-wrap; color: #4B5563; font-size: 11px; line-height: 1.6; }
    .scope-block { margin-top: 30px; background: #F9FAFB; padding: 16px 20px; border-radius: 12px; color: #4B5563; font-size: 11px; line-height: 1.6; }
    .scope-block h3 { font-size: 9px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; color: #9CA3AF; margin: 0 0 8px; }
    .scope-block ul, .scope-block ol { margin: 8px 0 8px 20px; padding: 0; }
    .scope-block p { margin: 6px 0; }
    .bottom { display: flex; justify-content: space-between; margin-top: 30px; gap: 30px; background: #F9FAFB; padding: 20px; border-radius: 12px; }
    .sign { width: 220px; text-align: center; }
    .sign .line { border-top: 2px dashed #D1D5DB; margin-top: 50px; padding-top: 8px; color: #6B7280; font-weight: 600; font-size: 10px; }
  </style></head><body>
    <div class="sheet">
      <div class="brand">
        <div>
          ${logoUri ? `<img class="logo" src="${logoUri}" alt="${esc(companyName)}"/>` : `<span class="name">${esc(companyName)}</span>`}
          <div class="title">${title}</div>
        </div>
        <div class="meta">
          <b style="color:#111827">${esc(companyName)}</b><br/>
          ${esc(org?.address || c.address || '')}<br/>
          ${c.gst ? `GSTIN: ${esc(c.gst)}` : ''}${c.pan ? ` &nbsp; PAN: ${esc(c.pan)}` : ''}<br/>
          ${esc(org?.phone || '')}${c.email ? ` &nbsp;·&nbsp; ${esc(c.email)}` : ''}
        </div>
      </div>

      <div class="docband">
        <div><div class="lbl">Document No.</div><div class="val">${esc(quote.documentNumber)}</div></div>
        <div><div class="lbl">Issued Date</div><div class="val">${fmtDate(quote.documentDate)}</div></div>
        <div><div class="lbl">Valid Until</div><div class="val">${fmtDate(quote.expirationDate)}</div></div>
      </div>

      <div class="cols">
        <div class="box">
          <h3>Bill To</h3>
          <div><b style="color:#111827;">${esc(quote.clientName)}</b></div>
          <div>${esc(quote.contactPerson)}</div>
          ${(() => {
            const cl = quote.client || {};
            const addr = quote.billingAddress || cl.billingAddress || [cl.address, cl.city, cl.state].filter(Boolean).join(', ');
            return addr ? `<div style="white-space:pre-line; margin-top:4px;">${esc(addr)}</div>` : '';
          })()}
          ${quote.clientGst ? `<div style="margin-top:4px;">GSTIN: ${esc(quote.clientGst)}</div>` : ''}
          ${quote.clientEmail ? `<div>${esc(quote.clientEmail)}</div>` : ''}
          ${quote.clientPhone ? `<div>${esc(quote.clientPhone)}</div>` : ''}
        </div>
        <div class="box r" style="flex: 0.6;">
          <h3>Details</h3>
          <div>Payment Terms: <b style="color:#111827;">${esc(quote.paymentTerms)}</b></div>
          ${quote.salesperson?.name ? `<div style="margin-top:4px;">Salesperson: ${esc(quote.salesperson.name)}</div>` : ''}
        </div>
      </div>

      <table>
        <thead><tr><th>#</th><th>Description</th><th>Unit</th><th class="r">Qty</th><th class="r">Unit Price</th><th class="r">Disc</th><th class="r">Tax</th><th class="r">Amount</th></tr></thead>
        <tbody>${lines}</tbody>
      </table>

      <table class="summary">
        <tr><td>Sub Total</td><td class="r">${inr(Number(quote.untaxedAmount) + Number(quote.totalDiscount))}</td></tr>
        ${Number(quote.totalDiscount) > 0 ? `<tr><td>Discount</td><td class="r">- ${inr(quote.totalDiscount)}</td></tr><tr><td>Taxable Amount</td><td class="r">${inr(quote.untaxedAmount)}</td></tr>` : ''}
        ${taxRows}
        <tr class="grand"><td>Grand Total</td><td class="r">${inr(quote.grandTotal)}</td></tr>
      </table>
      <div class="words">${esc(quote.amountInWords || '')}</div>
      ${hasRcm ? `<div class="r" style="margin-top:8px; font-size:10px; font-weight:700; color:#111827;">Tax payable under reverse charge (RCM).</div>` : ''}

      ${quote.scope ? `<div class="scope-block"><h3>Scope of Work</h3><div>${quote.scope}</div></div>` : ''}
      <div class="tc"><h3>Terms &amp; Conditions</h3><p>${esc(quote.termsConditions)}</p></div>

      <div class="bottom">
        <div class="bank">
          <h3>Bank Details</h3>
          ${c.bankHolder || c.bankName || c.bankBranch || c.bankAccount || c.bankIfsc ? `
            <div class="bank-details-grid">
              ${c.bankHolder ? `<div class="bank-row"><span class="bank-lbl">Account Holder Name:</span><span class="bank-val">${esc(c.bankHolder)}</span></div>` : ''}
              ${c.bankName ? `<div class="bank-row"><span class="bank-lbl">Bank Name:</span><span class="bank-val">${esc(c.bankName)}</span></div>` : ''}
              ${c.bankBranch ? `<div class="bank-row"><span class="bank-lbl">Branch:</span><span class="bank-val">${esc(c.bankBranch)}</span></div>` : ''}
              ${c.bankAccount ? `<div class="bank-row"><span class="bank-lbl">Account Number:</span><span class="bank-val">${esc(c.bankAccount)}</span></div>` : ''}
              ${c.bankIfsc ? `<div class="bank-row"><span class="bank-lbl">IFSC Code:</span><span class="bank-val">${esc(c.bankIfsc)}</span></div>` : ''}
            </div>
          ` : '<div style="color:#9CA3AF">Set bank details in company settings</div>'}
        </div>
        ${quote.onlineSignature ? `<div class="sign"><h3>Authorised Signature</h3><div class="line">Sign here</div></div>` : `<div class="sign"><h3>For ${esc(companyName)}</h3><div class="line">Authorised Signatory</div></div>`}
      </div>
    </div>
  </body></html>`;
}

export async function generateQuotePdf(quote: any, org: any): Promise<string> {
  const logoUri = await loadBrandLogo();
  const template = (org?.settings as any)?.company?.quotationTemplate || 'CLASSIC';
  
  let html = '';
  if (template === 'MINIMAL') {
    html = buildMinimalHtml(quote, org, logoUri);
  } else if (template === 'MODERN') {
    html = buildModernHtml(quote, org, logoUri);
  } else {
    html = buildClassicHtml(quote, org, logoUri);
  }
  
  const website = esc(org?.website || '');

  let footerTemplate = '';
  if (template === 'MINIMAL') {
    footerTemplate = `<div style="width:100%; padding:0 8mm; -webkit-print-color-adjust:exact;">
      <div style="border-top:1px solid #ccc; padding:6px 0; display:flex; align-items:center; justify-content:space-between; font-size:8px; color:#555; font-family:sans-serif;">
        <span>${website}</span>
        <span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
      </div>
    </div>`;
  } else if (template === 'MODERN') {
    footerTemplate = `<div style="width:100%; padding:0 8mm; -webkit-print-color-adjust:exact;">
      <div style="background:#F9FAFB; color:#6B7280; border-radius:8px; padding:6px 14px; display:flex; align-items:center; justify-content:space-between; font-size:8px; font-family:sans-serif; font-weight:500;">
        ${logoUri ? `<img src="${logoUri}" style="height:12px; filter:grayscale(100%) opacity(50%);"/>` : `<span>EyeLevel</span>`}
        <span>${website}</span>
        <span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
      </div>
    </div>`;
  } else {
    footerTemplate = `<div style="width:100%; padding:0 8mm; -webkit-print-color-adjust:exact;">
      <div style="background:${BRAND}; color:${ACCENT}; border-radius:8px; padding:6px 14px; display:flex; align-items:center; justify-content:space-between; font-size:8px;">
        ${logoUri ? `<img src="${logoUri}" style="height:16px;"/>` : `<span style="color:#fff;font-weight:bold;">EyeLevel</span>`}
        <span>${website}</span>
        <span style="color:#ffffff;">Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
      </div>
    </div>`;
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {}),
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const dir = path.resolve(process.cwd(), 'uploads', 'quotes');
    await fs.mkdir(dir, { recursive: true });
    const safeClient = String(quote.clientName || 'client').replace(/[^a-z0-9]+/gi, '_').slice(0, 40);
    const safeNum = String(quote.documentNumber).replace(/[^a-z0-9]+/gi, '-');
    const filename = `${safeNum}_${safeClient}.pdf`;
    await page.pdf({
      path: path.join(dir, filename),
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate,
      margin: { top: '6mm', bottom: '20mm', left: '8mm', right: '8mm' },
    });
    return `/uploads/quotes/${filename}`;
  } finally {
    await browser.close();
  }
}
