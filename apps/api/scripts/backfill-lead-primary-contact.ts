/**
 * Backfill: move each lead's flat contact into lead_contacts as its primary contact.
 *
 * Step 2 of the contacts consolidation (expand -> BACKFILL -> contract). A lead is a COMPANY and
 * its people belong in lead_contacts, where each can carry their own email, phone, LinkedIn, notes
 * and role. Historically a lead ALSO stored one person in flat columns on the lead row itself
 * (contactName / contactEmail / contactPhone / jobTitle / linkedinUrl), so the same human existed
 * in two places and the two could disagree.
 *
 * This copies the flat person into a contact row marked isPrimary. It does NOT clear the flat
 * columns — they are dropped in step 3, only once this has been verified in production.
 *
 * Rules:
 *   - a lead that already has ANY contact row is left alone (someone has curated it); if none of
 *     its contacts is primary, the oldest is promoted so every lead ends up with exactly one
 *   - a lead with no contact rows and no flat name is skipped — nothing to move, nothing invented
 *   - a flat contact with no name but an email/phone still becomes a contact, named from the
 *     email's local part, so the details aren't stranded
 *
 * Safe to run repeatedly.
 *
 * Usage:
 *   npx tsx scripts/backfill-lead-primary-contact.ts           # dry run (prints the plan)
 *   npx tsx scripts/backfill-lead-primary-contact.ts --apply   # write changes
 *   npx tsx scripts/backfill-lead-primary-contact.ts --org=<id> --apply
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const ORG = process.argv.find((a) => a.startsWith('--org='))?.split('=')[1];

/** A person needs a name; fall back to the email's local part before giving up. */
function contactNameFor(lead: { contactName: string | null; contactEmail: string | null }): string | null {
  const name = (lead.contactName || '').trim();
  if (name) return name;
  const email = (lead.contactEmail || '').trim();
  if (email.includes('@')) return email.split('@')[0];
  return null;
}

async function main() {
  const leads = await prisma.lead.findMany({
    where: ORG ? { organizationId: ORG } : {},
    select: {
      id: true, leadId: true, companyName: true,
      contactName: true, contactEmail: true, contactPhone: true,
      jobTitle: true, linkedinUrl: true,
      contacts: { select: { id: true, isPrimary: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
    },
    orderBy: { createdAt: 'asc' },
  });

  let created = 0;
  let promoted = 0;
  let alreadyFine = 0;
  let nothingToMove = 0;

  for (const lead of leads) {
    const label = `[${lead.leadId || lead.id}] ${(lead.companyName || '—').slice(0, 32).padEnd(32)}`;

    if (lead.contacts.length > 0) {
      if (lead.contacts.some((c) => c.isPrimary)) {
        alreadyFine++;
        continue;
      }
      // Has contacts but none flagged — promote the oldest so there is always exactly one primary.
      const oldest = lead.contacts[0];
      console.log(`${label} promote existing contact to primary`);
      promoted++;
      if (APPLY) {
        await prisma.leadContact.update({ where: { id: oldest.id }, data: { isPrimary: true } });
      }
      continue;
    }

    const name = contactNameFor(lead);
    const hasAnyDetail = name || lead.contactEmail || lead.contactPhone;
    if (!hasAnyDetail || !name) {
      nothingToMove++;
      continue;
    }

    console.log(`${label} create primary contact "${name}"`);
    created++;
    if (APPLY) {
      await prisma.leadContact.create({
        data: {
          leadId: lead.id,
          name,
          designation: lead.jobTitle || null,
          email: lead.contactEmail || null,
          phone: lead.contactPhone || null,
          linkedinUrl: lead.linkedinUrl || null,
          // The flat contact never recorded a role; DECISION_MAKER would be a guess, so leave it
          // for a human. The column is nullable on ClientContact but required here, and
          // CC_ONLY is the neutral "we know they exist, not what they decide" value.
          role: 'CC_ONLY',
          isPrimary: true,
        },
      });
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Leads scanned:                    ${leads.length}`);
  console.log(`Primary contacts to create:       ${created}`);
  console.log(`Existing contacts to promote:     ${promoted}`);
  console.log(`Already have a primary:           ${alreadyFine}`);
  console.log(`No contact data to move:          ${nothingToMove}`);
  console.log(APPLY ? '\n✅ Changes APPLIED.' : '\nℹ️  Dry run — re-run with --apply to write changes.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
