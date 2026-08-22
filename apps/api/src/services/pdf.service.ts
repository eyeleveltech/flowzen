/**
 * PDF Generation Service.
 *
 * Renders invoices and quotes to PDF using headless Chrome (Puppeteer).
 */

import puppeteer from 'puppeteer';
import { prisma } from '../lib/prisma.js';

/**
 * Generate a PDF from raw HTML.
 */
const generatePdfFromHtml = async (html: string): Promise<Buffer> => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  
  // Set the HTML content
  await page.setContent(html, { waitUntil: 'load' });
  
  // Generate PDF
  const pdfBuffer = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: {
      top: '20px',
      right: '20px',
      bottom: '20px',
      left: '20px',
    },
  });

  await browser.close();
  return Buffer.from(pdfBuffer);
};

export const generateQuotePdf = async (quoteId: string): Promise<Buffer> => {
  const quote = await prisma.quote.findUniqueOrThrow({
    where: { id: quoteId },
    include: {
      organization: true,
      company: true,
    },
  });

  // Basic HTML template for the quote
  const html = `
    <html>
      <head>
        <style>
          body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333; margin: 40px; }
          .header { display: flex; justify-content: space-between; margin-bottom: 40px; border-bottom: 2px solid #333; padding-bottom: 20px; }
          .title { font-size: 24px; font-weight: bold; }
          .meta { font-size: 14px; color: #666; }
          .details { display: flex; justify-content: space-between; margin-bottom: 40px; }
          .box { width: 45%; }
          .box h3 { margin-bottom: 10px; color: #555; font-size: 14px; text-transform: uppercase; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 40px; }
          th, td { text-align: left; padding: 12px; border-bottom: 1px solid #ddd; }
          th { background-color: #f8f9fa; }
          .total-row td { font-weight: bold; font-size: 18px; border-top: 2px solid #333; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="title">${quote.organization.name}</div>
            <div class="meta">${quote.organization.address ?? ''}</div>
          </div>
          <div style="text-align: right">
            <div class="title">QUOTATION</div>
            <div class="meta">${quote.number}</div>
          </div>
        </div>
        
        <div class="details">
          <div class="box">
            <h3>Prepared For</h3>
            <div><strong>${quote.company.name}</strong></div>
            <div>${quote.company.address ?? ''}</div>
          </div>
          <div class="box" style="text-align: right">
            <h3>Date</h3>
            <div>${quote.createdAt.toISOString().slice(0, 10)}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th style="text-align: right">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Engagement Type: ${quote.engagementType} (${quote.billingFrequency})</td>
              <td style="text-align: right">${quote.currency} ${quote.subtotal.toString()}</td>
            </tr>
            <tr>
              <td>Taxes (CGST/SGST/IGST)</td>
              <td style="text-align: right">${quote.currency} ${(
                Number(quote.cgst) + Number(quote.sgst) + Number(quote.igst)
              ).toFixed(2)}</td>
            </tr>
            <tr class="total-row">
              <td>Total</td>
              <td style="text-align: right">${quote.currency} ${quote.total.toString()}</td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  `;

  return generatePdfFromHtml(html);
};

export const generateInvoicePdf = async (invoiceId: string): Promise<Buffer> => {
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: {
      organization: true,
      company: true,
    },
  });

  const html = `
    <html>
      <head>
        <style>
          body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333; margin: 40px; }
          .header { display: flex; justify-content: space-between; margin-bottom: 40px; border-bottom: 2px solid #333; padding-bottom: 20px; }
          .title { font-size: 24px; font-weight: bold; }
          .meta { font-size: 14px; color: #666; }
          .details { display: flex; justify-content: space-between; margin-bottom: 40px; }
          .box { width: 45%; }
          .box h3 { margin-bottom: 10px; color: #555; font-size: 14px; text-transform: uppercase; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 40px; }
          th, td { text-align: left; padding: 12px; border-bottom: 1px solid #ddd; }
          th { background-color: #f8f9fa; }
          .total-row td { font-weight: bold; font-size: 18px; border-top: 2px solid #333; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="title">${invoice.organization.name}</div>
            <div class="meta">${invoice.organization.address ?? ''}</div>
          </div>
          <div style="text-align: right">
            <div class="title">INVOICE</div>
            <div class="meta">${invoice.number}</div>
          </div>
        </div>
        
        <div class="details">
          <div class="box">
            <h3>Billed To</h3>
            <div><strong>${invoice.company.name}</strong></div>
            <div>${invoice.company.address ?? ''}</div>
          </div>
          <div class="box" style="text-align: right">
            <h3>Invoice Date</h3>
            <div>${invoice.issueDate.toISOString().slice(0, 10)}</div>
            <br/>
            <h3>Due Date</h3>
            <div>${invoice.dueDate.toISOString().slice(0, 10)}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th style="text-align: right">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Services Rendered</td>
              <td style="text-align: right">${invoice.currency} ${invoice.subtotal.toString()}</td>
            </tr>
            <tr>
              <td>Taxes</td>
              <td style="text-align: right">${invoice.currency} ${(
                Number(invoice.cgst) + Number(invoice.sgst) + Number(invoice.igst)
              ).toFixed(2)}</td>
            </tr>
            <tr class="total-row">
              <td>Total Due</td>
              <td style="text-align: right">${invoice.currency} ${invoice.total.toString()}</td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  `;

  return generatePdfFromHtml(html);
};
