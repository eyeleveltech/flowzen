import { test, expect, type APIRequestContext } from '@playwright/test';
import { apiAs, stateFor, readOrgSettings } from './helpers';

/**
 * Two screens that put figures in front of a client, and the settings behind them.
 *
 * The retainer's monthly value is what MRR, the forecast and every month card
 * are built from, and it could be typed once and never corrected. The document
 * form is what somebody reads just before a proforma goes out — so when the
 * printed page and the on-screen preview disagree, the person sending it is
 * the last to find out.
 */

test.describe.configure({ mode: 'serial' });
test.use({ storageState: stateFor('admin') });

let api: APIRequestContext;

test.beforeAll(async () => {
  api = await apiAs('admin');
});

test.afterAll(async () => {
  await api.dispose();
});

const activeRetainer = async () => {
  const body = await (await api.get('/api/retainers?limit=50')).json();
  const list = body.retainers ?? body.data ?? [];
  const live = list.find((r: any) => r.status === 'ACTIVE');
  expect(live, 'the seed has no active retainer').toBeTruthy();
  return live;
};

// ── The retainer, correctable at last ───────────────────────────────────────

test.describe('editing a retainer', () => {
  test('opens filled in from the record, not blank', async ({ page }) => {
    const retainer = await activeRetainer();
    await page.goto(`/retainers/${retainer.id}`);

    await page.getByRole('button', { name: 'Edit retainer' }).click();
    await expect(page.getByRole('dialog', { name: 'Edit retainer' })).toBeVisible();

    // The figure it opens with has to be the one on the record. A modal that
    // opens empty and saves is how a rate gets wiped.
    await expect(page.getByLabel(/monthly value/i)).toHaveValue(String(Number(retainer.monthlyValue)));
    await expect(page.getByLabel(/start date/i)).not.toHaveValue('');
  });

  test('works the renewal date out rather than asking for one', async ({ page }) => {
    /*
     * §8 lists renewalDate as derived — start plus term. A field for it would
     * be a second writer for one value, and the one that skipped the formula
     * would win.
     */
    const retainer = await activeRetainer();
    await page.goto(`/retainers/${retainer.id}`);
    await page.getByRole('button', { name: 'Edit retainer' }).click();

    await page.getByLabel(/term \(months\)/i).fill('6');
    await expect(page.getByText(/Renews .* worked out from the start date and the term/)).toBeVisible();
    // There is no control to type one into.
    await expect(page.getByLabel(/renewal date/i)).toHaveCount(0);
  });

  test('asks what a new rate should do to the month in progress', async ({ page }) => {
    /*
     * A month card snapshots its revenue when it opens, so without this the
     * change is invisible until the next roll and the current month bills at
     * the old figure — with nothing saying so.
     */
    const retainer = await activeRetainer();
    await page.goto(`/retainers/${retainer.id}`);
    await page.getByRole('button', { name: 'Edit retainer' }).click();

    // Nothing has changed yet, so there is nothing to ask about.
    await expect(page.getByText(/Apply this to/)).toHaveCount(0);

    await page.getByLabel(/monthly value/i).fill(String(Number(retainer.monthlyValue) + 5000));
    await expect(page.getByText(/Apply this to/)).toBeVisible();
    await expect(page.getByText(/A month already closed or invoiced is left alone either way/)).toBeVisible();
  });

  test('a stopped retainer is not offered the button', async ({ page }) => {
    // Its months are closed and its figures have settled into MRR history.
    const body = await (await api.get('/api/retainers?limit=50&status=STOPPED')).json();
    const stopped = (body.retainers ?? body.data ?? [])[0];
    test.skip(!stopped, 'the seed has no stopped retainer');

    await page.goto(`/retainers/${stopped.id}`);
    await expect(page.getByRole('button', { name: 'Edit retainer' })).toHaveCount(0);
  });

  test('the server refuses it too, not just the screen', async () => {
    const body = await (await api.get('/api/retainers?limit=50&status=STOPPED')).json();
    const stopped = (body.retainers ?? body.data ?? [])[0];
    test.skip(!stopped, 'the seed has no stopped retainer');

    const res = await api.patch(`/api/retainers/${stopped.id}`, { data: { monthlyValue: 1 } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/been stopped/i);
  });

  test('refuses a rate of nothing', async () => {
    const retainer = await activeRetainer();
    const res = await api.patch(`/api/retainers/${retainer.id}`, { data: { monthlyValue: 0 } });
    expect(res.status()).toBe(400);
  });
});

// ── The document form, agreeing with the document ───────────────────────────

test.describe('the proforma form', () => {
  /** An unpaid proforma — the server refuses to edit one that has been paid. */
  const editableProforma = async () => {
    const body = await (await api.get('/api/proformas?limit=50')).json();
    const list = body.proformas ?? body.data ?? [];
    return list.find((p: any) => p.status === 'UNPAID');
  };

  test('shows the state by name, with no code in brackets', async ({ page }) => {
    /*
     * The printed document was changed to read "Tamil Nadu" and this form went
     * on reading "Tamil Nadu (33)" — the form and the document disagreeing on
     * screen about the same field, which nothing failed over.
     */
    const pf = await editableProforma();
    test.skip(!pf, 'the seed has no unpaid proforma to open');

    await page.goto(`/companies/${pf.companyId ?? pf.company?.id}`);
    await page.getByRole('tab', { name: /Invoices & Proformas/ }).click();
    await page.getByRole('button', { name: /^Edit$/ }).last().click();

    await expect(page.getByText('BILLED TO')).toBeVisible({ timeout: 15_000 });
    const modal = page.getByRole('dialog');
    await expect(modal).not.toContainText(/\(\d\d\)/);
    await expect(page.getByRole('combobox', { name: /client state/i })).toContainText(/[A-Za-z]/);
  });

  test('previews one GST line, as a proforma prints', async ({ page }) => {
    /*
     * A proforma is a quotation with no statutory format, so it shows the one
     * number the client cares about. A tax invoice must break the heads out —
     * Rule 46(m) — and that difference is easy to "tidy away" later, which is
     * what this holds.
     */
    const pf = await editableProforma();
    test.skip(!pf, 'the seed has no unpaid proforma to open');

    await page.goto(`/companies/${pf.companyId ?? pf.company?.id}`);
    await page.getByRole('tab', { name: /Invoices & Proformas/ }).click();
    await page.getByRole('button', { name: /^Edit$/ }).last().click();
    await expect(page.getByText('BILLED TO')).toBeVisible({ timeout: 15_000 });

    const modal = page.getByRole('dialog');
    await expect(modal.getByText(/GST @ \d+%/)).toBeVisible();
    // The split belongs on the invoice, not here.
    await expect(modal.getByText(/CGST @/)).toHaveCount(0);
    await expect(modal.getByText(/SGST @/)).toHaveCount(0);
  });
});

// ── The signatory box, which is now a choice ────────────────────────────────

test.describe('the signatory box', () => {
  test('Setup offers it, and the wording follows the setting', async ({ page }) => {
    /*
     * Sets the state it wants rather than reading whatever the last run left.
     *
     * The first version of this spec asserted the "on" wording and failed
     * because the value happened to be off — it was testing the database, not
     * the screen. Anything that depends on a shared setting has to arrange it
     * and put it back.
     */
    const before = (await (await api.get('/api/config')).json()).documentSettings.showSignatureBlock;
    try {
      await api.patch('/api/config/document-settings', { data: { showSignatureBlock: true } });
      await page.goto('/settings');
      await page.getByRole('button', { name: 'Documents & billing' }).click();

      await expect(page.getByLabel('Print the signatory box')).toBeChecked({ timeout: 15_000 });
      await expect(page.getByText(/above .?Authorised Signatory/)).toBeVisible();

      await api.patch('/api/config/document-settings', { data: { showSignatureBlock: false } });
      await page.reload();
      await page.getByRole('button', { name: 'Documents & billing' }).click();

      await expect(page.getByLabel('Print the signatory box')).not.toBeChecked({ timeout: 15_000 });
      await expect(page.getByText(/documents end at the bank details/)).toBeVisible();
    } finally {
      await api.patch('/api/config/document-settings', { data: { showSignatureBlock: before } });
    }
    const after = (await (await api.get('/api/config')).json()).documentSettings.showSignatureBlock;
    expect(after, 'the spec must leave this setting as it found it').toBe(before);
  });

  test('saves both ways, and goes back to how it was', async () => {
    const before = await (await api.get('/api/config')).json();
    const original = before.documentSettings.showSignatureBlock;
    try {
      await api.patch('/api/config/document-settings', { data: { showSignatureBlock: !original } });
      const flipped = await (await api.get('/api/config')).json();
      expect(flipped.documentSettings.showSignatureBlock).toBe(!original);
    } finally {
      await api.patch('/api/config/document-settings', { data: { showSignatureBlock: original } });
    }
    const after = await (await api.get('/api/config')).json();
    expect(after.documentSettings.showSignatureBlock).toBe(original);
  });

  test('refuses anything that is not a yes or a no', async () => {
    const res = await api.patch('/api/config/document-settings', { data: { showSignatureBlock: 'yes please' } });
    expect(res.status()).toBe(400);
  });

  test('document settings cannot write the fields /config owns', async () => {
    // One field, one writer. This endpoint used to accept the GSTIN and the
    // state without deriving the state code that decides CGST+SGST vs IGST.
    const res = await api.patch('/api/config/document-settings', {
      data: { gstNumber: '27AAAAA0000A1Z5', stateName: 'Maharashtra' },
    });
    // Accepted as a request, but those two are simply not part of its schema.
    const cfg = await (await api.get('/api/config')).json();
    expect(res.status()).toBeLessThan(500);
    expect(cfg.documentSettings.gstNumber).not.toBe('27AAAAA0000A1Z5');
  });
});
