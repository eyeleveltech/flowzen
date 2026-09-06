/**
 * Row actions, exercised the way a person would.
 *
 * A real browser, because both bugs this found were invisible to the type
 * checker and to the API: a menu that never entered the DOM because bringing its
 * row into view counted as a scroll, and — the failure mode of one dialog shared
 * by every row — a dialog that could open carrying the previous row's record.
 *
 * Needs BOTH servers:  npm run dev (api)  and  next dev -p 3005 (web)
 * Run:                 npm run check:row-actions
 */
import { chromium } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import 'dotenv/config';

const prisma = new PrismaClient();
const OUT = process.argv[2] ?? 'row-actions.png';
const WEB = 'http://localhost:3005';
const API = 'http://localhost:4000/api';

const m = await prisma.userRole.findFirstOrThrow({
  where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
  select: { role: true, user: { select: { id: true, email: true, organizationId: true, tokenVersion: true } } },
});
const token = jwt.sign(
  { userId: m.user.id, email: m.user.email, role: m.role, organizationId: m.user.organizationId, tokenVersion: m.user.tokenVersion },
  process.env.JWT_SECRET, { expiresIn: '1h' },
);
await prisma.$disconnect();
const me = await fetch(`${API}/auth/me`, { headers: { Cookie: `token=${token}` } }).then((r) => r.json());
const user = me?.data?.user ?? me?.data ?? me?.user;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: 'token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
// No module to set any more — the switcher and the mode are gone (§3.1).
await ctx.addInitScript((u) => {
  localStorage.setItem('flowzen-user', JSON.stringify(u));
}, user);

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGE ERROR: ${e.message}`));

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok || !detail ? '' : `  — ${detail}`}`);
  if (!ok) failures++;
};

// ── Tasks: two different rows, one shared dialog ──────────────────────────────
await page.goto(`${WEB}/tasks`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);

const rowTitles = await page.locator('tbody tr td:nth-child(2)').allInnerTexts();
const first = rowTitles[0]?.trim();
const second = rowTitles[1]?.trim();
check('the list has two rows to compare', Boolean(first && second), `${first} / ${second}`);

const openMenu = async (n) => {
  await page.locator('tbody tr').nth(n).getByRole('button', { name: /^Actions for / }).click();
  await page.waitForTimeout(250);
};

await openMenu(0);
const menuItems = await page.getByRole('menuitem').allInnerTexts();
console.log('   menu items:', JSON.stringify(menuItems));
console.log('   action buttons on page:', await page.getByRole('button', { name: /^Actions for / }).count());
await page.screenshot({ path: OUT.replace('.png', '-menu.png') });
check('the menu opens', await page.getByRole('menuitem', { name: 'Change due date' }).isVisible());
await page.getByRole('menuitem', { name: 'Change due date' }).click();
await page.waitForTimeout(500);
const firstSubject = await page.locator('[role="dialog"]').innerText();
check('the dialog names the first row', firstSubject.includes(first), firstSubject.slice(0, 80));
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

await openMenu(1);
await page.getByRole('menuitem', { name: 'Change due date' }).click();
await page.waitForTimeout(500);
const secondSubject = await page.locator('[role="dialog"]').innerText();
check(
  'reopened on another row it names THAT row, not the previous one',
  secondSubject.includes(second) && !secondSubject.includes(first),
  secondSubject.slice(0, 80),
);
await page.screenshot({ path: OUT });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// ── Clients: log against the row ─────────────────────────────────────────────
await page.goto(`${WEB}/clients`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
const client = (await page.locator('tbody tr td:nth-child(1)').first().innerText()).trim().split('\n')[0];
await page.locator('tbody tr').first().getByRole('button', { name: /^Actions for / }).click();
await page.waitForTimeout(250);
await page.getByRole('menuitem', { name: 'Log activity' }).click();
await page.waitForTimeout(600);
const logText = await page.locator('[role="dialog"]').innerText();
check('logging from a client row names the client', logText.includes(client), logText.slice(0, 80));

check('no page errors', errors.length === 0, errors.join(' | '));
console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} FAILED\n`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
