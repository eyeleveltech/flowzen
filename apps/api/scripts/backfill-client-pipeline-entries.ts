/**
 * Backfill: give already-imported clients their pipeline entry.
 *
 * The Pipeline board and the Renewals page are both built from `Lead` rows. Bulk client import
 * used to create only the Client, so every customer onboarded that way was invisible on both —
 * including renewal tracking for retainers. The importer now creates the deal card itself; this
 * repairs the clients imported before that fix.
 *
 * Stage follows the same rule as the importer (clientPipelineEntry.service.ts):
 *   status CHURNED / PROJECT_COMPLETED / ONHOLD  -> that stage
 *   engagementType containing "project"/"one-time" -> ACTIVE_PROJECT
 *   otherwise                                      -> ACTIVE_RETAINER
 *
 * Only touches clients that have NO lead at all, so it is safe to run repeatedly. It never
 * creates contracts, subscriptions or payments — importing history should not mint money rows.
 *
 * Usage:
 *   npx tsx scripts/backfill-client-pipeline-entries.ts           # dry run (prints the plan)
 *   npx tsx scripts/backfill-client-pipeline-entries.ts --apply   # actually write changes
 *   npx tsx scripts/backfill-client-pipeline-entries.ts --org=<id> --apply   # limit to one org
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createPipelineEntryForClient, stageForClient } from '../src/services/clientPipelineEntry.service.js';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const ORG = process.argv.find((a) => a.startsWith('--org='))?.split('=')[1];

async function main() {
  const clients = await prisma.client.findMany({
    where: {
      archivedAt: null,
      name: { not: 'Internal' },
      leads: { none: {} }, // no pipeline entry of any kind yet
      ...(ORG ? { organizationId: ORG } : {}),
    },
    include: { contacts: { orderBy: { createdAt: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  });

  if (clients.length === 0) {
    console.log('Nothing to do — every client already has a pipeline entry.');
    return;
  }

  // Per-org phone sets, so the backfill can't hand the same number to two leads
  // (Lead.contactPhone is unique per organization).
  const phonesByOrg = new Map<string, Set<string>>();
  for (const orgId of new Set(clients.map((c) => c.organizationId))) {
    const rows = await prisma.lead.findMany({
      where: { organizationId: orgId, contactPhone: { not: null } },
      select: { contactPhone: true },
    });
    phonesByOrg.set(orgId, new Set(rows.map((r) => (r.contactPhone || '').trim()).filter(Boolean)));
  }

  // Stage history needs a real user; use the org's first active admin.
  const adminByOrg = new Map<string, string | null>();
  for (const orgId of phonesByOrg.keys()) {
    const admin = await prisma.user.findFirst({
      where: { organizationId: orgId, status: 'ACTIVE', role: { in: ['SUPER_ADMIN', 'ADMIN'] } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    adminByOrg.set(orgId, admin?.id ?? null);
  }

  const byStage: Record<string, number> = {};
  let created = 0;
  let failed = 0;

  for (const client of clients) {
    const stage = stageForClient(client.status, client.engagementType);
    byStage[stage] = (byStage[stage] || 0) + 1;

    console.log(
      `[${client.id}] ${client.name.padEnd(38).slice(0, 38)} ` +
      `status=${String(client.status).padEnd(18)} engagement=${String(client.engagementType || '—').padEnd(24).slice(0, 24)} -> ${stage}`
    );

    if (!APPLY) continue;

    try {
      const entry = await createPipelineEntryForClient(prisma, client, {
        takenPhones: phonesByOrg.get(client.organizationId),
        changedById: adminByOrg.get(client.organizationId) ?? null,
      });
      if (entry) created++;
    } catch (e: any) {
      failed++;
      console.error(`   ⚠ failed: ${e?.message || e}`);
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Clients without a pipeline entry: ${clients.length}`);
  for (const [stage, n] of Object.entries(byStage).sort()) {
    console.log(`  ${stage.padEnd(20)} ${n}`);
  }
  if (APPLY) {
    console.log(`\nCreated: ${created}${failed ? `   Failed: ${failed}` : ''}`);
    console.log('✅ Changes APPLIED.');
  } else {
    console.log('\nℹ️  Dry run — re-run with --apply to write changes.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
