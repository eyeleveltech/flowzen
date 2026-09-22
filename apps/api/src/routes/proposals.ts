import { Router, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission, type AuthRequest } from '../middleware/auth.js';
import { ProposalKind, ProposalStage, ProposalOutcome, CompanyStatus } from '@prisma/client';
import { parsePagination } from '../utils/query.js';
import { toCsv } from '../utils/csv.js';
import { sendCsv } from '../utils/csvResponse.js';
import { proposalProbability, STAGE_PROBABILITY_SELECT } from '../utils/stageProbability.js';

export const proposalsRouter = Router();

proposalsRouter.use(authenticate);

// ── 1. Pipeline 6-Stage Kanban Board ────────────────────────────────────────

const PIPELINE_STAGES: ProposalStage[] = [
  ProposalStage.TALKING,
  ProposalStage.PROPOSAL_SENT,
  ProposalStage.IN_NEGOTIATION,
  ProposalStage.PROFORMA_ISSUED,
  ProposalStage.VERBAL_YES,
  ProposalStage.WON,
];

proposalsRouter.get('/pipeline', requirePermission('pipeline.read'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;

    // §14: the stage probabilities are a setting, not a constant. Read once
    // here so the board, the forecast and the web all weight a deal the same.
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: STAGE_PROBABILITY_SELECT,
    });

    const proposals = await prisma.proposal.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        // §10's board has six columns, the last one Won — so a won deal has to
        // stay on the board, in that column, not vanish the moment it's won.
        // Only Lost/Expired are the real "off the board" outcomes. Written as
        // an explicit OR rather than `notIn`, because `outcome NOT IN (...)`
        // would silently drop every still-open proposal too — SQL's three
        // valued logic makes `NULL NOT IN (...)` neither true nor false.
        OR: [{ outcome: null }, { outcome: ProposalOutcome.WON }],
      },
      include: {
        company: { select: { id: true, name: true, vertical: true, city: true } },
        owner: { select: { id: true, name: true } },
        versions: { orderBy: { n: 'desc' } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    // sourceId is a polymorphic pointer (§7), not a schema relation — Proforma
    // can no longer be `include`d off Proposal, so its own proformas are
    // fetched in one batch query and grouped by sourceId here instead.
    const proformasByProposal = new Map<string, { id: string; number: string; status: string; amount: unknown }[]>();
    /** When this proposal first reached Proforma issued — see stageEnteredAt. */
    const proformaRaisedAt = new Map<string, Date>();
    if (proposals.length > 0) {
      const proformas = await prisma.proforma.findMany({
        where: { sourceType: 'PROPOSAL', sourceId: { in: proposals.map((p) => p.id) } },
        select: { id: true, number: true, status: true, amount: true, sourceId: true, raisedAt: true },
      });
      for (const pf of proformas) {
        const list = proformasByProposal.get(pf.sourceId) ?? [];
        list.push(pf);
        proformasByProposal.set(pf.sourceId, list);
        const seen = proformaRaisedAt.get(pf.sourceId);
        if (!seen || pf.raisedAt < seen) proformaRaisedAt.set(pf.sourceId, pf.raisedAt);
      }
    }

    // Group proposals by stage
    const columns: Record<string, any[]> = {};
    for (const stage of PIPELINE_STAGES) {
      columns[stage] = [];
    }

    /*
     * §8: "Days in stage — now − timestamp of the last stage change."
     *
     * This read `updatedAt`, which is not that. Any write to the row reset it —
     * a probability override, an owner change, a new version — so a deal parked
     * in Proposal sent for thirty days showed as one day old if somebody nudged
     * it yesterday, and the board's "Going stale, over 25 days" counted fewer
     * than were actually stale. That is the one number on this screen whose
     * whole job is to notice neglect.
     *
     * §8 says to take it from Activity. It is taken from the records the stage
     * itself follows instead — the same ones §8 uses to derive `stage` — because
     * they are exact and cannot go missing: a stage change with no activity row
     * (losing a deal wrote none until today) would otherwise read as "never
     * moved". Same answer, one less thing that can be absent.
     */
    const stageEnteredAt = (p: (typeof proposals)[number]): Date => {
      if (p.stage === ProposalStage.WON && p.wonAt) return p.wonAt;
      if (p.stage === ProposalStage.VERBAL_YES && p.verbalYesAt) return p.verbalYesAt;
      if (p.stage === ProposalStage.PROFORMA_ISSUED) {
        const raised = proformaRaisedAt.get(p.id);
        if (raised) return raised;
      }
      // In negotiation is "more than one version", so it began at the latest
      // one; Proposal sent began at the first. Both come off the versions,
      // which are immutable, so neither can drift.
      const sorted = [...p.versions].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
      if (p.stage === ProposalStage.IN_NEGOTIATION && sorted.length > 1) return sorted[sorted.length - 1].sentAt;
      if (sorted.length > 0) return sorted[0].sentAt;
      return p.createdAt;
    };

    for (const p of proposals) {
      const currentVersion = p.versions[0] || null;
      const daysInStage = Math.max(
        1,
        Math.ceil((Date.now() - stageEnteredAt(p).getTime()) / (1000 * 3600 * 24)),
      );

      const card = {
        id: p.id,
        companyId: p.companyId,
        companyName: p.company.name,
        companyVertical: p.company.vertical,
        kind: p.kind,
        stage: p.stage,
        owner: p.owner,
        versionCount: p.versions.length,
        currentVersionId: currentVersion?.id ?? null,
        currentVersionNumber: currentVersion?.n || 1,
        // Explicitly numeric, unlike most money fields elsewhere in this API —
        // this endpoint's whole purpose is feeding the board's own sums
        // (total/weighted per column, full pipeline), and summing a Decimal's
        // string serialization with `+` concatenates instead of adding.
        quotedValue: currentVersion ? Number(currentVersion.value) : 0,
        scopeSummary: currentVersion?.scopeSummary || '',
        probability: proposalProbability(p, org),
        daysInStage,
        proforma: proformasByProposal.get(p.id)?.[0] || null,
        updatedAt: p.updatedAt,
      };

      if (columns[p.stage]) {
        columns[p.stage].push(card);
      } else {
        columns[ProposalStage.TALKING].push(card);
      }
    }

    res.json({ success: true, stages: PIPELINE_STAGES, columns });
  } catch (error) {
    next(error);
  }
});

// ── 1b. Stage-to-Stage Conversion ───────────────────────────────────────────
//
// `stage` alone can't answer "how far did this get" for a lost deal — losing
// overwrites it to LOST, wiping whatever stage it died at (see routes §7).
// So each step below reads a durable, never-overwritten fact instead:
// versions.length (a revision happened), a linked Proforma row (one was
// issued), outcome === WON — none of which a later loss erases. Each step's
// "in" is scoped to the proposals that reached the step before it, so a rate
// is specifically about that transition, not a share of everything ever sent.

proposalsRouter.get('/funnel', requirePermission('pipeline.read'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const months = 6;
    const since = new Date();
    since.setMonth(since.getMonth() - months);

    const proposals = await prisma.proposal.findMany({
      where: { organizationId: orgId, deletedAt: null, createdAt: { gte: since } },
      select: { id: true, outcome: true, versions: { select: { id: true } } },
    });

    const proposalIds = proposals.map((p) => p.id);
    const proformaProposalIds = new Set(
      proposalIds.length === 0
        ? []
        : (
            await prisma.proforma.findMany({
              where: { sourceType: 'PROPOSAL', sourceId: { in: proposalIds } },
              select: { sourceId: true },
            })
          ).map((f) => f.sourceId),
    );

    const sent = proposals.length;
    const revised = proposals.filter((p) => p.versions.length >= 2);
    const proformaIssued = revised.filter((p) => proformaProposalIds.has(p.id));
    const won = proformaIssued.filter((p) => p.outcome === ProposalOutcome.WON);

    const step = (label: string, inCount: number, outCount: number) => {
      const rate = inCount > 0 ? Math.round((outCount / inCount) * 1000) / 10 : 0;
      const read =
        inCount === 0 ? 'No data yet' : rate >= 60 ? 'Healthy' : rate >= 35 ? 'Some drop-off' : 'Needs attention';
      return { step: label, in: inCount, movedOn: outCount, rate, read };
    };

    const steps = [
      step('Sent to revised', sent, revised.length),
      step('Revised to proforma issued', revised.length, proformaIssued.length),
      step('Proforma issued to won', proformaIssued.length, won.length),
    ];

    res.json({ success: true, months, steps });
  } catch (error) {
    next(error);
  }
});

// ── 2. List Proposals Register ──────────────────────────────────────────────

proposalsRouter.get('/', requirePermission('pipeline.read'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const { companyId, stage, kind } = req.query;
    const wantsCsv = req.query.format === 'csv';
    const { page, limit, skip, take } = parsePagination(
      req.query,
      wantsCsv ? { defaultLimit: 10000, maxLimit: 10000 } : { defaultLimit: 200, maxLimit: 500 },
    );

    const where: any = { organizationId: orgId, deletedAt: null };
    if (companyId && typeof companyId === 'string') where.companyId = companyId;
    if (stage && typeof stage === 'string') where.stage = stage as ProposalStage;
    if (kind && typeof kind === 'string') where.kind = kind as ProposalKind;

    const [proposalRows, total] = await Promise.all([
      prisma.proposal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          company: { select: { id: true, name: true, vertical: true } },
          owner: { select: { id: true, name: true } },
          wonVersion: true,
          versions: { orderBy: { n: 'desc' } },
        },
      }),
      prisma.proposal.count({ where }),
    ]);

    // sourceId is a polymorphic pointer (§7), not a schema relation — see the
    // /pipeline handler above for why. Same batch-and-group here.
    const proformasByProposal = new Map<string, Awaited<ReturnType<typeof prisma.proforma.findMany>>>();
    if (proposalRows.length > 0) {
      const proformas = await prisma.proforma.findMany({
        where: { sourceType: 'PROPOSAL', sourceId: { in: proposalRows.map((p) => p.id) } },
      });
      for (const pf of proformas) {
        const list = proformasByProposal.get(pf.sourceId) ?? [];
        list.push(pf);
        proformasByProposal.set(pf.sourceId, list);
      }
    }
    const proposals = proposalRows.map((p) => ({ ...p, proformas: proformasByProposal.get(p.id) ?? [] }));

    if (wantsCsv) {
      const csv = toCsv(proposals, [
        { label: 'Company', value: (p) => p.company.name },
        { label: 'Kind', value: (p) => p.kind },
        { label: 'Owner', value: (p) => p.owner.name },
        { label: 'Stage', value: (p) => p.stage },
        { label: 'Outcome', value: (p) => p.outcome ?? '' },
        { label: 'Latest version value', value: (p) => (p.versions[0] ? Number(p.versions[0].value) : '') },
        { label: 'Lost reason', value: (p) => p.lostReason ?? '' },
        { label: 'Created', value: (p) => p.createdAt.toISOString().slice(0, 10) },
      ]);
      sendCsv(res, `proposals-${new Date().toISOString().slice(0, 10)}`, csv);
      return;
    }

    res.json({
      success: true,
      proposals,
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    next(error);
  }
});

// ── 3. Create Proposal with initial v1 Version ──────────────────────────────

const proposalCreateSchema = z.object({
  companyId: z.string().min(1, 'Company is required'),
  kind: z.nativeEnum(ProposalKind).default(ProposalKind.RETAINER),
  ownerId: z.string().optional(),
  // Both optional on request — a proposal can be logged before there's a real
  // number or a written scope yet. Falls back to 0 / empty rather than null:
  // ProposalVersion.value and .scopeSummary aren't nullable columns, and a
  // ProposalVersion with no value at all would break every reader downstream
  // that assumes a real number (pipeline totals, weighted value, forecast).
  // ₹0 is already a real, displayed state — Pipeline's "not yet quoted" stat
  // is exactly this.
  initialValue: z.number().min(0, 'Proposal value cannot be negative').optional().default(0),
  scopeSummary: z.string().optional().default(''),
  fileUrl: z.string().url().optional().or(z.literal('')),
});

proposalsRouter.post('/', requirePermission('pipeline.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = proposalCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const { companyId, kind, ownerId, initialValue, scopeSummary, fileUrl } = parsed.data;

    const company = await prisma.company.findFirst({ where: { id: companyId, organizationId: orgId } });
    if (!company) {
      res.status(404).json({ success: false, error: 'Company not found' });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const proposal = await tx.proposal.create({
        data: {
          organizationId: orgId,
          companyId,
          kind,
          ownerId: ownerId || req.user!.userId,
          stage: ProposalStage.PROPOSAL_SENT,
        },
      });

      const version = await tx.proposalVersion.create({
        data: {
          proposalId: proposal.id,
          n: 1,
          value: initialValue,
          scopeSummary: scopeSummary.trim(),
          fileUrl: fileUrl || null,
        },
      });

      await tx.activity.create({
        data: {
          organizationId: orgId,
          entityType: 'Proposal',
          entityId: proposal.id,
          actorId: req.user!.userId,
          verb: 'proposal_created',
          payload: { version: 'v1', value: initialValue, companyName: company.name },
        },
      });

      return { proposal, version };
    });

    res.status(201).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

// ── 4. Add Immutable Version v(N+1) ─────────────────────────────────────────

const versionCreateSchema = z.object({
  // Same relaxation as v1's own create schema above: optional, falls back to
  // 0 / empty rather than null — a revised version isn't always re-priced
  // right away, and neither column is nullable.
  value: z.number().min(0, 'Value cannot be negative').optional().default(0),
  scopeSummary: z.string().optional().default(''),
  fileUrl: z.string().url().optional().or(z.literal('')),
});

proposalsRouter.post('/:id/versions', requirePermission('pipeline.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = versionCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const id = String(req.params.id);

    const proposal = await prisma.proposal.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      include: { versions: { orderBy: { n: 'desc' } } },
    });

    if (!proposal) {
      res.status(404).json({ success: false, error: 'Proposal not found' });
      return;
    }

    if (proposal.outcome === ProposalOutcome.WON) {
      res.status(400).json({ success: false, error: 'Cannot add versions to a proposal that is already won.' });
      return;
    }

    const highestN = proposal.versions[0]?.n || 0;
    const nextN = highestN + 1;

    const version = await prisma.proposalVersion.create({
      data: {
        proposalId: id,
        n: nextN,
        value: parsed.data.value,
        scopeSummary: parsed.data.scopeSummary.trim(),
        fileUrl: parsed.data.fileUrl || null,
      },
    });

    // Auto update stage to in negotiation
    await prisma.proposal.update({
      where: { id },
      data: { stage: ProposalStage.IN_NEGOTIATION },
    });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Proposal',
        entityId: id,
        actorId: req.user!.userId,
        verb: 'proposal_version_added',
        payload: { n: nextN, value: parsed.data.value },
      },
    });

    res.status(201).json({ success: true, version });
  } catch (error) {
    next(error);
  }
});

// ── 5. Mark Verbal Yes ───────────────────────────────────────────────────────
//
// §3 and §8 of the brief: stage is derived, never typed — a version moves it
// to Proposal sent/In negotiation, a proforma moves it to Proforma issued, an
// outcome moves it to Won/Lost. The ONE manual transition the brief allows is
// flagging a verbal agreement before anything is signed (§8: "Manual flag ->
// Verbal yes"). This endpoint used to accept any stage from the request body,
// which let a caller hand-set WON or LOST without ever creating a won version
// or an outcome — silently corrupting close-rate and pipeline-value math.
// It is now that one flag, and nothing else.

proposalsRouter.patch('/:id/stage', requirePermission('pipeline.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const { stage } = req.body;
    if (stage !== ProposalStage.VERBAL_YES) {
      res.status(400).json({
        success: false,
        error:
          'Stage is derived from records, not set directly. The only manual flag is marking a proposal as Verbal yes.',
      });
      return;
    }

    const orgId = req.user!.organizationId;
    const id = String(req.params.id);

    const existing = await prisma.proposal.findFirst({ where: { id, organizationId: orgId, deletedAt: null } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Proposal not found' });
      return;
    }
    if (existing.outcome) {
      res.status(400).json({ success: false, error: 'This proposal is already resolved.' });
      return;
    }
    if (existing.stage !== ProposalStage.PROFORMA_ISSUED) {
      res.status(400).json({
        success: false,
        error: 'Verbal yes can only be flagged once a proforma has been issued.',
      });
      return;
    }

    const updated = await prisma.proposal.update({
      where: { id },
      data: { stage: ProposalStage.VERBAL_YES, verbalYesAt: new Date() },
    });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Proposal',
        entityId: id,
        actorId: req.user!.userId,
        verb: 'verbal_yes',
        payload: {},
      },
    });

    res.json({ success: true, proposal: updated });
  } catch (error) {
    next(error);
  }
});

// ── 5b. Override Win Probability ────────────────────────────────────────────
//
// Stage still isn't hand-set — this is the one other manual number the brief
// allows: "weighted = current version value x stage probability, with a per
// deal override" (§8, §12). Null clears it back to the stage-derived default.

const probabilitySchema = z.object({
  probabilityOverride: z.number().min(0).max(100).nullable(),
});

proposalsRouter.patch('/:id/probability', requirePermission('pipeline.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = probabilitySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const id = String(req.params.id);

    const existing = await prisma.proposal.findFirst({ where: { id, organizationId: orgId, deletedAt: null } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Proposal not found' });
      return;
    }
    if (existing.outcome) {
      res.status(400).json({ success: false, error: 'This proposal is already resolved.' });
      return;
    }

    const updated = await prisma.proposal.update({
      where: { id },
      data: { probabilityOverride: parsed.data.probabilityOverride },
    });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Proposal',
        entityId: id,
        actorId: req.user!.userId,
        verb: 'probability_overridden',
        payload: { probabilityOverride: parsed.data.probabilityOverride },
      },
    });

    res.json({ success: true, proposal: updated });
  } catch (error) {
    next(error);
  }
});

// ── 6. Win Proposal ─────────────────────────────────────────────────────────

const winSchema = z.object({
  versionId: z.string().min(1, 'Winning version ID is required'),
});

proposalsRouter.post('/:id/win', requirePermission('pipeline.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = winSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const id = String(req.params.id);
    const { versionId } = parsed.data;

    const proposal = await prisma.proposal.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      include: { company: true },
    });

    if (!proposal) {
      res.status(404).json({ success: false, error: 'Proposal not found' });
      return;
    }

    const version = await prisma.proposalVersion.findFirst({
      where: { id: versionId, proposalId: id },
    });

    if (!version) {
      res.status(404).json({ success: false, error: 'Winning version not found for this proposal' });
      return;
    }

    // Atomic win transaction: update proposal + graduate company to CLIENT
    const result = await prisma.$transaction(async (tx) => {
      const wonProposal = await tx.proposal.update({
        where: { id },
        data: {
          stage: ProposalStage.WON,
          outcome: ProposalOutcome.WON,
          wonVersionId: version.id,
          wonAt: new Date(),
        },
      });

      // Graduate Company to CLIENT status
      await tx.company.update({
        where: { id: proposal.companyId },
        data: { status: CompanyStatus.CLIENT },
      });

      await tx.activity.create({
        data: {
          organizationId: orgId,
          entityType: 'Proposal',
          entityId: id,
          actorId: req.user!.userId,
          verb: 'proposal_won',
          payload: { version: `v${version.n}`, value: version.value, companyName: proposal.company.name },
        },
      });

      return wonProposal;
    });

    res.json({ success: true, proposal: result });
  } catch (error) {
    next(error);
  }
});

// ── 7. Lose Proposal ────────────────────────────────────────────────────────

const loseSchema = z.object({
  lostReason: z.string().min(1, 'Lost reason is required'),
});

proposalsRouter.post('/:id/lose', requirePermission('pipeline.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = loseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const id = String(req.params.id);

    // `orgId` was read and then never used — the update went straight to the id.
    // Losing somebody else's deal is a quiet kind of damage: it does not error,
    // it just moves a stranger's proposal to LOST with a reason they never
    // wrote. POST /:id/win, sixty lines above, has always checked this.
    const existing = await prisma.proposal.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      select: { id: true, stage: true, company: { select: { name: true } } },
    });

    if (!existing) {
      res.status(404).json({ success: false, error: 'Proposal not found' });
      return;
    }

    const updated = await prisma.proposal.update({
      where: { id },
      data: {
        stage: ProposalStage.LOST,
        outcome: ProposalOutcome.LOST,
        lostReason: parsed.data.lostReason.trim(),
      },
    });

    // §16: "Every create, update and status change writes an Activity row. No
    // exceptions." Winning wrote one and losing did not — so the half of the
    // win rate that hurts was the half with no trail, and the stage a deal
    // died at was lost with it, because LOST overwrites `stage`.
    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Proposal',
        entityId: id,
        actorId: req.user!.userId,
        verb: 'proposal_lost',
        payload: {
          companyName: existing.company.name,
          lostFromStage: existing.stage,
          lostReason: parsed.data.lostReason.trim(),
        },
      },
    });

    res.json({ success: true, proposal: updated });
  } catch (error) {
    next(error);
  }
});

// ── 8. Edit a Proposal ──────────────────────────────────────────────────────
//
// Only the two things that are a property of the deal rather than a record of
// what happened to it.
//
// `companyId` is deliberately not editable. Moving a proposal to another
// company moves its value between two clients' pipelines, and if it has been
// won it already graduated the first company to CLIENT — an edit here would
// leave that behind with no proposal explaining it. Raise it against the right
// company instead; that is what delete below is for.
//
// The numbers are not editable either, by design: a version is immutable and a
// re-price is v(N+1) (§11.1). POST /:id/versions is the edit for money.

const proposalEditSchema = z
  .object({
    ownerId: z.string().min(1).optional(),
    kind: z.nativeEnum(ProposalKind).optional(),
  })
  .refine((v) => v.ownerId !== undefined || v.kind !== undefined, {
    message: 'Nothing to change',
  });

proposalsRouter.patch('/:id', requirePermission('pipeline.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = proposalEditSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const id = String(req.params.id);
    const { ownerId, kind } = parsed.data;

    const existing = await prisma.proposal.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      include: { company: { select: { name: true } } },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Proposal not found' });
      return;
    }

    const ownerChanged = ownerId !== undefined && ownerId !== existing.ownerId;
    const kindChanged = kind !== undefined && kind !== existing.kind;

    /*
     * Resending the values a proposal already has must not write the row.
     *
     * `updatedAt` is what the pipeline board reads as "days in this stage" and
     * what the daily brief reads as "no activity in N days" (routes/brief.ts).
     * A save that changed nothing would reset that clock, and a deal nobody
     * has touched in three weeks would come back looking freshly worked —
     * which is the one thing those two numbers exist to prevent.
     */
    if (!ownerChanged && !kindChanged) {
      const { company: _company, ...unchanged } = existing;
      res.json({ success: true, proposal: unchanged });
      return;
    }

    // Which kind it is decides what winning builds — a retainer or a project
    // (§11.1 step 11). Once that has happened the answer is on the ground, and
    // changing the label here would describe work that was never done.
    if (kindChanged && existing.outcome !== null) {
      res.status(400).json({
        success: false,
        error: 'This proposal is already closed — retainer or project was settled when it was won or lost.',
      });
      return;
    }

    if (ownerChanged) {
      const owner = await prisma.user.findFirst({
        where: { id: ownerId, organizationId: orgId, active: true },
        select: { id: true },
      });
      if (!owner) {
        res.status(404).json({ success: false, error: 'That person is not on the team' });
        return;
      }
    }

    const updated = await prisma.proposal.update({
      where: { id },
      data: {
        ...(ownerChanged ? { ownerId } : {}),
        ...(kindChanged ? { kind } : {}),
      },
    });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Proposal',
        entityId: id,
        actorId: req.user!.userId,
        verb: 'proposal_edited',
        payload: {
          companyName: existing.company.name,
          ...(ownerChanged ? { ownerFrom: existing.ownerId, ownerTo: ownerId } : {}),
          ...(kindChanged ? { kindFrom: existing.kind, kindTo: kind } : {}),
        },
      },
    });

    res.json({ success: true, proposal: updated });
  } catch (error) {
    next(error);
  }
});

// ── 9. Delete a Proposal ────────────────────────────────────────────────────
//
// The case this exists for is the only one it allows: a proposal logged by
// mistake, against the wrong company or twice over, that nothing has happened
// to yet. Everything past that point is refused, because a proposal is read by
// more than the pipeline board:
//
//   · the funnel and the win rate count won and lost proposals, so removing
//     one silently improves or worsens a number nobody edited;
//   · a won proposal graduated its company to CLIENT and seeded the project or
//     retainer through sourceProposalId, which would then point at nothing;
//   · a proforma raised against it is a document that went to a client.
//
// Soft delete, per §16 — the row stays, GET /trash lists it and
// POST /:id/restore puts it back.

proposalsRouter.get('/trash', requirePermission('pipeline.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    // Same key the register and projects' own /trash use, so a caller reads
    // deleted proposals exactly the way it reads live ones.
    const proposals = await prisma.proposal.findMany({
      where: { organizationId: orgId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      take: 100,
      include: {
        company: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true } },
        versions: { orderBy: { n: 'desc' }, take: 1 },
      },
    });
    res.json({ success: true, proposals });
  } catch (error) {
    next(error);
  }
});

proposalsRouter.delete('/:id', requirePermission('pipeline.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const id = String(req.params.id);

    const proposal = await prisma.proposal.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      include: { company: { select: { name: true } } },
    });
    if (!proposal) {
      res.status(404).json({ success: false, error: 'Proposal not found' });
      return;
    }

    if (proposal.outcome !== null) {
      res.status(400).json({
        success: false,
        error:
          proposal.outcome === ProposalOutcome.WON
            ? 'This proposal was won — the client and the work that came from it are built on it. It cannot be deleted.'
            : 'This proposal was lost. It stays, because the win rate counts it — hiding it would not make the number truer.',
      });
      return;
    }

    const proforma = await prisma.proforma.findFirst({
      where: { organizationId: orgId, sourceType: 'PROPOSAL', sourceId: id },
      select: { number: true },
    });
    if (proforma) {
      res.status(400).json({
        success: false,
        error: `Proforma ${proforma.number} was raised against this proposal. Cancel that first — it is a document the client has.`,
      });
      return;
    }

    await prisma.proposal.update({ where: { id }, data: { deletedAt: new Date() } });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Proposal',
        entityId: id,
        actorId: req.user!.userId,
        verb: 'proposal_deleted',
        payload: { companyName: proposal.company.name, stage: proposal.stage },
      },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

proposalsRouter.post('/:id/restore', requirePermission('pipeline.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const id = String(req.params.id);

    const existing = await prisma.proposal.findFirst({
      where: { id, organizationId: orgId, deletedAt: { not: null } },
      include: { company: { select: { name: true } } },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Deleted proposal not found' });
      return;
    }

    await prisma.proposal.update({ where: { id }, data: { deletedAt: null } });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Proposal',
        entityId: id,
        actorId: req.user!.userId,
        verb: 'proposal_restored',
        payload: { companyName: existing.company.name },
      },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
