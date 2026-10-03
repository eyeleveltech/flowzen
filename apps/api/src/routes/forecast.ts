import { Router, type Response, type NextFunction } from 'express';
import { authenticate, type AuthRequest, requirePermission } from '../middleware/auth.js';
import { composeForecast } from '../services/forecast.js';

export const forecastRouter = Router();

forecastRouter.use(authenticate);

/**
 * GET /api/forecast/3-month — 3-Month Forward Cash Flow Radar
 */
forecastRouter.get(
  '/3-month',
  // `reports.read` — the switch whose own label reads "Reports and brief" — was
  // granted to Management and then enforced on nothing, while this route asked
  // for `money.figures` instead. That let Accounts, who legitimately needs
  // figures, into the management reports as well. The narrower switch is the
  // one that was meant to guard this.
  requirePermission('reports.read'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const orgId = req.user!.organizationId;
      // §10 Forecast: "what if per deal" — pass the id of one open proposal
      // to see the forecast as though it had already closed (full value,
      // every month, instead of its stage-weighted contribution).
      const assumeWonId = typeof req.query.assumeWon === 'string' ? req.query.assumeWon : null;

      res.json({ success: true, ...(await composeForecast(orgId, assumeWonId)) });
    } catch (e) {
      next(e);
    }
  },
);
