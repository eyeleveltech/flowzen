import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Clear the client-facing business data, and nothing else.
 *
 * For the case this was written for: a production database loaded with
 * companies that turned out to be wrong, where starting the client list again
 * is easier than correcting it — but the organisation, the people who log in
 * and the equipment register must survive untouched.
 *
 * ─── What goes ──────────────────────────────────────────────────────────────
 *
 * Companies, and everything that hangs off one: their contacts, proposals and
 * versions, retainers, month cards, retainer projects, one-off projects,
 * milestones, tasks, invoices, payments and proformas. Plus the costs and
 * people-allocations attached to that work, and the activity and alert rows
 * about it — which are not reached by any foreign key, so they would otherwise
 * be left pointing at records that no longer exist.
 *
 * ─── What stays ─────────────────────────────────────────────────────────────
 *
 * The organisation and every setting on it. Every user, their password and
 * their role. The asset register, its maintenance history and its movements —
 * a camera does not stop existing because a client did. Outreach entries, which
 * are the list of people to approach and sit BEFORE a company exists.
 *
 * Costs that were not attached to a month card or a project also stay: those
 * are overheads and capital purchases, including the ones that bought the
 * assets, and they are the studio's own spending rather than a client's.
 *
 * ─── Why it is one transaction ──────────────────────────────────────────────
 *
 * Half-deleted is worse than either state — a retainer whose company is gone is
 * a row nothing can render. Either all of it goes or none does.
 */

/** Deleting a production database by accident should take more than a typo. */
const CONFIRM = 'DELETE THE BUSINESS DATA';

async function main() {
  const confirm = process.env.CONFIRM ?? '';
  const dryRun = process.env.DRY_RUN === '1';

  const org = await prisma.organization.findFirst({ select: { id: true, name: true } });
  if (!org) {
    console.error('No organisation — nothing to clear.');
    process.exit(1);
  }

  const before = await counts();
  console.log(`Organisation: ${org.name}\n`);
  console.log('What is there now:');
  report(before);

  if (!dryRun && confirm !== CONFIRM) {
    console.error(`\nRefusing to delete anything.`);
    console.error('');
    console.error('This removes every company, proposal, retainer, project, task,');
    console.error('invoice and payment. Users, settings and assets are kept.');
    console.error('');
    console.error('Take a backup, then run it again with:');
    console.error(`  DRY_RUN=1                       to see what would go`);
    console.error(`  CONFIRM="${CONFIRM}"   to actually do it`);
    process.exit(1);
  }

  if (dryRun) {
    console.log('\nDRY RUN — nothing was deleted.');
    await prisma.$disconnect();
    return;
  }

  /*
   * Children before parents.
   *
   * Most of this would cascade from `company.deleteMany` alone, but not all of
   * it: costs and people-allocations point at a month card or a project with
   * SetNull rather than Cascade, so they would survive as rows attached to
   * nothing. Deleting them explicitly, first, is what makes "cleared" true.
   */
  await prisma.$transaction(async (tx) => {
    // Costs and allocations tied to client work. A cost attached to neither a
    // month card nor a project is an overhead — it stays.
    await tx.peopleAllocation.deleteMany({});
    await tx.cost.deleteMany({
      where: { OR: [{ monthCardId: { not: null } }, { projectId: { not: null } }] },
    });

    // The log rows about all of it. These reference their subject by a plain
    // string id, so nothing deletes them for us.
    await tx.activity.deleteMany({
      where: {
        entityType: {
          in: ['Company', 'Proposal', 'Retainer', 'MonthCard', 'Project', 'Task', 'Invoice', 'Proforma'],
        },
      },
    });
    await tx.alertRead.deleteMany({});
    await tx.alert.deleteMany({});

    /*
     * Tasks before anything that owns them.
     *
     * Not for the foreign keys — those cascade — but for a database trigger:
     * `tasks_month_card_needs_project` guards a retainer's default project, and
     * deleting one while it still holds work raises "The default project still
     * holds work, so it cannot be deleted". Cascading from the company hits
     * that trigger rather than going around it.
     *
     * This clears internal tasks too, which belong to no company and nothing
     * else would have reached.
     */
    await tx.task.deleteMany({});

    // And the companies, which take their contacts, proposals, retainers,
    // month cards, retainer projects, projects, milestones, invoices, payments
    // and proformas with them.
    await tx.company.deleteMany({});
  });

  const after = await counts();
  console.log('\nWhat is left:');
  report(after);

  const kept = after.users === before.users && after.assets === before.assets;
  console.log(`\nUsers and assets untouched: ${kept ? 'yes' : 'NO — check by hand'}`);
  await prisma.$disconnect();
}

async function counts() {
  const [
    companies, people, proposals, retainers, monthCards, projects, tasks,
    invoices, payments, proformas, costs, allocations, activities, alerts,
    users, assets, outreach,
  ] = await Promise.all([
    prisma.company.count(), prisma.person.count(), prisma.proposal.count(),
    prisma.retainer.count(), prisma.monthCard.count(), prisma.project.count(),
    prisma.task.count(), prisma.invoice.count(), prisma.payment.count(),
    prisma.proforma.count(), prisma.cost.count(), prisma.peopleAllocation.count(),
    prisma.activity.count(), prisma.alert.count(),
    prisma.user.count(), prisma.asset.count(), prisma.outreachEntry.count(),
  ]);
  return {
    companies, people, proposals, retainers, monthCards, projects, tasks,
    invoices, payments, proformas, costs, allocations, activities, alerts,
    users, assets, outreach,
  };
}

function report(c: Awaited<ReturnType<typeof counts>>) {
  const line = (label: string, n: number) => console.log(`  ${label.padEnd(22)} ${n}`);
  console.log('  — going —');
  line('companies', c.companies);
  line('contacts', c.people);
  line('proposals', c.proposals);
  line('retainers', c.retainers);
  line('month cards', c.monthCards);
  line('projects', c.projects);
  line('tasks', c.tasks);
  line('invoices', c.invoices);
  line('payments', c.payments);
  line('proformas', c.proformas);
  line('allocations', c.allocations);
  console.log('  — kept —');
  line('users', c.users);
  line('assets', c.assets);
  line('outreach entries', c.outreach);
  line('costs (some kept)', c.costs);
  line('activity rows', c.activities);
  line('alerts', c.alerts);
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
