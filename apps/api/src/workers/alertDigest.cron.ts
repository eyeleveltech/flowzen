import { prisma } from '../lib/prisma.js';
import { sendMail } from '../utils/mailer.js';
import { logger } from '../utils/logger.js';
import { RULE_PERMISSION, MINE_REGARDLESS } from '../routes/notifications.js';
import { resolvePermissions } from '../middleware/auth.js';

/**
 * §16: "Notifications | In app first. Email digest for alerts."
 *
 * The in-app half has been there since the rules were: the bell reads
 * /notifications, scoped to what each person is allowed to see. The email half
 * was never built, so an alert only reached somebody who happened to open the
 * app — which is exactly backwards for the rules that matter most. An invoice
 * going overdue, a retainer renewing in 45 days and a proposal going quiet are
 * all things you want to hear about on a day you did NOT log in.
 *
 * ─── One scoping rule, not two ──────────────────────────────────────────────
 *
 * The digest shows each person the same alerts their bell would, using the same
 * RULE_PERMISSION map and the same "your own tasks reach you regardless" carve
 * out. Writing that logic twice is how a digest ends up mailing somebody a
 * figure the API would have refused them — §9's "the API must never send a
 * figure the caller is not entitled to" applies to mail as much as to JSON.
 *
 * ─── Quiet by design ────────────────────────────────────────────────────────
 *
 * Nobody is mailed a digest saying nothing is wrong. A person with no open
 * alerts gets no mail at all, so an arriving digest always means something
 * needs attention — which is the only way a daily email stays worth opening.
 */

/** Sent once a day. The hour is IST, matching every other time in this app. */
const DIGEST_HOUR_IST = 8;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** The IST calendar day, so "already sent today" survives a restart. */
const istDayKey = (at: Date): string => new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

const SEVERITY_LABEL: Record<string, string> = {
  HIGH: 'Needs attention',
  MEDIUM: 'Worth a look',
  LOW: 'For information',
};

/**
 * The alerts one person should be mailed — the same set their bell shows.
 *
 * Exported so a test can ask it directly rather than through the mailer.
 */
export async function alertsForUser(
  organizationId: string,
  user: { userId: string; preset: string; permissions: string[] },
): Promise<{ id: string; rule: string; message: string; severity: string; entityType: string }[]> {
  const caller = {
    userId: user.userId,
    organizationId,
    preset: user.preset as never,
    permissions: resolvePermissions(user.preset as never, user.permissions),
  };
  const held = new Set<string>(caller.permissions);
  const can = (needed?: string) => needed === undefined || held.has(needed);

  const allowedRules = Object.keys(RULE_PERMISSION).filter((rule) => can(RULE_PERMISSION[rule]));

  // The three task rules reach the person the task belongs to whatever their
  // permissions say — a rule about your own work is a fact about you.
  const missingTaskRules = MINE_REGARDLESS.filter((r) => !allowedRules.includes(r));
  const myTaskIds =
    missingTaskRules.length > 0
      ? (
          await prisma.task.findMany({
            where: { organizationId, deletedAt: null, assignees: { some: { userId: user.userId } } },
            select: { id: true },
          })
        ).map((t) => t.id)
      : [];

  const mine =
    myTaskIds.length > 0
      ? [{ rule: { in: [...missingTaskRules] }, entityType: 'Task', entityId: { in: myTaskIds } }]
      : [];

  if (allowedRules.length === 0 && mine.length === 0) return [];

  return prisma.alert.findMany({
    where: { organizationId, resolvedAt: null, OR: [{ rule: { in: allowedRules } }, ...mine] },
    orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
    take: 40,
    select: { id: true, rule: true, message: true, severity: true, entityType: true },
  });
}

const digestHtml = (name: string, alerts: Awaited<ReturnType<typeof alertsForUser>>, appUrl: string): string => {
  const bySeverity = new Map<string, typeof alerts>();
  for (const a of alerts) {
    const list = bySeverity.get(a.severity) ?? [];
    list.push(a);
    bySeverity.set(a.severity, list);
  }
  const blocks = [...bySeverity.entries()]
    .map(
      ([severity, list]) => `
        <p style="margin:16px 0 4px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#6d7f79">
          ${SEVERITY_LABEL[severity] ?? severity} · ${list.length}
        </p>
        <ul style="margin:0;padding-left:18px">
          ${list.map((a) => `<li style="margin:4px 0">${a.message}</li>`).join('')}
        </ul>`,
    )
    .join('');

  return `
    <p>Hello ${name.split(' ')[0]},</p>
    <p>${alerts.length === 1 ? 'One thing is' : `${alerts.length} things are`} open on Flowzen this morning.</p>
    ${blocks}
    <p style="margin-top:18px"><a href="${appUrl}">Open Flowzen</a></p>
    <p style="font-size:12px;color:#6d7f79">You are only sent this on days something is open — no mail means nothing needed you.</p>
  `;
};

/**
 * Sends each person their own digest. Idempotent for the day: an Activity row
 * per user per IST day is what stops a restart mailing everybody twice.
 */
export async function sendAlertDigests(now = new Date()): Promise<{ sent: number }> {
  const istHour = new Date(now.getTime() + IST_OFFSET_MS).getUTCHours();
  if (istHour !== DIGEST_HOUR_IST) return { sent: 0 };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
  const today = istDayKey(now);
  let sent = 0;

  const users = await prisma.user.findMany({
    where: { active: true },
    select: { id: true, name: true, email: true, preset: true, permissions: true, organizationId: true },
  });

  for (const user of users) {
    try {
      const alreadyToday = await prisma.activity.findFirst({
        where: {
          organizationId: user.organizationId,
          entityType: 'User',
          entityId: user.id,
          verb: 'alert_digest_sent',
          at: { gte: new Date(now.getTime() - 20 * 60 * 60 * 1000) },
        },
        select: { id: true },
      });
      if (alreadyToday) continue;

      const alerts = await alertsForUser(user.organizationId, {
        userId: user.id,
        preset: user.preset,
        permissions: user.permissions,
      });
      // Nothing open is not news.
      if (alerts.length === 0) continue;

      await sendMail(user.organizationId, {
        to: user.email,
        subject: `Flowzen: ${alerts.length} open ${alerts.length === 1 ? 'alert' : 'alerts'}`,
        html: digestHtml(user.name, alerts, appUrl),
        text: alerts.map((a) => `• ${a.message}`).join('\n') + `\n\n${appUrl}`,
      });

      await prisma.activity.create({
        data: {
          organizationId: user.organizationId,
          entityType: 'User',
          entityId: user.id,
          actorId: user.id,
          verb: 'alert_digest_sent',
          payload: { day: today, alerts: alerts.length },
        },
      });
      sent++;
    } catch (err) {
      // One person's bad address must not stop everybody else's digest.
      logger.error(`Alert digest failed for ${user.email}: ${err}`);
    }
  }

  return { sent };
}

/**
 * Polls hourly, like the other workers. The hour check and the once-a-day
 * guard inside `sendAlertDigests` make every other tick a no-op.
 */
export function startAlertDigestScheduler(intervalMs = 3600000) {
  if (process.env.NODE_ENV !== 'test') {
    sendAlertDigests().catch((e) => logger.error(`Alert digest scheduler error: ${e}`));
    setInterval(() => {
      sendAlertDigests().catch((e) => logger.error(`Alert digest scheduler error: ${e}`));
    }, intervalMs);
  }
}
