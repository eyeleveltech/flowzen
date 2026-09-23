import { test, expect } from '@playwright/test';
import { stateFor } from './helpers';

/**
 * Choosing which AI answers.
 *
 * Zen was a Gemini client — the key, the model, the wire format and the word
 * "Gemini" in the label. The point of this card is that it is now a choice, and
 * the two things worth driving in a browser are the ones a typecheck cannot
 * see: that the provider list actually arrives from the server, and that
 * picking one changes the form to match it.
 */
test.describe('which AI Zen asks', () => {
  test.use({ storageState: stateFor('admin') });

  const openZen = async (page: import('@playwright/test').Page) => {
    /*
     * Wait for every fetch this page re-renders on, not just for the dropdown
     * to appear.
     *
     * Settings loads its config, the provider list, the team and the audit log
     * separately, and each one that lands rebuilds the form — which DETACHES
     * the option mid-click. Playwright re-resolves, the next render detaches it
     * again, and the test times out having found the right element every time.
     * Spread out under a parallel run that is most of the time.
     *
     * `networkidle` looked like the tidy answer and never settles on this page.
     * Naming the four is duller and deterministic.
     */
    const settled = Promise.all(
      ['/assistant/providers', '/config/audit-log', '/users'].map((path) =>
        page.waitForResponse((r) => r.url().includes(path), { timeout: 30_000 }),
      ),
    );
    await page.goto('/settings');
    await settled;

    const provider = page.getByRole('combobox', { name: 'Provider' });
    await expect(provider).toBeVisible({ timeout: 15_000 });
    return provider;
  };

  /**
   * FieldSelect is a listbox, not a native select — open it, then pick.
   *
   * Choosing a provider rebuilds the form below it, so the wait at the end is
   * not politeness: without it the next `choose` clicks an option that is being
   * replaced underneath it, and the run fails on "element is not stable" every
   * few goes.
   */
  const choose = async (page: import('@playwright/test').Page, label: string) => {
    const box = page.getByRole('combobox', { name: 'Provider' });
    await box.click();
    await page.getByRole('option', { name: label, exact: true }).click();
    await expect(box).toContainText(label);
  };

  test('offers every provider the server has an adapter for', async ({ page }) => {
    const provider = await openZen(page);

    // Fetched, not written into the page — so this failing means the list and
    // the adapters have drifted apart, which is the bug worth catching.
    await provider.click();
    const names = await page.getByRole('option').allInnerTexts();
    expect(names.map((n) => n.trim())).toEqual([
      'Gemini',
      'OpenAI',
      'Anthropic',
      'OpenAI-compatible',
    ]);
  });

  test('asks for an address only where the provider has no home', async ({ page }) => {
    await openZen(page);
    const address = page.getByLabel('API address');

    // The three named providers know their own endpoints.
    await choose(page, 'Anthropic');
    await expect(address).toHaveCount(0);

    await choose(page, 'OpenAI-compatible');
    await expect(address).toBeVisible();
    await expect(address).toHaveAttribute('placeholder', /openrouter|v1/i);
  });

  test('changes the model when the provider changes', async ({ page }) => {
    /*
     * A model name means nothing outside its provider. Leaving the old one
     * would offer `gemini-2.5-flash` to OpenAI and produce a 404 at the moment
     * somebody asks a question — which reads as Zen being broken rather than a
     * setting being wrong.
     */
    await openZen(page);
    const model = page.getByLabel('Model');

    await choose(page, 'Anthropic');
    await expect(model).toHaveValue(/^claude-/);

    await choose(page, 'OpenAI');
    await expect(model).toHaveValue(/^gpt-/);

    await choose(page, 'Gemini');
    await expect(model).toHaveValue(/^gem/);
  });
});
