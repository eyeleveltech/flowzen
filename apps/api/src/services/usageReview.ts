import { AlertSeverity } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { emitToOrganization } from '../liveStream.js';
import { hasPermission, resolvePermissions, type UserSession } from '../middleware/auth.js';
import { forgetAlertClauses } from './alertClauseCache.js';
import { USAGE_REVIEW_RULE } from './alertRules.js';
import { SCREENS, SCREEN_ACCESS, screenLabel, type ScreenKey } from './usageScreens.js';
import { addDays, todayIn } from '../utils/workCalendar.js';

/**
 * The monthly usage review (Ease Plan 3, Part B): which screens nobody opens.
 *
 * For each screen, how many people opened it in the last 30 days out of how
 * many can — counts only, never names (the per-person list in Settings →
 * Usage is where names are). Both sides are today's active people, so
 * somebody switched off does not stand as "could have, didn't".
 */

export const REVIEW_DAYS = 30;

export type ScreenFlag = 'NOBODY' | 'UNDER_A_THIRD';

export interface ScreenReviewRow {
  key: ScreenKey;
  label: string;
  openedBy: number;
  canOpen: number;
  flag: ScreenFlag | null;
}

/** "Nobody opened this in 30 days", "Under a third of the people who can", or nothing. */
export function flagFor(openedBy: number, canOpen: number): ScreenFlag | null {
  if (canOpen === 0) return null;
  if (openedBy === 0) return 'NOBODY';
  if (openedBy * 3 < canOpen) return 'UNDER_A_THIRD';
  return null;
}

/** Whether this person can open the screen — the sidebar's rule (usageScreens SCREEN_ACCESS). */
export function canOpenScreen(user: UserSession, key: ScreenKey): boolean {
  const rule = SCREEN_ACCESS[key];
  if (!rule) return user.active;
  if (rule.managementOnly) return user.active && user.preset === 'MANAGEMENT';
  return rule.needs ? hasPermission(user, rule.needs) : user.active;
}

export async function screensReview(
  organizationId: string,
  now = new Date(),
): Promise<{ from: string; to: string; days: number; screens: ScreenReviewRow[] }> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  const to = todayIn(org?.timezone || 'Asia/Kolkata', now);
  const from = addDays(to, -(REVIEW_DAYS - 1));

  const [people, opened] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId, active: true },
      select: { id: true, email: true, name: true, preset: true, permissions: true },
    }),
    prisma.usageDay.groupBy({
      by: ['screen', 'userId'],
      where: { organizationId, day: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
    }),
  ]);

  const sessions: UserSession[] = people.map((p) => ({
    userId: p.id,
    organizationId,
    email: p.email,
    name: p.name,
    preset: p.preset,
    permissions: resolvePermissions(p.preset, p.permissions),
    active: true,
  }));
  const active = new Set(people.map((p) => p.id));
  const openedBy = new Map<string, Set<string>>();
  for (const row of opened) {
    if (!active.has(row.userId)) continue;
    const set = openedBy.get(row.screen) ?? new Set<string>();
    set.add(row.userId);
    openedBy.set(row.screen, set);
  }

  const screens = (Object.keys(SCREENS) as ScreenKey[]).map((key) => {
    const canOpen = sessions.filter((s) => canOpenScreen(s, key)).length;
    // Somebody who opened it while they could, and since lost the right, is not counted twice over.
    const opens = Math.min(openedBy.get(key)?.size ?? 0, canOpen);
    return { key, label: screenLabel(key), openedBy: opens, canOpen, flag: flagFor(opens, canOpen) };
  });
  return { from, to, days: REVIEW_DAYS, screens };
}

const monthName = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
};
const previousMonth = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

/**
 * Early each month, on the studio's calendar: "Usage review for October is
 * ready" for Management. Run daily by the usage clean-up and raised once per
 * month, on the first run of days 1 to 7 — so a server that was down on the
 * 1st still sends it that week, and one started mid-month does not send last
 * month's late. Raising it closes the month before's.
 */
export async function raiseUsageReviews(now = new Date()): Promise<number> {
  const orgs = await prisma.organization.findMany({ select: { id: true, timezone: true } });
  let raised = 0;
  for (const org of orgs) {
    const today = todayIn(org.timezone || 'Asia/Kolkata', now);
    if (Number(today.slice(8, 10)) > 7) continue;
    const reviewed = previousMonth(today.slice(0, 7));
    const entityId = `${org.id}:${reviewed}`;
    const already = await prisma.alert.findFirst({
      where: { organizationId: org.id, rule: USAGE_REVIEW_RULE, entityId },
      select: { id: true },
    });
    if (already) continue;
    await prisma.alert.updateMany({
      where: { organizationId: org.id, rule: USAGE_REVIEW_RULE, resolvedAt: null },
      data: { resolvedAt: now },
    });
    await prisma.alert.create({
      data: {
        organizationId: org.id,
        rule: USAGE_REVIEW_RULE,
        severity: AlertSeverity.LOW,
        entityType: 'UsageReview',
        entityId,
        message: `Usage review for ${monthName(reviewed)} is ready`,
      },
    });
    forgetAlertClauses(org.id);
    emitToOrganization(org.id, 'notification:new', null);
    raised += 1;
  }
  return raised;
}

/** Opening the Screens view is the review: its bell is done with. */
export async function closeUsageReview(organizationId: string, now = new Date()): Promise<number> {
  const { count } = await prisma.alert.updateMany({
    where: { organizationId, rule: USAGE_REVIEW_RULE, resolvedAt: null },
    data: { resolvedAt: now },
  });
  if (count > 0) emitToOrganization(organizationId, 'notification:new', null);
  return count;
}
