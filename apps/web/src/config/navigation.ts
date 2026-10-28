import {
  Building2,
  CheckSquare,
  CalendarDays,
  Columns,
  ListChecks,
  Globe,
  RefreshCcw,
  Diamond,
  Square,
  AlignJustify,
  Sparkles,
  IndianRupee,
  Package,
  PieChart,
  Settings,
  User as UserIcon,
  UsersRound,
  LucideIcon,
} from 'lucide-react';
import type { PermissionKey } from '@flowzen/shared';

/**
 * What a person sees in the sidebar.
 *
 * ─── What this used to be ───────────────────────────────────────────────────
 *
 * A RANK LADDER. Every item named the roles allowed to see it, and a person's
 * role was scored 0-4 so that "at or above" decided the answer.
 *
 * A ladder cannot describe this agency. BD and HEAD are not two rungs — they
 * are two different jobs: BD sells and cannot see the work, HEAD runs the work
 * and cannot see the pipeline. Scoring HEAD above BD made the sidebar conclude
 * a department head outranks business development, so it offered them the
 * pipeline, the proposals and the client list. The server refused all three,
 * correctly, and a head's sidebar carried four links that only ever produced a
 * permission error. Accounts had the same problem in the other direction: a
 * Team link that 403'd, and no Money link on some readings even though money
 * is their whole job.
 *
 * ─── What it is now ─────────────────────────────────────────────────────────
 *
 * The SAME permission switches the API enforces. Every item names the
 * permission its own screen's first request requires, and the sidebar asks the
 * person's `permissions` — which every auth response already sends — exactly
 * as `requirePermission` does on the server.
 *
 * So a link is in the sidebar if and only if the screen behind it will open.
 * There is no second model to keep in step, and adding a screen means naming
 * the permission its route already asks for rather than guessing a rung.
 */

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /**
   * The permission this screen's OWN first request requires — not everything
   * that can be done once inside it. Undefined means everybody: /my-work and
   * /profile are the two screens a signed-in person always has.
   */
  needs?: PermissionKey;
  /**
   * Only for somebody who heads a department (`Department.headId` is them) —
   * My Department. Management reaches the same page from Settings →
   * Departments instead, without it in their sidebar.
   */
  headsOnly?: boolean;
  isPrimaryMobile?: boolean;
}

/** Who the navigation is being drawn for, as the auth payload describes them. */
export type NavUser = { permissions?: readonly string[]; headOf?: readonly string[]; preset?: string };

/** Heads at least one department. */
export const headsADepartment = (user: NavUser | null | undefined): boolean => (user?.headOf?.length ?? 0) > 0;

/** An item this person is offered: the permission switch, and for a heads-only item, a department to head. */
export const offered = (item: NavItem, user: NavUser | null | undefined): boolean =>
  canSee(item, user?.permissions) && (!item.headsOnly || headsADepartment(user));

export interface NavSection {
  title: string | null;
  items: NavItem[];
}

/**
 * Mirrors `hasPermission` on the server, master switch included: `setup.admin`
 * answers yes to everything there, so it has to answer yes to everything here
 * or an admin's own sidebar would hide screens they can open.
 */
export const canSee = (
  item: { needs?: PermissionKey },
  permissions: readonly string[] | undefined,
): boolean => {
  if (!item.needs) return true;
  if (!permissions || permissions.length === 0) return false;
  return permissions.includes(item.needs) || permissions.includes('setup.admin');
};

export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'DAILY',
    items: [
      // Everybody has their own work, so this names no permission at all.
      { label: 'My Work', href: '/my-work', icon: CheckSquare, isPrimaryMobile: true },
      // Everybody's too: what is on when, read through the same permissions as
      // each item's own screen, so it needs nothing of its own.
      { label: 'Calendar', href: '/calendar', icon: CalendarDays, isPrimaryMobile: true },
      { label: 'Team', href: '/members', icon: Columns, needs: 'work.team', isPrimaryMobile: true },
      /*
       * A head's own page for their department — people, work, calendar,
       * gear and the time split. `work.team` is what every head
       * holds (Department head and Management are the only presets a head can
       * have), and `headsOnly` keeps it to the people who actually head one.
       */
      { label: 'My department', href: '/my-department', icon: Building2, needs: 'work.team', headsOnly: true },
      /*
       * Everything anybody is carrying. `work.all` is Head and Management —
       * the same switch that opens Live work and a project — so BD and
       * Accounts do not get a list of what the studio is doing, and an
       * Employee has My Work above it.
       */
      { label: 'All tasks', href: '/all-work', icon: ListChecks, needs: 'work.all' },
    ],
  },
  {
    title: 'BUSINESS',
    items: [
      { label: 'Companies', href: '/companies', icon: Globe, needs: 'company.read', isPrimaryMobile: true },
      { label: 'Outreach list', href: '/outreach', icon: RefreshCcw, needs: 'company.read' },
      { label: 'Pipeline', href: '/pipeline', icon: Diamond, needs: 'pipeline.read', isPrimaryMobile: true },
      { label: 'Proposals', href: '/quotations', icon: Square, needs: 'pipeline.read' },
      { label: 'Live work', href: '/live-work', icon: AlignJustify, needs: 'work.all', isPrimaryMobile: true },
    ],
  },
  {
    title: 'MANAGEMENT',
    items: [
      { label: 'Monday brief', href: '/brief', icon: Sparkles, needs: 'reports.read' },
      // The figures, not the paid/unpaid status — this screen opens with
      // retainer profitability, which is `money.figures` on the server.
      { label: 'Money', href: '/money', icon: IndianRupee, needs: 'money.figures', isPrimaryMobile: true },
      { label: 'Forecast', href: '/forecast', icon: PieChart, needs: 'reports.read' },
      // No `needs` — the catalogue itself is open to everybody signed in, and
      // the gates are inside the screen: `asset.manage` to hand anything over,
      // `money.figures` for the prices, both enforced by the server.
      //
      // It sits under MANAGEMENT because owning equipment is a management
      // concern, not a daily one. It is also the ONE ungated item in a section
      // where everything else needs a key — see `visibleSections` for what an
      // Employee is therefore shown, which is the row without the heading.
      { label: 'Assets', href: '/assets', icon: Package },
    ],
  },
  {
    title: 'ADMIN',
    items: [
      { label: 'Time split', href: '/allocations', icon: UsersRound, needs: 'cost.enter' },
      { label: 'Setup', href: '/settings', icon: Settings, needs: 'setup.admin' },
    ],
  },
];

export const BOTTOM_NAV_ITEMS: NavItem[] = [
  { label: 'Profile', href: '/profile', icon: UserIcon },
];

export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

/**
 * The sections this person actually has, headings included.
 *
 * A heading GROUPS things, and one filtered down to a single row is grouping
 * nothing — it is just a word above a link, and the word is frequently wrong
 * about the link. An Employee carries `work.own` and nothing else, so of the
 * four items under MANAGEMENT only the ungated asset register survives, and
 * their sidebar read:
 *
 *     MANAGEMENT
 *       Assets
 *
 * Nothing about looking up who has the 24-70mm is management, and the heading
 * told them so twice a day. The other fix on offer was to gate Assets on
 * `work.team`, which trades a cosmetic problem for a real one: the register
 * would then be hidden from precisely the designers and shooters who carry the
 * gear, and the point of a register is that the person holding a thing can see
 * it is theirs.
 *
 * So the heading goes instead of the row, and the rule is general rather than a
 * special case for one item — "DAILY / My Work" alone labels no more than
 * "MANAGEMENT / Assets" does. Sections keep their titles the moment a second
 * item appears under them, which is what everybody except an Employee sees.
 */
export const visibleSections = (user: NavUser | null | undefined): NavSection[] => {
  if (!user?.permissions) return [];

  return NAV_SECTIONS.map((section) => {
    const items = section.items.filter((item) => offered(item, user));
    return { ...section, items, title: items.length > 1 ? section.title : null };
  }).filter((section) => section.items.length > 0);
};

/**
 * What a typed or bookmarked URL requires, for the one guard the layout keeps.
 *
 * The sidebar already leaves out what a person cannot open, so this only ever
 * fires on a URL somebody typed or kept a bookmark to. It replaces a guard that
 * asked whether the ORGANISATION had a "module" — a concept that no longer
 * exists, and whose check returned early on a field the API stopped sending, so
 * it never fired at all.
 */
/**
 * The screens that are not in the sidebar, and what they need anyway.
 *
 * `permissionForPath` reads NAV_ITEMS, so a route with no nav entry answered
 * `undefined` — and `undefined` means "open to everybody". `/projects/[id]` and
 * `/retainers/[id]` are reached by clicking through Live work rather than from
 * the sidebar, so neither had an entry, and neither was guarded: anybody who
 * kept the URL could mount a client's project record. The server still masked
 * every figure and refused every request behind it, so nothing leaked — but the
 * screen assembled itself out of refusals, which is a worse answer than the
 * redirect the guard exists to give.
 *
 * Each names the permission its own first request already asks for
 * (`GET /projects/:id` and `GET /retainers/:id` are both `work.all`).
 */
const UNLISTED_ROUTES: { prefix: string; needs: PermissionKey }[] = [
  { prefix: '/projects', needs: 'work.all' },
  { prefix: '/retainers', needs: 'work.all' },
];

/**
 * A heads-only screen at this address — My Department — beyond its permission.
 *
 * The permission (`work.team`) is not the whole rule: a Department head who
 * heads nothing holds it too. So the layout also asks this: open to anybody
 * who heads a department, and to Management (who reach it from Settings).
 * `unknown` until the session has said which departments they head.
 */
export const headsOnlyAccess = (pathname: string, user: NavUser | null | undefined): 'open' | 'refused' | 'unknown' => {
  const item = NAV_ITEMS.find((i) => i.headsOnly && (pathname === i.href || pathname.startsWith(i.href + '/')));
  if (!item) return 'open';
  if (user?.preset === 'MANAGEMENT') return 'open';
  if (!user?.headOf) return 'unknown';
  return headsADepartment(user) ? 'open' : 'refused';
};

export const permissionForPath = (pathname: string): PermissionKey | undefined =>
  NAV_ITEMS.find((item) => pathname === item.href || pathname.startsWith(item.href + '/'))?.needs ??
  UNLISTED_ROUTES.find((r) => pathname === r.prefix || pathname.startsWith(r.prefix + '/'))?.needs;

/**
 * What the sidebar calls the screen at this address — "Money" for /money and
 * anything under it — for the message that says somebody cannot open it.
 * Undefined for a screen the sidebar does not list (a project, a retainer).
 */
export const screenNameForPath = (pathname: string): string | undefined =>
  [...NAV_ITEMS, ...BOTTOM_NAV_ITEMS].find((item) => pathname === item.href || pathname.startsWith(item.href + '/'))
    ?.label;
