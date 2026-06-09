import { Queue, QueueOptions } from 'bullmq';
import Redis from 'ioredis';
import { logger } from '../utils/logger.js';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// BullMQ requires a specific Redis configuration (maxRetriesPerRequest: null)
const bullMqRedisConnection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  retryStrategy(times) {
    if (times > 3) {
      logger.warn('[BullMQ Redis] Connection failed. Fallback mode enabled.');
      return null;
    }
    return Math.min(times * 50, 2000);
  },
});

export let isQueueReady = false;

bullMqRedisConnection.on('connect', () => {
  isQueueReady = true;
});
bullMqRedisConnection.on('error', () => {
  isQueueReady = false;
});

const queueOptions: QueueOptions = {
  connection: bullMqRedisConnection as any,
};

export const emailQueue = new Queue('emailQueue', queueOptions);

// Utility to dispatch jobs
export async function enqueueEmail(data: { to: string; subject: string; html: string }) {
  if (isQueueReady) {
    await emailQueue.add('send-email', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
    logger.info(`[Queue] Added email job for ${data.to}`);
  } else {
    // Fallback: execute directly if Redis/BullMQ is down
    logger.warn(`[Queue] Redis down. Sending email synchronously as fallback to ${data.to}`);
    // We import this dynamically to avoid circular dependencies if worker imports queue
    const { processEmailJob } = await import('../workers/emailWorker.js');
    await processEmailJob(data);
  }
}
