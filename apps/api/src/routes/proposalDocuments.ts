/**
 * Proposal documents (AI Proposal Builder, phase 1).
 *
 * Writing a proposal inside Flowzen: its sections, its line items, a live
 * preview, Finalise, and a PDF. Mounted on /api/proposals beside the pipeline
 * routes; every path here is either /catalog, /pricing-setup, /:id/documents
 * or /documents/…, none of which the pipeline router answers.
 *
 * Who does what (Founder, 19 Oct 2026):
 *   - Anyone on the pipeline reads a proposal and writes its text.
 *   - Prices — the line items, the floor override, Finalise — are Management's.
 *     Until a document is final, nobody else sees its figures.
 *   - A final document is the one the client gets, so anybody on the deal can
 *     open it and its PDF, and "Mark as sent" is the pipeline's to press.
 *   - Phase 2: "Send for review" hands a draft to Management (it is then
 *     theirs to edit, price, send back or finalise), the AI suggests text on
 *     request, and every final also keeps a Word file.
 *
 * Drafts are not ProposalVersions. A version is a proposal that was SENT — the
 * pipeline value, the Monday brief, the stalled-deal alert and the forecast all
 * read it that way — so a draft lives here until "Mark as sent" records one.
 */

import { Router, type NextFunction, type Response } from 'express';
import { z } from 'zod';
import { isIndustry } from '@flowzen/shared';
import { Prisma, ProposalOutcome, ProposalStage } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission, type AuthRequest } from '../middleware/auth.js';
import { nextStepFields } from '../services/salesFollowUp.js';
import { dealValueOf, priceProposal, type ProposalLineInput, type ProposalPrice } from '../services/proposalPricing.js';
import {
  defaultSections,
  documentRef,
  emptySections,
  linesForPricing,
  loadRenderableProposal,
  needsInputIn,
  nextProposalRef,
  parseSections,
  pricingContextFor,
  readFloors,
  renderProposalHtml,
  renderProposalPdf,
  sectionsSchema,
  unbackedAmounts,
} from '../services/proposalDocument.js';
import { nextStepForSave } from './proposals.js';
import { renderProposalDocx } from '../services/proposalDocx.js';
import { applyChanges, askProposalAi, parseThread, type ThreadEntry } from '../services/proposalAi.js';
import { AssistantFailed, AssistantNotConfigured } from '../services/moneyAssistant.js';
import { REVIEW_RULE } from '../services/alertRules.js';

export const proposalDocumentsRouter = Router();
proposalDocumentsRouter.use(authenticate);

/** Prices are Management's: the Pricing tab, the floor override, Finalise. */
const isManagement = (req: AuthRequest) => req.user!.preset === 'MANAGEMENT';

function requireManagement(req: AuthRequest, res: Response, next: NextFunction) {
  if (!isManagement(req)) {
    res.status(403).json({ success: false, error: 'Only Management can set or approve prices.' });
    return;
  }
  next();
}

const money = (v: unknown) => Number(v ?? 0);

// ── Setup: the service catalogue ────────────────────────────────────────────

const catalogItemSchema = z.object({
  name: z.string().trim().min(1, 'Name the service').max(120),
  category: z.string().trim().max(60).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
  unit: z.string().trim().min(1).max(30).optional(),
  billing: z.enum(['ONE_TIME', 'MONTHLY']).optional(),
  standardRate: z.number().min(0, 'A rate cannot be negative').max(1e9).optional().nullable(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

const catalogOut = (i: Prisma.ServiceCatalogItemGetPayload<object>, withRate: boolean) => ({
  id: i.id,
  name: i.name,
  category: i.category,
  description: i.description,
  unit: i.unit,
  billing: i.billing,
  active: i.active,
  sortOrder: i.sortOrder,
  ...(withRate ? { standardRate: i.standardRate === null ? null : money(i.standardRate) } : {}),
});

proposalDocumentsRouter.get('/catalog', requirePermission('pipeline.read'), async (req: AuthRequest, res: Response, next) => {
  try {
    const all = isManagement(req) && req.query.all === '1';
    const items = await prisma.serviceCatalogItem.findMany({
      where: { organizationId: req.user!.organizationId, ...(all ? {} : { active: true }) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    res.json({ success: true, items: items.map((i) => catalogOut(i, isManagement(req))) });
  } catch (e) {
    next(e);
  }
});

const duplicateName = (e: unknown) => (e as { code?: string }).code === 'P2002';

proposalDocumentsRouter.post('/catalog', requireManagement, async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = catalogItemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const d = parsed.data;
    const item = await prisma.serviceCatalogItem.create({
      data: {
        organizationId: req.user!.organizationId,
        name: d.name,
        category: d.category || null,
        description: d.description || null,
        unit: d.unit ?? 'month',
        billing: d.billing ?? 'MONTHLY',
        standardRate: d.standardRate ?? null,
        active: d.active ?? true,
        sortOrder: d.sortOrder ?? 0,
        updatedById: req.user!.userId,
      },
    });
    res.status(201).json({ success: true, item: catalogOut(item, true) });
  } catch (e) {
    if (duplicateName(e)) {
      res.status(409).json({ success: false, error: 'There is already a service with that name.' });
      return;
    }
    next(e);
  }
});

proposalDocumentsRouter.patch('/catalog/:itemId', requireManagement, async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = catalogItemSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const existing = await prisma.serviceCatalogItem.findFirst({
      where: { id: String(req.params.itemId), organizationId: req.user!.organizationId },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Service not found' });
      return;
    }
    const d = parsed.data;
    const item = await prisma.serviceCatalogItem.update({
      where: { id: existing.id },
      data: {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.category !== undefined ? { category: d.category || null } : {}),
        ...(d.description !== undefined ? { description: d.description || null } : {}),
        ...(d.unit !== undefined ? { unit: d.unit } : {}),
        ...(d.billing !== undefined ? { billing: d.billing } : {}),
        ...(d.standardRate !== undefined ? { standardRate: d.standardRate } : {}),
        ...(d.active !== undefined ? { active: d.active } : {}),
        ...(d.sortOrder !== undefined ? { sortOrder: d.sortOrder } : {}),
        updatedById: req.user!.userId,
      },
    });
    res.json({ success: true, item: catalogOut(item, true) });
  } catch (e) {
    if (duplicateName(e)) {
      res.status(409).json({ success: false, error: 'There is already a service with that name.' });
      return;
    }
    next(e);
  }
});

// ── Setup: the floors ───────────────────────────────────────────────────────

proposalDocumentsRouter.get('/pricing-setup', requireManagement, async (req: AuthRequest, res: Response, next) => {
  try {
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: req.user!.organizationId },
      select: { proposalFloorBase: true, proposalFloors: true },
    });
    res.json({ success: true, floorBase: money(org.proposalFloorBase), floors: readFloors(org.proposalFloors) });
  } catch (e) {
    next(e);
  }
});

const floorsSchema = z.object({
  floorBase: z.number().min(0, 'The floor cannot be negative').max(1e9),
  floors: z
    .record(z.string(), z.number().min(0, 'A floor cannot be negative').max(1e9))
    .refine((f) => Object.keys(f).every(isIndustry), 'One of those industries is not on the list'),
});

proposalDocumentsRouter.patch('/pricing-setup', requireManagement, async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = floorsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const orgId = req.user!.organizationId;
    const org = await prisma.organization.update({
      where: { id: orgId },
      data: { proposalFloorBase: parsed.data.floorBase, proposalFloors: parsed.data.floors },
      select: { proposalFloorBase: true, proposalFloors: true },
    });
    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Organization',
        entityId: orgId,
        actorId: req.user!.userId,
        verb: 'proposal_floors_updated',
        payload: { industries: Object.keys(parsed.data.floors) },
      },
    });
    res.json({ success: true, floorBase: money(org.proposalFloorBase), floors: readFloors(org.proposalFloors) });
  } catch (e) {
    next(e);
  }
});

// ── Loading ─────────────────────────────────────────────────────────────────

const documentInclude = {
  lineItems: { orderBy: { sortOrder: 'asc' as const } },
  createdBy: { select: { name: true } },
  finalisedBy: { select: { name: true } },
  floorOverrideBy: { select: { name: true } },
  reviewRequestedBy: { select: { name: true } },
  basedOn: { select: { n: true } },
  proposal: { include: { company: true } },
} satisfies Prisma.ProposalDocumentInclude;

type LoadedDocument = Prisma.ProposalDocumentGetPayload<{ include: typeof documentInclude }>;

async function loadDocument(req: AuthRequest, res: Response): Promise<LoadedDocument | null> {
  const doc = await prisma.proposalDocument.findFirst({
    where: { id: String(req.params.docId), proposal: { organizationId: req.user!.organizationId, deletedAt: null } },
    include: documentInclude,
  });
  if (!doc) {
    res.status(404).json({ success: false, error: 'Proposal document not found' });
    return null;
  }
  return doc;
}

async function orgForPricing(orgId: string) {
  return prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
}

async function priceOf(doc: LoadedDocument, items?: ProposalLineInput[]) {
  const org = await orgForPricing(doc.proposal.organizationId);
  const ctx = pricingContextFor(org, doc.proposal.company);
  return { ctx, price: priceProposal(items ?? linesForPricing(doc.lineItems), ctx) };
}

/**
 * Everything standing between a draft and Finalise, in words. The Pricing tab
 * lists these as they stand; Finalise refuses while any remain.
 */
function finaliseProblems(doc: LoadedDocument, price: ProposalPrice): string[] {
  const problems: string[] = [];
  const fee = doc.lineItems.filter((l) => !l.isPassthrough);
  if (!fee.length) problems.push('Add at least one priced service.');
  for (const l of fee) if (money(l.unitRate) <= 0) problems.push(`${l.name} has no rate.`);
  for (const l of fee) if (money(l.discountAmount) > money(l.qty) * money(l.unitRate)) problems.push(`The discount on ${l.name} is more than the line.`);
  if (!price.floor.passes && !doc.floorOverrideAt) {
    problems.push(
      `The monthly fee is below the ${price.floor.vertical ?? 'base'} floor of ₹${Math.round(price.floor.floor).toLocaleString('en-IN')}. Raise it, or record why it is lower.`,
    );
  }
  for (const name of price.discountsWithoutTrade) problems.push(`Say what the client gives in return for the discount on ${name}.`);
  const sections = parseSections(doc.sections);
  for (const amount of unbackedAmounts(doc.title, sections, price)) {
    problems.push(`The text says ${amount}, which no line item backs. Put prices in the Pricing tab, not the text.`);
  }
  for (const title of emptySections(sections)) problems.push(`"${title}" is empty. Write it, or hide it.`);
  for (const what of needsInputIn(doc.title, sections)) problems.push(`Still needs input: ${what}.`);
  return problems;
}

function documentOut(doc: LoadedDocument, withPrices: boolean) {
  const showFigures = withPrices || doc.status === 'FINAL';
  return {
    id: doc.id,
    proposalId: doc.proposalId,
    n: doc.n,
    ref: documentRef(doc.proposal.refNo, doc.n),
    status: doc.status,
    layout: doc.layout,
    title: doc.title,
    sections: parseSections(doc.sections),
    revisionNote: doc.revisionNote,
    basedOnN: doc.basedOn?.n ?? null,
    createdBy: doc.createdBy?.name ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    finalisedAt: doc.finalisedAt,
    finalisedBy: doc.finalisedBy?.name ?? null,
    sentAt: doc.sentAt,
    sentVersionId: doc.sentVersionId,
    floorOverride: doc.floorOverrideAt
      ? { reason: doc.floorOverrideReason, by: doc.floorOverrideBy?.name ?? null, at: doc.floorOverrideAt }
      : null,
    review: doc.reviewRequestedAt
      ? { requestedAt: doc.reviewRequestedAt, by: doc.reviewRequestedBy?.name ?? null }
      : null,
    reviewNote: doc.reviewNote,
    // The AI conversation. Staged rates are Management's, like every figure on a draft.
    aiThread: parseThread(doc.aiThread).map((e) =>
      e.from === 'ai' && e.lines && !showFigures
        ? { ...e, lines: { ...e.lines, items: e.lines.items.map((l) => ({ ...l, unitRate: null })) } }
        : e,
    ),
    lineItems: doc.lineItems.map((l) => ({
      id: l.id,
      catalogItemId: l.catalogItemId,
      name: l.name,
      description: l.description,
      billing: l.billing,
      qty: money(l.qty),
      unit: l.unit,
      isPassthrough: l.isPassthrough,
      priceSource: l.priceSource,
      ...(showFigures
        ? { unitRate: money(l.unitRate), discountAmount: money(l.discountAmount), discountTrade: l.discountTrade }
        : {}),
    })),
  };
}

async function respondWithDocument(req: AuthRequest, res: Response, doc: LoadedDocument, status = 200) {
  const mgmt = isManagement(req);
  const { ctx, price } = await priceOf(doc);
  const frozen = doc.status === 'FINAL' && doc.commercialSnapshot ? (doc.commercialSnapshot as unknown as ProposalPrice) : null;
  res.status(status).json({
    success: true,
    document: documentOut(doc, mgmt),
    canPrice: mgmt,
    ...(mgmt || doc.status === 'FINAL'
      ? {
          price: frozen ?? price,
          pricing: { clientStateKnown: ctx.clientStateKnown, clientStateName: ctx.clientStateName },
        }
      : {}),
    ...(mgmt && doc.status !== 'FINAL' ? { problems: finaliseProblems(doc, price) } : {}),
  });
}

// ── A deal's documents ──────────────────────────────────────────────────────

proposalDocumentsRouter.get('/:id/documents', requirePermission('pipeline.read'), async (req: AuthRequest, res: Response, next) => {
  try {
    const mgmt = isManagement(req);
    const proposal = await prisma.proposal.findFirst({
      where: { id: String(req.params.id), organizationId: req.user!.organizationId, deletedAt: null },
      include: {
        company: { select: { id: true, name: true, vertical: true, city: true } },
        owner: { select: { id: true, name: true } },
        versions: { orderBy: { n: 'desc' }, include: { sentFrom: { select: { id: true, n: true } } } },
        documents: {
          orderBy: { n: 'desc' },
          select: {
            id: true,
            n: true,
            status: true,
            title: true,
            revisionNote: true,
            createdAt: true,
            updatedAt: true,
            finalisedAt: true,
            sentAt: true,
            createdBy: { select: { name: true } },
          },
        },
      },
    });
    if (!proposal) {
      res.status(404).json({ success: false, error: 'Proposal not found' });
      return;
    }
    res.json({
      success: true,
      canPrice: mgmt,
      proposal: {
        id: proposal.id,
        kind: proposal.kind,
        stage: proposal.stage,
        outcome: proposal.outcome,
        refNo: proposal.refNo,
        company: proposal.company,
        owner: proposal.owner,
      },
      documents: proposal.documents.map((d) => ({
        id: d.id,
        n: d.n,
        ref: documentRef(proposal.refNo, d.n),
        status: d.status,
        title: d.title,
        revisionNote: d.revisionNote,
        createdBy: d.createdBy?.name ?? null,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        finalisedAt: d.finalisedAt,
        sentAt: d.sentAt,
      })),
      // What was actually sent. A figure only for Management on this screen.
      versions: proposal.versions.map((v) => ({
        id: v.id,
        n: v.n,
        sentAt: v.sentAt,
        scopeSummary: v.scopeSummary,
        fromDocument: v.sentFrom ? { id: v.sentFrom.id, n: v.sentFrom.n } : null,
        ...(mgmt ? { value: money(v.value) } : {}),
      })),
    });
  } catch (e) {
    next(e);
  }
});

proposalDocumentsRouter.post('/:id/documents', requirePermission('pipeline.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const proposal = await prisma.proposal.findFirst({
      where: { id: String(req.params.id), organizationId: orgId, deletedAt: null },
      include: { company: true, documents: { select: { n: true }, orderBy: { n: 'desc' }, take: 1 } },
    });
    if (!proposal) {
      res.status(404).json({ success: false, error: 'Proposal not found' });
      return;
    }
    if (proposal.outcome) {
      res.status(400).json({ success: false, error: `This deal is ${proposal.outcome === ProposalOutcome.WON ? 'won' : 'lost'}. Reopen it before writing a proposal.` });
      return;
    }
    if (proposal.documents.length) {
      res.status(409).json({ success: false, error: `This deal already has v${proposal.documents[0].n}. Start a new version from it instead.` });
      return;
    }

    // The deal's reference, given once, when its first document is started.
    if (!proposal.refNo) {
      for (let attempt = 1; ; attempt++) {
        const refNo = await nextProposalRef(orgId);
        try {
          await prisma.proposal.update({ where: { id: proposal.id }, data: { refNo } });
          break;
        } catch (err) {
          if ((err as { code?: string }).code !== 'P2002' || attempt >= 5) throw err;
        }
      }
    }

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true, defaultTermsAndConditions: true } });
    const created = await prisma.proposalDocument.create({
      data: {
        proposalId: proposal.id,
        n: 1,
        title: `Proposal for ${proposal.company.name}`,
        sections: defaultSections({ orgName: org.name, terms: org.defaultTermsAndConditions }) as unknown as Prisma.InputJsonValue,
        createdById: req.user!.userId,
      },
    });
    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Proposal',
        entityId: proposal.id,
        actorId: req.user!.userId,
        verb: 'proposal_document_started',
        payload: { n: 1 },
      },
    });
    const doc = await prisma.proposalDocument.findUniqueOrThrow({ where: { id: created.id }, include: documentInclude });
    await respondWithDocument(req, res, doc, 201);
  } catch (e) {
    next(e);
  }
});

// ── One document ────────────────────────────────────────────────────────────

proposalDocumentsRouter.get('/documents/:docId', requirePermission('pipeline.read'), async (req: AuthRequest, res: Response, next) => {
  try {
    const doc = await loadDocument(req, res);
    if (doc) await respondWithDocument(req, res, doc);
  } catch (e) {
    next(e);
  }
});

/**
 * A draft is anyone's on the deal to change; one in review is Management's;
 * a final is nobody's. Answers the refusal, and says whether it did.
 */
const refuseUnlessEditable = (doc: LoadedDocument, req: AuthRequest, res: Response): boolean => {
  if (doc.status === 'DRAFT') return false;
  if (doc.status === 'IN_REVIEW') {
    if (isManagement(req)) return false;
    res.status(409).json({ success: false, error: `v${doc.n} is with Management for review. Ask them to send it back to change it.` });
    return true;
  }
  res.status(409).json({ success: false, error: `v${doc.n} is final and locked. Start a new version to change it.` });
  return true;
};

/** The states this person may write to — the guard the writes themselves carry. */
const editableStates = (req: AuthRequest): ('DRAFT' | 'IN_REVIEW')[] => (isManagement(req) ? ['DRAFT', 'IN_REVIEW'] : ['DRAFT']);

const documentPatchSchema = z.object({
  title: z.string().trim().min(1, 'Give the proposal a title').max(160).optional(),
  sections: sectionsSchema.optional(),
  layout: z.enum(['MINIMAL', 'PREMIUM', 'COMPACT']).optional(),
  revisionNote: z.string().trim().max(500).optional().nullable(),
});

proposalDocumentsRouter.patch('/documents/:docId', requirePermission('pipeline.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = documentPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const doc = await loadDocument(req, res);
    if (!doc || refuseUnlessEditable(doc, req, res)) return;
    const d = parsed.data;
    // Guarded on the state in the write itself, so a save racing Finalise loses.
    const { count } = await prisma.proposalDocument.updateMany({
      where: { id: doc.id, status: { in: editableStates(req) } },
      data: {
        ...(d.title !== undefined ? { title: d.title } : {}),
        ...(d.layout !== undefined ? { layout: d.layout } : {}),
        ...(d.sections !== undefined ? { sections: d.sections as unknown as Prisma.InputJsonValue } : {}),
        ...(d.revisionNote !== undefined ? { revisionNote: d.revisionNote || null } : {}),
      },
    });
    if (!count) {
      res.status(409).json({ success: false, error: `v${doc.n} just changed hands (finalised or sent for review). Reload to see it.` });
      return;
    }
    const fresh = await prisma.proposalDocument.findUniqueOrThrow({ where: { id: doc.id }, include: documentInclude });
    await respondWithDocument(req, res, fresh);
  } catch (e) {
    next(e);
  }
});

proposalDocumentsRouter.delete('/documents/:docId', requirePermission('pipeline.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const doc = await loadDocument(req, res);
    if (!doc) return;
    if (doc.status !== 'DRAFT') {
      res.status(409).json({ success: false, error: `v${doc.n} is final. A final proposal is kept.` });
      return;
    }
    await prisma.proposalDocument.delete({ where: { id: doc.id } });
    await prisma.activity.create({
      data: {
        organizationId: req.user!.organizationId,
        entityType: 'Proposal',
        entityId: doc.proposalId,
        actorId: req.user!.userId,
        verb: 'proposal_document_discarded',
        payload: { n: doc.n },
      },
    });
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

// ── Pricing (Management) ────────────────────────────────────────────────────

const lineSchema = z.object({
  catalogItemId: z.string().min(1).optional().nullable(),
  name: z.string().trim().min(1, 'Name every line').max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  billing: z.enum(['ONE_TIME', 'MONTHLY']),
  qty: z.number().gt(0, 'Quantity must be more than zero').max(100_000),
  unit: z.string().trim().max(30).optional().nullable(),
  unitRate: z.number().min(0, 'A rate cannot be negative').max(1e9),
  discountAmount: z.number().min(0, 'A discount cannot be negative').max(1e9).optional(),
  discountTrade: z.string().trim().max(200).optional().nullable(),
  isPassthrough: z.boolean().optional(),
  priceSource: z.enum(['USER', 'VERSION', 'CATALOG']).optional(),
});
const linesSchema = z.object({ items: z.array(lineSchema).max(60, 'Keep a proposal to sixty lines or fewer') });

proposalDocumentsRouter.post('/documents/:docId/price', requireManagement, async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = linesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const doc = await loadDocument(req, res);
    if (!doc) return;
    const { price } = await priceOf(doc, parsed.data.items);
    res.json({ success: true, price });
  } catch (e) {
    next(e);
  }
});

proposalDocumentsRouter.put('/documents/:docId/line-items', requireManagement, async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = linesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const doc = await loadDocument(req, res);
    if (!doc || refuseUnlessEditable(doc, req, res)) return;

    const over = parsed.data.items.find((l) => (l.discountAmount ?? 0) > l.qty * l.unitRate);
    if (over) {
      res.status(400).json({ success: false, error: `The discount on ${over.name} is more than the line.` });
      return;
    }

    // Catalogue links only to this studio's own services.
    const linked = Array.from(new Set(parsed.data.items.map((l) => l.catalogItemId).filter((v): v is string => Boolean(v))));
    if (linked.length) {
      const found = await prisma.serviceCatalogItem.count({ where: { id: { in: linked }, organizationId: req.user!.organizationId } });
      if (found !== linked.length) {
        res.status(400).json({ success: false, error: 'One of those services is not in the catalogue.' });
        return;
      }
    }

    await saveLines(doc, parsed.data.items);
    const fresh = await prisma.proposalDocument.findUniqueOrThrow({ where: { id: doc.id }, include: documentInclude });
    await respondWithDocument(req, res, fresh);
  } catch (e) {
    next(e);
  }
});

type LineIn = z.infer<typeof lineSchema>;

/**
 * Replace a document's lines. An override was given for a figure, so a
 * different monthly fee clears it: it needs its own reason.
 */
async function saveLines(doc: LoadedDocument, items: LineIn[], extra: Prisma.ProposalDocumentUncheckedUpdateInput = {}) {
  const before = (await priceOf(doc)).price.monthly.subtotal;
  const after = (await priceOf(doc, items)).price.monthly.subtotal;
  const clearOverride = doc.floorOverrideAt && before !== after;
  await prisma.$transaction(async (tx) => {
    await tx.proposalLineItem.deleteMany({ where: { documentId: doc.id } });
    if (items.length) {
      await tx.proposalLineItem.createMany({
        data: items.map((l, i) => ({
          documentId: doc.id,
          catalogItemId: l.catalogItemId || null,
          name: l.name,
          description: l.description || null,
          billing: l.billing,
          qty: l.qty,
          unit: l.unit || null,
          unitRate: l.unitRate,
          discountAmount: l.discountAmount ?? 0,
          discountTrade: l.discountTrade || null,
          isPassthrough: l.isPassthrough ?? false,
          priceSource: l.priceSource ?? (l.catalogItemId ? 'CATALOG' : 'USER'),
          sortOrder: i,
        })),
      });
    }
    await tx.proposalDocument.update({
      where: { id: doc.id },
      data: {
        // Touch the row, so "last edited" moves with a pricing change.
        updatedAt: new Date(),
        ...(clearOverride ? { floorOverrideReason: null, floorOverrideById: null, floorOverrideAt: null } : {}),
        ...extra,
      },
    });
  });
}

const overrideSchema = z.object({
  reason: z.string().trim().min(20, 'Say why in a sentence — at least 20 characters').max(500),
});

proposalDocumentsRouter.post('/documents/:docId/floor-override', requireManagement, async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = overrideSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const doc = await loadDocument(req, res);
    if (!doc || refuseUnlessEditable(doc, req, res)) return;
    const { price } = await priceOf(doc);
    if (price.floor.passes) {
      res.status(400).json({ success: false, error: 'The monthly fee is at or above the floor. There is nothing to override.' });
      return;
    }
    await prisma.proposalDocument.update({
      where: { id: doc.id },
      data: { floorOverrideReason: parsed.data.reason, floorOverrideById: req.user!.userId, floorOverrideAt: new Date() },
    });
    await prisma.activity.create({
      data: {
        organizationId: req.user!.organizationId,
        entityType: 'Proposal',
        entityId: doc.proposalId,
        actorId: req.user!.userId,
        verb: 'proposal_floor_overridden',
        payload: { n: doc.n, reason: parsed.data.reason, monthlyValue: price.monthly.subtotal, floor: price.floor.floor },
      },
    });
    const fresh = await prisma.proposalDocument.findUniqueOrThrow({ where: { id: doc.id }, include: documentInclude });
    await respondWithDocument(req, res, fresh);
  } catch (e) {
    next(e);
  }
});

proposalDocumentsRouter.post('/documents/:docId/finalise', requireManagement, async (req: AuthRequest, res: Response, next) => {
  try {
    const doc = await loadDocument(req, res);
    if (!doc || refuseUnlessEditable(doc, req, res)) return;
    const orgId = req.user!.organizationId;
    const { price } = await priceOf(doc);
    const problems = finaliseProblems(doc, price);
    if (problems.length) {
      res.status(422).json({ success: false, error: problems[0], problems });
      return;
    }

    // The PDF first: if Chromium will not start, nothing is locked.
    const renderable = await loadRenderableProposal(doc.id, orgId, true);
    if (!renderable) {
      res.status(404).json({ success: false, error: 'Proposal document not found' });
      return;
    }
    const now = new Date();
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { timezone: true } });
    const final = {
      ...renderable,
      status: 'FINAL' as const,
      price,
      pricingNote: null,
      dateLabel: new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: org.timezone || 'Asia/Kolkata' }).format(now),
    };
    // Both files, made once, from the same frozen figures.
    const [pdf, docx] = await Promise.all([renderProposalPdf(final, { watermark: false }), renderProposalDocx(final, { draft: false })]);

    const { count } = await prisma.proposalDocument.updateMany({
      where: { id: doc.id, status: { in: ['DRAFT', 'IN_REVIEW'] } },
      data: {
        status: 'FINAL',
        finalisedAt: now,
        finalisedById: req.user!.userId,
        commercialSnapshot: price as unknown as Prisma.InputJsonValue,
        finalPdf: new Uint8Array(pdf),
        finalDocx: new Uint8Array(docx),
      },
    });
    if (!count) {
      res.status(409).json({ success: false, error: `v${doc.n} was finalised a moment ago.` });
      return;
    }
    await resolveReviewAlert(orgId, doc.proposalId);
    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Proposal',
        entityId: doc.proposalId,
        actorId: req.user!.userId,
        verb: 'proposal_document_finalised',
        payload: {
          n: doc.n,
          ref: documentRef(doc.proposal.refNo, doc.n),
          monthlyValue: price.monthly.subtotal,
          value: price.oneTime.subtotal,
          ...(doc.floorOverrideAt ? { floorOverridden: true } : {}),
        },
      },
    });
    const fresh = await prisma.proposalDocument.findUniqueOrThrow({ where: { id: doc.id }, include: documentInclude });
    await respondWithDocument(req, res, fresh);
  } catch (e) {
    next(e);
  }
});

// ── Versions ────────────────────────────────────────────────────────────────

const newVersionSchema = z.object({ revisionNote: z.string().trim().max(500).optional().nullable() });

proposalDocumentsRouter.post('/documents/:docId/versions', requirePermission('pipeline.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = newVersionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const doc = await loadDocument(req, res);
    if (!doc) return;
    if (doc.proposal.outcome) {
      res.status(400).json({ success: false, error: 'This deal is closed. Reopen it before writing a new version.' });
      return;
    }
    const siblings = await prisma.proposalDocument.findMany({
      where: { proposalId: doc.proposalId },
      select: { n: true, status: true },
      orderBy: { n: 'desc' },
    });
    const openDraft = siblings.find((s) => s.status === 'DRAFT' || s.status === 'IN_REVIEW');
    if (openDraft) {
      res.status(409).json({
        success: false,
        error: `v${openDraft.n} is still ${openDraft.status === 'DRAFT' ? 'a draft' : 'in review'}. Finish it first.`,
      });
      return;
    }
    const n = (siblings[0]?.n ?? 0) + 1;
    const created = await prisma.$transaction(async (tx) => {
      const copy = await tx.proposalDocument.create({
        data: {
          proposalId: doc.proposalId,
          n,
          layout: doc.layout,
          title: doc.title,
          sections: (doc.sections ?? []) as Prisma.InputJsonValue,
          revisionNote: parsed.data.revisionNote || null,
          basedOnId: doc.id,
          createdById: req.user!.userId,
          // The same lines, so the same fee: a floor reason already given still
          // stands. Changing the monthly fee clears it (PUT line-items).
          floorOverrideReason: doc.floorOverrideReason,
          floorOverrideById: doc.floorOverrideById,
          floorOverrideAt: doc.floorOverrideAt,
        },
      });
      if (doc.lineItems.length) {
        await tx.proposalLineItem.createMany({
          data: doc.lineItems.map((l) => ({
            documentId: copy.id,
            catalogItemId: l.catalogItemId,
            name: l.name,
            description: l.description,
            billing: l.billing,
            qty: l.qty,
            unit: l.unit,
            unitRate: l.unitRate,
            discountAmount: l.discountAmount,
            discountTrade: l.discountTrade,
            isPassthrough: l.isPassthrough,
            priceSource: l.priceSource,
            sortOrder: l.sortOrder,
          })),
        });
      }
      return copy;
    });
    await prisma.activity.create({
      data: {
        organizationId: req.user!.organizationId,
        entityType: 'Proposal',
        entityId: doc.proposalId,
        actorId: req.user!.userId,
        verb: 'proposal_document_started',
        payload: { n, basedOn: doc.n, ...(parsed.data.revisionNote ? { note: parsed.data.revisionNote } : {}) },
      },
    });
    const fresh = await prisma.proposalDocument.findUniqueOrThrow({ where: { id: created.id }, include: documentInclude });
    await respondWithDocument(req, res, fresh, 201);
  } catch (e) {
    next(e);
  }
});

// ── Review ──────────────────────────────────────────────────────────────────
//
// "Send for review": the writer is done with the words and hands the draft to
// Management to price and finalise. It then reads as In review, the writer
// can no longer change it, and Management sees it in the bell. Management
// finalises it, or sends it back with a note.

async function resolveReviewAlert(organizationId: string, proposalId: string) {
  const now = new Date();
  await prisma.alert.updateMany({
    where: { organizationId, rule: REVIEW_RULE, entityType: 'Proposal', entityId: proposalId, resolvedAt: null },
    data: { resolvedAt: now, updatedAt: now },
  });
}

proposalDocumentsRouter.post('/documents/:docId/review', requirePermission('pipeline.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const doc = await loadDocument(req, res);
    if (!doc) return;
    if (doc.status !== 'DRAFT') {
      res.status(409).json({ success: false, error: `v${doc.n} is ${doc.status === 'IN_REVIEW' ? 'already in review' : 'final'}.` });
      return;
    }
    const orgId = req.user!.organizationId;
    const now = new Date();
    const { count } = await prisma.proposalDocument.updateMany({
      where: { id: doc.id, status: 'DRAFT' },
      data: { status: 'IN_REVIEW', reviewRequestedAt: now, reviewRequestedById: req.user!.userId, reviewNote: null },
    });
    if (!count) {
      res.status(409).json({ success: false, error: `v${doc.n} just changed. Reload to see it.` });
      return;
    }
    const asker = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { name: true } });
    await resolveReviewAlert(orgId, doc.proposalId);
    await prisma.alert.create({
      data: {
        organizationId: orgId,
        rule: REVIEW_RULE,
        severity: 'MED',
        entityType: 'Proposal',
        entityId: doc.proposalId,
        message: `${doc.proposal.company.name}: proposal v${doc.n} is ready for pricing and review${asker?.name ? ` (${asker.name})` : ''}.`,
      },
    });
    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Proposal',
        entityId: doc.proposalId,
        actorId: req.user!.userId,
        verb: 'proposal_document_review_requested',
        payload: { n: doc.n },
      },
    });
    const fresh = await prisma.proposalDocument.findUniqueOrThrow({ where: { id: doc.id }, include: documentInclude });
    await respondWithDocument(req, res, fresh);
  } catch (e) {
    next(e);
  }
});

const sendBackSchema = z.object({ note: z.string().trim().min(3, 'Say what needs changing').max(500) });

proposalDocumentsRouter.post('/documents/:docId/send-back', requireManagement, async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = sendBackSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const doc = await loadDocument(req, res);
    if (!doc) return;
    if (doc.status !== 'IN_REVIEW') {
      res.status(409).json({ success: false, error: `v${doc.n} is not in review.` });
      return;
    }
    const orgId = req.user!.organizationId;
    await prisma.proposalDocument.updateMany({
      where: { id: doc.id, status: 'IN_REVIEW' },
      data: { status: 'DRAFT', reviewNote: parsed.data.note, reviewRequestedAt: null, reviewRequestedById: null },
    });
    await resolveReviewAlert(orgId, doc.proposalId);
    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Proposal',
        entityId: doc.proposalId,
        actorId: req.user!.userId,
        verb: 'proposal_document_sent_back',
        payload: { n: doc.n, note: parsed.data.note },
      },
    });
    const fresh = await prisma.proposalDocument.findUniqueOrThrow({ where: { id: doc.id }, include: documentInclude });
    await respondWithDocument(req, res, fresh);
  } catch (e) {
    next(e);
  }
});

// ── Writing with the AI ─────────────────────────────────────────────────────

const aiAskSchema = z.object({ message: z.string().trim().min(1, 'Say what you want written or changed').max(2000) });

const aiErrorReply = (e: unknown, res: Response): boolean => {
  if (e instanceof AssistantNotConfigured) {
    res.status(409).json({ success: false, error: 'No AI key is set. Add one in Setup → Organisation, under Zen.', code: 'NO_KEY' });
    return true;
  }
  if (e instanceof AssistantFailed) {
    res.status(502).json({ success: false, error: e.message });
    return true;
  }
  return false;
};

proposalDocumentsRouter.post('/documents/:docId/ai', requirePermission('pipeline.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = aiAskSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const doc = await loadDocument(req, res);
    if (!doc || refuseUnlessEditable(doc, req, res)) return;
    const me = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { name: true } });
    await askProposalAi({
      organizationId: req.user!.organizationId,
      userId: req.user!.userId,
      userName: me?.name ?? 'Somebody',
      setsPrices: isManagement(req),
      documentId: doc.id,
      message: parsed.data.message,
    });
    const fresh = await prisma.proposalDocument.findUniqueOrThrow({ where: { id: doc.id }, include: documentInclude });
    await respondWithDocument(req, res, fresh);
  } catch (e) {
    if (aiErrorReply(e, res)) return;
    next(e);
  }
});

const aiApplySchema = z.object({
  action: z.enum(['accept', 'discard']),
  /** The section changes to act on. Left out: all of this answer's pending ones. */
  changeIds: z.array(z.string()).max(30).optional(),
  /** Act on the staged Pricing lines too (Management). */
  lines: z.boolean().optional(),
});

proposalDocumentsRouter.post('/documents/:docId/ai/:entryId', requirePermission('pipeline.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = aiApplySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const doc = await loadDocument(req, res);
    if (!doc || refuseUnlessEditable(doc, req, res)) return;
    const thread = parseThread(doc.aiThread);
    const at = thread.findIndex((e) => e.id === req.params.entryId && e.from === 'ai');
    if (at < 0) {
      res.status(404).json({ success: false, error: 'That suggestion is gone.' });
      return;
    }
    const entry = thread[at] as Extract<ThreadEntry, { from: 'ai' }>;
    const { action, changeIds, lines } = parsed.data;
    if (lines && !isManagement(req)) {
      res.status(403).json({ success: false, error: 'Only Management can set or approve prices.' });
      return;
    }
    const picked = entry.changes.filter((c) => c.status === 'PENDING' && (!changeIds || changeIds.includes(c.id)));
    const status = action === 'accept' ? ('ACCEPTED' as const) : ('DISCARDED' as const);
    const nextEntry: ThreadEntry = {
      ...entry,
      changes: entry.changes.map((c) => (picked.some((x) => x.id === c.id) ? { ...c, status } : c)),
      ...(entry.lines && lines && entry.lines.status === 'PENDING' ? { lines: { ...entry.lines, status } } : {}),
    };
    const nextThread = thread.map((e, i) => (i === at ? nextEntry : e));
    const sections = action === 'accept' ? applyChanges(parseSections(doc.sections), picked) : parseSections(doc.sections);

    if (lines && action === 'accept' && entry.lines?.status === 'PENDING') {
      // The staged lines join the ones already priced, in the same save the Pricing tab uses.
      const current: LineIn[] = doc.lineItems.map((l) => ({
        catalogItemId: l.catalogItemId,
        name: l.name,
        description: l.description,
        billing: l.billing,
        qty: Number(l.qty),
        unit: l.unit,
        unitRate: Number(l.unitRate),
        discountAmount: Number(l.discountAmount),
        discountTrade: l.discountTrade,
        isPassthrough: l.isPassthrough,
        priceSource: l.priceSource,
      }));
      const added: LineIn[] = entry.lines.items.map((l) => ({
        catalogItemId: l.catalogItemId,
        name: l.name,
        description: l.description,
        billing: l.billing,
        qty: l.qty,
        unit: l.unit,
        unitRate: l.unitRate,
        discountAmount: 0,
        discountTrade: null,
        isPassthrough: false,
        priceSource: l.rateFrom === 'SERVICE_LIST' ? 'CATALOG' : 'USER',
      }));
      await saveLines(doc, [...current, ...added], {
        sections: sections as unknown as Prisma.InputJsonValue,
        aiThread: nextThread as unknown as Prisma.InputJsonValue,
      });
    } else {
      const { count } = await prisma.proposalDocument.updateMany({
        where: { id: doc.id, status: { in: editableStates(req) } },
        data: {
          sections: sections as unknown as Prisma.InputJsonValue,
          aiThread: nextThread as unknown as Prisma.InputJsonValue,
        },
      });
      if (!count) {
        res.status(409).json({ success: false, error: `v${doc.n} just changed hands. Reload to see it.` });
        return;
      }
    }
    const fresh = await prisma.proposalDocument.findUniqueOrThrow({ where: { id: doc.id }, include: documentInclude });
    await respondWithDocument(req, res, fresh);
  } catch (e) {
    next(e);
  }
});

// ── Preview and PDF ─────────────────────────────────────────────────────────

/** Figures show to Management, and to everybody once the document is final. */
const showsFigures = (req: AuthRequest, status: string) => isManagement(req) || status === 'FINAL';

proposalDocumentsRouter.get('/documents/:docId/preview', requirePermission('pipeline.read'), async (req: AuthRequest, res: Response, next) => {
  try {
    const doc = await prisma.proposalDocument.findFirst({
      where: { id: String(req.params.docId), proposal: { organizationId: req.user!.organizationId, deletedAt: null } },
      select: { id: true, status: true },
    });
    if (!doc) {
      res.status(404).json({ success: false, error: 'Proposal document not found' });
      return;
    }
    const p = await loadRenderableProposal(doc.id, req.user!.organizationId, showsFigures(req, doc.status));
    if (!p) {
      res.status(404).json({ success: false, error: 'Proposal document not found' });
      return;
    }
    res.json({ success: true, html: renderProposalHtml(p, { watermark: doc.status !== 'FINAL' }) });
  } catch (e) {
    next(e);
  }
});

const pdfName = (ref: string, draft: boolean, ext = 'pdf') => `${ref.replace(/[^A-Za-z0-9-]+/g, '-')}${draft ? '-DRAFT' : ''}.${ext}`;

proposalDocumentsRouter.get('/documents/:docId/pdf', requirePermission('pipeline.read'), async (req: AuthRequest, res: Response, next) => {
  try {
    const doc = await prisma.proposalDocument.findFirst({
      where: { id: String(req.params.docId), proposal: { organizationId: req.user!.organizationId, deletedAt: null } },
      select: { id: true, n: true, status: true, finalPdf: true, proposal: { select: { refNo: true } } },
    });
    if (!doc) {
      res.status(404).json({ success: false, error: 'Proposal document not found' });
      return;
    }
    const ref = documentRef(doc.proposal.refNo, doc.n);
    let pdf: Buffer;
    if (doc.status === 'FINAL' && doc.finalPdf) {
      // Exactly what was finalised — never re-rendered from today's settings.
      pdf = Buffer.from(doc.finalPdf);
    } else {
      const p = await loadRenderableProposal(doc.id, req.user!.organizationId, showsFigures(req, doc.status));
      if (!p) {
        res.status(404).json({ success: false, error: 'Proposal document not found' });
        return;
      }
      pdf = await renderProposalPdf(p, { watermark: doc.status !== 'FINAL' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pdfName(ref, doc.status !== 'FINAL')}"`);
    res.send(pdf);
  } catch (e) {
    next(e);
  }
});

/** The same document as a Word file. A final returns the file made at Finalise. */
proposalDocumentsRouter.get('/documents/:docId/docx', requirePermission('pipeline.read'), async (req: AuthRequest, res: Response, next) => {
  try {
    const doc = await prisma.proposalDocument.findFirst({
      where: { id: String(req.params.docId), proposal: { organizationId: req.user!.organizationId, deletedAt: null } },
      select: { id: true, n: true, status: true, finalDocx: true, proposal: { select: { refNo: true } } },
    });
    if (!doc) {
      res.status(404).json({ success: false, error: 'Proposal document not found' });
      return;
    }
    const ref = documentRef(doc.proposal.refNo, doc.n);
    let file: Buffer;
    if (doc.status === 'FINAL' && doc.finalDocx) {
      file = Buffer.from(doc.finalDocx);
    } else {
      const p = await loadRenderableProposal(doc.id, req.user!.organizationId, showsFigures(req, doc.status));
      if (!p) {
        res.status(404).json({ success: false, error: 'Proposal document not found' });
        return;
      }
      file = await renderProposalDocx(p, { draft: doc.status !== 'FINAL' });
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${pdfName(ref, doc.status !== 'FINAL', 'docx')}"`);
    res.send(file);
  } catch (e) {
    next(e);
  }
});

// ── Mark as sent ────────────────────────────────────────────────────────────

const markSentSchema = z.object({ ...nextStepFields });

/**
 * A final document went to the client. Records it the way the pipeline has
 * always recorded a sent proposal — a ProposalVersion — so the board, the
 * brief, the stalled-deal alert and the forecast see it without knowing
 * documents exist. Same stage rule as adding a version by hand.
 */
proposalDocumentsRouter.post('/documents/:docId/mark-sent', requirePermission('pipeline.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = markSentSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const doc = await loadDocument(req, res);
    if (!doc) return;
    if (doc.status !== 'FINAL' || !doc.commercialSnapshot) {
      res.status(409).json({ success: false, error: `v${doc.n} is not final yet. Management finalises it before it goes out.` });
      return;
    }
    if (doc.sentVersionId) {
      res.status(409).json({ success: false, error: `v${doc.n} is already marked as sent.` });
      return;
    }
    const orgId = req.user!.organizationId;
    const proposal = await prisma.proposal.findFirstOrThrow({
      where: { id: doc.proposalId, organizationId: orgId },
      include: { versions: { orderBy: { n: 'desc' }, take: 1 } },
    });
    if (proposal.outcome === ProposalOutcome.WON) {
      res.status(400).json({ success: false, error: 'Cannot add versions to a proposal that is already won.' });
      return;
    }
    const step = await nextStepForSave(orgId, proposal, parsed.data);
    if ('error' in step) {
      res.status(400).json({ success: false, error: step.error });
      return;
    }

    const price = doc.commercialSnapshot as unknown as ProposalPrice;
    const value = dealValueOf(price, proposal.kind);
    const nextN = (proposal.versions[0]?.n ?? 0) + 1;
    const stageTo = nextN === 1 ? ProposalStage.PROPOSAL_SENT : ProposalStage.IN_NEGOTIATION;
    const ref = documentRef(proposal.refNo, doc.n);
    const now = new Date();

    const version = await prisma.$transaction(async (tx) => {
      const v = await tx.proposalVersion.create({
        data: {
          proposalId: proposal.id,
          n: nextN,
          value,
          scopeSummary: `${doc.title?.trim() || 'Proposal'} (${ref})`,
          fileUrl: `/quotations/${proposal.id}?doc=${doc.id}`,
          sentAt: now,
        },
      });
      // Guarded, so two presses record one version.
      const { count } = await tx.proposalDocument.updateMany({
        where: { id: doc.id, sentVersionId: null },
        data: { sentVersionId: v.id, sentAt: now },
      });
      if (!count) throw Object.assign(new Error('already sent'), { alreadySent: true });
      await tx.proposal.update({
        where: { id: proposal.id },
        data: { stage: stageTo, ...step.data, lastTouchedAt: now },
      });
      return v;
    });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Proposal',
        entityId: proposal.id,
        actorId: req.user!.userId,
        verb: 'proposal_version_added',
        payload: {
          n: nextN,
          value,
          ...(proposal.versions[0] ? { previousValue: Number(proposal.versions[0].value) } : {}),
          stageFrom: proposal.stage,
          stageTo,
          ref,
        },
      },
    });

    res.status(201).json({ success: true, version: { id: version.id, n: version.n }, stage: stageTo });
  } catch (e) {
    if ((e as { alreadySent?: boolean }).alreadySent) {
      res.status(409).json({ success: false, error: 'This version was just marked as sent.' });
      return;
    }
    next(e);
  }
});
