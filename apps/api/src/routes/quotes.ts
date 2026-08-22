/**
 * Quotation endpoints.
 *
 * Flowzen sends the document; the client's answer comes back outside it, so the
 * answer is recorded by hand (master plan §3.12).
 */

import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, param, requireRole, requireModule, type AuthRequest } from '../middleware/auth.js';
import {
  createQuote,
  markSent,
  emailQuote,
  acceptQuote,
  declineQuote,
  findAwaitingReply,
  computeQuoteTotals,
  QuoteRuleError,
} from '../services/quote.service.js';
import { getOrgConfig } from '../lib/orgConfig.js';
import { TaxConfigurationError } from '../utils/tax.js';
import { explainMailFailure } from '../services/mail.js';
import { generateQuotePdf } from '../services/pdf.service.js';
import { storage } from '../services/storage.js';

export const quotesRouter = Router();

/**
 * Quotations are Sales and above (§3.10 — a Member's row reads "—").
 *
 * On the router, for the same reason as the pipeline: the write routes each
 * carried `requireRole('SALES')` and the LIST carried nothing, so any signed-in
 * account could read every quotation and its total. A quotation total is what a
 * client pays, which is the boundary the whole role design exists to hold.
 */
quotesRouter.use(authenticate, requireModule('CRM'), requireRole('SALES'));

/**
 * Turn the two errors a caller can actually act on into 4xx.
 *
 * Everything else goes to the handler, which logs it and says nothing — an error
 * a person cannot act on is a support ticket, not a message.
 */
const onError = (e: unknown, res: Response, next: NextFunction) => {
  if (e instanceof TaxConfigurationError) {
    res.status(422).json({ success: false, error: e.message, code: e.code });
    return;
  }
  // A rule the database also enforces. Refused here so it arrives as a sentence
  // rather than as a unique-index violation nobody can read.
  if (e instanceof QuoteRuleError) {
    res.status(409).json({ success: false, error: e.message, code: e.code });
    return;
  }
  next(e);
};

const lineSchema = z.object({
  description: z.string().min(1),
  quantity: z.union([z.number(), z.string()]),
  rate: z.union([z.number(), z.string()]),
  discountPercent: z.union([z.number(), z.string()]).optional(),
  serviceId: z.string().optional().nullable(),
});

const quoteSchema = z.object({
  dealId: z.string().min(1),
  engagementType: z.enum(['RETAINER', 'PROJECT']),
  billingFrequency: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY', 'ONE_TIME']),
  paymentTerms: z.enum(['ADVANCE_100', 'SPLIT_50_50', 'MONTHLY', 'MILESTONE']).optional().nullable(),
  lines: z.array(lineSchema).min(1, 'A quotation needs at least one line.'),
  taxRatePercent: z.number().optional(),
  validUntil: z.coerce.date().optional().nullable(),
});

quotesRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const quotes = await prisma.quote.findMany({
      where: {
        organizationId: req.user!.organizationId,
        ...(req.query.dealId ? { dealId: String(req.query.dealId) } : {}),
        ...(req.query.status ? { status: req.query.status as never } : {}),
      },
      include: {
        company: { select: { id: true, name: true } },
        deal: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ success: true, data: quotes });
  } catch (e) {
    next(e);
  }
});

/**
 * Preview the totals without saving.
 *
 * Lets the form show a running figure that is the SERVER's arithmetic, so what is
 * displayed while typing and what gets billed cannot diverge.
 */
quotesRouter.post('/preview', requireRole('SALES'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { lines, taxRatePercent, companyId } = req.body ?? {};
    if (!Array.isArray(lines) || lines.length === 0) {
      res.status(400).json({ success: false, error: 'At least one line is needed.' });
      return;
    }

    const org = await getOrgConfig(req.user!.organizationId);
    const company = companyId
      ? await prisma.company.findFirst({
          where: { id: String(companyId), organizationId: org.id },
          select: { state: true },
        })
      : null;

    const totals = computeQuoteTotals(lines, taxRatePercent ?? 18, org.state, company?.state ?? null);
    res.json({
      success: true,
      data: {
        lines: totals.lines,
        subtotal: totals.subtotal.toString(),
        cgst: totals.cgst.toString(),
        sgst: totals.sgst.toString(),
        igst: totals.igst.toString(),
        total: totals.total.toString(),
      },
    });
  } catch (e) {
    onError(e, res, next);
  }
});

quotesRouter.post('/', requireRole('SALES'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = quoteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const quote = await createQuote(
      { ...parsed.data, organizationId: req.user!.organizationId },
      req.user!.userId,
    );
    res.status(201).json({ success: true, data: quote });
  } catch (e) {
    onError(e, res, next);
  }
});

quotesRouter.get('/awaiting-reply', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const days = Number(req.query.days ?? 7);
    res.json({ success: true, data: await findAwaitingReply(req.user!.organizationId, days) });
  } catch (e) {
    next(e);
  }
});

quotesRouter.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const quote = await prisma.quote.findFirst({
      where: { id: param(req, 'id'), organizationId: req.user!.organizationId },
      include: { company: true, deal: { include: { stage: true } } },
    });
    if (!quote) {
      res.status(404).json({ success: false, error: 'Quotation not found' });
      return;
    }
    res.json({ success: true, data: quote });
  } catch (e) {
    next(e);
  }
});

const owned = async (req: AuthRequest, id: string) =>
  prisma.quote.findFirst({
    where: { id, organizationId: req.user!.organizationId },
    select: { id: true },
  });

const sendSchema = z.object({
  via: z.enum(['FLOWZEN_EMAIL', 'MANUAL_EMAIL', 'WHATSAPP', 'IN_PERSON', 'OTHER']).default('FLOWZEN_EMAIL'),
  /** Only for the manual paths — when it actually went out. */
  sentAt: z.coerce.date().optional(),
  /** FLOWZEN_EMAIL only: override the recipient, and a line of your own. */
  to: z.string().email().optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
});

/**
 * Sent from Flowzen, or by hand and marked afterwards. Both are supported, and
 * they are NOT the same act.
 *
 * `FLOWZEN_EMAIL` actually sends, and the status moves only if the message left.
 * Everything else is a person asserting they sent it themselves, which Flowzen
 * records without pretending to have witnessed it (§3.12).
 */
quotesRouter.post('/:id/send', requireRole('SALES'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    if (!(await owned(req, id))) {
      res.status(404).json({ success: false, error: 'Quotation not found' });
      return;
    }

    const parsed = sendSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    if (parsed.data.via !== 'FLOWZEN_EMAIL') {
      const data = await markSent(id, req.user!.userId, parsed.data.via, parsed.data.sentAt ?? new Date());
      res.json({ success: true, data: { ...data, emailed: false } });
      return;
    }

    const result = await emailQuote(id, req.user!.userId, {
      to: parsed.data.to,
      note: parsed.data.note,
    });

    if (!result.delivered) {
      // 422, not 500: the request was fine and nothing is broken in Flowzen —
      // it cannot send yet, and the answer says what to do about it. The quote
      // is untouched, so marking it sent by hand is still available.
      res.status(422).json({
        success: false,
        code: result.reason,
        error: explainMailFailure(result.reason),
        detail: result.detail,
      });
      return;
    }

    res.json({
      success: true,
      data: { ...result.quote, emailed: true, to: result.to },
      message: `Quotation emailed to ${result.to}.`,
    });
  } catch (e) {
    onError(e, res, next);
  }
});

const acceptSchema = z.object({
  /** When they said yes — defaults to now, but editable, and that is the point. */
  acceptedAt: z.coerce.date().optional(),
  via: z.enum(['EMAIL', 'CALL', 'WHATSAPP', 'IN_PERSON', 'SIGNED_DOCUMENT', 'OTHER']),
  note: z.string().optional().nullable(),
});

quotesRouter.post('/:id/accept', requireRole('SALES'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    if (!(await owned(req, id))) {
      res.status(404).json({ success: false, error: 'Quotation not found' });
      return;
    }
    const parsed = acceptSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const result = await acceptQuote(
      id,
      { acceptedAt: parsed.data.acceptedAt ?? new Date(), via: parsed.data.via, note: parsed.data.note },
      req.user!.userId,
    );

    res.json({
      success: true,
      data: result,
      // Accepting offers the win, pre-filled. It does not perform it — winning
      // needs a start date this person may not have (§3.12).
      message: result.promptWin ? 'Quotation accepted. Win the deal to start billing.' : undefined,
    });
  } catch (e) {
    onError(e, res, next);
  }
});

quotesRouter.post('/:id/decline', requireRole('SALES'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    if (!(await owned(req, id))) {
      res.status(404).json({ success: false, error: 'Quotation not found' });
      return;
    }
    const reason = req.body?.reason;
    if (!reason) {
      res.status(422).json({ success: false, error: 'A reason is needed — it is what makes "why do we lose?" answerable.' });
      return;
    }
    const declinedAt = req.body?.declinedAt ? new Date(req.body.declinedAt) : new Date();
    res.json({ success: true, data: await declineQuote(id, reason, req.user!.userId, declinedAt) });
  } catch (e) {
    onError(e, res, next);
  }
});
