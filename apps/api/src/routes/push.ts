import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma.js';
import { authenticate, type AuthRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_PREFERENCES, pushConfigured, queuePush, vapidPublicKey } from '../services/push.js';
import { runPushWorker } from '../workers/push.cron.js';

/**
 * Profile → Phone notifications.
 *
 * Everything here is about the caller's own devices and the caller's own
 * switches. Nobody sees or removes anybody else's, and there is no route that
 * sends a push to anybody but yourself — the rest are queued by the places
 * things happen (services/push.ts).
 */
export const pushRouter = Router();

pushRouter.use(authenticate);

/** One person, one browser: the same browser subscribing again replaces its row. */
const MAX_DEVICES = 10;

/** On, from where this person stands: the server has the keys and an admin switched it on. */
async function enabledFor(organizationId: string): Promise<boolean> {
  if (!pushConfigured()) return false;
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { pushEnabled: true } });
  return Boolean(org?.pushEnabled);
}

const OFF = 'Phone notifications are switched off for your organisation.';

/** "iPhone · Safari", from the user agent. Only ever a label for the person's own list. */
export function deviceLabel(ua: string | undefined): string {
  const s = ua ?? '';
  const device = /iPhone/.test(s)
    ? 'iPhone'
    : /iPad/.test(s)
      ? 'iPad'
      : /Android/.test(s)
        ? /Mobile/.test(s)
          ? 'Android phone'
          : 'Android tablet'
        : /Macintosh|Mac OS X/.test(s)
          ? 'Mac'
          : /Windows/.test(s)
            ? 'Windows PC'
            : /Linux/.test(s)
              ? 'Linux PC'
              : 'Device';
  const browser = /EdgA?\//.test(s)
    ? 'Edge'
    : /SamsungBrowser\//.test(s)
      ? 'Samsung Internet'
      : /Firefox\/|FxiOS\//.test(s)
        ? 'Firefox'
        : /CriOS\/|Chrome\//.test(s)
          ? 'Chrome'
          : /Safari\//.test(s)
            ? 'Safari'
            : 'Browser';
  return `${device} · ${browser}`;
}

/** GET /api/push/config — whether to offer the card, and the key the browser subscribes with. */
pushRouter.get('/config', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const enabled = await enabledFor(req.user!.organizationId);
    res.json({ success: true, enabled, publicKey: enabled ? vapidPublicKey() : null });
  } catch (error) {
    next(error);
  }
});

const subscribeSchema = z.object({
  endpoint: z
    .string()
    .max(2048)
    .url()
    .refine((u) => u.startsWith('https://'), 'That is not a push address'),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
});

/** POST /api/push/subscribe — this browser, for the caller. */
pushRouter.post('/subscribe', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = subscribeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const { organizationId, userId } = req.user!;
    if (!(await enabledFor(organizationId))) {
      res.status(403).json({ success: false, error: OFF });
      return;
    }
    const { endpoint, keys } = parsed.data;
    const label = deviceLabel(req.headers['user-agent']);

    // Upsert by endpoint: a shared browser that a second person turns on now
    // belongs to them, which is who is holding it.
    const device = await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { organizationId, userId, endpoint, p256dh: keys.p256dh, auth: keys.auth, deviceLabel: label },
      update: { organizationId, userId, p256dh: keys.p256dh, auth: keys.auth, deviceLabel: label, failedCount: 0 },
      select: { id: true, deviceLabel: true, createdAt: true, lastUsedAt: true, endpoint: true },
    });

    // A person does not have more than a handful of devices; the oldest go.
    const all = await prisma.pushSubscription.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (all.length > MAX_DEVICES) {
      await prisma.pushSubscription.deleteMany({ where: { id: { in: all.slice(MAX_DEVICES).map((d) => d.id) } } });
    }

    res.status(201).json({ success: true, device });
  } catch (error) {
    next(error);
  }
});

/** GET /api/push/subscriptions — the caller's devices. */
pushRouter.get('/subscriptions', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const devices = await prisma.pushSubscription.findMany({
      where: { userId: req.user!.userId, organizationId: req.user!.organizationId },
      orderBy: { createdAt: 'desc' },
      // The endpoint, so the page can say which row is the browser it is in.
      select: { id: true, deviceLabel: true, createdAt: true, lastUsedAt: true, endpoint: true },
    });
    res.json({ success: true, devices });
  } catch (error) {
    next(error);
  }
});

/** DELETE /api/push/subscriptions/:id — one of the caller's own devices. */
pushRouter.delete('/subscriptions/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const gone = await prisma.pushSubscription.deleteMany({
      where: { id: String(req.params.id), userId: req.user!.userId },
    });
    if (gone.count === 0) {
      res.status(404).json({ success: false, error: 'That device is not on your list.' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/** GET /api/push/preferences — the four kinds; the defaults until changed. */
pushRouter.get('/preferences', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const row = await prisma.notificationPreference.findUnique({ where: { userId: req.user!.userId } });
    const { pushApprovals, pushCalendar, pushTasks, pushBell } = row ?? DEFAULT_PREFERENCES;
    res.json({ success: true, preferences: { pushApprovals, pushCalendar, pushTasks, pushBell } });
  } catch (error) {
    next(error);
  }
});

const preferencesSchema = z
  .object({
    pushApprovals: z.boolean().optional(),
    pushCalendar: z.boolean().optional(),
    pushTasks: z.boolean().optional(),
    pushBell: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });

/** PUT /api/push/preferences — any of the four. */
pushRouter.put('/preferences', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = preferencesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const userId = req.user!.userId;
    const row = await prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...parsed.data },
      update: parsed.data,
    });
    const { pushApprovals, pushCalendar, pushTasks, pushBell } = row;
    res.json({ success: true, preferences: { pushApprovals, pushCalendar, pushTasks, pushBell } });
  } catch (error) {
    next(error);
  }
});

const testLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `push-test:${(req as AuthRequest).user?.userId ?? 'anon'}`,
  message: { success: false, error: 'That is a few tests already. Try again in a few minutes.' },
});

/** POST /api/push/test — a test to every one of the caller's devices, now. */
pushRouter.post('/test', testLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { organizationId, userId } = req.user!;
    if (!(await enabledFor(organizationId))) {
      res.status(403).json({ success: false, error: OFF });
      return;
    }
    const devices = await prisma.pushSubscription.count({ where: { userId } });
    if (devices === 0) {
      res.status(400).json({ success: false, error: 'Turn phone notifications on first.' });
      return;
    }
    const queued = await queuePush(
      { organizationId, userId },
      'TEST',
      `test:${Date.now()}`,
      'Flowzen test',
      'Phone notifications work on this device. Tap to open Flowzen.',
      '/profile',
      { immediate: true },
    );
    // Straight away rather than on the next minute's tick: the person is
    // holding the phone, waiting for it.
    if (queued) runPushWorker().catch((e) => logger.error(`Push test send failed: ${e}`));
    res.json({ success: true, devices });
  } catch (error) {
    next(error);
  }
});
