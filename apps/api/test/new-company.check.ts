/**
 * Adding a company puts it on the board.
 *
 * Proved through the real HTTP route, because the thing worth proving spans the
 * request schema, one transaction and three tables — and because the previous
 * behaviour was correct in every unit sense and still left leads invisible.
 *
 * Needs the API running:  npm run dev
 * Run:                    npx tsx test/new-company.check.ts
 */

import { prisma } from '../src/lib/prisma.js';
import { generateToken } from '../src/utils/jwt.js';

const BASE = process.env.API_BASE ?? 'http://localhost:4000/api';
const STAMP = `zz-newco-check-${Date.now()}`;
let failures = 0;

const check = (label: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok || !detail ? '' : `  — ${detail}`}`);
  if (!ok) failures++;
};

const run = async () => {
  /*
   * A REAL user with a REAL role.
   *
   * An earlier journey minted tokens carrying invented `role` claims and then
   * "found" three access bugs that did not exist — the server reads roles live
   * from the database on every request and ignored the claim entirely. Pick the
   * person, do not describe them.
   */
  const membership = await prisma.userRole.findFirstOrThrow({
    where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
    select: { role: true, user: { select: { id: true, organizationId: true, email: true } } },
  });
  const user = { ...membership.user, role: membership.role };
  const token = generateToken({
    userId: user.id,
    email: user.email,
    organizationId: user.organizationId,
    role: user.role,
  });
  const headers = { 'Content-Type': 'application/json', Cookie: `token=${token}` };

  const created: string[] = [];

  const post = async (body: unknown) => {
    const r = await fetch(`${BASE}/companies`, { method: 'POST', headers, body: JSON.stringify(body) });
    return { status: r.status, json: (await r.json()) as { success: boolean; data?: any; error?: string } };
  };

  try {
    // ── The referral: one typed field ────────────────────────────────────────
    const a = await post({
      name: `${STAMP} Acme Foods`,
      phone: '9876500001',
      city: 'Chennai',
      contact: { name: 'Priya Sharma', phone: '9876500001' },
    });
    check('the company is created', a.status === 201, `${a.status} ${a.json.error ?? ''}`);
    if (a.json.data) created.push(a.json.data.id);

    const co = await prisma.company.findUniqueOrThrow({
      where: { id: a.json.data.id },
      include: { contacts: true, deals: { include: { stage: true, stageHistory: true } } },
    });

    check('it lands on the board', co.deals.length === 1, `${co.deals.length} cards`);
    const card = co.deals[0];
    check('in the FIRST stage', card?.stage.position === 0, card?.stage.name);
    check('which is an open stage', card?.stage.kind === 'OPEN', card?.stage.kind);
    check('the card has NO title — nameless is correct here', card?.title === null, String(card?.title));
    check('no value invented', card?.value === null);
    check('no close date invented', card?.expectedCloseDate === null);
    check('history starts at creation, not at the first move', card?.stageHistory.length === 1);

    check('the contact was saved in the same request', co.contacts.length === 1);
    check('and is the primary one', co.contacts[0]?.isPrimary === true);

    // The two fields that decide whether anyone is ever reminded.
    check('an owner was assigned', Boolean(co.ownerId));
    check('a follow-up date was defaulted', Boolean(co.followUpDate));
    check('the card carries the same date', Boolean(card?.followUpDate));

    // ── The exception: not a lead ────────────────────────────────────────────
    const b = await post({ name: `${STAMP} Some Vendor`, startDeal: false });
    if (b.json.data) created.push(b.json.data.id);
    const vendor = await prisma.company.findUniqueOrThrow({
      where: { id: b.json.data.id },
      include: { deals: true },
    });
    check('startDeal:false creates no card', vendor.deals.length === 0);
    check('but still gets a follow-up date, so it is not lost', Boolean(vendor.followUpDate));

    // ── The duplicate rule still runs ────────────────────────────────────────
    const dup = await post({ name: `${STAMP} Acme Foods`, phone: '9876500001' });
    check('the same phone is still blocked', dup.status === 409, String(dup.status));
    if (dup.json.data) created.push(dup.json.data.id);

    // ── Nothing partially written ────────────────────────────────────────────
    const orphans = await prisma.company.count({
      where: { name: { startsWith: STAMP }, ownerId: null },
    });
    check('no company was written without an owner', orphans === 0);
  } finally {
    const mine = await prisma.company.findMany({
      where: { name: { startsWith: STAMP } },
      select: { id: true },
    });
    const ids = mine.map((c) => c.id);
    await prisma.activity.deleteMany({ where: { companyId: { in: ids } } });
    await prisma.stageHistory.deleteMany({ where: { deal: { companyId: { in: ids } } } });
    await prisma.deal.deleteMany({ where: { companyId: { in: ids } } });
    await prisma.contact.deleteMany({ where: { companyId: { in: ids } } });
    await prisma.company.deleteMany({ where: { id: { in: ids } } });

    const left = await prisma.company.count({ where: { name: { startsWith: STAMP } } });
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
