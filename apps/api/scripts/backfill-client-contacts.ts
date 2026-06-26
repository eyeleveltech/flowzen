/**
 * One-time backfill for the lead→client conversion bug (Clients_Module_Audit C1).
 *
 * Old conversion logic stored the *contact person* in `client.name` and usually
 * created no `client_contacts` row. This script repairs already-converted clients
 * (those linked from a Lead via `lead.clientId`) by:
 *   1. renaming the account to the company name when the name currently holds the
 *      person (and a company name exists, and it won't collide with another client);
 *   2. creating a contact row from the lead's person when the client has none.
 *
 * Safe to run repeatedly — it only touches rows that still need fixing.
 *
 * Usage:
 *   npx tsx scripts/backfill-client-contacts.ts          # dry run (prints what it WOULD do)
 *   npx tsx scripts/backfill-client-contacts.ts --apply   # actually write changes
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  const leads = await prisma.lead.findMany({
    where: { clientId: { not: null } },
    select: {
      id: true,
      contactName: true,
      companyName: true,
      contactEmail: true,
      contactPhone: true,
      jobTitle: true,
      client: { select: { id: true, name: true, organizationId: true, contacts: { select: { id: true } } } },
    },
  });

  let renamed = 0;
  let contactsAdded = 0;
  let renameSkippedCollision = 0;
  let untouched = 0;

  for (const lead of leads) {
    const client = lead.client;
    if (!client || client.name === 'Internal') continue;

    const ops: string[] = [];
    const data: { name?: string; contacts?: any } = {};

    // 1. Rename: only when the name still holds the person and a company exists.
    const holdsPerson = !!lead.contactName && client.name === lead.contactName;
    const hasCompany = !!lead.companyName && lead.companyName !== lead.contactName;
    if (holdsPerson && hasCompany) {
      const collision = await prisma.client.findFirst({
        where: {
          organizationId: client.organizationId,
          name: { equals: lead.companyName!, mode: 'insensitive' },
          id: { not: client.id },
        },
        select: { id: true },
      });
      if (collision) {
        renameSkippedCollision++;
        ops.push(`rename SKIPPED (a client named "${lead.companyName}" already exists — needs manual merge)`);
      } else {
        data.name = lead.companyName!;
        ops.push(`rename "${client.name}" -> "${lead.companyName}"`);
        renamed++;
      }
    }

    // 2. Create a contact from the lead's person when the client has none.
    if (client.contacts.length === 0 && lead.contactName) {
      data.contacts = {
        create: {
          name: lead.contactName,
          designation: lead.jobTitle || null,
          email: lead.contactEmail || null,
          phone: lead.contactPhone || null,
        },
      };
      ops.push(`add contact "${lead.contactName}"`);
      contactsAdded++;
    }

    if (!data.name && !data.contacts) {
      untouched++;
      continue;
    }

    console.log(`[${client.id}] ${ops.join('; ')}`);
    if (APPLY) {
      await prisma.client.update({ where: { id: client.id }, data });
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Linked clients scanned:      ${leads.length}`);
  console.log(`Names to rename:             ${renamed}`);
  console.log(`Renames skipped (collision): ${renameSkippedCollision}`);
  console.log(`Contacts to add:             ${contactsAdded}`);
  console.log(`Already correct (untouched): ${untouched}`);
  console.log(APPLY ? '\n✅ Changes APPLIED.' : '\nℹ️  Dry run — re-run with --apply to write changes.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
