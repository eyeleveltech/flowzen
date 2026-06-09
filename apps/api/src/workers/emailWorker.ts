import { Worker } from 'bullmq';
import nodemailer from 'nodemailer';
import { logger } from '../utils/logger.js';
import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const bullMqRedisConnection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  retryStrategy(times) {
    if (times > 3) return null;
    return Math.min(times * 50, 2000);
  },
});

export async function processEmailJob(data: { to: string; subject: string; html: string }) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS || process.env.SMTP_USER === 'your-email@gmail.com') {
    logger.warn('[EmailWorker] SMTP not fully configured. Skipping email to:', data.to);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '465'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: `"${process.env.SMTP_FROM_NAME || 'Flowzen'}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
    to: data.to,
    subject: data.subject,
    html: data.html,
  });
  logger.info(`[EmailWorker] Successfully sent email to ${data.to}`);
}

// Initialize the worker
export const emailWorker = new Worker(
  'emailQueue',
  async (job) => {
    logger.info(`[EmailWorker] Processing job ${job.id} for ${job.data.to}`);
    await processEmailJob(job.data);
  },
  { connection: bullMqRedisConnection as any }
);

emailWorker.on('completed', (job) => {
  logger.info(`[EmailWorker] Job ${job.id} completed successfully`);
});

emailWorker.on('failed', (job, err) => {
  logger.error(`[EmailWorker] Job ${job?.id} failed: ${err.message}`);
});
