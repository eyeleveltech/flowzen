import nodemailer from 'nodemailer';
import { prisma } from '../lib/prisma.js';
import { emitToUser, emitToOrganization } from '../sse.js';
import { NotificationType } from '@prisma/client';
import { enqueueEmail } from '../lib/queue.js';

// Transporter will be initialized lazily to ensure env vars are loaded

interface NotificationPayload {
  userId: string;
  type: NotificationType;
  message: string;
  metadata?: any;
}

export class NotificationService {
  /**
   * Creates a notification in the database, emits it via Socket.io, 
   * and optionally sends an email fallback.
   */
  static async send(payload: NotificationPayload) {
    try {
      // 1. Create DB Record
      const notification = await prisma.notification.create({
        data: {
          userId: payload.userId,
          type: payload.type,
          message: payload.message,
          metadata: payload.metadata || {},
        },
      });

      // 2. Dispatch via SSE (Real-time)
      emitToUser(null, payload.userId, 'notification:new', notification);

      // 3. Fallback: Send Email
      const pmTypes: NotificationType[] = ['TASK_ASSIGNED', 'DEADLINE_APPROACHING', 'TASK_OVERDUE', 'COMMENT_ADDED', 'MENTION'];
      if (pmTypes.includes(payload.type)) {
        const user = await prisma.user.findUnique({
          where: { id: payload.userId },
          select: { email: true, name: true, settings: true },
        });

        if (user && user.email) {
          const n = ((user.settings as any)?.notifications) || {};
          let emailEnabled = false;

          if (payload.type === 'TASK_ASSIGNED' && n.taskAssigned !== false) emailEnabled = true;
          if (payload.type === 'DEADLINE_APPROACHING' && n.taskDue24h !== false) emailEnabled = true;
          if (payload.type === 'TASK_OVERDUE' && n.taskOverdue !== false) emailEnabled = true;
          if ((payload.type === 'COMMENT_ADDED' || payload.type === 'MENTION') && n.taskComment !== false) emailEnabled = true;

          if (emailEnabled) {
            let subject = `New Notification: ${payload.type.replace(/_/g, ' ')}`;
            if (payload.type === 'TASK_ASSIGNED') subject = `[Flowzen] New Task Assigned`;
            else if (payload.type === 'DEADLINE_APPROACHING') subject = `[Flowzen] Task Due Soon`;
            else if (payload.type === 'TASK_OVERDUE') subject = `[Flowzen] Task Overdue Alert`;
            else if (payload.type === 'COMMENT_ADDED' || payload.type === 'MENTION') subject = `[Flowzen] New Comment/Mention on Task`;

            await this.sendEmail({
              to: user.email,
              subject,
              html: `
                <div style="font-family: sans-serif; padding: 20px;">
                  <h2>Hello ${user.name.split(' ')[0]},</h2>
                  <p>${payload.message}</p>
                  <br />
                  <a href="${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/dashboard" style="background: #111827; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 8px;">View in Dashboard</a>
                </div>
              `,
            });
          }
        }
      }

      return notification;
    } catch (error) {
      // Swallow so a notification failure never breaks the parent request,
      // but surface it loudly enough to be caught in logs/telemetry.
      console.error(`[NotificationService] Failed to send ${payload.type} to ${payload.userId}:`, error);
      return null;
    }
  }

  /**
   * Fan a single notification out to multiple recipients, de-duplicated and
   * with the actor excluded (so people aren't notified about their own actions).
   */
  static async sendMany(
    userIds: (string | null | undefined)[],
    payload: { type: NotificationType; message: string; metadata?: any },
    excludeUserId?: string,
  ) {
    const recipients = [...new Set(userIds.filter((id): id is string => !!id && id !== excludeUserId))];
    await Promise.all(recipients.map((userId) => this.send({ ...payload, userId })));
  }

  static async sendEmail(data: { to: string; subject: string; html: string }) {
    await enqueueEmail(data);
  }
}
