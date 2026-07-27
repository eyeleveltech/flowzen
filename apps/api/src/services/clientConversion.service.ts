import type { Prisma } from '@prisma/client';

/**
 * Lead → Client conversion.
 *
 * A Client is the account you bill and deliver against. It comes into existence at exactly
 * one moment: when the deal is won, or when a project is being started from the lead. It is
 * NEVER created as a side effect of moving a card between pipeline stages, and it is NEVER
 * deleted when a card moves backwards — by then it may carry contacts, notes, billing
 * details, projects and payments that the pipeline knows nothing about.
 *
 * Everything before conversion lives on the Lead, so there is only one record to edit while
 * the deal is still being chased.
 */

// A transaction client or the plain client — conversion is always part of a larger unit of
// work (winning a deal also writes stage history, activities and revenue records).
type Tx = Prisma.TransactionClient;

/** Fields copied from the lead onto the account it becomes. */
const identityFrom = (lead: any) => ({
  name: lead.companyName || lead.contactName || 'Unknown',
  company: lead.companyName || null,
  email: lead.contactEmail || null,
  phone: lead.contactPhone || null,
  contactPerson: lead.contactName || null,
  address: lead.address || null,
  city: lead.city || null,
  state: lead.state || null,
  website: lead.website || null,
  industry: lead.industry || null,
  billingAddress: lead.billingAddress || null,
  gstNumber: lead.gstNumber || null,
  contractValue: lead.dealValue ?? null,
  jobTitle: lead.jobTitle || null,
  linkedinUrl: lead.linkedinUrl || null,
  companySize: lead.companySize || null,
  landlinePhone: lead.landlinePhone || null,
  zip: lead.zip || null,
  country: lead.country || null,
  instagramHandle: lead.instagramHandle || null,
  facebookPage: lead.facebookPage || null,
  source: lead.source || null,
  priority: lead.priority || null,
  contractType: lead.contractType || null,
  healthStatus: lead.healthStatus || null,
  expectedRevenue: lead.expectedRevenue ?? null,
  dossierJson: lead.dossierJson ?? null,
  dossierStatus: lead.dossierStatus || null,
});

/**
 * Find an existing account for this lead's company, so a repeat customer's second deal
 * links to the account you already have instead of creating a twin. Matching is scoped to
 * the org and deliberately conservative: an exact, case-insensitive hit on email, phone or
 * company name. Anything fuzzier risks merging two genuinely different customers.
 */
async function findMatchingClient(tx: Tx, orgId: string, lead: any) {
  const candidates: Prisma.ClientWhereInput[] = [];
  if (lead.contactEmail) candidates.push({ email: { equals: lead.contactEmail, mode: 'insensitive' } });
  if (lead.contactPhone) candidates.push({ phone: lead.contactPhone });

  const targetName = (lead.companyName || lead.contactName || '').trim();
  if (targetName) {
    candidates.push({ name: { equals: targetName, mode: 'insensitive' } });
    candidates.push({ company: { equals: targetName, mode: 'insensitive' } });
  }
  if (lead.companyName) {
    candidates.push({ company: { equals: lead.companyName, mode: 'insensitive' } });
    candidates.push({ name: { equals: lead.companyName, mode: 'insensitive' } });
  }
  if (!candidates.length) return null;

  // Only match a live account. An archived (soft-deleted) client was deliberately retired, so
  // a returning customer gets a fresh active account rather than silently resurrecting one
  // that's hidden from every list.
  return tx.client.findFirst({
    where: { organizationId: orgId, archivedAt: null, OR: candidates },
    orderBy: { createdAt: 'asc' },
  });
}

export interface ConversionResult {
  clientId: string;
  /** True only when a brand-new account was created (not when an existing one was matched). */
  created: boolean;
}

/**
 * Ensure the lead has a Client account, creating one only if needed. Idempotent: calling it
 * on an already-converted lead returns the existing account untouched.
 *
 * Never deletes and never unlinks.
 */
export async function ensureClientForLead(
  tx: Tx,
  lead: any,
  orgId: string,
): Promise<ConversionResult> {
  if (lead.clientId) {
    const existingClient = await tx.client.findUnique({ where: { id: lead.clientId }, select: { id: true, status: true } });
    if (existingClient && existingClient.status === 'PROSPECT') {
      await tx.client.update({ where: { id: lead.clientId }, data: { status: 'ACTIVE' } });
    }
    return { clientId: lead.clientId, created: false };
  }

  const existing = await findMatchingClient(tx, orgId, lead);
  if (existing) {
    await tx.lead.update({ where: { id: lead.id }, data: { clientId: existing.id } });
    await repointLeadQuotes(tx, lead.id, existing.id);
    if (existing.status === 'PROSPECT') {
      await tx.client.update({ where: { id: existing.id }, data: { status: 'ACTIVE' } });
    }
    return { clientId: existing.id, created: false };
  }

  const leadContacts = await tx.leadContact.findMany({ where: { leadId: lead.id } });

  // The lead's own contact person seeds the account when no contact list was built out.
  const contacts = leadContacts.length
    ? leadContacts.map((c: any) => ({
        name: c.name,
        designation: c.designation || null,
        email: c.email || null,
        phone: c.phone || null,
      }))
    : lead.contactName
      ? [{
          name: lead.contactName,
          designation: lead.jobTitle || null,
          email: lead.contactEmail || null,
          phone: lead.contactPhone || null,
        }]
      : [];

  const client = await tx.client.create({
    data: {
      ...identityFrom(lead),
      status: 'ACTIVE', // an account only exists once the deal is won
      organizationId: orgId,
      ...(contacts.length ? { contacts: { create: contacts } } : {}),
    },
  });

  await tx.lead.update({ where: { id: lead.id }, data: { clientId: client.id } });
  await repointLeadQuotes(tx, lead.id, client.id);

  return { clientId: client.id, created: true };
}

/**
 * Quotations raised while the deal was still a lead belong to the account once it exists,
 * so they show up on the client's record rather than being stranded on the lead.
 */
async function repointLeadQuotes(tx: Tx, leadId: string, clientId: string) {
  await tx.quoteDocument.updateMany({
    where: { leadId, clientId: null } as any,
    data: { clientId },
  });
}

/**
 * Identity and billing fields the Lead owns only until it converts. Afterwards the Client
 * is the single master for them and the lead's copies are frozen, so the two records can
 * never drift apart or disagree about a GST number.
 */
export const LEAD_IDENTITY_FIELDS = [
  'companyName', 'contactName', 'contactEmail', 'contactPhone', 'landlinePhone',
  'jobTitle', 'address', 'city', 'state', 'zip', 'country',
  'billingAddress', 'gstNumber', 'website', 'industry',
] as const;
