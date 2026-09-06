/**
 * The win → project handoff, proved against the real database.
 *
 * Not a unit test: `winDeal` is one transaction across five tables, and the thing
 * worth proving is that the project comes out carrying what was typed on the win
 * form — not that a mock was called. Mocks would have agreed with any version of
 * this code, including a wrong one.
 *
 * Creates its own throwaway company and deals, and deletes everything it made.
 * Run: npx tsx test/win-handoff.check.ts
 */

import { prisma } from '../src/lib/prisma.js';
import { winDeal } from '../src/services/deal.service.js';

const STAMP = `zz-handoff-check-${Date.now()}`;
let failures = 0;

const check = (label: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok || !detail ? '' : `  — ${detail}`}`);
  if (!ok) failures++;
};

const run = async () => {
  const org = await prisma.organization.findFirstOrThrow({ select: { id: true } });
  const user = await prisma.user.findFirstOrThrow({
    where: { organizationId: org.id },
    select: { id: true },
  });
  const firstStage = await prisma.stage.findFirstOrThrow({
    where: { pipeline: { organizationId: org.id, isDefault: true }, kind: 'OPEN', archivedAt: null },
    orderBy: { position: 'asc' },
    select: { id: true },
  });

  const company = await prisma.company.create({
    data: { organizationId: org.id, name: STAMP, status: 'PROSPECT' },
    select: { id: true },
  });

  const madeDeals: string[] = [];

  const newDeal = async (title: string) => {
    const d = await prisma.deal.create({
      data: {
        organizationId: org.id,
        companyId: company.id,
        title,
        stageId: firstStage.id,
        value: 400000,
        expectedCloseDate: new Date('2026-09-05'),
        ownerId: user.id,
      },
      select: { id: true },
    });
    madeDeals.push(d.id);
    return d.id;
  };

  try {
    // ── A one-off project ────────────────────────────────────────────────────
    const oneOff = await newDeal(`${STAMP} one-off`);
    const start = new Date('2026-09-01');
    const end = new Date('2026-10-15');

    const won = await winDeal(
      oneOff,
      {
        contractType: 'PROJECT',
        startDate: start,
        endDate: end,
        amount: 400000,
        billingFrequency: 'ONE_TIME',
        project: { name: 'Acme website redesign' },
      },
      user.id,
    );

    check('the win returns the project it created', Boolean(won.projectId));

    const p = await prisma.project.findUniqueOrThrow({ where: { id: won.projectId! } });
    check('the project points back at the deal', p.dealId === oneOff, String(p.dealId));
    check('it belongs to the same client', p.companyId === company.id);
    check('the budget is the amount that was agreed', p.budget?.toString() === '400000');
    check('a one-off is typed ONE_TIME', p.type === 'ONE_TIME', String(p.type));
    check('it starts when billing starts', p.startDate?.getTime() === start.getTime());
    check('a one-off carries its delivery date', p.dueDate?.getTime() === end.getTime());
    check('it starts in PLANNING', p.status === 'PLANNING', String(p.status));
    check('the deal owner leads it by default', p.ownerId === user.id);

    // The whole point of the column: expenses now have something to measure against.
    const expense = await prisma.expense.create({
      data: {
        organizationId: org.id,
        projectId: p.id,
        companyId: company.id,
        amount: 150000,
        currency: 'INR',
        date: new Date('2026-09-10'),
        description: STAMP,
      },
      select: { id: true },
    });
    const { _sum } = await prisma.expense.aggregate({
      where: { projectId: p.id },
      _sum: { amount: true },
    });
    check(
      'budget minus expenses is a real margin',
      p.budget!.minus(_sum.amount!).toString() === '250000',
      p.budget!.minus(_sum.amount ?? 0).toString(),
    );
    await prisma.expense.delete({ where: { id: expense.id } });

    // ── A retainer ───────────────────────────────────────────────────────────
    const retainer = await newDeal(`${STAMP} retainer`);
    const won2 = await winDeal(
      retainer,
      {
        contractType: 'RETAINER',
        startDate: start,
        endDate: null,
        amount: 75000,
        billingFrequency: 'MONTHLY',
        project: { name: 'Acme social media' },
      },
      user.id,
    );
    const r = await prisma.project.findUniqueOrThrow({ where: { id: won2.projectId! } });
    check('a retainer is typed RETAINER', r.type === 'RETAINER', String(r.type));
    check(
      'a rolling retainer gets NO delivery date — inventing one invents a deadline',
      r.dueDate === null,
      String(r.dueDate),
    );
    check('the monthly amount is its budget', r.budget?.toString() === '75000');

    // ── Winning without one ──────────────────────────────────────────────────
    const bare = await newDeal(`${STAMP} no project`);
    const won3 = await winDeal(
      bare,
      {
        contractType: 'PROJECT',
        startDate: start,
        endDate: end,
        amount: 50000,
        billingFrequency: 'ONE_TIME',
      },
      user.id,
    );
    check('a win with no project asked for creates none', won3.projectId === null);
    check('and still creates the engagement', Boolean(won3.engagementId));

    check('the client is now ACTIVE', won3.companyStatus === 'ACTIVE', won3.companyStatus);
  } finally {
    // Ordered so nothing is orphaned, even if an assertion above threw.
    await prisma.expense.deleteMany({ where: { companyId: company.id } });
    await prisma.project.deleteMany({ where: { companyId: company.id } });
    await prisma.engagementRevision.deleteMany({
      where: { engagement: { companyId: company.id } },
    });
    await prisma.invoice.deleteMany({ where: { companyId: company.id } });
    await prisma.engagement.deleteMany({ where: { companyId: company.id } });
    await prisma.activity.deleteMany({ where: { companyId: company.id } });
    await prisma.task.deleteMany({ where: { dealId: { in: madeDeals } } });
    await prisma.stageHistory.deleteMany({ where: { dealId: { in: madeDeals } } });
    await prisma.deal.deleteMany({ where: { companyId: company.id } });
    await prisma.company.delete({ where: { id: company.id } });

    const left = await prisma.company.count({ where: { name: STAMP } });
    check('cleaned up after itself', left === 0);
    await prisma.$disconnect();
  }

  console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
