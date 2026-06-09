import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationService } from './notifications.js';
import { prisma } from '../lib/prisma.js';
import { emitToUser } from '../sse.js';
import nodemailer from 'nodemailer';

// Mock SSE
vi.mock('../sse.js', () => ({
  emitToUser: vi.fn(),
}));

// Mock Nodemailer
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn().mockReturnValue({
      sendMail: vi.fn().mockResolvedValue(true),
    }),
  },
}));

describe('NotificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a notification in the database', async () => {
    const payload = {
      userId: 'user-123',
      type: 'TASK_ASSIGNED' as const,
      message: 'Test message',
      metadata: { taskId: 'task-1' },
    };

    // Setup Prisma Mock Return
    (prisma.notification.create as any).mockResolvedValue({
      id: 'notif-1',
      ...payload,
      read: false,
      createdAt: new Date(),
    });

    const result = await NotificationService.send(payload);

    // Verify DB Call
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        userId: payload.userId,
        type: payload.type,
        message: payload.message,
        metadata: payload.metadata,
      },
    });

    // Verify Output
    expect(result).toBeDefined();
    expect(result?.id).toBe('notif-1');
  });

  it('should emit an SSE event to the specific user', async () => {
    const payload = {
      userId: 'user-123',
      type: 'COMMENT_ADDED' as const,
      message: 'Test comment',
    };

    (prisma.notification.create as any).mockResolvedValue({ id: 'notif-2' });

    await NotificationService.send(payload);

    // Verify SSE
    expect(emitToUser).toHaveBeenCalledWith(null, 'user-123', 'notification:new', { id: 'notif-2' });
  });

  it('should attempt to send an email for high priority notifications', async () => {
    const payload = {
      userId: 'user-email-test',
      type: 'TASK_ASSIGNED' as const,
      message: 'You have a new task',
    };

    (prisma.notification.create as any).mockResolvedValue({ id: 'notif-3' });
    
    // Mock user lookup for email
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'user-email-test',
      name: 'John Doe',
      email: 'john@example.com',
    });

    await NotificationService.send(payload);

    // We can't easily assert the internal un-exported sendEmail function,
    // but we CAN assert that findUnique was called to fetch the user's email.
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: payload.userId },
      select: { email: true, name: true },
    });
  });
});
