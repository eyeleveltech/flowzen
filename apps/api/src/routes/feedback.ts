import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireManagement, type AuthRequest } from '../middleware/auth.js';
import { moneyClock, orgToday } from '../utils/moneyDates.js';
import { dayStartUtc } from '../utils/zonedTime.js';
import { screenFor, screenLabel } from '../services/usageScreens.js';
import { refreshFeedbackAlert, tellTheSender } from '../services/feedback.js';
import { logger } from '../utils/logger.js';

/**
 * /api/feedback — "Something confusing? Tell us" (Ease Plan 3, Part A).
 *
 * Anybody signed in can send a note; only Management reads and handles them
 * (Setup → Feedback) — the preset, as `requireManagement()` decides, so a Head
 * holding setup.admin runs Settings but not this. The sender's name is always
 * kept (the user's choice: no anonymous notes).
 */
export const feedbackRouter = Router();
feedbackRouter.use(authenticate);

/** At most this many notes per person per studio day. */
export const DAILY_LIMIT = 10;

const sendSchema = z.object({
  message: z
    .string({ required_error: 'Say what was confusing.' })
    .trim()
    .min(1, 'Say what was confusing.')
    .max(2000, 'Keep it under 2,000 characters.'),
  path: z.string().max(500).optional().default(''),
  device: z.enum(['PHONE', 'DESKTOP']).optional().default('DESKTOP'),
});

/** Only the page, never its query: `/companies/abc?q=pavilion` is kept as `/companies/abc`. */
const pagePath = (raw: string): string => {
  try {
    const url = new URL(raw || '/', 'http://flowzen.local');
    return url.host === 'flowzen.local' ? url.pathname.slice(0, 300) : '/';
  } catch {
    return '/';
  }
};

/** POST /api/feedback { message, path, device } — anybody signed in. */
feedbackRouter.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Say what was confusing.' });
      return;
    }
    const { timezone } = await moneyClock(user.organizationId);
    const sentToday = await prisma.feedback.count({
      where: { organizationId: user.organizationId, userId: user.userId, createdAt: { gte: dayStartUtc(orgToday(timezone), timezone) } },
    });
    if (sentToday >= DAILY_LIMIT) {
      res.status(429).json({
        success: false,
        error: `Thank you — that's ${DAILY_LIMIT} notes today, the most for one day. Please send the rest tomorrow.`,
      });
      return;
    }
    const path = pagePath(parsed.data.path);
    const note = await prisma.feedback.create({
      data: {
        organizationId: user.organizationId,
        userId: user.userId,
        path,
        screen: screenFor(parsed.data.path),
        device: parsed.data.device,
        message: parsed.data.message,
      },
      select: { id: true },
    });
    // The note is saved; a bell that fails to update must not make it look lost.
    await refreshFeedbackAlert(user.organizationId).catch((e) =>
      logger.warn(`Feedback bell not updated for ${user.organizationId}: ${e instanceof Error ? e.message : e}`),
    );
    res.status(201).json({ success: true, id: note.id });
  } catch (e) {
    next(e);
  }
});

const management = requireManagement('Feedback notes are for management only.');

/** GET /api/feedback — every note, newest first. Management only. */
feedbackRouter.get('/', management, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.feedback.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        id: true,
        message: true,
        path: true,
        screen: true,
        device: true,
        status: true,
        note: true,
        createdAt: true,
        handledAt: true,
        user: { select: { id: true, name: true, department: { select: { name: true } } } },
        handledBy: { select: { id: true, name: true } },
      },
    });
    res.json({
      success: true,
      notes: rows.map(({ user, ...n }) => ({
        ...n,
        // The screen by name ("Money"), as the bell and the list say it.
        screen: n.screen ? screenLabel(n.screen) : null,
        from: { id: user.id, name: user.name, dept: user.department?.name ?? null },
      })),
    });
  } catch (e) {
    next(e);
  }
});

const updateSchema = z.object({
  status: z.enum(['NEW', 'SEEN', 'DONE']),
  note: z.string().trim().max(2000, 'Keep the note under 2,000 characters.').nullable().optional(),
});

/**
 * PATCH /api/feedback/:id { status, note? } — Management only.
 *
 * When a note becomes Done with something written in `note`, its sender gets
 * one bell saying so. Editing the note while it stays Done does not ring
 * again; only reopening it and closing it again does, as a fresh answer.
 */
feedbackRouter.patch('/:id', management, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Pick New, Seen or Done.' });
      return;
    }
    const existing = await prisma.feedback.findFirst({
      where: { id: String(req.params.id), organizationId: user.organizationId },
      select: { id: true, userId: true, screen: true, status: true, note: true, handledAt: true },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Feedback note not found' });
      return;
    }
    const note = parsed.data.note === undefined ? existing.note : parsed.data.note || null;
    const now = new Date();
    const updated = await prisma.feedback.update({
      where: { id: existing.id },
      data: {
        status: parsed.data.status,
        note,
        handledById: parsed.data.status === 'NEW' ? null : user.userId,
        handledAt: parsed.data.status === 'NEW' ? null : now,
      },
      select: { id: true, status: true, note: true, handledAt: true, handledBy: { select: { id: true, name: true } } },
    });

    // "Looked at" once: Done, with a note, and not already told.
    const told = existing.status === 'DONE' && Boolean(existing.note);
    if (parsed.data.status === 'DONE' && note && !told) {
      await tellTheSender({ organizationId: user.organizationId, userId: existing.userId, screen: existing.screen, note }).catch((e) =>
        logger.warn(`Feedback reply bell not raised for ${existing.id}: ${e instanceof Error ? e.message : e}`),
      );
    }
    await refreshFeedbackAlert(user.organizationId).catch((e) =>
      logger.warn(`Feedback bell not updated for ${user.organizationId}: ${e instanceof Error ? e.message : e}`),
    );
    res.json({ success: true, note: updated });
  } catch (e) {
    next(e);
  }
});
