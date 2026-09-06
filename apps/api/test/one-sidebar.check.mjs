/**
 * Four places, one sidebar, and no page that used to be two.
 *
 * Drives a real browser as an Admin and checks the things stage 6 removed —
 * which is the harder half, because a removal fails SILENTLY. A switcher that
 * is still rendered, a screen that no longer redirects, a card still linking to
 * a page that redirects back: none of those throw, and all of them look fine
 * until somebody tries to use them.
 *
 * Cleans up whatever it creates.
 *
 * Needs BOTH servers:  npm run dev (api)  and  next dev -p 3005 (web)
 * Run:                 npm run check:one-sidebar
 */
import { chromium } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import 'dotenv/config';

const prisma = new PrismaClient();
const OUT = process.argv[2] ?? 'one-sidebar.png';
const WEB = 'http://localhost:3005';
const API = 'http://localhost:4000/api';
const STAMP = `zz-nav-${Date.now()}`;

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok || !detail ? '' : `  — ${detail}`}`);
  if (!ok) failures++;
};

const m = await prisma.userRole.findFirstOrThrow({
  where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
  select: { role: true, user: { select: { id: true, email: true, organizationId: true, tokenVersion: true } } },
});
const orgId = m.user.organizationId;
const token = jwt.sign(
  { userId: m.user.id, email: m.user.email, role: m.role, organizationId: orgId, tokenVersion: m.user.tokenVersion },
  process.env.JWT_SECRET, { expiresIn: '1h' },
);
const me = await fetch(`${API}/auth/me`, { headers: { Cookie: `token=${token}` } }).then((r) => r.json());
const user = me?.data?.user ?? me?.data ?? me?.user;

// A client with an open card, so the merged page has something to render.
const stage = await prisma.stage.findFirstOrThrow({
  where: { pipeline: { organizationId: orgId, isDefault: true }, kind: 'OPEN', archivedAt: null },
  orderBy: { position: 'asc' },
  select: { id: true, name: true },
});
const company = await prisma.company.create({
  data: { organizationId: orgId, name: `${STAMP} Acme`, status: 'PROSPECT', ownerId: m.user.id },
  select: { id: true, name: true },
});
const deal = await prisma.deal.create({
  data: {
    organizationId: orgId,
    companyId: company.id,
    stageId: stage.id,
    ownerId: m.user.id,
    title: `${STAMP} rebuild`,
    value: '75000',
  },
  select: { id: true },
});
await prisma.stageHistory.create({
  data: { dealId: deal.id, fromStageId: null, toStageId: stage.id, movedById: m.user.id },
});

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addCookies([{ name: 'token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
// Nothing but the session. There is no module to seed any more.
await ctx.addInitScript((u) => {
  localStorage.setItem('flowzen-user', JSON.stringify(u));
}, user);

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGE ERROR: ${e.message}`));

const sidebar = () => page.locator('aside').first();

try {
  await page.goto(`${WEB}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  // ── One sidebar, four groups ────────────────────────────────────────────
  console.log('\nFour places');
  const nav = await sidebar().innerText();

  // Case-insensitively: the group headings are uppercased in CSS, so `innerText`
  // reads them back as "WORK". Asserting on the styling rather than the words
  // would break the first time somebody changes the type.
  for (const heading of ['Today', 'Clients', 'Work', 'Money']) {
    check(
      `the sidebar names ${heading}`,
      new RegExp(`\\b${heading}\\b`, 'i').test(nav),
      nav.replace(/\n+/g, ' | ').slice(0, 160),
    );
  }
  /*
   * And the switcher is gone.
   *
   * It cost two clicks on the way to every cross-section job, and — worse — the
   * mode it set decided what half the pages rendered, so the same person saw a
   * different client depending on where they had been (§3.1).
   */
  check('there is nothing to switch between', !/switch/i.test(nav), nav.slice(0, 200));
  check(
    'and no link to the picker',
    (await sidebar().locator('a[href="/modules"]').count()) === 0,
  );

  // Everything is reachable at once — no mode gates the list.
  for (const href of ['/dashboard', '/clients', '/pipeline', '/projects', '/my-tasks', '/quotations', '/revenue']) {
    check(`${href} is one click away`, (await sidebar().locator(`a[href="${href}"]`).count()) > 0);
  }
  await page.screenshot({ path: OUT });

  // ── The screens that used to be two ─────────────────────────────────────
  console.log('\nThe pages that merged');

  await page.goto(`${WEB}/crm`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  check('the second morning screen sends you to Today', page.url().endsWith('/dashboard'), page.url());

  await page.goto(`${WEB}/pipeline/${deal.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  check(
    'an old card link lands on the client',
    page.url().includes(`/clients/${company.id}`),
    page.url(),
  );

  // ── And the client page carries what that page used to ──────────────────
  console.log('\nOne page per client');
  await page.waitForTimeout(1500);
  const body = await page.locator('main, body').first().innerText();

  check('the client page names them', body.includes(company.name), body.slice(0, 120));
  check('shows what we are discussing', body.includes(`${STAMP} rebuild`), 'title missing');
  check('with its stage', body.includes(stage.name), `no "${stage.name}"`);
  /*
   * The three buttons that only existed on the deleted page. Their absence is
   * the whole failure mode of a merge: the page looks complete and cannot do
   * the one thing it replaced.
   */
  for (const label of ['Won', 'Lost', 'Park', 'Quote']) {
    check(`and the ${label} button`, (await page.getByRole('button', { name: label, exact: true }).count()) > 0);
  }

  // ── The word is gone ────────────────────────────────────────────────────
  console.log('\nThe vocabulary');
  /*
   * Checked on the CHROME — the words the interface itself authors: headings,
   * buttons, labels, column headers, placeholders, tooltips.
   *
   * Not on every word on the page, and the distinction matters twice.
   *
   * `deals` is still the table, still in every URL the API serves, and still
   * what makes win rate countable; it is the READING that had to change (§8.7).
   *
   * And a page also renders text PEOPLE wrote — client names, task titles, and
   * an append-only activity log. Some old rows in that log say "Deal won",
   * because they were written before this rename and `Activity` is documented
   * append-only: a history you can edit is not a history. Asserting on all text
   * would either fail forever or push me into quietly rewriting a log, and
   * neither of those is the check that should exist.
   */
  const saysDeal = (text) => /\bdeals?\b/i.test(text);
  const chrome = () =>
    page.$$eval(
      'button, h1, h2, h3, h4, label, th, [placeholder], [title], [aria-label]',
      (nodes) =>
        nodes
          .flatMap((n) => [
            n.innerText ?? '',
            n.getAttribute('placeholder') ?? '',
            n.getAttribute('title') ?? '',
            n.getAttribute('aria-label') ?? '',
          ])
          .join(' | '),
    );

  const clientChrome = await chrome();
  check('no "deal" on the client page', !saysDeal(body), (body.match(/.{0,40}deal.{0,40}/i) ?? [''])[0]);
  check('nor in anything it labels', !saysDeal(clientChrome), (clientChrome.match(/.{0,50}deal.{0,50}/i) ?? [''])[0]);

  await page.goto(`${WEB}/pipeline`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const board = await page.locator('main, body').first().innerText();
  const boardChrome = await chrome();
  check('no "deal" on the board', !saysDeal(board), (board.match(/.{0,40}deal.{0,40}/i) ?? [''])[0]);
  check('nor in anything it labels', !saysDeal(boardChrome), (boardChrome.match(/.{0,50}deal.{0,50}/i) ?? [''])[0]);
  check('and no way to create one', (await page.getByRole('button', { name: /new deal/i }).count()) === 0);
  check('the way in is a client', (await page.getByRole('button', { name: /new client/i }).count()) > 0);

  await page.goto(`${WEB}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const today = await page.locator('main, body').first().innerText();
  const todayChrome = await chrome();
  check('no "deal" in anything Today labels', !saysDeal(todayChrome), (todayChrome.match(/.{0,50}deal.{0,50}/i) ?? [''])[0]);
  check('Today counts what is being delivered', /Active projects/i.test(today), today.slice(0, 200));

  check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
  await prisma.stageHistory.deleteMany({ where: { dealId: deal.id } });
  await prisma.activity.deleteMany({ where: { companyId: company.id } });
  await prisma.deal.deleteMany({ where: { companyId: company.id } });
  await prisma.company.deleteMany({ where: { id: company.id } });
  const left = await prisma.company.count({ where: { name: { startsWith: STAMP } } });
  check('cleaned up after itself', left === 0, `${left} left`);
  await prisma.$disconnect();
}

console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
