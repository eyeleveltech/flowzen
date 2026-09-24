import { test as teardown } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { MARK } from './helpers';

/**
 * Removes the rows these specs created — properly, not by soft-deleting them.
 *
 * ─── Why the API cannot do this ─────────────────────────────────────────────
 *
 * §16 of the brief: "Soft delete only. Nothing is ever hard deleted by a user."
 * That is right for the product and useless for a test suite: calling
 * DELETE /proposals/:id leaves the row in the bin, so after a few runs the
 * Trash tab is full of probe records and the specs that count what is in there
 * start failing on their own litter. The first version of this suite did
 * exactly that and left seventeen behind.
 *
 * A test harness is not a user. This talks to the database directly and removes
 * only rows carrying the marker, which no real record contains.
 *
 * ─── Deliberately narrow ────────────────────────────────────────────────────
 *
 * Every delete below is keyed on MARK. Nothing here can touch a real proposal,
 * a real task or anything else, however badly a spec fails partway through.
 */

teardown('remove everything the specs created', async () => {
  const db = new PrismaClient();
  try {
    const versions = await db.proposalVersion.findMany({
      where: { scopeSummary: { contains: MARK } },
      select: { proposalId: true },
    });
    const proposalIds = [...new Set(versions.map((v) => v.proposalId))];

    if (proposalIds.length > 0) {
      // Activity rows reference the proposal by a polymorphic id, so they are
      // matched on that rather than removed by a cascade.
      await db.activity.deleteMany({ where: { entityId: { in: proposalIds } } });
      await db.proposalVersion.deleteMany({ where: { proposalId: { in: proposalIds } } });
      await db.proposal.deleteMany({ where: { id: { in: proposalIds } } });
    }

    const tasks = await db.task.findMany({ where: { title: { contains: MARK } }, select: { id: true } });
    const taskIds = tasks.map((t) => t.id);
    if (taskIds.length > 0) {
      await db.taskAssignee.deleteMany({ where: { taskId: { in: taskIds } } });
      await db.activity.deleteMany({ where: { entityId: { in: taskIds } } });
      await db.task.deleteMany({ where: { id: { in: taskIds } } });
    }

    /*
     * Companies and the outreach leads they were promoted from.
     *
     * Not cleaned before, because nothing created one: the specs made proposals
     * and tasks against companies the seed already had. The Prospect-stage spec
     * promotes a lead, which creates BOTH — and a company left behind is worse
     * than a stray task, because the next run's duplicate check sees it and
     * skips the row the spec is about to assert on.
     *
     * Children first: a promoted company owns its contact, its deal and the
     * activity rows about it.
     */
    const companies = await db.company.findMany({ where: { name: { contains: MARK } }, select: { id: true } });
    const companyIds = companies.map((c) => c.id);
    if (companyIds.length > 0) {
      await db.proposal.deleteMany({ where: { companyId: { in: companyIds } } });
      await db.person.deleteMany({ where: { companyId: { in: companyIds } } });
      await db.activity.deleteMany({ where: { entityId: { in: companyIds } } });
      await db.outreachEntry.deleteMany({ where: { promotedCompanyId: { in: companyIds } } });
      await db.company.deleteMany({ where: { id: { in: companyIds } } });
    }
    await db.outreachEntry.deleteMany({ where: { name: { contains: MARK } } });

    const left = (await db.proposalVersion.count({ where: { scopeSummary: { contains: MARK } } }))
      + (await db.company.count({ where: { name: { contains: MARK } } }))
      + (await db.outreachEntry.count({ where: { name: { contains: MARK } } }));
    // eslint-disable-next-line no-console
    console.log(
      `\n[purge] removed ${proposalIds.length} proposal(s), ${taskIds.length} task(s) and `
        + `${companyIds.length} company/companies; ${left} marked row(s) left.`,
    );
    if (left > 0) throw new Error(`purge left ${left} marked rows behind`);
  } finally {
    await db.$disconnect();
  }
});
