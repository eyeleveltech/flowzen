/**
 * Sales next step plan — after the `sales_next_step` migration: which open
 * deals and active leads have only an import-time date as their last touch,
 * so they can be corrected with "Set last contact date" (one by one, or in
 * bulk on the outreach list and the proposals list).
 *
 * Read-only. Run it on a copy of production first, and on production after:
 *
 *   npx tsx prisma/sales-touch-report.ts
 *
 *   · A deal counts as "import-time only" when nothing has touched it since it
 *     was created: no last touch at all, or one within ten minutes of the
 *     deal's own creation (the version, the activity row and the deal itself
 *     were all written in the same import).
 *   · A lead counts when no status change was ever recorded: its last touch is
 *     empty, so it counts from the day it was added.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TEN_MINUTES = 10 * 60 * 1000;
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—');

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true, dealStaleDays: true, outreachStaleDays: true } });
  for (const org of orgs) {
    const [deals, leads] = await Promise.all([
      prisma.proposal.findMany({
        where: { organizationId: org.id, deletedAt: null, outcome: null },
        select: {
          id: true,
          stage: true,
          createdAt: true,
          lastTouchedAt: true,
          nextStep: true,
          company: { select: { name: true } },
          owner: { select: { name: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.outreachEntry.findMany({
        where: {
          organizationId: org.id,
          deletedAt: null,
          promotedCompanyId: null,
          status: { in: ['FOLLOW_UP', 'MEETING', 'INTERESTED'] },
        },
        select: { id: true, name: true, status: true, importedAt: true, lastTouchedAt: true, nextStep: true, owner: { select: { name: true } } },
        orderBy: { importedAt: 'asc' },
      }),
    ]);

    const importOnlyDeals = deals.filter(
      (d) => !d.lastTouchedAt || Math.abs(d.lastTouchedAt.getTime() - d.createdAt.getTime()) <= TEN_MINUTES,
    );
    const untouchedLeads = leads.filter((l) => !l.lastTouchedAt);

    console.log(`\n${org.name} — deals go stale after ${org.dealStaleDays} days, leads after ${org.outreachStaleDays}`);
    console.log(`  Open deals: ${deals.length}. Last touch is only the import/creation date: ${importOnlyDeals.length}. No next step: ${deals.filter((d) => !d.nextStep).length}.`);
    for (const d of importOnlyDeals) {
      console.log(`    ${d.company.name} — ${d.stage}, owner ${d.owner.name}, created ${day(d.createdAt)}, last touch ${day(d.lastTouchedAt)}`);
    }
    console.log(`  Active leads: ${leads.length}. No status change ever recorded (counts from the day added): ${untouchedLeads.length}. No next step: ${leads.filter((l) => !l.nextStep).length}.`);
    for (const l of untouchedLeads) {
      console.log(`    ${l.name} — ${l.status}, owner ${l.owner?.name ?? 'nobody'}, added ${day(l.importedAt)}`);
    }
  }
  console.log('\nCorrect these with "Set last contact date" — on a deal card, an outreach row, or several at once from the list.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
