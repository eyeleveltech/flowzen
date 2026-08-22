/**
 * One search box over everything.
 *
 * Scoped to the organisation on every branch — a search that forgets its
 * organisation is the most direct way to leak one client's data to another, and
 * it looks like a working feature while it does it (master plan §5).
 *
 * Money is not searchable text, so invoices and quotations match on their NUMBER.
 * That is what somebody has in front of them when they come looking.
 */

import { Router, type Response, type NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, queryParam, rankOf, type AuthRequest } from '../middleware/auth.js';

export const searchRouter = Router();

searchRouter.use(authenticate);

const LIMIT = 6;

searchRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const q = (queryParam(req, 'q') ?? '').trim();
    // Two characters is the point where results stop being everything.
    if (q.length < 2) {
      res.json({ success: true, data: { companies: [], deals: [], projects: [], tasks: [], quotes: [], invoices: [] } });
      return;
    }

    const orgId = req.user!.organizationId;
    const contains = { contains: q, mode: 'insensitive' as const };
    // Money is the one real dividing line, so quotations and invoices are only
    // searched for people who are allowed to see them (§3.10).
    const seesMoney = rankOf(req.user!.role) >= rankOf('ADMIN');

    const [companies, deals, projects, tasks, quotes, invoices] = await Promise.all([
      prisma.company.findMany({
        where: { organizationId: orgId, OR: [{ name: contains }, { email: contains }, { phone: contains }] },
        select: { id: true, name: true, status: true },
        take: LIMIT,
      }),
      prisma.deal.findMany({
        where: { organizationId: orgId, title: contains },
        select: { id: true, title: true, company: { select: { name: true } }, stage: { select: { name: true } } },
        take: LIMIT,
      }),
      prisma.project.findMany({
        where: { organizationId: orgId, name: contains },
        select: { id: true, name: true, company: { select: { name: true } } },
        take: LIMIT,
      }),
      prisma.task.findMany({
        where: { organizationId: orgId, title: contains },
        select: {
          id: true,
          title: true,
          projectId: true,
          dealId: true,
          project: { select: { name: true } },
        },
        take: LIMIT,
      }),
      seesMoney
        ? prisma.quote.findMany({
            where: { organizationId: orgId, number: contains },
            select: { id: true, number: true, total: true, company: { select: { name: true } } },
            take: LIMIT,
          })
        : [],
      seesMoney
        ? prisma.invoice.findMany({
            where: { organizationId: orgId, number: contains },
            select: { id: true, number: true, total: true, company: { select: { name: true } } },
            take: LIMIT,
          })
        : [],
    ]);

    res.json({
      success: true,
      data: {
        companies,
        deals,
        projects,
        // A task belongs to exactly one of a project or a deal, so where it
        // links to follows from which parent it has.
        tasks: tasks.map((t) => ({
          id: t.id,
          title: t.title,
          context: t.project?.name ?? 'On a deal',
          href: t.projectId ? `/projects/${t.projectId}` : t.dealId ? `/pipeline/${t.dealId}` : '/tasks',
        })),
        quotes: quotes.map((q) => ({ ...q, total: q.total.toString() })),
        invoices: invoices.map((i) => ({ ...i, total: i.total.toString() })),
      },
    });
  } catch (e) {
    next(e);
  }
});
