import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BOTTOM_NAV_ITEMS, NAV_ITEMS } from './navigation';
import { SETTINGS_GROUPS } from './settingsTabs';

/**
 * Zen's guide to Flowzen covers every screen (Zen Plan 3).
 *
 * The guide is what Zen answers "how do I…" from, and the last written account
 * of this app went stale: task templates were removed and it still described
 * them. So a screen added to the sidebar, the bottom tabs or Settings without
 * a section in the guide fails here, naming the screen.
 *
 * A screen's section is a heading carrying its name — and, for the sidebar and
 * bottom tabs, its address, so the link Zen gives is the real one.
 */

const GUIDE = readFileSync(resolve(__dirname, '../../../api/src/services/zen/flowzen-guide.md'), 'utf8');
const HEADINGS = GUIDE.split(/\r?\n/).filter((l) => /^#{2,3} /.test(l));

const hasHeading = (...parts: string[]) => HEADINGS.some((h) => parts.every((p) => h.includes(p)));

describe("Zen's guide", () => {
  it.each([...NAV_ITEMS, ...BOTTOM_NAV_ITEMS].map((i) => [i.label, i.href]))(
    'has a section for %s (%s)',
    (label, href) => {
      expect(hasHeading(label, `(${href})`), `Add a "## ${label} (${href})" section to services/zen/flowzen-guide.md`).toBe(true);
    },
  );

  it.each(SETTINGS_GROUPS.flatMap((g) => g.tabs.map((t) => [t.label])))('has a section for Settings → %s', (label) => {
    expect(hasHeading(`Settings → ${label}`), `Add a "### Settings → ${label}" section to services/zen/flowzen-guide.md`).toBe(true);
  });
});
