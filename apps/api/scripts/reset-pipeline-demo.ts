/**
 * Reset the CRM pipeline to a clean, realistic demo state.
 *
 * Two jobs, run together:
 *   1. CLEANUP — removes the "Acme Conversion Test …" rows left behind by the e2e
 *      regression suite (their leads, the auto-created test clients, and the test quotes).
 *   2. SEED — inserts a realistic set of leads spread across the pre-conversion pipeline
 *      stages (New Lead → Negotiation), so the Pipeline board shows data the same way the
 *      Clients page does.
 *
 * Why only pre-conversion stages? The model rule is "a Client is born only when a deal is
 * won." Seeding a lead straight into a won stage (CONTRACT/ACTIVE_*) would create a won deal
 * with no Client behind it — an inconsistent state. To see the "Won & Closed" column fill up,
 * win one of these seeded leads through the UI: that runs the real conversion and creates the
 * account. (Your existing TechVenture / GreenLeaf / FinanceFlow clients were seeded directly
 * as accounts and correctly have no pipeline card.)
 *
 * Safe to run repeatedly: cleanup only matches the test rows; seed skips any lead whose
 * companyName already exists in the org.
 *
 * Usage:
 *   npx tsx scripts/reset-pipeline-demo.ts            # dry run — prints what it WOULD do
 *   npx tsx scripts/reset-pipeline-demo.ts --apply    # actually write changes
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

// Same format + atomic counter as src/utils/leadId.ts (FL-YYYYMM-XXXXXX, sequential per org/month).
async function generateLeadId(organizationId: string): Promise<string> {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const rows = await prisma.$queryRaw<{ counter: number }[]>`
    INSERT INTO "lead_id_counters" ("id", "organizationId", "yearMonth", "counter")
    VALUES (gen_random_uuid()::text, ${organizationId}, ${yearMonth}, 1)
    ON CONFLICT ("organizationId", "yearMonth")
    DO UPDATE SET "counter" = "lead_id_counters"."counter" + 1
    RETURNING "counter";
  `;
  return `FL-${yearMonth}-${String(rows[0].counter).padStart(6, '0')}`;
}

// A believable agency sales pipeline. Every stage here is PRE-conversion.
const DEMO_LEADS = [
  { companyName: 'Brightline Retail',      contactName: 'Priya Sharma',   jobTitle: 'Marketing Head',     industry: 'Retail',        city: 'Mumbai',    stage: 'NEW_LEAD',    priority: 'MEDIUM', source: 'INBOUND', dealValue: 120000 },
  { companyName: 'Nimbus Cloud Services',  contactName: 'Arjun Mehta',    jobTitle: 'CTO',                industry: 'SaaS',          city: 'Bengaluru', stage: 'NEW_LEAD',    priority: 'HIGH',   source: 'REFERRAL', dealValue: 350000 },
  { companyName: 'Coastal Foods Pvt Ltd',  contactName: 'Ritu Nair',      jobTitle: 'Founder',            industry: 'FMCG',          city: 'Kochi',     stage: 'OUTREACH',    priority: 'MEDIUM', source: 'MANUAL',   dealValue: 90000 },
  { companyName: 'Vertex Fitness',         contactName: 'Sameer Khan',    jobTitle: 'Owner',              industry: 'Fitness',       city: 'Pune',      stage: 'OUTREACH',    priority: 'LOW',    source: 'INBOUND',  dealValue: 60000 },
  { companyName: 'Aurora Interiors',       contactName: 'Neha Kulkarni',  jobTitle: 'Creative Director',  industry: 'Interior Design', city: 'Mumbai',  stage: 'MEETING',     priority: 'HIGH',   source: 'REFERRAL', dealValue: 210000 },
  { companyName: 'PeakPay Fintech',        contactName: 'Rohan Desai',    jobTitle: 'Head of Growth',     industry: 'Fintech',       city: 'Gurugram',  stage: 'MEETING',     priority: 'HIGH',   source: 'INBOUND',  dealValue: 480000 },
  { companyName: 'GreenSprout Nurseries',  contactName: 'Ananya Rao',     jobTitle: 'Director',           industry: 'Agriculture',   city: 'Hyderabad', stage: 'PROPOSAL',    priority: 'MEDIUM', source: 'MANUAL',   dealValue: 145000 },
  { companyName: 'Metro Logistics',        contactName: 'Vikram Singh',   jobTitle: 'VP Operations',      industry: 'Logistics',     city: 'Delhi',     stage: 'PROPOSAL',    priority: 'HIGH',   source: 'REFERRAL', dealValue: 620000 },
  { companyName: 'Lumina Jewels',          contactName: 'Isha Kapoor',    jobTitle: 'Managing Partner',   industry: 'Jewellery',     city: 'Jaipur',    stage: 'NEGOTIATION', priority: 'HIGH',   source: 'INBOUND',  dealValue: 275000 },
  { companyName: 'Skyward Travels',        contactName: 'Karan Malhotra', jobTitle: 'CEO',                industry: 'Travel',        city: 'Chandigarh',stage: 'NEGOTIATION', priority: 'MEDIUM', source: 'REFERRAL', dealValue: 190000 },
] as const;

async function main() {
  console.log(`=== reset-pipeline-demo (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);

  const org = await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true } });
  if (!org) { console.log('No organization found. Aborting.'); return; }
  console.log(`Organization: ${org.name} (${org.id})\n`);

  // Pick an owner to assign leads to (first admin, else any user).
  const owner = await prisma.user.findFirst({
    where: { organizationId: org.id, role: { in: ['SUPER_ADMIN', 'ADMIN'] } },
    orderBy: { createdAt: 'asc' }, select: { id: true, name: true },
  }) || await prisma.user.findFirst({ where: { organizationId: org.id }, select: { id: true, name: true } });
  console.log(`Assigning seeded leads to: ${owner?.name ?? '(unassigned)'}\n`);

  // ---------- 1. CLEANUP ----------
  const testLeads = await prisma.lead.findMany({ where: { organizationId: org.id, companyName: { startsWith: 'Acme Conversion Test' } }, select: { id: true } });
  const testClients = await prisma.client.findMany({ where: { organizationId: org.id, name: { startsWith: 'Acme Conversion Test' } }, select: { id: true } });
  const leadIds = testLeads.map(l => l.id);
  const clientIds = testClients.map(c => c.id);
  const testQuotes = await prisma.quoteDocument.count({ where: { OR: [{ leadId: { in: leadIds } }, { clientId: { in: clientIds } }] } });
  console.log(`CLEANUP: ${testLeads.length} test lead(s), ${testClients.length} test client(s), ${testQuotes} test quote(s)`);
  console.log('         (deleting the leads cascades their tasks / stage-history / contacts)\n');

  if (APPLY && (leadIds.length || clientIds.length)) {
    const revWhere = { OR: [{ sourceLeadId: { in: leadIds } }, { clientId: { in: clientIds } }] };
    await prisma.$transaction(async (tx) => {
      await tx.quoteDocument.deleteMany({ where: { OR: [{ leadId: { in: leadIds } }, { clientId: { in: clientIds } }] } });
      // Revenue records auto-created from these leads must go BEFORE the client — contracts /
      // subscriptions / payments have RESTRICT FKs to Client, so the client delete would fail
      // otherwise. Payments hang off contracts, so they go first.
      await tx.payment.deleteMany({ where: { clientId: { in: clientIds } } });
      await tx.subscription.deleteMany({ where: revWhere });
      await tx.contract.deleteMany({ where: revWhere });
      await tx.lead.deleteMany({ where: { id: { in: leadIds } } });     // cascades tasks, stageHistory, leadContacts
      await tx.client.deleteMany({ where: { id: { in: clientIds } } }); // cascades clientContacts
    });
    console.log('  ✓ deleted.\n');
  }

  // ---------- 2. SEED ----------
  console.log(`SEED: ${DEMO_LEADS.length} realistic lead(s) across NEW_LEAD → NEGOTIATION`);
  let created = 0, skipped = 0;
  for (const d of DEMO_LEADS) {
    const exists = await prisma.lead.findFirst({ where: { organizationId: org.id, companyName: d.companyName }, select: { id: true } });
    if (exists) { skipped++; console.log(`  - skip (exists): ${d.companyName}`); continue; }
    if (!APPLY) { created++; console.log(`  + would create: ${d.companyName.padEnd(24)} [${d.stage}]  ₹${d.dealValue.toLocaleString('en-IN')}`); continue; }

    const leadId = await generateLeadId(org.id);
    await prisma.lead.create({
      data: {
        leadId,
        organizationId: org.id,
        stage: d.stage as any,
        priority: d.priority as any,
        source: d.source as any,
        assignedToId: owner?.id ?? null,
        companyName: d.companyName,
        contactName: d.contactName,
        contactEmail: `${d.contactName.split(' ')[0].toLowerCase()}@${d.companyName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
        contactPhone: null,
        jobTitle: d.jobTitle,
        industry: d.industry,
        city: d.city,
        country: 'India',
        dealValue: d.dealValue,
        expectedCloseDate: null,
      },
    });
    created++;
    console.log(`  + created: ${leadId}  ${d.companyName.padEnd(24)} [${d.stage}]`);
  }

  console.log(`\nSEED result: ${created} ${APPLY ? 'created' : 'would create'}, ${skipped} skipped.`);
  console.log(`\n${APPLY ? '✓ Done.' : 'Dry run only — re-run with --apply to write changes.'}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
