/**
 * One box over everything (⌘K).
 *
 * The palette is mounted on every dashboard page and fires on every two-letter
 * query, so this route was being called constantly and 404'ing every time —
 * swallowed by the palette's empty catch, which is why it looked like "search
 * finds nothing" rather than "search is not there".
 *
 * Each section is gated on the same permission as the list screen it comes
 * from, so search can never become a side door into figures a person is not
 * allowed to open directly. Sections a person may not see are absent, not
 * empty — the palette renders only what it is given.
 */

import { Router, type Response, type NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, hasPermission, type AuthRequest } from '../middleware/auth.js';

export const searchRouter = Router();

searchRouter.use(authenticate);

/** How each stage reads on screen. Mirrors the list config sends. */
const STAGE_NAME: Record<string, string> = {
  TALKING: 'Talking',
  PROPOSAL_SENT: 'Proposal Sent',
  IN_NEGOTIATION: 'In Negotiation',
  PROFORMA_ISSUED: 'Proforma Issued',
  VERBAL_YES: 'Verbal Yes',
  WON: 'Won',
  LOST: 'Lost',
  EXPIRED: 'Expired',
};

/** Enough rows to recognise the one you meant, few enough to scan. */
const LIMIT = 6;

searchRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const orgId = req.user!.organizationId;
    const user = req.user!;

    const empty = { companies: [], deals: [], projects: [], tasks: [], quotes: [], invoices: [] };

    // The palette already refuses to call below two characters; this is the
    // same rule on the server, so a hand-made request cannot ask for the
    // whole database one letter at a time.
    if (q.length < 2) {
      res.json(empty);
      return;
    }

    const like = { contains: q, mode: 'insensitive' as const };

    const canCompanies = hasPermission(user, 'company.read');
    const canPipeline = hasPermission(user, 'pipeline.read');
    const canProjects = hasPermission(user, 'work.all');
    const canMoney = hasPermission(user, 'money.status');

    const [companies, deals, projects, tasks, quotes, invoices] = await Promise.all([
      canCompanies
        ? prisma.company.findMany({
            where: { organizationId: orgId, archivedAt: null, name: like },
            select: { id: true, name: true, status: true },
            orderBy: { name: 'asc' },
            take: LIMIT,
          })
        : [],

      // A proposal has no title of its own — what people remember is the
      // client, so that is what it is matched and named by. The palette's
      // `enquiryName` already falls back to the company for a null title.
      canPipeline
        ? prisma.proposal.findMany({
            where: { organizationId: orgId, company: { name: like } },
            // `kind` and `createdAt` are what tell two of a client's
            // proposals apart. A proposal has no title, so without them a
            // company with two rendered the same line twice — searching
            // Pavilion Club returned "Pavilion Club · Won" and
            // "Pavilion Club · Won", two real records and no way to pick.
            select: {
              id: true,
              stage: true,
              kind: true,
              createdAt: true,
              company: { select: { id: true, name: true } },
            },
            orderBy: { updatedAt: 'desc' },
            take: LIMIT,
          })
        : [],

      canProjects
        ? prisma.project.findMany({
            where: { organizationId: orgId, deletedAt: null, name: like },
            select: { id: true, name: true, company: { select: { name: true } } },
            orderBy: { updatedAt: 'desc' },
            take: LIMIT,
          })
        : [],

      // Tasks are the one section everybody gets, because everybody has their
      // own. Without work.all it is narrowed to the ones assigned to you —
      // the same rule /my-work follows.
      prisma.task.findMany({
        where: {
          organizationId: orgId,
          deletedAt: null,
          title: like,
          ...(hasPermission(user, 'work.all') ? {} : { assignees: { some: { userId: user.userId } } }),
        },
        select: {
          id: true,
          title: true,
          projectId: true,
          project: { select: { name: true } },
          monthCard: {
            select: { retainerId: true, retainer: { select: { company: { select: { name: true } } } } },
          },
        },
        orderBy: { dueDate: 'asc' },
        take: LIMIT,
      }),

      canPipeline
        ? prisma.proforma.findMany({
            where: { organizationId: orgId, number: like },
            select: { id: true, number: true, company: { select: { name: true } } },
            orderBy: { createdAt: 'desc' },
            take: LIMIT,
          })
        : [],

      canMoney
        ? prisma.invoice.findMany({
            where: { organizationId: orgId, number: like },
            select: { id: true, number: true, company: { select: { name: true } } },
            orderBy: { createdAt: 'desc' },
            take: LIMIT,
          })
        : [],
    ]);

    res.json({
      companies,
      deals: deals.map((d) => ({
        id: d.id,
        title: null,
        company: d.company,
        stage: { name: STAGE_NAME[d.stage] ?? d.stage },
        kind: d.kind,
        raisedAt: d.createdAt,
      })),
      projects,
      // There is no screen that opens a single task, so a task links to the
      // thing it hangs off — the project or the retainer month it belongs to,
      // and /my-work for one that belongs to neither.
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        context: t.project?.name ?? t.monthCard?.retainer.company.name ?? null,
        href: t.projectId
          ? `/projects/${t.projectId}`
          : t.monthCard
            ? `/retainers/${t.monthCard.retainerId}`
            : '/my-work',
      })),
      quotes,
      invoices,
    });
  } catch (e) {
    next(e);
  }
});
