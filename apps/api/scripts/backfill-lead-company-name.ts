/**
 * Backfill: give every lead a company name.
 *
 * The lead's identity became the COMPANY (companyName is now required on create; contactName is
 * optional). Leads captured under the old person-first rule can have no company at all, which
 * would leave them un-editable through a form that now requires one.
 *
 * Fills the gap from the best evidence available, in order:
 *   1. the linked client's company/name  (the account it became — authoritative)
 *   2. the contact person's name         (a sole trader really is the company)
 * A lead with neither is reported and left alone; nothing is invented.
 *
 * Safe to run repeatedly — only touches leads whose companyName is still empty.
 *
 * Usage:
 *   npx tsx scripts/backfill-lead-company-name.ts           # dry run (prints the plan)
 *   npx tsx scripts/backfill-lead-company-name.ts --apply   # write changes
 *   npx tsx scripts/backfill-lead-company-name.ts --org=<id> --apply
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const ORG = process.argv.find((a) => a.startsWith('--org='))?.split('=')[1];

async function main() {
  const leads = await prisma.lead.findMany({
    where: {
      OR: [{ companyName: null }, { companyName: '' }],
      ...(ORG ? { organizationId: ORG } : {}),
    },
    select: {
      id: true, leadId: true, contactName: true, stage: true,
      client: { select: { company: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (leads.length === 0) {
    console.log('Nothing to do — every lead already has a company name.');
    return;
  }

  let filled = 0;
  const unresolved: string[] = [];

  for (const lead of leads) {
    const fromClient = (lead.client?.company || lead.client?.name || '').trim();
    const fromContact = (lead.contactName || '').trim();
    const source = fromClient ? 'client account' : fromContact ? 'contact name' : null;
    const value = fromClient || fromContact;

    if (!value || value.length < 2) {
      unresolved.push(lead.leadId || lead.id);
      console.log(`[${lead.leadId || lead.id}] NO SOURCE — needs a company name by hand (stage ${lead.stage})`);
      continue;
    }

    console.log(`[${lead.leadId || lead.id}] companyName <- "${value}"  (from ${source})`);
    filled++;
    if (APPLY) {
      await prisma.lead.update({ where: { id: lead.id }, data: { companyName: value } });
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Leads missing a company name: ${leads.length}`);
  console.log(`Fillable from existing data:  ${filled}`);
  console.log(`Need manual attention:        ${unresolved.length}${unresolved.length ? ` (${unresolved.join(', ')})` : ''}`);
  console.log(APPLY ? '\n✅ Changes APPLIED.' : '\nℹ️  Dry run — re-run with --apply to write changes.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
