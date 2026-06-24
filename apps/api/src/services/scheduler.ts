import cron from 'node-cron';
import { prisma } from '../lib/prisma.js';
import { NotificationService } from './notifications.js';
import { runDailyNotificationJobs } from './notificationScanners.js';
import { logger } from '../utils/logger.js';

const CHECK_INTERVAL_MS = 60 * 60 * 1000;      // run hourly
const LOOKAHEAD_MS = 24 * 60 * 60 * 1000;       // notify for tasks due within 24h
const DEDUP_WINDOW_MS = 20 * 60 * 60 * 1000;    // don't re-notify the same task within 20h

/**
 * Finds tasks whose deadline is approaching and notifies their assignee.
 * Dedup is done against recently-created DEADLINE_APPROACHING notifications
 * (by metadata.taskId) so we don't spam on every run — no schema change needed.
 */
async function runDeadlineCheck() {
  try {
    const now = new Date();
    const soon = new Date(now.getTime() + LOOKAHEAD_MS);

    const tasks = await prisma.task.findMany({
      where: {
        dueDate: { gte: now, lte: soon },
        status: { notIn: ['COMPLETED'] },
        assigneeId: { not: null },
      },
      select: { id: true, title: true, assigneeId: true, projectId: true },
    });

    if (tasks.length === 0) return;

    const since = new Date(now.getTime() - DEDUP_WINDOW_MS);
    const recent = await prisma.notification.findMany({
      where: { type: 'DEADLINE_APPROACHING', createdAt: { gte: since } },
      select: { metadata: true },
    });
    const alreadyNotified = new Set(
      recent.map((n) => (n.metadata as any)?.taskId).filter(Boolean),
    );

    let sent = 0;
    for (const task of tasks) {
      if (alreadyNotified.has(task.id)) continue;
      await NotificationService.send({
        type: 'DEADLINE_APPROACHING',
        message: `"${task.title}" is due soon`,
        userId: task.assigneeId!,
        metadata: { taskId: task.id, projectId: task.projectId },
      });
      sent++;
    }

    if (sent > 0) logger.info(`[Scheduler] Sent ${sent} deadline notification(s)`);
  } catch (error) {
    logger.error('[Scheduler] Deadline check failed:', error);
  }
}

export function startScheduler() {
  // Run shortly after boot (let the app settle), then on a fixed interval.
  setTimeout(runDeadlineCheck, 30 * 1000);
  setInterval(runDeadlineCheck, CHECK_INTERVAL_MS);

  // Module F — daily CRM jobs (follow-up due, stale leads, digest) at 08:00 IST.
  cron.schedule('0 8 * * *', () => { runDailyNotificationJobs().catch((e) => logger.error('[Scheduler] daily jobs failed', e)); }, { timezone: 'Asia/Kolkata' });

  logger.info('[Scheduler] Deadline + daily notification schedulers started');
}
