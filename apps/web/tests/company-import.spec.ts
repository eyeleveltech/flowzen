import { test, expect } from '@playwright/test';
import { stateFor } from './helpers';

/**
 * The company importer's front door.
 *
 * The screen used to open on an empty file picker and one line of prose listing
 * the columns from memory — a list that had drifted from the parser in both
 * directions: it promised `country` and `zip`, and said nothing about `status`,
 * which decides whether an imported company is a prospect or somebody you
 * already work with.
 *
 * That drift is the thing these guard, because it cannot be caught any other
 * way: a column the parser ignores is not an error. It defaults, the import
 * succeeds, and two hundred companies are quietly wrong.
 */
test.describe('before you pick a file', () => {
  test.use({ storageState: stateFor('admin') });

  const openImport = async (page: import('@playwright/test').Page) => {
    // The rules are fetched, so waiting for the response is what makes the
    // assertions below about the server's list rather than a race.
    const listed = page.waitForResponse(
      (r) => r.url().includes('/companies/import/rules') && r.status() === 200,
      { timeout: 30_000 },
    );
    await page.goto('/companies');
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const modal = page.getByRole('dialog', { name: /Import companies/i });
    await expect(modal).toBeVisible({ timeout: 15_000 });
    await listed;
    return modal;
  };

  test('offers a template to start from', async ({ page }) => {
    const modal = await openImport(page);
    const link = modal.getByRole('link', { name: /Download template/i });
    await expect(link).toBeVisible();
    // Points at the importer's own endpoint, so the file and the parser can
    // never describe different columns.
    await expect(link).toHaveAttribute('href', /\/companies\/import\/template$/);
  });

  test('the template it serves is a real, importable file', async ({ page }) => {
    const modal = await openImport(page);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      modal.getByRole('link', { name: /Download template/i }).click(),
    ]);

    const stream = await download.createReadStream();
    const text = await new Promise<string>((resolve, reject) => {
      let out = '';
      stream.on('data', (c) => (out += c));
      stream.on('end', () => resolve(out));
      stream.on('error', reject);
    });

    expect(download.suggestedFilename()).toBe('flowzen-company-import-template.csv');
    // The rules travel WITH the file, as comment lines the parser skips, so they
    // cannot be separated from what they describe.
    expect(text).toContain('# Flowzen');
    const header = text.split(/\r?\n/).find((l) => !l.replace('﻿', '').startsWith('#'));
    expect(header).toContain('name');
    expect(header).toContain('status');
  });

  test('explains the columns, from the server rather than from memory', async ({ page }) => {
    const modal = await openImport(page);
    await modal.getByRole('button', { name: /What the columns mean/i }).click();

    const rules = modal.locator('dl');
    await expect(rules).toBeVisible();

    // The column the old hand-written list forgot, and the reason it matters.
    await expect(rules).toContainText('status');
    await expect(rules).toContainText('CLIENT');
    // The two silent defaults somebody has to know about, because neither fails.
    await expect(rules).toContainText('Defaults to Chennai');
    await expect(rules).toContainText('becomes B2B');
    // And what the importer does NOT take, so nobody expects money to arrive.
    await expect(rules).toContainText(/not imported/i);

    // `name` is the only required column, and it says so.
    await expect(rules.getByText('required')).toHaveCount(1);
  });
});
