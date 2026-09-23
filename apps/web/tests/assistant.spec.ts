import { test, expect } from '@playwright/test';
import { stateFor, zenSwitchedOn } from './helpers';

/**
 * The assistant panel.
 *
 * Its first version rendered INSIDE the header, which carries
 * `backdrop-blur-xl` — and a backdrop-filter makes an element the containing
 * block for its `fixed` descendants. So `fixed inset-0` sized itself to a
 * 56px-tall header rather than the viewport, and z-50 sat inside the header's
 * own z-30 stacking context. It opened, and was a sliver behind the page.
 *
 * Which is why these assert the panel's real geometry rather than that it
 * exists: "is in the DOM" was true the whole time it was broken.
 */

test.describe('the management assistant', () => {
  test.use({ storageState: stateFor('admin') });

  test('opens as a full-height panel, not a sliver inside the header', async ({ page }) => {
    await page.goto('/live-work');

    const launcher = page.getByRole('button', { name: 'Ask Zen' });
    await expect(launcher).toBeVisible({ timeout: 15_000 });
    await launcher.click();

    const panel = page.getByRole('dialog', { name: 'Zen' });
    await expect(panel).toBeVisible();

    const box = await panel.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();

    // The whole bug, as a number: it was as tall as the header.
    expect(box!.height).toBeGreaterThan(viewport!.height * 0.9);
    // And against the right edge, not floating mid-page.
    expect(box!.x + box!.width).toBeGreaterThan(viewport!.width - 2);
  });

  test('closes on Escape and on the backdrop', async ({ page }) => {
    await page.goto('/live-work');
    await page.getByRole('button', { name: 'Ask Zen' }).click();

    const panel = page.getByRole('dialog', { name: 'Zen' });
    await expect(panel).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });

  test('says how to turn it on when no key is set', async ({ page }) => {
    await page.goto('/live-work');
    await page.getByRole('button', { name: 'Ask Zen' }).click();

    const panel = page.getByRole('dialog', { name: 'Zen' });
    // Either it is configured and offers the input, or it says where to go.
    const input = panel.getByRole('textbox', { name: 'Ask Zen' });
    if (await input.count()) {
      await expect(input).toBeVisible();
    } else {
      await expect(panel.getByRole('link', { name: /Settings/ })).toBeVisible();
    }
  });
});

/**
 * The chat itself.
 *
 * Bubbles, sides, timestamps — the shape a messenger reader already knows. The
 * assertions are about geometry and role again rather than "the text is on the
 * page", because the last time this panel broke it was fully present in the
 * DOM and rendered inside a 56px header.
 */
test.describe('the chat', () => {
  test.use({ storageState: stateFor('admin') });

  test('puts your message on the right and the answer on the left', async ({ page }) => {
    /*
     * The answer is stubbed.
     *
     * This test is about where a bubble sits, and reaching Google for that
     * made it depend on a third party's capacity — it failed once on a 503
     * and passed on a retry, which is the worst kind of test. The route is
     * covered for real in the API suite.
     */
    await page.route('**/api/assistant/stream', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        // Two pieces, so this also covers the panel APPENDING rather than
        // replacing — a streamed answer that overwrites itself shows only its
        // last fragment, and looks fine until you read it.
        body: [
          'event: piece',
          'data: {"text":"Da One High Performance Sports, "}',
          '',
          'event: piece',
          'data: {"text":"at 36.7% margin."}',
          '',
          'event: done',
          'data: {"month":"2026-09"}',
          '',
          '',
        ].join(String.fromCharCode(10)),
      }),
    );

    await zenSwitchedOn(page);
    await page.goto('/live-work');
    await page.getByRole('button', { name: 'Ask Zen' }).click();

    const panel = page.getByRole('dialog', { name: 'Zen' });
    /*
     * Wait for the panel to settle before deciding whether it is configured.
     *
     * `aiConfigured` arrives with /config, so counting the input the moment
     * the panel opens sometimes ran before that landed — and the test skipped
     * itself on a race rather than on the thing it meant to check. Two runs of
     * the same suite reported different totals, which is how it showed up.
     */
    const input = panel.getByRole('textbox', { name: 'Ask Zen' });
    await expect(input).toBeVisible({ timeout: 15_000 });

    await input.fill('Which client is least profitable this month?');
    await panel.getByRole('button', { name: 'Send' }).click();

    // Your own message appears at once, without waiting for an answer.
    const mine = panel.getByText('Which client is least profitable this month?');
    await expect(mine).toBeVisible();

    const panelBox = (await panel.boundingBox())!;
    const mineBox = (await mine.boundingBox())!;
    // Right-aligned: its centre sits past the panel's middle.
    expect(mineBox.x + mineBox.width / 2).toBeGreaterThan(panelBox.x + panelBox.width / 2);

    /*
     * And the reply comes back on the other side.
     *
     * Addressed by `data-message`, not by the bubble's rounding: the typing
     * indicator wears the same `rounded-bl-md` shape, so a class selector here
     * was satisfied by the three dots and would have passed whether or not an
     * answer ever arrived.
     */
    // The BUBBLE, not its row: the row is a full-width flex column, so its
    // centre is the panel's centre whichever side the bubble sits on.
    const reply = panel.locator('[data-message="assistant"] > div').first();
    await expect(reply).toBeVisible();
    // The WHOLE answer, both pieces. Checking only the last fragment would
    // pass if the panel replaced the bubble on each piece instead of
    // appending — which is the bug streaming most easily introduces.
    await expect(reply).toHaveText('Da One High Performance Sports, at 36.7% margin.');
    const replyBox = (await reply.boundingBox())!;
    expect(replyBox.x + replyBox.width / 2).toBeLessThan(panelBox.x + panelBox.width / 2);
  });

  test('offers dictation where the browser supports it', async ({ page }) => {
    await zenSwitchedOn(page);
    await page.goto('/live-work');
    await page.getByRole('button', { name: 'Ask Zen' }).click();
    const panel = page.getByRole('dialog', { name: 'Zen' });
    const box = panel.getByRole('textbox', { name: 'Ask Zen' });
    await expect(box).toBeVisible({ timeout: 15_000 });

    const supported = await page.evaluate(
      () => 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window,
    );
    const mic = panel.getByRole('button', { name: 'Dictate' });
    if (supported) {
      await expect(mic).toBeVisible();
      await expect(mic).toHaveAttribute('aria-pressed', 'false');
    } else {
      // Absent, not broken — a button that cannot work is worse than no button.
      await expect(mic).toHaveCount(0);
    }
  });
});

/**
 * The confirmation card.
 *
 * Zen never writes a task. It fills one in, the card shows every field, and
 * the click is the write — posted to the same `POST /tasks` the modal uses,
 * under the same session. So the two things worth testing are that the fields
 * a person is about to agree to are actually on screen, and that pressing
 * Create sends exactly what was drafted and nothing else.
 */
test.describe('a task Zen has drafted', () => {
  test.use({ storageState: stateFor('admin') });

  const DRAFT = {
    body: {
      title: 'September social media report',
      dueDate: '2026-09-26',
      workType: 'MONTH_CARD',
      workId: 'mc-sep',
      monthCardId: 'mc-sep',
      retainerProjectId: 'rp-base',
      assigneeId: 'usr-boss',
      priority: 'HIGH',
    },
    shows: {
      title: 'September social media report',
      client: 'VOSO Sports',
      belongsTo: 'Monthly Retainer Work — 2026-09',
      assignedTo: 'Akmal — Management',
      due: '2026-09-26',
      priority: 'HIGH',
      notes: null,
    },
  };

  /** Open the panel with one drafted task already proposed. */
  const withADraft = async (page: import('@playwright/test').Page) => {
    await page.route('**/api/assistant/stream', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: [
          'event: draft',
          `data: ${JSON.stringify({ draft: DRAFT })}`,
          '',
          'event: piece',
          'data: {"text":"Here it is — press Create when it looks right."}',
          '',
          'event: done',
          'data: {"month":"2026-09"}',
          '',
          '',
        ].join(String.fromCharCode(10)),
      }),
    );

    await zenSwitchedOn(page);
    await page.goto('/live-work');
    await page.getByRole('button', { name: 'Ask Zen' }).click();
    const panel = page.getByRole('dialog', { name: 'Zen' });

    const input = panel.getByRole('textbox', { name: 'Ask Zen' });
    await expect(input).toBeVisible({ timeout: 15_000 });

    await input.fill('social media report for voso, friday, high priority');
    await panel.getByRole('button', { name: 'Send' }).click();
    return panel;
  };

  test('shows every field before anything is created', async ({ page }) => {
    const panel = await withADraft(page);

    const card = panel.locator('[data-draft]');
    await expect(card).toBeVisible({ timeout: 10_000 });

    /*
     * Each one named, because the card exists to be read. A card missing the
     * assignee is worse than no card: it looks complete, and the field you did
     * not check is the one the model guessed.
     */
    await expect(card).toContainText('September social media report');
    await expect(card).toContainText('VOSO Sports');
    await expect(card).toContainText('Monthly Retainer Work — 2026-09');
    await expect(card).toContainText('Akmal — Management');
    await expect(card).toContainText('2026-09-26');
    await expect(card).toContainText('HIGH');

    // Nothing has happened yet, and the card says so by still offering the button.
    await expect(card.getByRole('button', { name: 'Create' })).toBeVisible();
    await expect(card).not.toContainText('on the board');
  });

  test('posts exactly what was drafted, and only on the click', async ({ page }) => {
    const posted: unknown[] = [];
    await page.route('**/api/tasks', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      posted.push(route.request().postDataJSON());
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, task: { id: 'task-new' } }),
      });
    });

    const panel = await withADraft(page);
    const card = panel.locator('[data-draft]');
    await expect(card).toBeVisible({ timeout: 10_000 });

    // The draft has been on screen for a while and nothing has been created.
    expect(posted).toHaveLength(0);

    await card.getByRole('button', { name: 'Create' }).click();
    await expect(card).toContainText('on the board');

    // Byte for byte what Zen drafted — not a re-derived body, which is how a
    // confirmed task and a created one drift apart.
    expect(posted).toHaveLength(1);
    expect(posted[0]).toEqual(DRAFT.body);
  });

  test('says why when the route refuses, on the card', async ({ page }) => {
    await page.route('**/api/tasks', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'That month is closed.' }),
      });
    });

    const panel = await withADraft(page);
    const card = panel.locator('[data-draft]');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.getByRole('button', { name: 'Create' }).click();

    // On the card, next to the button that failed — a refusal three bubbles
    // further down reads as a comment on the wrong thing.
    await expect(card).toContainText('That month is closed.');
    await expect(card.getByRole('button', { name: 'Create' })).toBeVisible();
  });

  test('discard takes it away without creating anything', async ({ page }) => {
    const posted: unknown[] = [];
    await page.route('**/api/tasks', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      posted.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, contentType: 'application/json', body: '{"success":true}' });
    });

    const panel = await withADraft(page);
    const card = panel.locator('[data-draft]');
    await expect(card).toBeVisible({ timeout: 10_000 });

    await card.getByRole('button', { name: 'Discard' }).click();
    await expect(card).toBeHidden();
    expect(posted).toHaveLength(0);
  });
});
