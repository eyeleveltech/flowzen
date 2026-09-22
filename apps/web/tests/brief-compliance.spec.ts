import { test, expect, type APIRequestContext } from '@playwright/test';
import { apiAs, stateFor, readOrgSettings, writeOrgSettings, PEOPLE, type Persona } from './helpers';

/**
 * The rules PROJECT_BRIEF.md states in numbers, checked against the running app.
 *
 * These are the ones nothing else can catch. A weighted figure computed from an
 * unauthorised percentage still looks like a number; an endpoint that hands a
 * BD a cost figure still returns 200. Only a test that knows what the brief
 * says can tell either of them from working software.
 */

test.describe.configure({ mode: 'serial' });

// Every spec here reads as an admin; the few that need another person use the
// API context for that person rather than a second browser session.
test.use({ storageState: stateFor('admin') });

let api: APIRequestContext;

/**
 * One signed-in context per person, made once.
 *
 * Signing in inside each test looked tidier and was wrong: /api/auth carries a
 * two-stage rate limiter (20 per account, 200 per address, per 15 minutes), so
 * a matrix of seven paths across five people meant thirty-five logins and the
 * suite locked itself out. These are the credentials being tested, not the
 * thing under test.
 */
const ctx: Partial<Record<Persona, APIRequestContext>> = {};
const ALL: Persona[] = ['employee', 'head', 'bd', 'accounts', 'admin'];

test.beforeAll(async () => {
  for (const who of ALL) ctx[who] = await apiAs(who);
  api = ctx.admin!;
});

test.afterAll(async () => {
  for (const who of ALL) await ctx[who]?.dispose();
});

// ── §9 · Permissions, enforced on the server ────────────────────────────────

test.describe('§9 · who can reach what', () => {
  /**
   * §9's own matrix, as a table. A change to a preset that nobody meant to make
   * shows up here rather than as a person quietly seeing a screen they should
   * not, which is the kind of thing nobody reports as a bug.
   */
  const MATRIX: Record<string, Partial<Record<Persona, number>>> = {
    '/api/proposals/pipeline': { employee: 403, head: 403, bd: 200, accounts: 403, admin: 200 },
    '/api/companies?limit=3': { employee: 403, head: 403, bd: 200, accounts: 200, admin: 200 },
    '/api/retainers?limit=3': { employee: 403, head: 200, bd: 403, accounts: 403, admin: 200 },
    '/api/retainers/profitability': { employee: 403, head: 403, bd: 403, accounts: 200, admin: 200 },
    '/api/costs?limit=3': { employee: 403, head: 200, bd: 403, accounts: 200, admin: 200 },
    // reports.read is Management alone — Accounts legitimately needs figures
    // and is still not entitled to the management reports.
    '/api/forecast/3-month': { employee: 403, head: 403, bd: 403, accounts: 403, admin: 200 },
    '/api/brief/monday': { employee: 403, head: 403, bd: 403, accounts: 403, admin: 200 },
  };

  for (const [path, expected] of Object.entries(MATRIX)) {
    test(`${path} answers each preset as §9 says`, async () => {
      for (const [who, status] of Object.entries(expected) as [Persona, number][]) {
        const res = await ctx[who]!.get(path);
        expect(res.status(), `${PEOPLE[who].label} at ${path}`).toBe(status);
      }
    });
  }

  test('a BD sees deal values, because they cannot sell without them', async () => {
    // §9: "Deal values are not the same as cost figures." Two separate gates,
    // and this is the one that must stay OPEN.
    const board = await (await ctx.bd!.get('/api/proposals/pipeline')).json();
    const cards = Object.values(board.columns ?? {}).flat() as any[];
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.some((c) => typeof c.quotedValue === 'number')).toBe(true);
  });

  test('nothing sends a rupee figure to somebody without money.figures', async () => {
    /*
     * §9: "The API must never send a figure the caller is not entitled to.
     * Masking in the client only is not access control."
     *
     * Masked money is null in this codebase, never 0 — a zero is a claim, an
     * absence is not — so a real number under any of these keys is a leak.
     */
    const FIGURES = [
      'monthlyCost', 'salary', 'estimatedCost', 'actualCost', 'directCost', 'directCostsTotal',
      'peopleCost', 'externalCost', 'profit', 'marginPercent', 'revenue', 'monthlyValue',
    ];
    const leaks = (node: any, path = '', found: string[] = []): string[] => {
      if (node === null || node === undefined) return found;
      if (Array.isArray(node)) {
        node.slice(0, 8).forEach((v, i) => leaks(v, `${path}[${i}]`, found));
        return found;
      }
      if (typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
          if (FIGURES.includes(k) && v !== null && typeof v !== 'object') found.push(`${path}.${k} = ${v}`);
          leaks(v, `${path}.${k}`, found);
        }
      }
      return found;
    };

    for (const who of ['employee', 'head', 'bd'] as Persona[]) {
      for (const path of ['/api/config', '/api/tasks/my', '/api/tasks?limit=5', '/api/users', '/api/companies?limit=5', '/api/proposals/pipeline']) {
        const res = await ctx[who]!.get(path);
        if (res.status() !== 200) continue;
        const found = leaks(await res.json());
        expect(found, `${PEOPLE[who].label} was sent a figure at ${path}`).toEqual([]);
      }
    }
  });
});

// ── §14 · Stage probabilities are a setting, at the brief's defaults ────────

test.describe('§14 · stage probabilities', () => {
  test('are the brief’s numbers, not any of the three tables the code once held', async () => {
    const o = await readOrgSettings(api);
    expect(o.stageProbProposalSent, 'brief §14 sets Proposal sent at 30').toBe(30);
    expect(o.stageProbInNegotiation).toBe(60);
    expect(o.stageProbProformaIssued, 'brief §14 sets Proforma issued at 85').toBe(85);
    expect(o.stageProbVerbalYes, 'brief §14 sets Verbal yes at 90').toBe(90);
  });

  test('the board prints the same figures the API weights against', async ({ page }) => {
    /*
     * There were three copies of this table and no two agreed, so the Pipeline
     * board and the Forecast reported different weighted values for the same
     * deal. The board now reads /config, which is what the API weights with.
     */
    await page.goto('/pipeline');
    await expect(page.getByText('Proposal sent')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('30% likely').first()).toBeVisible();
    await expect(page.getByText('85% likely').first()).toBeVisible();
    // The numbers the code used to carry, which must not appear any more.
    await expect(page.getByText('40% likely')).toHaveCount(0);
    await expect(page.getByText('95% likely')).toHaveCount(0);
  });

  test('a change in Setup moves the board, then goes back', async ({ page }) => {
    const original = await readOrgSettings(api);
    try {
      await writeOrgSettings(api, { stageProbProposalSent: 44 });
      await page.goto('/pipeline');
      await expect(page.getByText('44% likely').first()).toBeVisible({ timeout: 15_000 });
    } finally {
      // Org-wide, so it is put back whether the assertion held or not.
      await writeOrgSettings(api, { stageProbProposalSent: original.stageProbProposalSent as number });
    }
    expect((await readOrgSettings(api)).stageProbProposalSent).toBe(original.stageProbProposalSent);
  });

  test('refuses a probability that is not a percentage', async () => {
    const res = await api.patch('/api/config', { data: { stageProbVerbalYes: 140 } });
    expect(res.status()).toBe(400);
  });
});

// ── §14 · Sundays AND public holidays excluded ──────────────────────────────

test.describe('§14 · the working calendar', () => {
  test('holidays save, de-duplicated and in order, then go back', async () => {
    const original = await readOrgSettings(api);
    try {
      await writeOrgSettings(api, { holidays: ['2026-11-08', '2026-01-14', '2026-11-08'] });
      const saved = await readOrgSettings(api);
      expect(saved.holidays).toEqual(['2026-01-14', '2026-11-08']);
    } finally {
      await writeOrgSettings(api, { holidays: original.holidays as string[] });
    }
    expect((await readOrgSettings(api)).holidays).toEqual(original.holidays);
  });

  test('refuses something that is not a date', async () => {
    const res = await api.patch('/api/config', { data: { holidays: ['next Diwali'] } });
    expect(res.status()).toBe(400);
  });

  test('Setup offers the calendar and the probabilities', async ({ page }) => {
    // §14: "All configurable in Setup." Both were columns with nowhere to set
    // them — the working hours had been on the organisation since the first
    // schema and no screen had ever shown them.
    await page.goto('/settings');
    await expect(page.getByText('Working calendar')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Stage probabilities')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sun' })).toBeVisible();
    await expect(page.getByLabel(/Public holidays/)).toBeVisible();
  });
});
