/**
 * ⌘K does things, not only finds them.
 *
 * Drives the palette the way a person would — type a verb and a name, press
 * Enter — and then checks the DATABASE, because the only proof that an action
 * ran is the row it wrote. A dialog opening is not the same as work being done.
 *
 * Cleans up whatever it logs.
 *
 * Needs BOTH servers:  npm run dev (api)  and  next dev -p 3005 (web)
 * Run:                 npm run check:command-bar
 */
import { chromium } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import 'dotenv/config';

const prisma = new PrismaClient();
const OUT = process.argv[2] ?? 'command-bar.png';
const WEB = 'http://localhost:3005';
const API = 'http://localhost:4000/api';
const STAMP = `zz-cmd-${Date.now()}`;

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

// A company with a name nothing else matches, so the search is unambiguous.
const company = await prisma.company.create({
  data: { organizationId: orgId, name: `${STAMP} Acme`, status: 'PROSPECT', ownerId: m.user.id },
  select: { id: true, name: true },
});

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: 'token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
// No module to set any more — the switcher and the mode are gone (§3.1). The
// session alone decides what is on screen.
await ctx.addInitScript((u) => {
  localStorage.setItem('flowzen-user', JSON.stringify(u));
}, user);

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGE ERROR: ${e.message}`));

try {
  await page.goto(`${WEB}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  const input = page.getByPlaceholder(/Search clients, enquiries/);

  // ── Finding still works ─────────────────────────────────────────────────────
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(400);
  await input.fill(STAMP);
  await page.waitForTimeout(900);
  /*
   * Inside the palette, not anywhere on screen.
   *
   * This looked for the word "Clients" on the whole page, which was unambiguous
   * only while the sidebar was a single flat list. Now there is a Clients GROUP
   * and a Clients LINK in it, so a page-wide match finds three and Playwright
   * refuses — a check that broke on a navigation change it was never about.
   *
   * Scoped by testid rather than by shape, so the visual pass cannot break it
   * either.
   */
  const palette = page.getByTestId('command-palette');
  check(
    'plain search still finds things',
    await palette.getByText('Clients', { exact: true }).first().isVisible(),
  );

  // ── A verb turns it into a command ──────────────────────────────────────────
  await input.fill(`meeting ${STAMP}`);
  await page.waitForTimeout(900);
  const rowText = await page.locator('button:has-text("Log activity")').first().innerText();
  check('typing a verb offers the action', rowText.includes('Log activity'), rowText);
  check('and names the subject it will act on', rowText.includes(STAMP), rowText);
  await page.screenshot({ path: OUT });

  // ── Enter opens the dialog, pre-filled ──────────────────────────────────────
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const dialog = await page.locator('[role="dialog"]').innerText();
  check('Enter opens the log dialog', dialog.includes('Log something'), dialog.slice(0, 60));
  check('with the client already filled in', dialog.includes(company.name), dialog.slice(0, 90));

  // ── And it actually writes ──────────────────────────────────────────────────
  await page.getByLabel(/What happened|One line|Summary|What was said/i).first().fill(`${STAMP} spoke to them`)
    .catch(async () => {
      // Fall back to the first text input in the dialog if the label differs.
      await page.locator('[role="dialog"] input[type="text"]').first().fill(`${STAMP} spoke to them`);
    });
  await page.getByRole('button', { name: /^Save|Log$/ }).first().click();
  await page.waitForTimeout(1200);

  const logged = await prisma.activity.findFirst({
    where: { companyId: company.id },
    select: { type: true, message: true },
  });
  check('an activity reaches the database', Boolean(logged), 'nothing written');
  /*
   * MEETING, not CALL.
   *
   * The first version of this check typed "call" and asserted CALL — which
   * passed while nothing mapped the verb at all, because CALL is the dialog's
   * default. Typing "meeting" is the version that can fail.
   */
  check('the verb decides the kind — "meeting" is not a call', logged?.type === 'MEETING', String(logged?.type));

  check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
  await prisma.activity.deleteMany({ where: { companyId: company.id } });
  await prisma.deal.deleteMany({ where: { companyId: company.id } });
  await prisma.company.deleteMany({ where: { id: company.id } });
  const left = await prisma.company.count({ where: { name: { startsWith: STAMP } } });
  check('cleaned up after itself', left === 0, `${left} left`);
  await prisma.$disconnect();
}

console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
