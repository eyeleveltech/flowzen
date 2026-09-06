/**
 * Stage 6, over HTTP: one screen per client, one morning screen, four places.
 *
 * The browser half of stage 6 is in `one-sidebar.check.mjs`. This half checks
 * the thing the browser cannot see — that the SERVER actually sends what those
 * merged screens need, in one request:
 *
 *   ① `GET /companies/:id` carries the whole of the deleted deal page. If it
 *      does not, `/clients/:id` renders a stage panel with no stage, and the
 *      merge is a screen that looks right and shows nothing.
 *   ② `GET /dashboard` carries what the two morning screens it replaced carried
 *      between them — the delivery counts, the company follow-ups, the expired
 *      quotes. Anything missing here is a prompt that silently stopped
 *      appearing when `/crm` was retired.
 *   ③ The delivery counts are the SERVER's, not a length taken from a capped
 *      list — so they stay right past the cap.
 *   ④ A Member still gets none of it. Merging screens must not merge the
 *      permissions with them: this is the check that the field-level strip
 *      survived the rewrite.
 *
 * Creates its own company, card, quote and projects, and deletes all of it.
 *
 * Needs the API running:  npm run dev
 * Run:                    npm run check:one-page
 */

import { prisma } from '../src/lib/prisma.js';
import { generateToken } from '../src/utils/jwt.js';
import { startOfDay, addDays } from '../src/utils/orgDay.js';

const BASE = process.env.API_BASE ?? 'http://localhost:4000/api';
const STAMP = `zz-onepage-${Date.now()}`;
let failures = 0;

const check = (label: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok || !detail ? '' : `  — ${detail}`}`);
  if (!ok) failures++;
};

const get = async (path: string, token: string) => {
  const r = await fetch(`${BASE}${path}`, { headers: { Cookie: `token=${token}` } });
  const body = await r.json().catch(() => null);
  return { status: r.status, data: body?.data };
};

const run = async () => {
  const org = await prisma.organization.findFirstOrThrow({ select: { id: true, timezone: true } });

  const admin = await prisma.userRole.findFirstOrThrow({
    where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, user: { organizationId: org.id } },
    select: { role: true, user: { select: { id: true, email: true, tokenVersion: true } } },
  });
  /*
   * A Member of our own.
   *
   * The first version of this looked one up and skipped the whole permissions
   * section when the organisation had none — so on a seed with no Member it
   * printed "skipped" and passed, which is a check that cannot fail. Creating
   * one means this half always runs.
   */
  const memberUser = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: `${STAMP}@example.invalid`,
      name: `${STAMP} member`,
      status: 'ACTIVE',
      roles: { create: { role: 'MEMBER', organizationId: org.id } },
    },
    select: { id: true, email: true, tokenVersion: true },
  });

  const tokenFor = (u: { id: string; email: string; tokenVersion: number }, role: string) =>
    generateToken({
      userId: u.id,
      email: u.email,
      role: role as never,
      organizationId: org.id,
      tokenVersion: u.tokenVersion,
    });

  const adminToken = tokenFor(admin.user, admin.role);

  // ── The fixture: a company with a card, a quote and two projects ────────────
  const stage = await prisma.stage.findFirstOrThrow({
    where: { pipeline: { organizationId: org.id, isDefault: true }, kind: 'OPEN', archivedAt: null },
    orderBy: { position: 'asc' },
    select: { id: true, name: true },
  });

  const company = await prisma.company.create({
    data: {
      organizationId: org.id,
      name: `${STAMP} Co`,
      status: 'PROSPECT',
      ownerId: admin.user.id,
      // Due today, and nothing open against them yet — the one prompt that only
      // ever appeared on the retired CRM screen.
      followUpDate: startOfDay(new Date(), org.timezone),
    },
    select: { id: true },
  });

  /*
   * A second company, with a follow-up date and NO card.
   *
   * This is the case the deal reminders cannot reach — somebody you were given
   * on Tuesday and said you would call back — and it was visible on the retired
   * CRM screen only. The first company deliberately has an open card, so it must
   * NOT appear in that list: its own card's date is what fires.
   */
  const quiet = await prisma.company.create({
    data: {
      organizationId: org.id,
      name: `${STAMP} Quiet`,
      status: 'PROSPECT',
      ownerId: admin.user.id,
      followUpDate: startOfDay(new Date(), org.timezone),
    },
    select: { id: true },
  });

  const deal = await prisma.deal.create({
    data: {
      organizationId: org.id,
      companyId: company.id,
      stageId: stage.id,
      ownerId: admin.user.id,
      title: `${STAMP} work`,
      value: '50000',
    },
    select: { id: true },
  });
  await prisma.stageHistory.create({
    data: { dealId: deal.id, fromStageId: null, toStageId: stage.id, movedById: admin.user.id },
  });

  // An overdue project — off track by the same rule `computeHealth` uses.
  const yesterday = addDays(startOfDay(new Date(), org.timezone), -1, org.timezone);
  const late = await prisma.project.create({
    data: {
      organizationId: org.id,
      companyId: company.id,
      name: `${STAMP} late`,
      status: 'ACTIVE',
      dueDate: yesterday,
      ownerId: admin.user.id,
    },
    select: { id: true },
  });
  const onTime = await prisma.project.create({
    data: {
      organizationId: org.id,
      companyId: company.id,
      name: `${STAMP} fine`,
      status: 'ACTIVE',
      dueDate: addDays(startOfDay(new Date(), org.timezone), 30, org.timezone),
      ownerId: admin.user.id,
    },
    select: { id: true },
  });

  try {
    // ── ① The client page gets the whole of the old deal page ────────────────
    console.log('\nOne page per client');
    const client = await get(`/companies/${company.id}`, adminToken);
    check('the client loads', client.status === 200, String(client.status));

    const card = client.data?.deals?.find((d: { id: string }) => d.id === deal.id);
    check('their card is on it', Boolean(card), 'no card');

    /*
     * Each of these was on `/pipeline/[id]` and nowhere else. A merged page that
     * is missing one of them is not merged — it is the same split with an extra
     * click removed.
     */
    check('with the stage, in full', card?.stage?.id === stage.id && Boolean(card?.stage?.kind), JSON.stringify(card?.stage)?.slice(0, 80));
    check('with the value', card?.value != null, String(card?.value));
    check('with its quotations', Array.isArray(card?.quotes), typeof card?.quotes);
    check('with the owner', Boolean(card?.owner?.name), JSON.stringify(card?.owner));
    check('with every move it has made', (card?.stageHistory?.length ?? 0) > 0, `${card?.stageHistory?.length} moves`);
    check('with its custom fields', Array.isArray(card?.fieldValues), typeof card?.fieldValues);
    check('and what it became, when it has', 'engagement' in (card ?? {}), Object.keys(card ?? {}).join(','));

    // ── ② and ③ One morning screen ───────────────────────────────────────────
    console.log('\nOne morning screen');
    const today = await get('/dashboard', adminToken);
    check('Today loads', today.status === 200, String(today.status));

    check(
      'counts active projects on the server',
      typeof today.data?.delivery?.active === 'number',
      JSON.stringify(today.data?.delivery),
    );
    /*
     * The figure, not a length.
     *
     * The delivery dashboard counted this in the browser from `api.projects.list()`,
     * which the server caps — so the number quietly meant "among the first page"
     * and stopped being true exactly when it mattered most.
     */
    check(
      'and counts the off-track one',
      (today.data?.delivery?.offTrack ?? 0) >= 1,
      `offTrack=${today.data?.delivery?.offTrack}`,
    );
    check(
      'off track means overdue, not merely late-ish',
      today.data?.delivery?.active >= 2,
      `active=${today.data?.delivery?.active}`,
    );

    const pipeline = today.data?.pipeline;
    check('carries the deal follow-ups', Array.isArray(pipeline?.followUpsDue), typeof pipeline?.followUpsDue);
    /*
     * The three that existed on the retired CRM screen ONLY. Losing any of them
     * to a screen merge is the failure mode this file is here to catch: nobody
     * reports a reminder that stopped arriving.
     */
    check(
      'carries the client follow-ups the cards cannot cover',
      Array.isArray(pipeline?.companyFollowUpsDue),
      typeof pipeline?.companyFollowUpsDue,
    );
    const chased = (pipeline?.companyFollowUpsDue ?? []).map((c: { id: string }) => c.id);
    check(
      'and finds the client with nothing open against them',
      chased.includes(quiet.id),
      JSON.stringify(pipeline?.companyFollowUpsDue?.map((c: { name: string }) => c.name)),
    );
    /*
     * And leaves out the one that HAS a card, whose own follow-up date is what
     * fires. Without this the two lists overlap and the same client is chased
     * twice on the same morning — which is how a prompt stops being read.
     */
    check('and leaves out the one whose card already covers it', !chased.includes(company.id));
    check('carries expired quotations', Array.isArray(pipeline?.quotesExpired), typeof pipeline?.quotesExpired);
    check('carries what has gone quiet', Array.isArray(pipeline?.rotting), typeof pipeline?.rotting);
    check('carries quotes with no reply', Array.isArray(pipeline?.quotesAwaitingReply), typeof pipeline?.quotesAwaitingReply);

    // ── ④ Merging screens did not merge the permissions ──────────────────────
    console.log('\nThe strip survived the merge');
    {
      const memberToken = tokenFor(memberUser, 'MEMBER');
      const asMember = await get(`/companies/${company.id}`, memberToken);
      /*
       * A Member reaches this client at all only through work they are on. Either
       * answer is correct — refused, or allowed with the commercial fields gone —
       * and what must NOT happen is the cards arriving.
       */
      if (asMember.status === 404) {
        check('a Member cannot reach a client they do not work for', true);
      } else {
        check('a Member gets no cards', (asMember.data?.deals?.length ?? 0) === 0, `${asMember.data?.deals?.length} cards`);
        check('a Member gets no invoices', (asMember.data?.invoices?.length ?? 0) === 0);
        check('a Member gets no retainer value', asMember.data?.monthlyValue == null, String(asMember.data?.monthlyValue));
      }

      const memberToday = await get('/dashboard', memberToken);
      check('a Member gets no pipeline on Today', memberToday.data?.pipeline == null, typeof memberToday.data?.pipeline);
      check('a Member gets no money on Today', memberToday.data?.money == null, typeof memberToday.data?.money);
      // But they DO get the delivery figures — that is their own work.
      check(
        'a Member still gets the delivery figures',
        typeof memberToday.data?.delivery?.active === 'number',
        JSON.stringify(memberToday.data?.delivery),
      );
    }
  } finally {
    await prisma.stageHistory.deleteMany({ where: { dealId: deal.id } });
    await prisma.activity.deleteMany({ where: { companyId: company.id } });
    await prisma.project.deleteMany({ where: { id: { in: [late.id, onTime.id] } } });
    await prisma.deal.deleteMany({ where: { companyId: company.id } });
    await prisma.company.deleteMany({ where: { id: { in: [company.id, quiet.id] } } });
    await prisma.userRole.deleteMany({ where: { userId: memberUser.id } });
    await prisma.user.deleteMany({ where: { id: memberUser.id } });
    const left =
      (await prisma.company.count({ where: { name: { startsWith: STAMP } } })) +
      (await prisma.user.count({ where: { name: { startsWith: STAMP } } }));
    check('cleaned up after itself', left === 0, `${left} left`);
    await prisma.$disconnect();
  }

  console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
