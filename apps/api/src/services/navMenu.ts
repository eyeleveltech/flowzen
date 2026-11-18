/**
 * Each person's own menu (Ease Plan 3, decisions 9–12): the sidebar items they
 * pinned to the top, and the ones they hid into "Hidden (n)".
 *
 * ─── Pins never grant access ────────────────────────────────────────────────
 *
 * A saved href is only ever a preference about where a link sits. It is kept
 * only when the screen behind it is one this person is offered RIGHT NOW,
 * under exactly the rule the web's sidebar uses (`offered()` in
 * apps/web/src/config/navigation.ts):
 *
 *   needs           the permission switch, through `hasPermission` — the same
 *                   check `requirePermission` makes, setup.admin and the
 *                   Management bypass included;
 *   managementOnly  the PRESET, as `requireManagement()` gates the screen —
 *                   setup.admin does not stand in for it;
 *   headsOnly       they head an active department (My department). Management
 *                   reaches that page from Setup instead, so it is not theirs
 *                   to pin unless they head one too — the sidebar says the same.
 *
 * The web filters again when it draws, so an item somebody loses access to
 * simply disappears; the stored copy is corrected on their next save.
 *
 * ─── Why a copy of the list ─────────────────────────────────────────────────
 *
 * The web's NAV_ITEMS carries icons from lucide-react, which the API has no
 * business importing. This is the same list reduced to what the server needs —
 * href and gate — and `navMenu.test.ts` reads the web file's text and fails the
 * moment the two disagree about an href or a gate.
 */

import type { PermissionKey } from '@flowzen/shared';
import { hasPermission, type UserSession } from '../middleware/auth.js';
import { departmentsHeadedBy } from './departmentPage.js';

export interface MenuItemRule {
  href: string;
  needs?: PermissionKey;
  managementOnly?: boolean;
  headsOnly?: boolean;
}

/** NAV_ITEMS, in the sidebar's own order — href and gate only. */
export const MENU_ITEMS: readonly MenuItemRule[] = [
  // DAILY
  { href: '/my-work' },
  { href: '/calendar', needs: 'work.own' },
  { href: '/members', needs: 'work.team' },
  { href: '/my-department', needs: 'work.team', headsOnly: true },
  { href: '/all-work', needs: 'work.all' },
  // BUSINESS
  { href: '/companies', needs: 'company.read' },
  { href: '/outreach', needs: 'company.read' },
  { href: '/pipeline', needs: 'pipeline.read' },
  { href: '/quotations', needs: 'pipeline.read' },
  { href: '/live-work', needs: 'work.all' },
  // MANAGEMENT
  { href: '/brief', needs: 'reports.read' },
  { href: '/money', needs: 'money.figures' },
  { href: '/subscriptions', needs: 'money.figures', managementOnly: true },
  { href: '/forecast', needs: 'reports.read' },
  { href: '/logins', needs: 'reports.read', managementOnly: true },
  { href: '/assets' },
  // ADMIN
  { href: '/allocations', needs: 'cost.enter' },
  { href: '/settings', needs: 'setup.admin' },
];

/** The home page. It can be pinned, never hidden. */
export const HOME_HREF = '/my-work';

/**
 * The most hrefs one request may send per list. Every kept list is at most
 * MENU_ITEMS long anyway (unknown hrefs dropped, duplicates collapsed); this
 * only stops a body of ten thousand strings being walked at all.
 */
export const MENU_INPUT_MAX = 100;

const BY_HREF = new Map(MENU_ITEMS.map((item) => [item.href, item]));

/** Whether this item's own gate lets this person see it — `headsADepartment` asked only when it matters. */
export const offeredOnServer = (item: MenuItemRule, user: UserSession, headsADepartment: boolean): boolean =>
  (!item.needs || hasPermission(user, item.needs)) &&
  (!item.managementOnly || (user.active && user.preset === 'MANAGEMENT')) &&
  (!item.headsOnly || headsADepartment);

/** Known hrefs, first occurrence kept, in the order given. */
const known = (hrefs: readonly string[]): string[] => {
  const out: string[] = [];
  for (const href of hrefs) if (BY_HREF.has(href) && !out.includes(href)) out.push(href);
  return out;
};

/**
 * What is kept of a save: only items this person is offered now, each once,
 * pins in the order they were pinned. An href both pinned and hidden is
 * pinned. My Work is never hidden.
 */
export async function keptMenu(
  user: UserSession,
  body: { pinned: readonly string[]; hidden: readonly string[] },
): Promise<{ pinned: string[]; hidden: string[] }> {
  const pinnedIn = known(body.pinned);
  const hiddenIn = known(body.hidden).filter((href) => href !== HOME_HREF && !pinnedIn.includes(href));

  // The departments table is read only when a heads-only item was sent.
  const needsHeads = [...pinnedIn, ...hiddenIn].some((href) => BY_HREF.get(href)!.headsOnly);
  const heads = needsHeads && (await departmentsHeadedBy(user.organizationId, user.userId)).length > 0;

  const can = (href: string) => offeredOnServer(BY_HREF.get(href)!, user, heads);
  return { pinned: pinnedIn.filter(can), hidden: hiddenIn.filter(can) };
}
