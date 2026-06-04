import nodemailer from 'nodemailer';
import { prisma } from '../lib/prisma.js';
import { io } from '../index.js';
import { NotificationType } from '@prisma/client';

// Configure Nodemailer transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: process.env.SMTP_PORT === '465', // true for 465, false for other ports like 587
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

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

      // 2. Dispatch via Socket.io (Real-time)
      // Assuming users join a room named by their user ID: `user_${userId}`
      io.to(`user_${payload.userId}`).emit('notification:new', notification);

      // 3. Fallback: Send Email
      // To prevent spam, we can only send emails for high priority items, 
      // or check if the user is currently connected to Socket.io.
      // For now, we will send an email for specific events like TASK_ASSIGNED.
      if (payload.type === 'TASK_ASSIGNED' || payload.type === 'DEADLINE_APPROACHING') {
        const user = await prisma.user.findUnique({
          where: { id: payload.userId },
          select: { email: true, name: true },
        });

        if (user && user.email) {
          await this.sendEmail({
            to: user.email,
            subject: `New Notification: ${payload.type.replace(/_/g, ' ')}`,
            html: `
              <div style="font-family: sans-serif; padding: 20px;">
                <h2>Hello ${user.name.split(' ')[0]},</h2>
                <p>${payload.message}</p>
                <br />
                <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard" style="background: #111827; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 8px;">View in Dashboard</a>
              </div>
            `,
          });
        }
      }

      return notification;
    } catch (error) {
      console.error('[NotificationService] Error sending notification:', error);
    }
  }

  private static async sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS || process.env.SMTP_USER === 'your-email@gmail.com') {
      console.warn('[NotificationService] SMTP not fully configured. Skipping email to:', to);
      return;
    }

    try {
      await transporter.sendMail({
        from: `"${process.env.SMTP_FROM_NAME || 'Flowzen'}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
        to,
        subject,
        html,
      });
      console.log(`[NotificationService] Email sent to ${to}`);
    } catch (error) {
      console.error('[NotificationService] Error sending email:', error);
    }
  }
}
