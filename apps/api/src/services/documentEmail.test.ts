import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../lib/prisma.js';

/**
 * CR-02 §10 — sending the document.
 *
 * The PDF renderer launches a browser and the mailer opens an SMTP connection,
 * so both are stubbed here. What is left is the part worth testing: who the
 * form offers to send to, what the covering note says, and that the attachment
 * is actually attached.
 */

// `vi.hoisted` because `vi.mock` is lifted above the imports, so a plain
// `const` declared here would still be in its temporal dead zone when the
// factory below runs.
const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn(async () => ({ sent: true as const })) }));

vi.mock('../utils/mailer.js', () => ({
  sendMail,
  resolveMailConfig: vi.fn(),
}));

vi.mock('./documentPdf.js', () => ({
  generateDocumentPdf: vi.fn(async () => Buffer.from('%PDF-1.4 pretend')),
}));

import {
  documentEmailDefaults,
  sendDocumentEmail,
  defaultEmailBody,
  defaultEmailSubject,
} from './documentEmail.js';
import { loadRenderableDocument } from './documentModel.js';

const ORG = {
  name: 'EyeLevel Growth Studio',
  legalName: 'EyeLevel Growth Studio LLP',
  address: 'No. 12, KK Nagar',
  state: 'Tamil Nadu',
  gstNumber: '33AABCE1234F1Z5',
  gstStateCode: '33',
  pan: 'AABCE1234F',
  contactEmail: 'accounts@eyelevelstudio.in',
  declarationText: null,
  defaultPaymentTerms: 'Immediate',
  defaultTermsAndConditions: ['Payment on receipt'],
  signatureImage: null,
};

const PROFORMA = {
  id: 'pf-1',
  number: 'EL/PI/26-27/017',
  companyId: 'co-1',
  amount: 100000,
  raisedAt: new Date('2026-09-09'),
  validTill: new Date('2026-10-09'),
  gstApplicable: true,
  gstRatePercent: 18,
  subtotal: 100000,
  cgstAmount: 9000,
  sgstAmount: 9000,
  igstAmount: 0,
  roundOff: 0,
  total: 118000,
  amountInWords: 'Rupees One Lakh Eighteen Thousand Only.',
  supplyType: 'INTRA',
  placeOfSupplyState: 'Tamil Nadu',
  placeOfSupplyCode: '33',
  billingName: 'Client Pvt Ltd',
  billingContactName: null,
  billingAddress: null,
  billingStateName: 'Tamil Nadu',
  billingStateCode: '33',
  gstin: null,
  sellerSnapshot: null,
  customFields: null,
  poNumber: null,
  poDate: null,
  terms: 'Payment on receipt',
  notes: null,
  description: 'Retainer',
  sacCode: '998365',
  organization: ORG,
  company: { name: 'Client Pvt Ltd', billingAddress: null, gstin: null },
  lineItems: [
    { serialNo: 1, particulars: 'Retainer', units: 1, unitCost: 100000, hsnSac: '998365', amount: 100000, gstRate: 18 },
  ],
};

beforeEach(() => {
  sendMail.mockClear();
  (prisma.proforma.findFirst as any).mockResolvedValue(PROFORMA);
  (prisma.activity.create as any).mockResolvedValue({});
});

describe('who the form offers to send to', () => {
  it('puts the person who pays first, then whoever approves, then anyone else', async () => {
    (prisma.person.findMany as any).mockResolvedValue([
      { name: 'Ravi', email: 'ravi@client.com', role: 'CONTACT' },
      { name: 'Meera', email: 'meera@client.com', role: 'PAYER' },
      { name: 'Anil', email: 'anil@client.com', role: 'APPROVER' },
    ]);

    const defaults = await documentEmailDefaults('PROFORMA', 'pf-1', 'org-1');
    expect(defaults.recipients.map((r) => r.name)).toEqual(['Meera', 'Anil', 'Ravi']);
    expect(defaults.to).toBe('meera@client.com');
  });

  it('offers nobody rather than guessing when no contact has an email', async () => {
    (prisma.person.findMany as any).mockResolvedValue([]);
    const defaults = await documentEmailDefaults('PROFORMA', 'pf-1', 'org-1');
    expect(defaults.recipients).toEqual([]);
    expect(defaults.to).toBeNull();
  });
});

describe('the covering note', () => {
  it('states what the document is and what it comes to', async () => {
    const doc = await loadRenderableDocument('PROFORMA', 'pf-1', 'org-1');

    expect(defaultEmailSubject(doc)).toBe('Proforma invoice EL/PI/26-27/017 from EyeLevel Growth Studio LLP');

    const body = defaultEmailBody(doc);
    expect(body).toContain('EL/PI/26-27/017');
    expect(body).toContain('₹1,18,000.00');
    expect(body).toContain('valid until 09 Oct 2026');
    expect(body).toContain('EyeLevel Growth Studio LLP');
  });
});

describe('sending', () => {
  beforeEach(() => {
    (prisma.person.findMany as any).mockResolvedValue([]);
  });

  it('attaches the PDF, named after the document', async () => {
    await sendDocumentEmail('PROFORMA', 'pf-1', 'org-1', 'usr-1', { to: 'meera@client.com' });

    expect(sendMail).toHaveBeenCalledTimes(1);
    const [orgId, message] = sendMail.mock.calls[0] as unknown as [string, any];
    expect(orgId).toBe('org-1');
    expect(message.to).toBe('meera@client.com');
    expect(message.attachments).toHaveLength(1);
    // Slashes are routine in the series and a filename is not a path.
    expect(message.attachments[0].filename).toBe('EL-PI-26-27-017.pdf');
    expect(message.attachments[0].contentType).toBe('application/pdf');
  });

  it('sends what was typed, not the default, when the sender rewrote it', async () => {
    await sendDocumentEmail('PROFORMA', 'pf-1', 'org-1', 'usr-1', {
      to: 'meera@client.com',
      subject: 'As discussed',
      message: 'Hi Meera,\n\nAttached.',
    });
    const [, message] = sendMail.mock.calls[0] as unknown as [string, any];
    expect(message.subject).toBe('As discussed');
    expect(message.text).toBe('Hi Meera,\n\nAttached.');
    expect(message.html).toContain('<p>Hi Meera,</p>');
  });

  it('replies to the organisation’s own address, not the sender’s', async () => {
    await sendDocumentEmail('PROFORMA', 'pf-1', 'org-1', 'usr-1', { to: 'meera@client.com' });
    const [, message] = sendMail.mock.calls[0] as unknown as [string, any];
    expect(message.replyTo).toBe('accounts@eyelevelstudio.in');
  });

  it('records that it went, and to whom, without copying the body into the audit trail', async () => {
    await sendDocumentEmail('PROFORMA', 'pf-1', 'org-1', 'usr-1', {
      to: 'meera@client.com',
      cc: ['ravi@client.com'],
      message: 'Something private about this client.',
    });
    const call = (prisma.activity.create as any).mock.calls.at(-1)[0];
    expect(call.data.verb).toBe('document_emailed');
    expect(call.data.payload.to).toBe('meera@client.com');
    expect(call.data.payload.cc).toEqual(['ravi@client.com']);
    expect(JSON.stringify(call.data.payload)).not.toContain('Something private');
  });
});
