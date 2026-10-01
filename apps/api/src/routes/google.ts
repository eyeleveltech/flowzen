import { Router, type Response, type NextFunction } from 'express';
import { GoogleConnectionStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate, type AuthRequest } from '../middleware/auth.js';
import { encryptSecret } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';
import {
  GOOGLE_SCOPES,
  google,
  googleConfigured,
  makeState,
  oauthClient,
  queueUpcomingFor,
  stateIsFor,
  syncBusy,
} from '../services/googleCalendar.js';

/**
 * /api/google — a person connecting their own Google Calendar.
 *
 * Only ever their own: every route acts on the signed-in person and nobody
 * else, and none of them returns a token. The browser comes here directly
 * (not through fetch) for connect and the callback, because Google's consent
 * page is a page.
 */
export const googleRouter = Router();

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
const backToProfile = (res: Response, outcome: 'connected' | 'error') => res.redirect(`${appUrl()}/profile?google=${outcome}`);

/**
 * A page the browser lands on, not an API call: with no session there is no
 * JSON 401 for anybody to read, so it goes back to Profile instead.
 */
const pageAuth = (req: AuthRequest, res: Response, next: NextFunction) =>
  req.cookies?.token || req.headers.authorization ? authenticate(req, res, next) : backToProfile(res, 'error');

/** On for this organisation: the server has the keys AND an admin switched it on. */
async function enabledFor(organizationId: string): Promise<boolean> {
  if (!googleConfigured()) return false;
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { googleCalendarEnabled: true } });
  return Boolean(org?.googleCalendarEnabled);
}

const orgTimezone = async (organizationId: string) =>
  (await prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }))?.timezone || 'Asia/Kolkata';

/** GET /google/connect — off to Google's own sign-in and consent. */
googleRouter.get('/connect', pageAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await enabledFor(req.user!.organizationId))) {
      backToProfile(res, 'error');
      return;
    }
    const url = oauthClient().generateAuthUrl({
      // A refresh token, and a fresh consent so Google always sends one —
      // reconnecting after a revoke gets nothing otherwise.
      access_type: 'offline',
      prompt: 'consent',
      scope: GOOGLE_SCOPES,
      state: makeState(req.user!.userId),
      login_hint: req.user!.email,
    });
    res.redirect(url);
  } catch (e) {
    next(e);
  }
});

/**
 * GET /google/callback — Google sends the person back here.
 *
 * The state must be this same signed-in person's. Then: the token is stored
 * encrypted, the "Flowzen" calendar made, busy time read for the first time,
 * and the meetings they are already on queued for their Google.
 */
googleRouter.get('/callback', pageAuth, async (req: AuthRequest, res: Response) => {
  const user = req.user!;
  try {
    if (!(await enabledFor(user.organizationId))) return backToProfile(res, 'error');
    if (req.query.error || !req.query.code) return backToProfile(res, 'error');
    if (!stateIsFor(String(req.query.state ?? ''), user.userId)) {
      logger.warn(`Google callback with a state that is not ${user.userId}'s`);
      return backToProfile(res, 'error');
    }

    const { refreshToken, email } = await google().exchangeCode(String(req.query.code));
    if (!refreshToken || !email) return backToProfile(res, 'error');

    const timezone = await orgTimezone(user.organizationId);
    const existing = await prisma.googleCalendarConnection.findUnique({ where: { userId: user.userId } });
    const conn = await prisma.googleCalendarConnection.upsert({
      where: { userId: user.userId },
      create: {
        organizationId: user.organizationId,
        userId: user.userId,
        googleEmail: email,
        refreshTokenEncrypted: encryptSecret(refreshToken),
      },
      update: {
        googleEmail: email,
        refreshTokenEncrypted: encryptSecret(refreshToken),
        status: GoogleConnectionStatus.ACTIVE,
        lastError: null,
        // A different Google account starts clean: its own calendar, its own sync.
        ...(existing && existing.googleEmail !== email ? { flowzenCalendarId: null, syncToken: null } : {}),
      },
    });
    if (existing && existing.googleEmail !== email) {
      await prisma.externalBusyBlock.deleteMany({ where: { userId: user.userId } });
      await prisma.googleEventLink.deleteMany({ where: { userId: user.userId } });
    }

    // The "Flowzen" calendar, the first read, the queue — none of which is
    // allowed to undo the connection itself.
    try {
      if (!conn.flowzenCalendarId) {
        const id = await google().createCalendar(conn, timezone);
        await prisma.googleCalendarConnection.update({ where: { id: conn.id }, data: { flowzenCalendarId: id } });
      }
      const fresh = await prisma.googleCalendarConnection.findUniqueOrThrow({ where: { id: conn.id } });
      await syncBusy(fresh, timezone);
      await queueUpcomingFor(user.organizationId, user.userId, timezone);
    } catch (e) {
      logger.warn(`Google first sync for ${user.userId} deferred: ${e instanceof Error ? e.message : e}`);
    }
    return backToProfile(res, 'connected');
  } catch (e) {
    logger.error(`Google connect for ${user.userId} failed: ${e instanceof Error ? e.message : e}`);
    return backToProfile(res, 'error');
  }
});

/** GET /google/status — the caller's own connection, as Profile shows it. */
googleRouter.get('/status', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const enabled = await enabledFor(req.user!.organizationId);
    const conn = enabled
      ? await prisma.googleCalendarConnection.findUnique({
          where: { userId: req.user!.userId },
          select: { googleEmail: true, status: true, lastSyncedAt: true },
        })
      : null;
    res.json({
      success: true,
      enabled,
      connected: Boolean(conn),
      googleEmail: conn?.googleEmail ?? null,
      status: conn?.status ?? null,
      lastSyncedAt: conn?.lastSyncedAt ?? null,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /google/disconnect — undo all of it.
 *
 * The "Flowzen" calendar is deleted from their Google (while the token still
 * works), the token revoked at Google, and the stored token, busy time and
 * queue removed here. Google being unreachable does not stop the Flowzen side
 * going: disconnecting must always work.
 */
googleRouter.post('/disconnect', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const conn = await prisma.googleCalendarConnection.findUnique({ where: { userId } });
    if (!conn) {
      res.json({ success: true });
      return;
    }
    const atGoogle: string[] = [];
    if (conn.flowzenCalendarId) {
      await google()
        .deleteCalendar(conn, conn.flowzenCalendarId)
        .catch((e) => atGoogle.push(`calendar: ${e instanceof Error ? e.message : e}`));
    }
    await google()
      .revoke(conn)
      .catch((e) => atGoogle.push(`revoke: ${e instanceof Error ? e.message : e}`));
    if (atGoogle.length) logger.warn(`Google disconnect for ${userId}, at Google: ${atGoogle.join('; ')}`);

    await prisma.$transaction([
      prisma.googleEventLink.deleteMany({ where: { userId } }),
      prisma.externalBusyBlock.deleteMany({ where: { userId } }),
      prisma.googleCalendarConnection.delete({ where: { userId } }),
    ]);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});
