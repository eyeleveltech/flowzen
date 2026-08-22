/**
 * The whole journey, against the real database.
 *
 * Not a unit test — this drives the actual services end to end, the way the audit
 * that found the original bugs drove the real HTTP API rather than reading code
 * and guessing.
 *
 *   npx tsx test/journey.ts
 *
 * It cleans up after itself.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';
import { moveDealToStage, winDeal, DealRuleError, holdDeal, unholdDeal } from '../src/services/deal.service.js';
import { calculateMrr, changeTerms, endEngagement, monthlyValue } from '../src/services/engagement.service.js';
import { raiseInvoiceForEngagement, recordPayment, revenueSummary, isOverdue } from '../src/services/invoice.service.js';
import { syncCompanyStatus } from '../src/services/companyStatus.js';
import { createQuote, markSent, acceptQuote } from '../src/services/quote.service.js';

let pass = 0;
let fail = 0;

const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = String(actual) === String(expected);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  — expected ${expected}, got ${actual}`}`);
};

const rejects = async (label: string, fn: () => Promise<unknown>, match?: RegExp) => {
  try {
    await fn();
    fail++;
    console.log(`  FAIL  ${label} — was ALLOWED`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (match && !match.test(msg)) {
      fail++;
      console.log(`  FAIL  ${label} — wrong error: ${msg}`);
    } else {
      pass++;
      console.log(`  ok    ${label}`);
    }
  }
};

const heading = (s: string) => console.log(`\n${s}\n${'─'.repeat(s.length)}`);

async function main() {
  const org = await prisma.organization.findFirstOrThrow();
  const user = await prisma.user.findFirstOrThrow();

  // Measure the change this journey causes rather than the organisation's totals.
  // Asserting on absolutes only works in an empty database, which is never the
  // case for long — and a test that fails because unrelated data exists is one
  // people learn to ignore.
  const baselineMrr = await calculateMrr(org.id);
  const stages = await prisma.stage.findMany({
    where: { pipeline: { organizationId: org.id, isDefault: true } },
    orderBy: { position: 'asc' },
  });
  const byName = (n: string) => stages.find((s) => s.name === n)!;

  const created: { companies: string[] } = { companies: [] };

  // ── A company arrives ──────────────────────────────────────────────────────
  heading('1 · A company arrives');

  const company = await prisma.company.create({
    data: { organizationId: org.id, name: 'Zomato (journey test)', state: 'Karnataka', ownerId: user.id },
  });
  created.companies.push(company.id);
  check('starts as a prospect', company.status, 'PROSPECT');

  const deal = await prisma.deal.create({
    data: {
      organizationId: org.id,
      companyId: company.id,
      title: 'Social media retainer',
      stageId: byName('New Lead').id,
      ownerId: user.id,
    },
  });

  // ── The deal is worked ─────────────────────────────────────────────────────
  heading('2 · Working the deal');

  await moveDealToStage(deal.id, byName('Meeting').id, user.id);
  check('moved to Meeting', (await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).stageId, byName('Meeting').id);

  await moveDealToStage(deal.id, byName('Proposal').id, user.id);
  await moveDealToStage(deal.id, byName('Meeting').id, user.id);
  console.log('  ok    can be dragged backwards — real deals go sideways');
  pass++;

  await rejects(
    'blocked from Negotiation with no value or close date',
    () => moveDealToStage(deal.id, byName('Negotiation').id, user.id),
    /needs a value/i,
  );

  await prisma.deal.update({
    where: { id: deal.id },
    data: { value: new Prisma.Decimal(40000), expectedCloseDate: new Date('2026-09-30') },
  });
  await moveDealToStage(deal.id, byName('Negotiation').id, user.id);
  console.log('  ok    allowed once both are present');
  pass++;

  await holdDeal(deal.id, 'Waiting on their budget cycle', user.id);
  const held = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
  check('parked without losing its column', held.stageId, byName('Negotiation').id);
  check('and is flagged as held', held.isOnHold, true);
  await unholdDeal(deal.id, user.id);

  // ── The quotation ──────────────────────────────────────────────────────────
  heading('3 · Quoting, and the answer coming back');

  const quote = await createQuote(
    {
      organizationId: org.id,
      dealId: deal.id,
      engagementType: 'RETAINER',
      billingFrequency: 'MONTHLY',
      paymentTerms: 'MONTHLY',
      taxRatePercent: 18,
      // 2 x 25,000 less 20% = 40,000. Chosen so the discount actually bites —
      // an undiscounted line would pass even if the discount were ignored.
      lines: [{ description: 'Social media retainer', quantity: 2, rate: 25000, discountPercent: 20 }],
    },
    user.id,
  );

  check('numbered from the organisation, not a constant', quote.number.startsWith(`${org.documentPrefix}/QT/`), 'true');
  check('the server did the arithmetic', quote.subtotal.toString(), '40000');
  // The company is in Karnataka and the organisation in Tamil Nadu, so this is
  // interstate — IGST, decided by the two states rather than by a dropdown.
  check('interstate, so IGST', quote.igst.toString(), '7200');
  check('and no CGST', quote.cgst.toString(), '0');
  check('total frozen onto the document', quote.total.toString(), '47200');

  const quotedDeal = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
  check("the deal's value follows the quote", quotedDeal.value?.toString(), '47200');

  await markSent(quote.id, user.id, 'MANUAL_EMAIL', new Date('2026-08-10'));
  const sent = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
  check('a hand-sent quotation stays distinguishable', sent.sentVia, 'MANUAL_EMAIL');

  const accepted = await acceptQuote(
    quote.id,
    { acceptedAt: new Date('2026-08-12'), via: 'CALL', note: 'agreed on the call' },
    user.id,
  );

  // The whole reason the two dates are separate columns: they agreed on the
  // 12th and this was written up later, so the sales cycle is measured from
  // the 12th.
  check('accepted on the day they said yes', accepted.quote.acceptedAt?.toISOString().slice(0, 10), '2026-08-12');
  check('recorded separately from when it happened', accepted.quote.recordedAt !== null, 'true');
  check('accepting offers the win rather than performing it', accepted.promptWin, true);
  check('and pre-fills it ex-tax', accepted.winDefaults?.amount, '40000');

  const second = await createQuote(
    {
      organizationId: org.id,
      dealId: deal.id,
      engagementType: 'RETAINER',
      billingFrequency: 'MONTHLY',
      lines: [{ description: 'Revised retainer', quantity: 1, rate: 45000 }],
    },
    user.id,
  );
  await rejects(
    'a deal cannot accept a second price',
    () => acceptQuote(second.id, { acceptedAt: new Date('2026-08-13'), via: 'EMAIL' }, user.id),
    /already accepted/i,
  );

  // Put the deal's value back where the accepted quotation left it — creating
  // the second quotation moved it, and the win below is asserted against it.
  await prisma.deal.update({ where: { id: deal.id }, data: { value: quote.total } });

  // ── Winning ────────────────────────────────────────────────────────────────
  heading('4 · Winning — the hinge');

  await rejects(
    'cannot win through a plain stage move',
    () => moveDealToStage(deal.id, byName('Won').id, user.id),
    /use the win action/i,
  );

  const won = await winDeal(
    deal.id,
    {
      contractType: 'RETAINER',
      startDate: new Date('2026-04-01'),
      endDate: null, // rolling
      amount: 40000,
      billingFrequency: 'MONTHLY',
      paymentTerms: 'MONTHLY',
    },
    user.id,
  );

  const afterWin = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
  check('company became a client', afterWin.status, 'ACTIVE');

  const engagement = await prisma.engagement.findUniqueOrThrow({ where: { id: won.engagementId } });
  check('ONE engagement created', engagement.amount.toString(), '40000');
  check('as a retainer', engagement.type, 'RETAINER');
  check('rolling — no end date invented', engagement.endDate, 'null');
  check('billing due from the start date', engagement.nextBillingDate?.toISOString().slice(0, 10), '2026-04-01');
  check('review scheduled 6 months out', engagement.nextReviewDate?.toISOString().slice(0, 10), '2026-10-01');

  const revisions = await prisma.engagementRevision.count({ where: { engagementId: engagement.id } });
  check('price history starts at the win', revisions, 1);

  // New Lead -> Meeting -> Proposal -> Meeting -> Negotiation -> Won
  const history = await prisma.stageHistory.count({ where: { dealId: deal.id } });
  check('every move recorded in stage history', history, 5);

  // ── The bug that started all this ──────────────────────────────────────────
  heading('5 · The billing bug cannot recur');

  const projectDeal = await prisma.deal.create({
    data: {
      organizationId: org.id,
      companyId: company.id,
      title: 'Website build',
      stageId: byName('Negotiation').id,
      value: new Prisma.Decimal(500000),
      expectedCloseDate: new Date('2026-10-01'),
      ownerId: user.id,
    },
  });

  await rejects(
    'a project cannot be won without an end date',
    () =>
      winDeal(
        projectDeal.id,
        { contractType: 'PROJECT', startDate: new Date('2026-05-01'), amount: 500000, billingFrequency: 'ONE_TIME' },
        user.id,
      ),
    /project needs an end date/i,
  );

  const projectWon = await winDeal(
    projectDeal.id,
    {
      contractType: 'PROJECT',
      startDate: new Date('2026-05-01'),
      endDate: new Date('2026-08-31'),
      amount: 500000,
      billingFrequency: 'ONE_TIME',
    },
    user.id,
  );
  const projectEng = await prisma.engagement.findUniqueOrThrow({ where: { id: projectWon.engagementId } });
  check('a one-off is billed ONE_TIME, not monthly', projectEng.billingFrequency, 'ONE_TIME');
  check('and contributes nothing to MRR', monthlyValue(projectEng.amount, projectEng.billingFrequency).toString(), '0');

  await rejects(
    'the same deal cannot be won twice',
    () => winDeal(deal.id, { contractType: 'RETAINER', startDate: new Date(), amount: 1, billingFrequency: 'MONTHLY' }, user.id),
    /already been won/i,
  );

  // ── Money ──────────────────────────────────────────────────────────────────
  heading('6 · Getting paid');

  const invoice = await raiseInvoiceForEngagement(engagement.id, user.id, {
    issueDate: new Date('2026-04-01'),
  });
  check('invoice numbered from settings', invoice.number.startsWith('EL/INV/2026-27/'), 'true');
  check('subtotal is the engagement amount', invoice.subtotal.toString(), '40000');
  // Org is Tamil Nadu, company is Karnataka -> inter-state -> IGST.
  check('inter-state, so IGST', invoice.igst.toString(), '7200');
  check('and no CGST', invoice.cgst.toString(), '0');
  check('total includes tax', invoice.total.toString(), '47200');
  check('covers one month', invoice.periodEnd?.toISOString().slice(0, 10), '2026-04-30');

  const advanced = await prisma.engagement.findUniqueOrThrow({ where: { id: engagement.id } });
  check('billing date advanced by one month', advanced.nextBillingDate?.toISOString().slice(0, 10), '2026-05-01');

  await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'SENT' } });

  await recordPayment(
    {
      organizationId: org.id,
      companyId: company.id,
      invoiceId: invoice.id,
      amount: 20000,
      currency: 'INR',
      paidOn: new Date('2026-04-15'),
    },
    user.id,
  );
  check('part payment -> partly paid', (await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status, 'PARTIALLY_PAID');

  await recordPayment(
    {
      organizationId: org.id,
      companyId: company.id,
      invoiceId: invoice.id,
      amount: 27200,
      currency: 'INR',
      paidOn: new Date('2026-04-25'),
    },
    user.id,
  );
  check('settled in full -> paid', (await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status, 'PAID');

  const paidInvoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
  check('a paid invoice is never overdue', isOverdue(paidInvoice, new Date('2027-01-01')), false);

  // ── Reporting ──────────────────────────────────────────────────────────────
  heading('7 · The numbers');

  const mrr = (await calculateMrr(org.id)).sub(baselineMrr);
  check('MRR counts the retainer only', mrr.toString(), '40000');

  const summary = await revenueSummary(org.id, new Date('2026-04-01'), new Date('2026-04-30'));
  check('billed', summary.billed.toString(), '47200');
  check('collected', summary.collected.toString(), '47200');
  check('nothing outstanding', summary.outstanding.toString(), '0');

  // ── Price review ───────────────────────────────────────────────────────────
  heading('8 · The six-month review');

  await changeTerms(engagement.id, { amount: 55000, reason: '6-month review', effectiveFrom: new Date('2026-10-01') }, user.id);
  check('MRR reflects the new price', (await calculateMrr(org.id)).sub(baselineMrr).toString(), '55000');
  check('but the old price is kept', await prisma.engagementRevision.count({ where: { engagementId: engagement.id } }), 2);

  const audit = await prisma.auditLog.count({ where: { entityId: engagement.id, action: 'ENGAGEMENT_TERMS_CHANGED' } });
  check('and the change is audited', audit, 1);

  // ── Endings ────────────────────────────────────────────────────────────────
  heading('9 · How it ends');

  await endEngagement(engagement.id, 'Client moved in-house', user.id, new Date('2026-12-31'));
  await syncCompanyStatus(company.id);
  const afterRetainerEnds = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
  // The project engagement is still ACTIVE, so the company is too.
  check('still active while the project runs', afterRetainerEnds.status, 'ACTIVE');

  await endEngagement(projectEng.id, 'Delivered', user.id, new Date('2026-08-31'));
  const afterAllEnd = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
  // The retainer ended LAST (December), so this reads as churn rather than delivery.
  check('the last ending decides the status', afterAllEnd.status, 'CHURNED');

  // A company with engagements cannot be deleted — the foreign key is RESTRICT,
  // which is the "nothing is deleted, only retired" rule (§5) holding at the
  // database rather than in a code review. Prove it, then clean up in order.
  await rejects(
    'a company with engagements cannot be deleted',
    () => prisma.company.delete({ where: { id: company.id } }),
    /RESTRICT|foreign key/i,
  );

  // ── Cleanup ────────────────────────────────────────────────────────────────
  for (const id of created.companies) {
    const engagementIds = (
      await prisma.engagement.findMany({ where: { companyId: id }, select: { id: true } })
    ).map((e) => e.id);

    await prisma.auditLog.deleteMany({ where: { entityId: { in: engagementIds } } });
    await prisma.payment.deleteMany({ where: { companyId: id } });
    await prisma.invoice.deleteMany({ where: { companyId: id } });
    await prisma.engagementRevision.deleteMany({ where: { engagementId: { in: engagementIds } } });
    await prisma.engagement.deleteMany({ where: { companyId: id } });
    await prisma.company.delete({ where: { id } });
  }

  // The counters are deliberately NOT reset. Rolling a document sequence
  // backwards is the one thing numbering must never do — the documents this run
  // created are gone, but any raised outside it are not, so a reset counter
  // hands out a number that is already taken and every later document fails on
  // the unique index. A gap in the sequence costs nothing; a reused number is a
  // 500 on the next real quotation (§3.7).

  console.log(`\n${'═'.repeat(46)}`);
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log('═'.repeat(46));
  if (fail) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('\njourney failed:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
