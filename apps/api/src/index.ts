/**
 * Flowzen API (v2).
 */

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
// Side-effect import: loads .env before any module that reads process.env at
// module scope. ES imports are hoisted, so calling dotenv.config() in this file's
// body would run too late.
import './lib/env.js';
import { logger } from './utils/logger.js';

import { authRouter } from './routes/auth.js';
import { configRouter } from './routes/config.js';
import { companiesRouter } from './routes/companies.js';
import { dealsRouter } from './routes/deals.js';
import { expensesRouter } from './routes/expenses.js';
import { revenueRouter } from './routes/revenue.js';
import { quotesRouter } from './routes/quotes.js';
import { projectsRouter } from './routes/projects.js';
import { activitiesRouter } from './routes/activities.js';
import { dashboardRouter } from './routes/dashboard.js';
import { notificationsRouter } from './routes/notifications.js';
import { usersRouter } from './routes/users.js';
import { profileRouter } from './routes/profile.js';
import { searchRouter } from './routes/search.js';
import { reportsRouter } from './routes/reports.js';
import { departmentsRouter } from './routes/departments.js';
import { sseRouter } from './sse.js';
import { startScannerCron } from './workers/scanner.cron.js';

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(',').map((s: string) => s.trim()) ?? true,
    credentials: true,
  }),
);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// `status` is kept because something outside may be watching this endpoint.
// Changing a health check's shape is how a monitor goes quiet without anyone
// noticing it has stopped reporting.
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: 2 });
});

app.use('/api/auth', authRouter);
app.use('/api/config', configRouter);
app.use('/api/companies', companiesRouter);
app.use('/api/deals', dealsRouter);
app.use('/api/expenses', expensesRouter);
app.use('/api/revenue', revenueRouter);
app.use('/api/quotes', quotesRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/activities', activitiesRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/reports', reportsRouter);
// The header polls this on every page. Unmounted, it is a 404 on every page.
app.use('/api/notifications', notificationsRouter);
app.use('/api/users', usersRouter);
app.use('/api/profile', profileRouter);
app.use('/api/search', searchRouter);
app.use('/api/departments', departmentsRouter);

// Live updates. The client reconnects forever if this is missing, so an
// unmounted stream endpoint is not a quiet failure — it is a retry loop.
app.use('/api/stream', sseRouter);

app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

/**
 * One error handler.
 *
 * A rule violation is a 4xx with the field it belongs to, so a form can render it
 * where the person is looking. Anything unrecognised is a 500 and gets logged
 * with its stack — an error a customer cannot act on is a support ticket.
 */
app.use(
  (
    err: Error & { status?: number; code?: string },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const status = err.status ?? 500;
    if (status >= 500) {
      logger.error(`Unhandled error: ${err.stack ?? err.message}`);
    }
    res.status(status).json({
      success: false,
      error: status >= 500 ? 'Something went wrong' : err.message,
      ...(err.code ? { code: err.code } : {}),
    });
  },
);

const port = Number(process.env.PORT ?? 4000);

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    logger.info(`Flowzen API v2 listening on :${port}`);
    startScannerCron();
  });
}

export { app };
