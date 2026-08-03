import type { Prisma, LeadStage } from '@prisma/client';
import { generateLeadId, normalizePhone } from '../utils/leadId.js';
import { findLeadByPhone, syncPrimaryContact } from './leadContact.service.js';

/**
 * Client → pipeline entry.
 *
 * The Pipeline board and the Renewals page are both built from `Lead` rows (see
 * pipeline/page.tsx → /crm/leads, and crm.ts's /renewals → leads at ACTIVE_RETAINER). A client
 * onboarded through bulk import has no Lead, so it was invisible to both — including renewal
 * tracking for retainers, which is the one thing an imported retainer most needs.
 *
 * This creates the deal card an already-won customer should have had. It is the mirror of
 * clientConversion.service.ts: that one makes a Client when a deal is won, this one makes the
 * Lead for a customer that was already won before Flowzen knew about them.
 *
 * Deliberately does NOT run the leadStage cascade (contracts / subscriptions / revenue rows).
 * Importing history should not mint financial records; those stay a human decision.
 */

type Tx = Prisma.TransactionClient;

/**
 * Where an existing customer belongs on the board.
 *
 * Status decides first, because it says whether the relationship is actually running. Only an
 * ACTIVE account is a won deal; the engagement type then picks which kind of Active it is.
 *
 * PROSPECT matters most here: it is the DEFAULT status for any imported row that doesn't set one,
 * so treating it as an engagement-type case would file unqualified prospects as won retainers —
 * inflating Renewals, and counting them at weight 1.0 in the executive report.
 */
export function stageForClient(status: string | null | undefined, engagementType: string | null | undefined): LeadStage {
  switch (status) {
    case 'CHURNED': return 'CHURNED' as LeadStage;
    case 'PROJECT_COMPLETED': return 'PROJECT_COMPLETED' as LeadStage;
    case 'ONHOLD': return 'ON_HOLD' as LeadStage;
    case 'PROSPECT': return 'NEW_LEAD' as LeadStage;
  }
  const e = (engagementType || '').toLowerCase();
  if (e.includes('project') || e.includes('one-time') || e.includes('one time')) {
    return 'ACTIVE_PROJECT' as LeadStage;
  }
  return 'ACTIVE_RETAINER' as LeadStage;
}

export interface PipelineEntryOptions {
  /** Phones already used by a lead in this org. Pass a preloaded set when looping over many
   *  clients so each row doesn't need its own query; it is mutated as phones are consumed. */
  takenPhones?: Set<string>;
  /** Who to record as having made the stage change. Falls back to no history row. */
  changedById?: string | null;
}

/**
 * Create the pipeline entry for a client. Returns the new lead's id, or null if the client
 * already has one (making this safe to re-run over the same data).
 */
export async function createPipelineEntryForClient(
  tx: Tx,
  client: any,
  opts: PipelineEntryOptions = {},
): Promise<{ leadId: string; stage: LeadStage } | null> {
  const existing = await tx.lead.findFirst({ where: { clientId: client.id }, select: { id: true } });
  if (existing) return null;

  const stage = stageForClient(client.status, client.engagementType);

  // A lead's phone is unique per organization. A collision (two imported clients sharing a number,
  // or a number already on a lead) must not cost us the pipeline entry, so the duplicate number is
  // dropped rather than the row. null — never '' — because empty strings DO collide with each
  // other under the unique index, while multiple NULLs are allowed.
  //
  // Compared on normalized DIGITS: numbers are stored however they were typed, so
  // "+91-98400-00001" and "9840000001" are the same phone and must collide.
  const rawPhone = (client.phone || '').toString().trim();
  let contactPhone: string | null = rawPhone || null;
  const digits = normalizePhone(rawPhone);
  if (contactPhone && digits) {
    if (opts.takenPhones) {
      if (opts.takenPhones.has(digits)) contactPhone = null;
      else opts.takenPhones.add(digits);
    } else {
      const clash = await findLeadByPhone(tx, client.organizationId, digits, normalizePhone);
      if (clash) contactPhone = null;
    }
  }

  const primaryContact = client.contacts?.[0];
  const newLeadId = await generateLeadId(client.organizationId);

  const lead = await tx.lead.create({
    data: {
      leadId: newLeadId,
      organizationId: client.organizationId,
      clientId: client.id,
      source: client.source || 'EXCEL',
      stage,
      priority: client.priority || 'MEDIUM',
      // Only assert a contract type for a stage that actually implies one; a prospect parked at
      // NEW_LEAD hasn't agreed to anything yet.
      contractType: stage === 'ACTIVE_PROJECT' ? 'ONE_TIME'
        : stage === 'ACTIVE_RETAINER' ? (client.contractType || 'RETAINER')
        : (client.contractType || null),
      companyName: client.company || client.name || null,
      landlinePhone: client.landlinePhone || null,
      assignedToId: client.accountManagerId || null,
      dealValue: client.contractValue ?? null,
      expectedRevenue: client.expectedRevenue ?? null,
      contractStartDate: client.startDate || null,
      address: client.address || null,
      city: client.city || null,
      state: client.state || null,
      zip: client.zip || null,
      country: client.country || null,
      billingAddress: client.billingAddress || null,
      gstNumber: client.gstNumber || null,
      website: client.website || null,
      industry: client.industry || null,
      companySize: client.companySize || null,
      // linkedinUrl belongs to the PERSON now — it goes onto the contact row below, not the lead.
      instagramHandle: client.instagramHandle || null,
      facebookPage: client.facebookPage || null,
      healthStatus: client.healthStatus || null,
    },
    select: { id: true },
  });

  // Give the new pipeline entry its contact row too, so it matches every other lead. Sourced from
  // the client's own primary contact where there is one.
  await syncPrimaryContact(tx, lead.id, {
    name: primaryContact?.name || client.contactPerson || null,
    email: client.email || primaryContact?.email || null,
    phone: contactPhone,
    designation: primaryContact?.designation || client.jobTitle || null,
    linkedinUrl: client.linkedinUrl || null,
  });

  if (opts.changedById) {
    await tx.stageHistory.create({
      data: {
        leadId: lead.id,
        fromStage: 'NEW_LEAD' as LeadStage,
        toStage: stage,
        notes: 'Existing customer onboarded via client import',
        changedById: opts.changedById,
      },
    });
  }

  return { leadId: lead.id, stage };
}
