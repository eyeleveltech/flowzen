import morgan from 'morgan';
import { logger } from '../utils/logger.js';

morgan.token('req-id', (req: any) => req.id || req.headers['x-request-id'] || '-');

morgan.token('safe-url', (req: any) => {
  const rawUrl: string = req.originalUrl || req.url || '';
  if (!rawUrl.includes('?')) return rawUrl;

  const [pathname, search] = rawUrl.split('?');
  const params = new URLSearchParams(search);
  const SENSITIVE_KEYS = ['apikey', 'token', 'secret', 'password', 'key', 'access_token'];

  for (const key of Array.from(params.keys())) {
    if (SENSITIVE_KEYS.includes(key.toLowerCase())) {
      params.set(key, '[REDACTED]');
    }
  }

  const sanitizedQuery = params.toString();
  return sanitizedQuery ? `${pathname}?${sanitizedQuery}` : pathname;
});

const stream = {
  write: (message: string) => logger.info(message.trim()),
};

export const morganMiddleware = morgan(
  '[:req-id] :remote-addr :method :safe-url :status :res[content-length] - :response-time ms',
  { stream }
);
