import { expect, type Page, type APIRequestContext, request } from '@playwright/test';
import fs from 'node:fs';

/**
 * Shared scaffolding for the end-to-end specs.
 *
 * ─── On using the seeded accounts ───────────────────────────────────────────
 *
 * These specs sign in as the real seeded people rather than registering a
 * throwaway org each run. That is deliberate: most of what is under test here
 * is about WHO CAN SEE WHAT, and a fresh org would have one admin and no BD,
 * no Head and no employee to check the boundaries against. The trade is that
 * the specs must leave the database as they found it, which every helper below
 * exists to make easy.
 *
 * ─── On cleaning up ─────────────────────────────────────────────────────────
 *
 * Anything a spec creates carries a marker in its name, and `cleanupMarked`
 * removes it through the API rather than the UI — a failing spec should still
 * leave nothing behind, and it cannot be relied on to click a delete button on
 * its way out.
 */

/**
 * The API ORIGIN, not its /api path.
 *
 * Playwright resolves a request path that begins with "/" against the ORIGIN
 * and discards the baseURL's own path — so a baseURL of ".../api" plus a path
 * of "/auth/login" silently becomes ":4000/auth/login", and every call 404s
 * with nothing to explain why. Origin here; every path below carries its /api.
 */
export const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api').replace(/\/api\/?$/, '');

/** A string no real record would contain, so cleanup can find its own litter. */
export const MARK = 'E2E-PROBE';
export const marked = (what: string) => `${MARK} ${what} ${Date.now()}`;

/**
 * The seeded people, by what they are allowed to do rather than by name.
 *
 * The passwords are the dev seed's own. They are not secrets in this
 * deployment and the seeder prints a generated one for any real install.
 */
export const PEOPLE = {
  admin: { email: 'harish.s@eyelevelstudio.in', password: 'Harish143@', label: 'Management' },
  bd: { email: 'tanuja@eyelevelstudio.in', password: 'ChangeMe123!', label: 'BD' },
  head: { email: 'charles@eyelevelstudio.in', password: 'ChangeMe123!', label: 'Head' },
  accounts: { email: 'priya@eyelevelstudio.in', password: 'ChangeMe123!', label: 'Accounts' },
  employee: { email: 'ramya@eyelevelstudio.in', password: 'ChangeMe123!', label: 'Employee' },
} as const;

export type Persona = keyof typeof PEOPLE;

/** Where auth.setup.ts leaves each person's session for the rest of the run. */
export const STATE_DIR = 'playwright/.auth';
export const stateFor = (who: Persona) => `${STATE_DIR}/${who}.json`;

/**
 * Signs in through the real form.
 *
 * Only for specs that are ABOUT signing in. Everything else declares who it is
 * with `test.use({ storageState: stateFor('bd') })` and starts already signed
 * in — see auth.setup.ts for why that matters rather than just being faster.
 */
export async function signIn(page: Page, who: Persona = 'admin'): Promise<void> {
  const person = PEOPLE[who];
  await page.goto('/login');
  await page.fill('input[type="email"]', person.email);
  await page.fill('input[type="password"]', person.password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 }),
    page.click('button[type="submit"]'),
  ]);
}

/**
 * An API context signed in as somebody — for arranging the state a UI test
 * needs, and for tearing it down afterwards.
 *
 * Going through the API to set up is not cheating: the spec is about the
 * screen, and clicking through four other screens first only means a failure
 * somewhere else fails this too.
 */
export async function apiAs(who: Persona = 'admin'): Promise<APIRequestContext> {
  // Reuse the session auth.setup.ts already obtained rather than spending
  // another of this account's 20 logins. Falls back to signing in for a spec
  // run on its own, without the setup project.
  if (fs.existsSync(stateFor(who))) {
    return request.newContext({ baseURL: API_ORIGIN, storageState: stateFor(who) });
  }

  const ctx = await request.newContext({ baseURL: API_ORIGIN });
  const person = PEOPLE[who];
  const res = await ctx.post('/api/auth/login', { data: { email: person.email, password: person.password } });
  if (!res.ok()) {
    // Say what actually happened. "Could not sign in" sent me looking at the
    // seed twice when the real answer was a 429 from the auth rate limiter.
    const body = await res.text();
    throw new Error(
      `could not sign ${person.label} (${person.email}) in: ${res.status()} ${body.slice(0, 200)}\n` +
        (res.status() === 429
          ? 'That is the auth rate limiter (20 per account / 200 per address, per 15 minutes). ' +
            'Sign each person in once per file and share the context, or wait it out.'
          : 'Check the API is running on 4000 and the database is seeded.'),
    );
  }
  return ctx;
}

/** The first company that is already a client, for anything needing a real one. */
export async function someClient(api: APIRequestContext): Promise<{ id: string; name: string }> {
  const res = await api.get('/api/companies?limit=50');
  const body = await res.json();
  const list: { id: string; name: string; status: string }[] = body.companies ?? body.data ?? [];
  const client = list.find((c) => c.status === 'CLIENT') ?? list[0];
  expect(client, 'the seed has no companies to test against').toBeTruthy();
  return { id: client.id, name: client.name };
}

/** A proposal nothing has happened to, created for one spec and removed after. */
export async function createProbeProposal(
  api: APIRequestContext,
  companyId: string,
  kind: 'RETAINER' | 'PROJECT' = 'PROJECT',
): Promise<string> {
  const res = await api.post('/api/proposals', {
    data: { companyId, kind, initialValue: 123456, scopeSummary: marked('proposal') },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).proposal.id;
}

/**
 * Removes every record these specs created, whatever state they left it in.
 *
 * Deliberately tolerant: a proposal may be soft-deleted, restored, or already
 * gone, and cleanup has to cope with all three without failing the run.
 */
export async function cleanupMarked(api: APIRequestContext): Promise<void> {
  const collect = async (path: string, key: string) => {
    const res = await api.get(path);
    if (!res.ok()) return [];
    const body = await res.json();
    return (body[key] ?? body.data ?? []) as any[];
  };

  // Live and deleted alike — a spec under test may have removed one already.
  const live = await collect('/api/proposals?limit=500', 'proposals');
  const binned = await collect('/api/proposals/trash', 'proposals');
  const mine = [...live, ...binned].filter((p) =>
    (p.versions ?? []).some((v: any) => String(v.scopeSummary ?? '').includes(MARK)),
  );
  for (const p of mine) {
    // Restore first: the delete route refuses nothing, but a soft-deleted row
    // cannot be found by it.
    await api.post(`/api/proposals/${p.id}/restore`).catch(() => {});
    await api.delete(`/api/proposals/${p.id}`).catch(() => {});
  }

  const tasks = await collect('/api/tasks?limit=500', 'tasks');
  for (const t of tasks.filter((t) => String(t.title ?? '').includes(MARK))) {
    await api.delete(`/api/tasks/${t.id}`).catch(() => {});
  }
}

/**
 * The organisation settings, saved and restored around a spec that changes one.
 *
 * Several of these settings are org-wide — stage probabilities, the working
 * calendar — so a spec that edits one is editing what every other spec reads.
 * Those specs run serially and put the value back through this.
 */
export async function readOrgSettings(api: APIRequestContext): Promise<Record<string, unknown>> {
  const body = await (await api.get('/api/config')).json();
  const o = body.organization;
  return {
    stageProbTalking: o.stageProbabilities?.TALKING,
    stageProbProposalSent: o.stageProbabilities?.PROPOSAL_SENT,
    stageProbInNegotiation: o.stageProbabilities?.IN_NEGOTIATION,
    stageProbProformaIssued: o.stageProbabilities?.PROFORMA_ISSUED,
    stageProbVerbalYes: o.stageProbabilities?.VERBAL_YES,
    workingHoursStart: o.workingHoursStart,
    workingHoursEnd: o.workingHoursEnd,
    workingDays: o.workingDays,
    holidays: o.holidays,
  };
}

export async function writeOrgSettings(api: APIRequestContext, settings: Record<string, unknown>): Promise<void> {
  const res = await api.patch('/api/config', { data: settings });
  expect(res.ok(), 'could not put the organisation settings back').toBeTruthy();
}

/** A toast, by its words — the app's one way of confirming a save. */
export function toast(page: Page, text: string | RegExp) {
  return page.getByText(text).first();
}
