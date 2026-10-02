import { Router, type Response, type NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireManagement, type AuthRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import { todayIn } from '../utils/workCalendar.js';
import { screenFor, type ScreenKey } from '../services/usageScreens.js';
import { usageForLastDays } from '../services/usageSummary.js';

/**
 * /api/usage — who is using Flowzen.
 *
 * Everybody's screen opens are recorded (POST /view), as a per-day summary:
 * which screen, how many times, first and last. Only Management can read it
 * back (GET /summary) — the same rule as Zen. Everybody is told so on their
 * Profile, and rows go after 90 days (workers/usageCleanup.cron.ts).
 */
export const usageRouter = Router();
usageRouter.use(authenticate);

/** The same screen again within this long is the same visit: last seen moves, the count does not. */
export const REPEAT_WINDOW_MS = 10 * 60_000;

/** Per person, per minute — far more than a person clicking, quietly ignored past it. */
const LIMIT_PER_MINUTE = 60;
const hits = new Map<string, { start: number; n: number }>();
function overLimit(userId: string, now = Date.now()): boolean {
  const h = hits.get(userId);
  if (!h || now - h.start >= 60_000) {
    hits.set(userId, { start: now, n: 1 });
    // Keep the map from growing without end: forget anybody idle a minute.
    if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start >= 60_000) hits.delete(k);
    return false;
  }
  h.n++;
  return h.n > LIMIT_PER_MINUTE;
}

const zoneCache = new Map<string, { at: number; timezone: string }>();
async function zoneOf(organizationId: string): Promise<string> {
  const hit = zoneCache.get(organizationId);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.timezone;
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  const timezone = org?.timezone || 'Asia/Kolkata';
  zoneCache.set(organizationId, { at: Date.now(), timezone });
  return timezone;
}

/**
 * Count one screen open. A first open of the day makes the row; the same
 * screen again within ten minutes only moves `lastAt`; later than that it is
 * another view.
 */
export async function recordView(
  organizationId: string,
  userId: string,
  screen: ScreenKey,
  now = new Date(),
): Promise<'counted' | 'seen'> {
  const day = new Date(`${todayIn(await zoneOf(organizationId), now)}T00:00:00Z`);
  const where = { userId_day_screen: { userId, day, screen } };
  let row = await prisma.usageDay.findUnique({ where, select: { id: true, lastAt: true } });
  if (!row) {
    try {
      await prisma.usageDay.create({ data: { organizationId, userId, day, screen, views: 1, firstAt: now, lastAt: now } });
      return 'counted';
    } catch (e) {
      // Two tabs at once: the other made the row; count against it instead.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      row = await prisma.usageDay.findUnique({ where, select: { id: true, lastAt: true } });
      if (!row) return 'seen';
    }
  }
  const repeat = now.getTime() - row.lastAt.getTime() < REPEAT_WINDOW_MS;
  await prisma.usageDay.update({
    where: { id: row.id },
    data: repeat ? { lastAt: now } : { views: { increment: 1 }, lastAt: now },
  });
  return repeat ? 'seen' : 'counted';
}

/**
 * POST /usage/view — "I am looking at this screen." Sent by the web app when
 * the route changes with the tab visible; never by the bell or background
 * fetches. Only the screen's name is kept, never the path. Always 204: an
 * unknown path, a person over the limit, or a hiccup here must never surface
 * on the page that sent it.
 */
usageRouter.post('/view', async (req: AuthRequest, res: Response) => {
  const user = req.user!;
  try {
    if (!overLimit(user.userId)) {
      const screen = screenFor(req.body?.path);
      if (screen) await recordView(user.organizationId, user.userId, screen);
    }
  } catch (e) {
    logger.warn(`Usage view not recorded for ${user.userId}: ${e instanceof Error ? e.message : e}`);
  }
  res.status(204).end();
});

/** GET /usage/summary?days=7|30 — Management only. */
usageRouter.get(
  '/summary',
  requireManagement('Who is using Flowzen is for management only.'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const days = req.query.days === '30' ? 30 : 7;
      const summary = await usageForLastDays(req.user!.organizationId, days);
      res.json({ success: true, days, ...summary });
    } catch (e) {
      next(e);
    }
  },
);
