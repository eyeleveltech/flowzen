import './lib/env.js'; // must stay first: loads .env before modules that read process.env at import time
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { errorHandler } from './middleware/errorHandler.js';
import { authenticate, authorize, requireModule } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { clientRouter } from './routes/clients.js';
import { projectRouter } from './routes/projects.js';
import { taskRouter } from './routes/tasks.js';
import { teamRouter } from './routes/team.js';
import { teamRouter as teamsRouter } from './routes/teams.js';
import { reportRouter } from './routes/reports.js';
import { notificationRouter } from './routes/notifications.js';
import { analyticsRouter } from './routes/analytics.js';
import { searchRouter } from './routes/search.js';
import { settingsRouter } from './routes/settings.js';
import { profileRouter } from './routes/profile.js';
import { workflowRouter } from './routes/workflows.js';
import { crmRouter } from './routes/crm.js';
import { quoteRouter } from './routes/quotes.js';
import { revenueRouter } from './routes/revenue.js';
import publicApiRouter from './routes/public/index.js';
import { sseRouter } from './sse.js';
import './workers/emailWorker.js'; // Initialize BullMQ email worker
import { startScheduler } from './services/scheduler.js';
import { morganMiddleware } from './middleware/logger.js';
import { logger } from './utils/logger.js';

// Startup diagnostic (masked) — confirms whether AI keys actually loaded into this process.
console.log(`[env] cwd=${process.cwd()} | APIFY_TOKEN=${process.env.APIFY_TOKEN ? 'loaded' : 'MISSING'} | OPENAI_API_KEY=${process.env.OPENAI_API_KEY ? 'loaded' : 'MISSING'}`);

const app = express();
app.set('trust proxy', 1);

import cookieParser from 'cookie-parser';

// Middleware
app.use(helmet());
app.use(morganMiddleware);
app.use(cors({
  origin: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Static files for uploads. Served under BOTH paths:
//  - /uploads      : direct access (local dev, where the browser hits the API host:port)
//  - /api/uploads  : production, where a reverse proxy routes only /api/* to this service,
//                    so upload URLs must go through /api to reach us (otherwise the frontend
//                    origin serves them -> 404).
const uploadsStatic = express.static('uploads');
app.use('/uploads', uploadsStatic);
app.use('/api/uploads', uploadsStatic);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
// Core (always available):
app.use('/api/auth', authRouter);
app.use('/api/notifications', notificationRouter);
app.use('/api/search', searchRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/profile', profileRouter);
app.use('/api/stream', sseRouter);

// CRM module (Admins only):
app.use('/api/crm/quotes', authenticate, authorize('SUPER_ADMIN', 'ADMIN'), requireModule('CRM'), quoteRouter);
app.use('/api/crm', authenticate, authorize('SUPER_ADMIN', 'ADMIN'), requireModule('CRM'), crmRouter);
app.use('/api/revenue', authenticate, authorize('SUPER_ADMIN', 'ADMIN'), revenueRouter);
app.use('/api/analytics', analyticsRouter);

// Shared infrastructure — available whenever CRM or PM is on (both use clients + the members list):
app.use('/api/clients', authenticate, requireModule('CRM', 'PM'), clientRouter);
app.use('/api/team', authenticate, requireModule('CRM', 'PM'), teamRouter);

// PM module:
app.use('/api/dashboard', authenticate, requireModule('PM'), dashboardRouter);
app.use('/api/projects', authenticate, requireModule('PM'), projectRouter);
app.use('/api/tasks', authenticate, requireModule('PM'), taskRouter);
app.use('/api/teams', authenticate, requireModule('PM'), teamsRouter);
app.use('/api/reports', authenticate, requireModule('PM'), reportRouter);
app.use('/api/workflows', authenticate, requireModule('PM'), workflowRouter);

// Public API (external keys):
app.use('/api/v1', publicApiRouter);

// Error handler
app.use(errorHandler);

// Start
const PORT = process.env.API_PORT || 4000;
if (process.env.NODE_ENV !== 'test') {
  app.listen(Number(PORT), '0.0.0.0', () => {
    logger.info(`🚀 Flowzen API running on http://localhost:${PORT}`);
    logger.info(`📡 SSE ready on /api/stream`);
    startScheduler();
  });
}

export { app };
