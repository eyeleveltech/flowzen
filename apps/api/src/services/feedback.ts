import { AlertSeverity } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { emitToOrganization, emitToUser } from '../liveStream.js';
import { forgetAlertClauses } from './alertClauseCache.js';
import { screenLabel } from './usageScreens.js';
import { FEEDBACK_NEW_RULE, FEEDBACK_REPLY_RULE } from './alertRules.js';

/**
 * The bells around "Something confusing? Tell us" (Ease Plan 3).
 *
 * Both are raised here, outside the scanner, and listed in EXTERNAL_RULES so
 * the scanner's resolve pass never closes them:
 *
 *   FEEDBACK_NEW        Management: one open alert per organisation, "3 new
 *                       feedback notes", kept up to date with each note and
 *                       resolved when none is New.
 *   FEEDBACK_LOOKED_AT  The sender: "Thanks — your note about Money was looked
 *                       at: …", once, when Management marks it Done with a note.
 *
 * The monthly usage review's bell is in services/usageReview.ts.
 */

/** How long a "your note was looked at" bell stays before it tidies itself away. */
const REPLY_KEEP_DAYS = 14;

/** Brings the one "N new feedback notes" alert in line with what is New now. */
export async function refreshFeedbackAlert(organizationId: string): Promise<void> {
  const [waiting, open] = await Promise.all([
    prisma.feedback.count({ where: { organizationId, status: 'NEW' } }),
    prisma.alert.findFirst({
      where: { organizationId, rule: FEEDBACK_NEW_RULE, resolvedAt: null },
      orderBy: { raisedAt: 'desc' },
      select: { id: true, message: true },
    }),
  ]);
  if (waiting === 0) {
    if (open) await prisma.alert.updateMany({ where: { organizationId, rule: FEEDBACK_NEW_RULE, resolvedAt: null }, data: { resolvedAt: new Date() } });
    return;
  }
  const message = `${waiting} new feedback ${waiting === 1 ? 'note' : 'notes'}`;
  if (open) {
    if (open.message !== message) {
      // A fresh count is news again: it comes back unread.
      await prisma.alert.update({ where: { id: open.id }, data: { message, raisedAt: new Date() } });
      await prisma.alertRead.deleteMany({ where: { alertId: open.id } });
    }
  } else {
    await prisma.alert.create({
      data: { organizationId, rule: FEEDBACK_NEW_RULE, severity: AlertSeverity.LOW, entityType: 'Feedback', entityId: organizationId, message },
    });
  }
  forgetAlertClauses(organizationId);
  emitToOrganization(organizationId, 'notification:new', null);
}

/** The sender's one bell, once Management has looked at it and said what they did. */
export async function tellTheSender(note: { organizationId: string; userId: string; screen: string | null; note: string }): Promise<void> {
  const about = note.screen ? screenLabel(note.screen) : 'Flowzen';
  const said = note.note.trim().replace(/\s+/g, ' ');
  const message = `Thanks — your note about ${about} was looked at: ${said.length > 300 ? `${said.slice(0, 297)}…` : said}`;
  await prisma.alert.create({
    data: {
      organizationId: note.organizationId,
      rule: FEEDBACK_REPLY_RULE,
      severity: AlertSeverity.LOW,
      // About the sender themselves, as "your own work" rules are about your own tasks.
      entityType: 'FeedbackReply',
      entityId: note.userId,
      message,
    },
  });
  emitToUser(note.userId, 'notification:new', null);
}

/** "Thanks — your note…" bells older than two weeks are closed (the daily clean-up). */
export async function closeOldFeedbackReplies(now = new Date()): Promise<number> {
  const { count } = await prisma.alert.updateMany({
    where: { rule: FEEDBACK_REPLY_RULE, resolvedAt: null, raisedAt: { lt: new Date(now.getTime() - REPLY_KEEP_DAYS * 86_400_000) } },
    data: { resolvedAt: now },
  });
  return count;
}
