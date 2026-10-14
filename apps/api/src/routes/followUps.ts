import { Router, type Response, type NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, hasPermission, type AuthRequest } from '../middleware/auth.js';
import { asStoredDay, dayKey } from '../utils/moneyDates.js';
import { ACTIVE_OUTREACH, studioToday } from '../services/salesFollowUp.js';

/**
 * GET /api/follow-ups — the Follow-ups section on the owner's My Work
 * (Sales next step plan, decision 5).
 *
 * Their own open deals and active leads whose next step falls today or
 * earlier (overdue), or tomorrow. Overdue next steps reach nobody's bell —
 * this list is where the owner sees them; PROPOSAL_STALLED still reaches
 * management.
 *
 * Deals need pipeline.read and leads company.read: each half appears only for
 * someone allowed to open it.
 */
export const followUpsRouter = Router();
followUpsRouter.use(authenticate);

export interface FollowUp {
  kind: 'DEAL' | 'LEAD';
  id: string;
  /** The client or the lead. */
  name: string;
  nextStep: string | null;
  date: string;
  overdue: boolean;
  dueToday: boolean;
  link: string;
}

followUpsRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const me = req.user!.userId;
    const today = await studioToday(orgId);
    const tomorrowEnd = new Date(asStoredDay(today).getTime() + 2 * 86_400_000);

    const seeDeals = hasPermission(req.user!, 'pipeline.read');
    const seeLeads = hasPermission(req.user!, 'company.read');

    const [deals, leads] = await Promise.all([
      seeDeals
        ? prisma.proposal.findMany({
            where: { organizationId: orgId, ownerId: me, outcome: null, deletedAt: null, nextStepDate: { lt: tomorrowEnd } },
            select: { id: true, companyId: true, nextStep: true, nextStepDate: true, company: { select: { name: true } } },
            orderBy: { nextStepDate: 'asc' },
            take: 100,
          })
        : [],
      seeLeads
        ? prisma.outreachEntry.findMany({
            where: {
              organizationId: orgId,
              ownerId: me,
              deletedAt: null,
              promotedCompanyId: null,
              status: { in: ACTIVE_OUTREACH },
              nextActionDate: { lt: tomorrowEnd },
            },
            select: { id: true, name: true, nextStep: true, nextActionDate: true },
            orderBy: { nextActionDate: 'asc' },
            take: 100,
          })
        : [],
    ]);

    const row = (kind: FollowUp['kind'], id: string, name: string, nextStep: string | null, at: Date, link: string): FollowUp => {
      const date = dayKey(at);
      return { kind, id, name, nextStep, date, overdue: date < today, dueToday: date === today, link };
    };

    const items: FollowUp[] = [
      ...deals.map((d) => row('DEAL', d.id, d.company.name, d.nextStep, d.nextStepDate!, `/companies/${d.companyId}?tab=PROPOSALS`)),
      ...leads.map((l) => row('LEAD', l.id, l.name, l.nextStep, l.nextActionDate!, `/outreach?search=${encodeURIComponent(l.name)}`)),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

    res.json({ success: true, today, items });
  } catch (e) {
    next(e);
  }
});
