/**
 * Remove pre-fix "phantom" CRM revenue records.
 *
 * Before the stage-service unification, the CRM auto-created subscriptions/contracts that were
 * (a) not linked to their lead (sourceLeadId NULL) and (b) sometimes created with amount 0 when
 * a deal was moved to Active before its value was set. Those stray rows show up as bogus "active
 * subscriptions / contracts" on a client's revenue.
 *
 * This deletes ONLY auto-created rows from the old code path — identified by the old note text
 * ("... Won & Closed gate") or by being CRM-auto-created with NO sourceLeadId. It never touches
 * a manually-created contract/subscription, and never touches the new (post-fix) rows, which all
 * carry a sourceLeadId.
 *
 * Safe to run repeatedly.
 *
 * Usage:
 *   npx tsx scripts/cleanup-stray-revenue.ts            # dry run — prints what it WOULD delete
 *   npx tsx scripts/cleanup-stray-revenue.ts --apply    # actually delete
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

// Matches pre-fix auto-created rows only: the old note text, or CRM-auto with no lead link.
const strayWhere = {
  OR: [
    { notes: { contains: 'Won & Closed' } },
    { AND: [{ sourceLeadId: null }, { notes: { contains: 'Auto-created from CRM' } }] },
  ],
};

async function main() {
  console.log(`=== cleanup-stray-revenue (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);

  const subs = await prisma.subscription.findMany({
    where: strayWhere as any,
    select: { id: true, amount: true, notes: true, client: { select: { name: true } } },
  });
  const cons = await prisma.contract.findMany({
    where: strayWhere as any,
    select: { id: true, value: true, notes: true, client: { select: { name: true } } },
  });

  console.log(`Stray subscriptions: ${subs.length}`);
  for (const s of subs) console.log(`  ₹${s.amount}  ${s.client?.name}  — "${s.notes}"`);
  console.log(`Stray contracts: ${cons.length}`);
  for (const c of cons) console.log(`  ₹${c.value}  ${c.client?.name}  — "${c.notes}"`);

  if (!subs.length && !cons.length) {
    console.log('\nNothing to clean — revenue is already tidy. ✓');
    return;
  }

  if (APPLY) {
    // Payments hang off contracts (RESTRICT), so clear any first, then the stray rows.
    const conIds = cons.map((c) => c.id);
    await prisma.$transaction(async (tx) => {
      if (conIds.length) await tx.payment.deleteMany({ where: { contractId: { in: conIds } } });
      await tx.subscription.deleteMany({ where: { id: { in: subs.map((s) => s.id) } } });
      await tx.contract.deleteMany({ where: { id: { in: conIds } } });
    });
    console.log(`\n✓ Deleted ${subs.length} subscription(s) and ${cons.length} contract(s).`);
  } else {
    console.log('\nDry run only — re-run with --apply to delete.');
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
