/**
 * Flowzen API Core Server
 */

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import './lib/env.js';
import { logger } from './utils/logger.js';

import { authRouter } from './routes/auth.js';
import { companiesRouter } from './routes/companies.js';
import { outreachRouter } from './routes/outreach.js';
import { proposalsRouter } from './routes/proposals.js';
import { proformasRouter } from './routes/proformas.js';
import { tasksRouter } from './routes/tasks.js';
import { retainersRouter } from './routes/retainers.js';
import { projectsRouter } from './routes/projects.js';
import { teamRouter } from './routes/team.js';
import { sseRouter } from './sse.js';
import { notificationsRouter } from './routes/notifications.js';
import { dashboardRouter } from './routes/dashboard.js';
import { configRouter } from './routes/config.js';
import { activitiesRouter } from './routes/activities.js';
import { invoicesRouter } from './routes/invoices.js';
import { forecastRouter } from './routes/forecast.js';
import { briefRouter } from './routes/brief.js';
import { costsRouter } from './routes/costs.js';
import { allocationsRouter } from './routes/allocations.js';
import { usersRouter } from './routes/users.js';
import { profileRouter } from './routes/profile.js';
import { searchRouter } from './routes/search.js';
import { taskTemplatesRouter } from './routes/taskTemplates.js';
import { assetsRouter } from './routes/assets.js';
import { startAgencyHealthScanner } from './workers/scanner.cron.js';
import { startMonthCardScheduler } from './workers/monthCard.cron.js';
import { startAllocationScheduler } from './workers/allocation.cron.js';
import { startRecurringCostScheduler } from './workers/recurringCost.cron.js';
import { startMondayBriefScheduler } from './workers/brief.cron.js';

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

/**
 * A ceiling on how fast anybody can hammer the API.
 *
 * Rate limiting existed only on `/api/auth`, which stopped somebody guessing
 * passwords and nothing else: a signed-in account could run any other endpoint
 * flat out. This is deliberately loose — 600 requests a minute is far above
 * what the app itself generates, so it never gets in a real person's way — and
 * it is a backstop against a runaway loop or a script, not a security control.
 * The per-account limiter on /api/auth remains the tight one.
 */
app.use(
  '/api',
  rateLimit({
    windowMs: 60_000,
    limit: 600,
    standardHeaders: true,
    legacyHeaders: false,
    // The health check is what a monitor polls; throttling it would make the
    // API look down at exactly the moment somebody is checking whether it is.
    skip: (req) => req.path === '/health',
    message: { success: false, error: 'Too many requests. Slow down and try again in a minute.' },
  }),
);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: 2 });
});

// Mounted domain routers
app.use('/api/auth', authRouter);
app.use('/api/companies', companiesRouter);
app.use('/api/outreach', outreachRouter);
// One base path per router. `/api/pipeline` used to mount this same router a
// second time, publishing all 11 proposal routes on a second address that no
// client ever called — twice the surface for none of the use.
app.use('/api/proposals', proposalsRouter);
app.use('/api/proformas', proformasRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/retainers', retainersRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/team', teamRouter);
app.use('/api/users', usersRouter);
app.use('/api/profile', profileRouter);
app.use('/api/search', searchRouter);
app.use('/api/stream', sseRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/config', configRouter);
app.use('/api/activities', activitiesRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/forecast', forecastRouter);
app.use('/api/brief', briefRouter);
app.use('/api/costs', costsRouter);
app.use('/api/allocations', allocationsRouter);
app.use('/api/task-templates', taskTemplatesRouter);
app.use('/api/assets', assetsRouter);

// Start background health rules scanner
startAgencyHealthScanner();

// Keep MonthCards rolling on their own — the 1st of the month should not
// depend on an admin remembering to press "Trigger Month Roll".
startMonthCardScheduler();

// Compute proposed PeopleAllocation percentages from completed task counts
// from the 25th onward, so heads have something real to confirm against.
startAllocationScheduler();

// Roll recurring costs (rent, internet, software, salaries) forward into a
// new draft row each month, instead of leaving `recurring` a flag nothing reads.
startRecurringCostScheduler();

// Mail the Monday brief to everyone with reports.read — the brief itself
// was already real, just never scheduled or sent anywhere.
startMondayBriefScheduler();

app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

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

const PORT = process.env.PORT || 4000;
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logger.info(`⚡ Flowzen API server running on port ${PORT}`);
  });
}

export { app };
export default app;
