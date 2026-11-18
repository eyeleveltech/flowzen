/**
 * Each person's own menu (Ease Plan 3, decisions 9–12): Pinned at the top,
 * Hidden (n) at the bottom, and the phone's tabs built from the pins.
 *
 * The rule these hold above everything else: pins never grant access. Every
 * helper asks `offered()` again, so a pin on a screen somebody can no longer
 * open simply is not drawn — not in Pinned, not in Hidden, not as a tab.
 */

import { describe, it, expect } from 'vitest';
import { ROLE_PRESET_PERMISSIONS, type RolePreset } from '@flowzen/shared';
import {
  NAV_ITEMS,
  BOTTOM_NAV_ITEMS,
  HOME_HREF,
  offered,
  visibleSections,
  menuFor,
  pinnedItems,
  hiddenItems,
  bottomTabsFor,
  moreSheetFor,
  withPinToggled,
  withHiddenToggled,
  type MenuUser,
} from './navigation';

const as = (preset: RolePreset, menu: { pinned?: string[]; hidden?: string[] } = {}): MenuUser => ({
  permissions: ROLE_PRESET_PERMISSIONS[preset],
  preset,
  headOf: [],
  navPinned: menu.pinned,
  navHidden: menu.hidden,
});

const hrefs = (items: { href: string }[]) => items.map((i) => i.href);
const sectionHrefs = (user: MenuUser) => menuFor(user).sections.flatMap((s) => hrefs(s.items));

describe('Pinned, the usual sections, Hidden (n)', () => {
  it('puts pins at the top in the order pinned, and shows each item once', () => {
    const user = as('MANAGEMENT', { pinned: ['/money', '/calendar'] });
    const { pinned, hidden } = menuFor(user);
    expect(hrefs(pinned)).toEqual(['/money', '/calendar']);
    expect(hidden).toEqual([]);
    expect(sectionHrefs(user)).not.toContain('/money');
    expect(sectionHrefs(user)).not.toContain('/calendar');
    // Everything else is exactly where it was.
    const usual = hrefs(visibleSections(as('MANAGEMENT')).flatMap((s) => s.items));
    expect(sectionHrefs(user)).toEqual(usual.filter((h) => h !== '/money' && h !== '/calendar'));
  });

  it('unpinning puts the item straight back in its usual place', () => {
    const before = as('MANAGEMENT');
    const unpinned = as('MANAGEMENT', withPinToggled(withPinToggled({ pinned: [], hidden: [] }, '/money'), '/money'));
    expect(sectionHrefs(unpinned)).toEqual(sectionHrefs(before));
  });

  it('moves a hidden item into Hidden (n), in the menu’s own order', () => {
    const user = as('MANAGEMENT', { hidden: ['/forecast', '/brief'] });
    expect(hrefs(menuFor(user).hidden)).toEqual(['/brief', '/forecast']);
    expect(sectionHrefs(user)).not.toContain('/forecast');
    expect(sectionHrefs(user)).not.toContain('/brief');
  });

  it('never hides My Work, and pinned wins over hidden', () => {
    const user = as('EMPLOYEE', { pinned: ['/calendar'], hidden: [HOME_HREF, '/calendar', '/assets'] });
    expect(hrefs(hiddenItems(user))).toEqual(['/assets']);
    expect(hrefs(pinnedItems(user))).toEqual(['/calendar']);
    expect(sectionHrefs(user)).toEqual([HOME_HREF]);
  });

  it('ignores hrefs that are not menu items, and duplicates', () => {
    const user = as('MANAGEMENT', { pinned: ['/money', '/profile', '/nope', '/money'], hidden: ['/projects/x'] });
    expect(hrefs(pinnedItems(user))).toEqual(['/money']);
    expect(hiddenItems(user)).toEqual([]);
  });

  it('draws nothing before the session is known', () => {
    expect(menuFor(null)).toEqual({ pinned: [], sections: [], hidden: [] });
    expect(bottomTabsFor(null)).toEqual([]);
  });
});

describe('pins never grant access', () => {
  it('an item they lost access to disappears from Pinned and Hidden', () => {
    // Pinned Money while they held money.figures; it was taken away.
    const user = as('EMPLOYEE', { pinned: ['/money', '/calendar'], hidden: ['/forecast'] });
    expect(hrefs(pinnedItems(user))).toEqual(['/calendar']);
    expect(hiddenItems(user)).toEqual([]);
    expect(sectionHrefs(user)).not.toContain('/money');
  });

  it('a Management-only item stays away from a setup.admin who is not Management', () => {
    const admin: MenuUser = {
      permissions: [...ROLE_PRESET_PERMISSIONS.HEAD, 'setup.admin'],
      preset: 'HEAD',
      headOf: [],
      navPinned: ['/logins', '/settings'],
    };
    expect(hrefs(pinnedItems(admin))).toEqual(['/settings']);
  });

  it('My department only for somebody who heads one', () => {
    expect(pinnedItems(as('HEAD', { pinned: ['/my-department'] }))).toEqual([]);
    expect(hrefs(pinnedItems({ ...as('HEAD', { pinned: ['/my-department'] }), headOf: ['d-dev'] }))).toEqual(['/my-department']);
  });

  it('every item drawn anywhere is one they are offered', () => {
    for (const preset of ['EMPLOYEE', 'HEAD', 'BD', 'ACCOUNTS', 'MANAGEMENT'] as RolePreset[]) {
      const all = NAV_ITEMS.map((i) => i.href);
      const user = as(preset, { pinned: all.slice(0, 9), hidden: all.slice(9) });
      const { pinned, sections, hidden } = menuFor(user);
      for (const item of [...pinned, ...sections.flatMap((s) => s.items), ...hidden, ...bottomTabsFor(user)]) {
        expect(offered(item, user), `${preset} ${item.href}`).toBe(true);
      }
    }
  });
});

describe('the phone’s tabs', () => {
  /** Today's rule, written out: the first four primaries they can open. */
  const defaultTabs = (user: MenuUser) => NAV_ITEMS.filter((i) => i.isPrimaryMobile && offered(i, user)).slice(0, 4);

  it('with pins: My Work and the first three pins', () => {
    const user = as('MANAGEMENT', { pinned: ['/money', '/calendar', '/forecast', '/logins'] });
    expect(hrefs(bottomTabsFor(user))).toEqual([HOME_HREF, '/money', '/calendar', '/forecast']);
  });

  it('with fewer than three pins: My Work and those', () => {
    expect(hrefs(bottomTabsFor(as('MANAGEMENT', { pinned: ['/money'] })))).toEqual([HOME_HREF, '/money']);
  });

  it('My Work pinned is not counted twice', () => {
    const user = as('MANAGEMENT', { pinned: [HOME_HREF, '/money', '/calendar', '/forecast'] });
    expect(hrefs(bottomTabsFor(user))).toEqual([HOME_HREF, '/money', '/calendar', '/forecast']);
  });

  it('with no pins: today’s default, exactly', () => {
    for (const preset of ['EMPLOYEE', 'HEAD', 'BD', 'ACCOUNTS', 'MANAGEMENT'] as RolePreset[]) {
      expect(bottomTabsFor(as(preset)), preset).toEqual(defaultTabs(as(preset)));
    }
  });

  it('pins they can no longer open do not count — back to the default', () => {
    const user = as('EMPLOYEE', { pinned: ['/money'] });
    expect(bottomTabsFor(user)).toEqual(defaultTabs(user));
  });

  it('More holds what the tabs leave out, in the sidebar’s shape — the default unchanged', () => {
    const plain = as('MANAGEMENT');
    const tabs = bottomTabsFor(plain);
    const sheet = moreSheetFor(plain, tabs);
    // Exactly the list More showed before menus existed.
    expect([...sheet.items, ...BOTTOM_NAV_ITEMS]).toEqual(
      [...NAV_ITEMS.filter((i) => !tabs.includes(i)), ...BOTTOM_NAV_ITEMS].filter((i) => offered(i, plain)),
    );
    expect(sheet.pinned).toEqual([]);

    const user = as('MANAGEMENT', { pinned: ['/money', '/calendar', '/forecast', '/logins'], hidden: ['/brief'] });
    const mine = moreSheetFor(user, bottomTabsFor(user));
    expect(hrefs(mine.pinned)).toEqual(['/logins']);
    expect(hrefs(mine.hidden)).toEqual(['/brief']);
    expect(hrefs(mine.items)).not.toContain('/money');
    expect(hrefs(mine.items)).not.toContain(HOME_HREF);
  });
});

describe('pin and hide', () => {
  const none = { pinned: [], hidden: [] };

  it('pins at the end, and pinning a hidden item brings it back', () => {
    expect(withPinToggled({ pinned: ['/money'], hidden: [] }, '/calendar')).toEqual({ pinned: ['/money', '/calendar'], hidden: [] });
    expect(withPinToggled({ pinned: [], hidden: ['/forecast'] }, '/forecast')).toEqual({ pinned: ['/forecast'], hidden: [] });
    expect(withPinToggled({ pinned: ['/money', '/calendar'], hidden: [] }, '/money')).toEqual({ pinned: ['/calendar'], hidden: [] });
  });

  it('hiding a pinned item unpins it; My Work never hides', () => {
    expect(withHiddenToggled({ pinned: ['/money'], hidden: [] }, '/money')).toEqual({ pinned: [], hidden: ['/money'] });
    expect(withHiddenToggled({ pinned: [], hidden: ['/money'] }, '/money')).toEqual(none);
    expect(withHiddenToggled(none, HOME_HREF)).toEqual(none);
  });
});
