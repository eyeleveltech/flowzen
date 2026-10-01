import type { PermissionKey } from '@flowzen/shared';
import { hasPermission, type AuthRequest } from '../middleware/auth.js';

/**
 * Where a record opens, for anything that links to one — the bell and the
 * calendar today.
 *
 * The bell's links used to be built as `/${entityType.toLowerCase()}s/${id}`,
 * which produced a real page for exactly two of the eight entity types in use.
 * `Company` became `/companys/…`; Task, Proforma, User, Proposal and Invoice
 * have no detail page at all. Thirty-six of the forty-four open alerts led to a
 * hard 404 — verified by following each one.
 *
 * So: a record with a page opens that record, and a record without one opens
 * the screen where you can actually deal with it. `null` means it is not a
 * link, which is honest and better than a dead one.
 */

/**
 * What each landing screen asks for, so a link is only given when it opens.
 *
 * Mirrors config/navigation.ts on the web and the route guards behind it.
 * `null` means the screen is open to anybody signed in.
 */
const SCREEN_PERMISSION: Record<string, PermissionKey | null> = {
  '/my-work': null,
  '/calendar': null,
  '/assets': null,
  '/members': 'work.team',
  '/companies': 'company.read',
  '/outreach': 'company.read',
  '/quotations': 'pipeline.read',
  '/live-work': 'work.all',
  '/projects': 'work.all',
  '/retainers': 'work.all',
  '/money': 'money.figures',
  '/allocations': 'cost.enter',
};

/**
 * The page for a record, whoever is asking.
 *
 * `parentId` is for the one record whose address needs its parent: a
 * retainer's project lives under its retainer.
 */
export const rawLinkFor = (entityType: string, entityId: string, parentId?: string): string | null => {
  switch (entityType) {
    case 'Project':
      return `/projects/${entityId}`;
    case 'Retainer':
      return `/retainers/${entityId}`;
    case 'RetainerProject':
      return parentId ? `/retainers/${parentId}/projects/${entityId}` : null;
    case 'Company':
      return `/companies/${entityId}`;
    case 'Asset':
      return `/assets/${entityId}`;
    // No page of their own — the list that holds them is the useful landing.
    case 'Task':
      return '/my-work';
    case 'User':
      return '/members';
    case 'Invoice':
      return '/money';
    case 'OutreachEntry':
      return '/outreach';
    case 'Proposal':
    case 'Proforma':
      return '/quotations';
    // A retainer month's alerts are all about billing it, and the billing
    // board is where that is done — and the one screen Accounts can open.
    case 'MonthCard':
      return '/money?tab=billing';
    case 'Organization':
      return '/allocations';
    // A meeting or shoot opens on the calendar, in its drawer.
    case 'CalendarEvent':
      return `/calendar?event=${entityId}`;
    default:
      return null;
  }
};

/**
 * The link, but only if this person can follow it.
 *
 * Telling somebody about something and then sending them to a screen they
 * cannot open is worse than no link: the row keeps its sentence and loses its
 * link instead. The screen is read without its query string, so
 * `/money?tab=billing` is checked as `/money`.
 */
export const linkForUser = (
  entityType: string,
  entityId: string,
  user: AuthRequest['user'],
  parentId?: string,
): string | null => {
  const href = rawLinkFor(entityType, entityId, parentId);
  if (!href || !user) return href;
  const base = '/' + href.split(/[/?]/)[1];
  const needed = SCREEN_PERMISSION[base];
  if (needed && !hasPermission(user, needed)) return null;
  return href;
};

/**
 * One task, opened: its drawer on My Work, or — when it is not on the person's
 * own desk — the read-only view drawn from its history. My Work decides which.
 */
export const taskLink = (taskId: string): string => `/my-work?task=${taskId}`;
