import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import {
  authenticate,
  hasPermission,
  requirePermission,
  type AuthRequest,
} from '../middleware/auth.js';
import {
  AssetCategory,
  AssetCondition,
  AssetMaintenanceKind,
  AssetStatus,
  CostPaidBy,
  CostTreatment,
  CostType,
  Prisma,
} from '@prisma/client';
import { ASSET_USEFUL_LIFE, ASSET_CATEGORY_LABEL, ASSET_STATUS_LABEL } from '@flowzen/shared';
import { parsePagination } from '../utils/query.js';
import { toCsv, parseCsv, normaliseHeader } from '../utils/csv.js';
import { sendCsv } from '../utils/csvResponse.js';
import { nextAssetTag, tagWithRetry } from '../utils/assetTag.js';
import {
  bookValue,
  financialYearOf,
  financialYearWindow,
  fullyDepreciated,
  monthlyDepreciation,
  registerRow,
  type DepreciableAsset,
} from '../utils/assetValue.js';
import {
  MovementConflict,
  assignCustody,
  checkOut,
  openMovementFor,
  returnAsset,
  transfer,
} from '../services/assetMovement.js';

/**
 * The company's kit, and who is holding it.
 *
 * ─── Two gates, and they are independent ────────────────────────────────────
 *
 * Reading the catalogue — what we own, who has it, is the 24-70 free on Friday
 * — needs nothing but being signed in. That is deliberate: the video team asks
 * that question daily, and a register only half the office can read is a
 * register the other half keeps in a WhatsApp thread instead.
 *
 * Two separate things are gated on top of that:
 *
 *   money.figures   the PRICE of anything — purchase, salvage, book value,
 *                   what it sold for. Stripped from the payload rather than
 *                   sent and hidden, following the `User.monthlyCost` precedent.
 *   asset.manage    the ACT of handing something over — enter, assign, check
 *                   out, check in, retire, log a repair.
 *
 * They do not imply each other in either direction. Accounts reads every price
 * and cannot issue a lens; a studio manager granted `asset.manage` issues gear
 * all day and never sees what it cost. Any test of this router has to prove
 * both halves separately, because a single `canDoAssetStuff` boolean is exactly
 * the shortcut that would collapse them.
 */

export const assetsRouter = Router();

assetsRouter.use(authenticate);

// ─── Presentation ────────────────────────────────────────────────────────────

type AssetRow = Prisma.AssetGetPayload<{
  include: {
    currentHolder: { select: { id: true; name: true; active: true } };
  };
}>;

const depreciable = (a: {
  purchasePrice: Prisma.Decimal;
  salvageValue: Prisma.Decimal;
  usefulLifeMonths: number;
  purchasedAt: Date;
}): DepreciableAsset => ({
  purchasePrice: Number(a.purchasePrice),
  salvageValue: Number(a.salvageValue),
  usefulLifeMonths: a.usefulLifeMonths,
  purchasedAt: a.purchasedAt,
});

/**
 * One asset, with the money in it or without.
 *
 * The money fields are ABSENT for a caller without `money.figures`, not null.
 * A null reads as "we do not know what this cost", which is a different and
 * wrong statement; an absent key says the question was not answered for you.
 */
function present(asset: AssetRow, canSeeFigures: boolean, asOf = new Date()) {
  const base = {
    id: asset.id,
    tag: asset.tag,
    name: asset.name,
    category: asset.category,
    make: asset.make,
    model: asset.model,
    serialNumber: asset.serialNumber,
    status: asset.status,
    condition: asset.condition,
    bookable: asset.bookable,
    purchasedAt: asset.purchasedAt,
    vendor: asset.vendor,
    invoiceNumber: asset.invoiceNumber,
    usefulLifeMonths: asset.usefulLifeMonths,
    warrantyUntil: asset.warrantyUntil,
    insuredUntil: asset.insuredUntil,
    billUrl: asset.billUrl,
    photoUrl: asset.photoUrl,
    notes: asset.notes,
    disposedAt: asset.disposedAt,
    disposalNote: asset.disposalNote,
    currentHolderId: asset.currentHolderId,
    currentHolder: asset.currentHolder
      ? { id: asset.currentHolder.id, name: asset.currentHolder.name, active: asset.currentHolder.active }
      : null,
    // Whether it has run out its life is not a price, so everybody sees it —
    // "this laptop is due for replacement" is a fact about the office.
    fullyDepreciated: fullyDepreciated(depreciable(asset), asOf),
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };

  if (!canSeeFigures) return base;

  return {
    ...base,
    costId: asset.costId,
    purchasePrice: Number(asset.purchasePrice),
    salvageValue: Number(asset.salvageValue),
    disposalValue: asset.disposalValue === null ? null : Number(asset.disposalValue),
    bookValue: bookValue(depreciable(asset), asOf),
    monthlyDepreciation: Math.round(monthlyDepreciation(depreciable(asset)) * 100) / 100,
  };
}

const holderSelect = { select: { id: true, name: true, active: true } } as const;

/** Days late, or 0. Whole days, because "0.4 days overdue" helps nobody. */
const daysLate = (dueAt: Date | null, now: Date): number => {
  if (!dueAt) return 0;
  const ms = now.getTime() - dueAt.getTime();
  return ms <= 0 ? 0 : Math.floor(ms / 86_400_000);
};

// ─── The register ────────────────────────────────────────────────────────────

/**
 * GET /api/assets — the catalogue.
 *
 * Open to any signed-in person (see the note at the top). `dueForReplacement`
 * is computed rather than filtered in SQL: it depends on today's date against
 * each asset's own purchase date and life, which is not a column.
 */
assetsRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const canSeeFigures = hasPermission(req.user!, 'money.figures');
    const wantsCsv = req.query.format === 'csv';
    const { page, limit, skip, take } = parsePagination(
      req.query,
      wantsCsv ? { defaultLimit: 5000, maxLimit: 5000 } : { defaultLimit: 100, maxLimit: 500 },
    );

    const { category, status, holderId, bookable, q, dueForReplacement } = req.query;

    /**
     * `where` narrows the ROWS. `facetWhere` is the same minus the status,
     * because the tab counts have to describe what each tab WOULD show.
     *
     * The register had the defect /companies had: the In repair tab put
     * `status=IN_REPAIR` on the fetch, and the tab row then counted what came
     * back — so All reported the repair count and Retired reported 0, on a
     * register that might hold sixty items. Invisible only because nothing has
     * been entered yet.
     */
    const where: Prisma.AssetWhereInput = { organizationId: orgId, deletedAt: null };
    const facetWhere: Prisma.AssetWhereInput = { organizationId: orgId, deletedAt: null };
    if (typeof category === 'string' && category in AssetCategory) {
      where.category = category as AssetCategory;
      facetWhere.category = category as AssetCategory;
    }
    if (typeof status === 'string' && status in AssetStatus) {
      where.status = status as AssetStatus;
    }
    if (typeof holderId === 'string' && holderId) {
      where.currentHolderId = holderId;
      facetWhere.currentHolderId = holderId;
    }
    if (bookable === 'true') {
      where.bookable = true;
      facetWhere.bookable = true;
    }
    if (bookable === 'false') {
      where.bookable = false;
      facetWhere.bookable = false;
    }
    if (typeof q === 'string' && q.trim()) {
      const term = q.trim();
      const search = [
        { name: { contains: term, mode: 'insensitive' as const } },
        { tag: { contains: term, mode: 'insensitive' as const } },
        { make: { contains: term, mode: 'insensitive' as const } },
        { model: { contains: term, mode: 'insensitive' as const } },
        { serialNumber: { contains: term, mode: 'insensitive' as const } },
      ];
      where.OR = search;
      facetWhere.OR = search;
    }

    const [rows, total] = await Promise.all([
      prisma.asset.findMany({
        where,
        orderBy: [{ category: 'asc' }, { tag: 'asc' }],
        skip: dueForReplacement === 'true' ? undefined : skip,
        take: dueForReplacement === 'true' ? undefined : take,
        include: { currentHolder: holderSelect },
      }),
      prisma.asset.count({ where }),
    ]);

    const now = new Date();
    let data = rows.map((a) => present(a, canSeeFigures, now));
    if (dueForReplacement === 'true') data = data.filter((a) => a.fullyDepreciated);

    // Due back dates come from the open movements, in one query rather than an
    // N+1 — the whole reason `currentHolderId` is denormalised onto the asset.
    const outIds = rows.filter((a) => a.status === AssetStatus.BOOKED_OUT).map((a) => a.id);
    const open = outIds.length
      ? await prisma.assetMovement.findMany({
          where: { assetId: { in: outIds }, returnedAt: null },
          select: { assetId: true, dueAt: true, purpose: true },
        })
      : [];
    const dueByAsset = new Map(open.map((m) => [m.assetId, m]));
    const withDue = data.map((a) => {
      const m = dueByAsset.get(a.id);
      return m
        ? { ...a, dueAt: m.dueAt, purpose: m.purpose, overdue: daysLate(m.dueAt, now) > 0 }
        : a;
    });

    if (wantsCsv) {
      const csv = toCsv(withDue as any[], [
        { label: 'Tag', value: (a) => a.tag },
        { label: 'Name', value: (a) => a.name },
        { label: 'Category', value: (a) => ASSET_CATEGORY_LABEL[a.category] ?? a.category },
        { label: 'Make', value: (a) => a.make ?? '' },
        { label: 'Model', value: (a) => a.model ?? '' },
        { label: 'Serial', value: (a) => a.serialNumber ?? '' },
        { label: 'Status', value: (a) => ASSET_STATUS_LABEL[a.status] ?? a.status },
        { label: 'Condition', value: (a) => a.condition },
        { label: 'Held by', value: (a) => a.currentHolder?.name ?? '' },
        { label: 'Due back', value: (a) => (a.dueAt ? a.dueAt.toISOString().slice(0, 10) : '') },
        { label: 'Purchased', value: (a) => a.purchasedAt.toISOString().slice(0, 10) },
        { label: 'Purchase price', value: (a) => a.purchasePrice ?? '' },
        { label: 'Book value', value: (a) => a.bookValue ?? '' },
      ]);
      sendCsv(res, `assets-${new Date().toISOString().slice(0, 10)}`, csv);
      return;
    }

    // The tab row, counted from the register rather than from the rows on
    // screen. `out` is its own tab and is the count of open movements, which
    // is what the Out now board itself shows.
    const spread = await prisma.asset.groupBy({
      by: ['status'],
      where: facetWhere,
      _count: true,
    });
    const byStatus = (...list: AssetStatus[]) =>
      spread.filter((s) => list.includes(s.status)).reduce((n, s) => n + s._count, 0);

    const counts = {
      all: byStatus(
        AssetStatus.IN_STOCK,
        AssetStatus.ASSIGNED,
        AssetStatus.BOOKED_OUT,
        AssetStatus.IN_REPAIR,
      ),
      out: byStatus(AssetStatus.BOOKED_OUT, AssetStatus.ASSIGNED),
      repair: byStatus(AssetStatus.IN_REPAIR),
      retired: byStatus(AssetStatus.RETIRED, AssetStatus.SOLD, AssetStatus.LOST),
    };

    res.json({
      success: true,
      data: withDue,
      assets: withDue,
      counts,
      access: { canManage: hasPermission(req.user!, 'asset.manage'), canSeeFigures },
      meta: {
        page,
        limit,
        total: dueForReplacement === 'true' ? withDue.length : total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/assets/summary — the strip across the top of the register.
 *
 * The two money figures are omitted without `money.figures`, same rule as the
 * list. Everything else — how many are out, how many are late — is a fact
 * about where the kit is, which everybody needs.
 */
assetsRouter.get('/summary', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const canSeeFigures = hasPermission(req.user!, 'money.figures');
    const now = new Date();

    const assets = await prisma.asset.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: {
        id: true,
        status: true,
        category: true,
        purchasePrice: true,
        salvageValue: true,
        usefulLifeMonths: true,
        purchasedAt: true,
      },
    });

    const byStatus: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    for (const a of assets) {
      byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
      byCategory[a.category] = (byCategory[a.category] ?? 0) + 1;
    }

    const openBookings = await prisma.assetMovement.findMany({
      where: { returnedAt: null, kind: 'BOOKING', asset: { organizationId: orgId, deletedAt: null } },
      select: { dueAt: true },
    });

    const summary: Record<string, unknown> = {
      total: assets.length,
      byStatus,
      byCategory,
      outNow: openBookings.length,
      overdue: openBookings.filter((m) => daysLate(m.dueAt, now) > 0).length,
      inRepair: byStatus[AssetStatus.IN_REPAIR] ?? 0,
      dueForReplacement: assets.filter((a) => fullyDepreciated(depreciable(a), now)).length,
    };

    if (canSeeFigures) {
      summary.totalPurchaseValue = Math.round(
        assets.reduce((s, a) => s + Number(a.purchasePrice), 0),
      );
      summary.totalBookValue = Math.round(
        assets
          .filter((a) => a.status !== AssetStatus.SOLD)
          .reduce((s, a) => s + bookValue(depreciable(a), now), 0),
      );
    }

    res.json({ success: true, data: summary, summary, access: { canManage: hasPermission(req.user!, 'asset.manage'), canSeeFigures } });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/assets/out-now — the board the video team opens on a Monday.
 *
 * Every open BOOKING, late ones first. Custody assignments are deliberately
 * not here: a laptop with a designer is not "out", it is where it lives, and
 * mixing the two is how an overdue board becomes something nobody reads.
 */
assetsRouter.get('/out-now', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const now = new Date();
    const movements = await prisma.assetMovement.findMany({
      where: { returnedAt: null, kind: 'BOOKING', asset: { organizationId: orgId, deletedAt: null } },
      orderBy: { dueAt: 'asc' },
      include: {
        asset: { select: { id: true, tag: true, name: true, category: true } },
        user: { select: { id: true, name: true, active: true } },
        issuedBy: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
    });

    const data = movements.map((m) => ({
      ...m,
      overdue: daysLate(m.dueAt, now) > 0,
      daysOverdue: daysLate(m.dueAt, now),
    }));

    res.json({ success: true, data, movements: data });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/assets/availability?from=&to= — what is free in a window.
 *
 * An OPEN booking always blocks, whatever the window asked about. There is no
 * advance-reservation model here — a booking is opened at the moment gear
 * physically leaves the office — so "is anything out on this?" and "is it in
 * the cupboard?" are the same question, and the honest answer to both is no
 * while it has not come back.
 *
 * The overdue case is the one that matters and the one an overlap test gets
 * wrong. A camera due back yesterday and still out does not overlap next
 * Friday by any calendar arithmetic, and it is still not in the cupboard on
 * Friday. `busyUntil` carries the due date so the screen can say "due back
 * Thursday" rather than pretending to know it will be.
 */
assetsRouter.get('/availability', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const from = req.query.from ? new Date(String(req.query.from)) : new Date();
    const to = req.query.to ? new Date(String(req.query.to)) : new Date(from.getTime() + 86_400_000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
      res.status(400).json({ success: false, error: 'Give a valid from and to date' });
      return;
    }

    const bookable = await prisma.asset.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        bookable: true,
        status: { in: [AssetStatus.IN_STOCK, AssetStatus.ASSIGNED, AssetStatus.BOOKED_OUT] },
      },
      orderBy: [{ category: 'asc' }, { tag: 'asc' }],
      include: { currentHolder: holderSelect },
    });

    const openBookings = await prisma.assetMovement.findMany({
      where: {
        returnedAt: null,
        kind: 'BOOKING',
        asset: { organizationId: orgId, deletedAt: null },
      },
      select: { assetId: true, outAt: true, dueAt: true, user: { select: { id: true, name: true } } },
    });

    const clash = new Map<string, { until: Date | null; holder: { id: string; name: string } }>();
    for (const b of openBookings) {
      clash.set(b.assetId, { until: b.dueAt, holder: b.user });
    }

    const canSeeFigures = hasPermission(req.user!, 'money.figures');
    const data = bookable.map((a) => {
      const busy = clash.get(a.id);
      return {
        ...present(a, canSeeFigures),
        available: !busy,
        busyUntil: busy?.until ?? null,
        busyWith: busy?.holder ?? null,
        // True when it is due back before the window opens — "probably fine,
        // but somebody has it". Deliberately separate from `available`, which
        // stays false: a promise to return it is not the same as it being here.
        dueBackBeforeWindow: Boolean(busy?.until && busy.until < from),
      };
    });

    res.json({ success: true, data, from, to });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/assets/register?fy=2026-27 — the fixed-asset schedule.
 *
 * One row per asset: tag, name, category, purchase date, purchase price,
 * opening WDV, depreciation for the year, closing WDV, status. The FY window
 * comes from `Organization.financialYearStart`, which already exists and
 * already defaults to April — this needed no new setting.
 *
 * Gated on BOTH keys. It is a money document (`money.figures`) about the
 * equipment register (`asset.manage`), and either one alone is the wrong
 * audience for it.
 */
assetsRouter.get(
  '/register',
  requirePermission('money.figures'),
  requirePermission('asset.manage'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const orgId = req.user!.organizationId;
      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { financialYearStart: true },
      });
      const startMonth = org?.financialYearStart ?? 4;
      const fy =
        typeof req.query.fy === 'string' && /^\d{4}-\d{2}$/.test(req.query.fy)
          ? req.query.fy
          : financialYearOf(new Date(), startMonth);
      const window = financialYearWindow(fy, startMonth);

      const assets = await prisma.asset.findMany({
        where: {
          organizationId: orgId,
          deletedAt: null,
          purchasedAt: { lt: window.endExclusive },
        },
        orderBy: [{ category: 'asc' }, { purchasedAt: 'asc' }],
      });

      const rows = assets.map((a) => {
        const row = registerRow(depreciable(a), window);
        return {
          id: a.id,
          tag: a.tag,
          name: a.name,
          category: a.category,
          purchasedAt: a.purchasedAt,
          purchasePrice: Number(a.purchasePrice),
          status: a.status,
          ...row,
        };
      });

      const totals = rows.reduce(
        (acc, r) => ({
          purchasePrice: acc.purchasePrice + r.purchasePrice,
          openingWdv: acc.openingWdv + r.openingWdv,
          depreciationForYear: acc.depreciationForYear + r.depreciationForYear,
          closingWdv: acc.closingWdv + r.closingWdv,
        }),
        { purchasePrice: 0, openingWdv: 0, depreciationForYear: 0, closingWdv: 0 },
      );

      if (req.query.format === 'csv') {
        const csv = toCsv(rows, [
          { label: 'Tag', value: (r) => r.tag },
          { label: 'Name', value: (r) => r.name },
          { label: 'Category', value: (r) => ASSET_CATEGORY_LABEL[r.category] ?? r.category },
          { label: 'Purchase date', value: (r) => r.purchasedAt.toISOString().slice(0, 10) },
          { label: 'Purchase price', value: (r) => r.purchasePrice },
          { label: 'Opening WDV', value: (r) => r.openingWdv },
          { label: 'Depreciation for the year', value: (r) => r.depreciationForYear },
          { label: 'Closing WDV', value: (r) => r.closingWdv },
          { label: 'Status', value: (r) => ASSET_STATUS_LABEL[r.status] ?? r.status },
        ]);
        sendCsv(res, `asset-register-${fy}`, csv);
        return;
      }

      res.json({ success: true, data: { fy, from: window.start, to: window.endExclusive, rows, totals } });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * GET /api/assets/trash — soft-deleted assets, and the way back.
 *
 * Same shape as the cost register's, and for the same reason: §16 mandates
 * soft delete, and a soft delete with no restore is a hard delete with extra
 * rows.
 */
assetsRouter.get(
  '/trash',
  requirePermission('setup.admin'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const assets = await prisma.asset.findMany({
        where: { organizationId: req.user!.organizationId, deletedAt: { not: null } },
        orderBy: { deletedAt: 'desc' },
        include: { currentHolder: holderSelect },
      });
      res.json({ success: true, assets: assets.map((a) => present(a, hasPermission(req.user!, 'money.figures'))) });
    } catch (e) {
      next(e);
    }
  },
);

assetsRouter.post(
  '/:id/restore',
  requirePermission('setup.admin'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const orgId = req.user!.organizationId;
      const id = String(req.params.id);
      const existing = await prisma.asset.findFirst({
        where: { id, organizationId: orgId, deletedAt: { not: null } },
      });
      if (!existing) {
        res.status(404).json({ success: false, error: 'Deleted asset not found' });
        return;
      }
      await prisma.asset.update({ where: { id }, data: { deletedAt: null } });
      await logAsset(orgId, req.user!.userId, id, 'asset.restored', { tag: existing.tag });
      res.json({ success: true });
    } catch (e) {
      next(e);
    }
  },
);

// ─── Entering kit ────────────────────────────────────────────────────────────

const createSchema = z.object({
  name: z.string().min(1, 'Give it a name'),
  category: z.nativeEnum(AssetCategory),
  make: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  serialNumber: z.string().optional().nullable(),
  condition: z.nativeEnum(AssetCondition).default(AssetCondition.GOOD),
  bookable: z.boolean().optional(),
  purchasePrice: z.number().nonnegative(),
  purchasedAt: z.string(),
  vendor: z.string().optional().nullable(),
  invoiceNumber: z.string().optional().nullable(),
  usefulLifeMonths: z.number().int().positive().optional(),
  salvageValue: z.number().nonnegative().default(0),
  warrantyUntil: z.string().optional().nullable(),
  insuredUntil: z.string().optional().nullable(),
  billUrl: z.string().optional().nullable(),
  photoUrl: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  /** Link to the CAPITAL cost that already recorded this spend. */
  costId: z.string().optional().nullable(),
  /** Or raise that cost here, in the same transaction, so it is typed once. */
  createCost: z.boolean().optional(),
});

const asDate = (v: string | null | undefined): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Every mutation writes one of these, so the audit trail comes free. */
async function logAsset(
  organizationId: string,
  actorId: string,
  assetId: string,
  verb: string,
  payload: Prisma.InputJsonValue,
): Promise<void> {
  await prisma.activity.create({
    data: { organizationId, actorId, entityType: 'Asset', entityId: assetId, verb, payload },
  });
}

/**
 * GET /api/assets/next-tag?category=LENS — what the sticker will say.
 *
 * The create form shows it before anything is saved, so somebody can write the
 * label while they have the pen in their hand. It is a suggestion, not a
 * reservation: the tag is settled at insert time by `tagWithRetry`.
 */
assetsRouter.get(
  '/next-tag',
  requirePermission('asset.manage'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const category = String(req.query.category ?? '');
      if (!(category in AssetCategory)) {
        res.status(400).json({ success: false, error: 'Pick a category first' });
        return;
      }
      const tag = await nextAssetTag(req.user!.organizationId, category as AssetCategory);
      res.json({ success: true, data: { tag }, tag });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * POST /api/assets — enter a piece of kit.
 *
 * A duplicate serial number is a WARNING carried back with the created asset,
 * never a refusal. Two identical bodies bought together genuinely do exist, and
 * a register that argues with the person entering the second one is a register
 * that ends up missing it.
 */
assetsRouter.post(
  '/',
  requirePermission('asset.manage'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues[0].message });
        return;
      }
      const orgId = req.user!.organizationId;
      const d = parsed.data;

      const purchasedAt = asDate(d.purchasedAt);
      if (!purchasedAt) {
        res.status(400).json({ success: false, error: 'Give a valid purchase date' });
        return;
      }

      const warnings: string[] = [];
      if (d.serialNumber?.trim()) {
        const twin = await prisma.asset.findFirst({
          where: { organizationId: orgId, serialNumber: d.serialNumber.trim(), deletedAt: null },
          select: { tag: true, name: true },
        });
        if (twin) {
          warnings.push(
            `Serial ${d.serialNumber.trim()} is already on ${twin.tag} — "${twin.name}". Two identical bodies is fine; a typo is not.`,
          );
        }
      }

      const created = await tagWithRetry(orgId, d.category, async (tag) =>
        prisma.$transaction(async (tx) => {
          let costId = d.costId ?? null;

          // Raise the CAPITAL cost here so the amount is typed once and the
          // register and the P&L can never disagree about what was paid.
          if (!costId && d.createCost) {
            const cost = await tx.cost.create({
              data: {
                organizationId: orgId,
                type: CostType.CAPITAL,
                category: 'Equipment',
                vendor: d.vendor?.trim() || 'Unknown',
                amount: d.purchasePrice,
                incurredAt: purchasedAt,
                paidBy: CostPaidBy.COMPANY,
                treatment: CostTreatment.COMPANY_EXPENSE,
                enteredById: req.user!.userId,
                notes: `${tag} — ${d.name}`,
              },
            });
            costId = cost.id;
          }

          return tx.asset.create({
            data: {
              organizationId: orgId,
              tag,
              name: d.name.trim(),
              category: d.category,
              make: d.make?.trim() || null,
              model: d.model?.trim() || null,
              serialNumber: d.serialNumber?.trim() || null,
              condition: d.condition,
              bookable: d.bookable ?? false,
              costId,
              purchasePrice: d.purchasePrice,
              purchasedAt,
              vendor: d.vendor?.trim() || null,
              invoiceNumber: d.invoiceNumber?.trim() || null,
              usefulLifeMonths: d.usefulLifeMonths ?? ASSET_USEFUL_LIFE[d.category] ?? 60,
              salvageValue: d.salvageValue,
              warrantyUntil: asDate(d.warrantyUntil),
              insuredUntil: asDate(d.insuredUntil),
              billUrl: d.billUrl?.trim() || null,
              photoUrl: d.photoUrl?.trim() || null,
              notes: d.notes?.trim() || null,
            },
            include: { currentHolder: holderSelect },
          });
        }),
      );

      await logAsset(orgId, req.user!.userId, created.id, 'asset.created', {
        tag: created.tag,
        name: created.name,
        category: created.category,
      });

      res.status(201).json({
        success: true,
        data: present(created, hasPermission(req.user!, 'money.figures')),
        warnings,
      });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * POST /api/assets/import — the one-hour job that seeds the register.
 *
 * Mirrors the client importer: a dry run reports what WOULD happen, and the
 * same body with `commit: true` does it. A row that cannot be read is skipped
 * and reported, never fatal — a sixty-line inventory that refuses to load
 * because line 40 has a blank price is one nobody imports twice.
 */
assetsRouter.post(
  '/import',
  requirePermission('asset.manage'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const orgId = req.user!.organizationId;
      const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
      const commit = req.body?.commit === true;
      if (!csv.trim()) {
        res.status(400).json({ success: false, error: 'Paste the CSV, or attach a file' });
        return;
      }

      const parsedRows = parseCsv(csv);
      const problems: { row: number; reason: string }[] = [];
      const ready: { row: number; name: string; category: AssetCategory; purchasePrice: number; purchasedAt: Date; serialNumber: string | null; make: string | null; model: string | null; vendor: string | null; bookable: boolean }[] = [];

      parsedRows.forEach((raw, i) => {
        const line = i + 2; // 1-indexed, plus the header
        // parseCsv already keys rows by normalised header, so the lookup only
        // has to normalise the name being asked for: "Purchase Price",
        // "purchase_price" and "purchaseprice" all land on the same cell.
        const get = (k: string) => String(raw[normaliseHeader(k)] ?? '').trim();

        const name = get('name');
        const categoryRaw = get('category').toUpperCase().replace(/[\s-]+/g, '_');
        const priceRaw = get('purchase price') || get('price');
        const dateRaw = get('purchased at') || get('purchase date');

        if (!name) return problems.push({ row: line, reason: 'No name' });
        if (!(categoryRaw in AssetCategory)) {
          return problems.push({ row: line, reason: `Unknown category "${get('category')}"` });
        }
        const price = Number(priceRaw.replace(/[^\d.]/g, ''));
        if (!Number.isFinite(price)) return problems.push({ row: line, reason: 'No purchase price' });
        const purchasedAt = asDate(dateRaw);
        if (!purchasedAt) return problems.push({ row: line, reason: 'No valid purchase date' });

        ready.push({
          row: line,
          name,
          category: categoryRaw as AssetCategory,
          purchasePrice: price,
          purchasedAt,
          serialNumber: get('serial') || get('serial number') || null,
          make: get('make') || null,
          model: get('model') || null,
          vendor: get('vendor') || null,
          bookable: /^(y|yes|true|1)$/i.test(get('bookable')),
        });
      });

      if (!commit) {
        res.json({ success: true, data: { dryRun: true, willCreate: ready.length, problems, preview: ready.slice(0, 10) } });
        return;
      }

      let created = 0;
      for (const row of ready) {
        await tagWithRetry(orgId, row.category, async (tag) => {
          const asset = await prisma.asset.create({
            data: {
              organizationId: orgId,
              tag,
              name: row.name,
              category: row.category,
              make: row.make,
              model: row.model,
              serialNumber: row.serialNumber,
              bookable: row.bookable,
              purchasePrice: row.purchasePrice,
              purchasedAt: row.purchasedAt,
              vendor: row.vendor,
              usefulLifeMonths: ASSET_USEFUL_LIFE[row.category] ?? 60,
            },
          });
          created++;
          return asset;
        });
      }

      res.json({ success: true, data: { dryRun: false, created, problems } });
    } catch (e) {
      next(e);
    }
  },
);

// ─── One asset ───────────────────────────────────────────────────────────────

/** GET /api/assets/:id — the record, its history and its repairs. */
assetsRouter.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const canSeeFigures = hasPermission(req.user!, 'money.figures');
    const asset = await prisma.asset.findFirst({
      where: { id: String(req.params.id), organizationId: orgId, deletedAt: null },
      include: {
        currentHolder: holderSelect,
        movements: {
          orderBy: { outAt: 'desc' },
          include: {
            user: { select: { id: true, name: true } },
            issuedBy: { select: { id: true, name: true } },
            receivedBy: { select: { id: true, name: true } },
            project: { select: { id: true, name: true } },
          },
        },
        maintenance: {
          orderBy: { sentAt: 'desc' },
          include: { createdBy: { select: { id: true, name: true } } },
        },
      },
    });

    if (!asset) {
      res.status(404).json({ success: false, error: 'Asset not found' });
      return;
    }

    const now = new Date();
    const open = asset.movements.find((m) => m.returnedAt === null) ?? null;

    res.json({
      success: true,
      data: {
        ...present(asset, canSeeFigures, now),
        openMovement: open
          ? { ...open, overdue: daysLate(open.dueAt, now) > 0, daysOverdue: daysLate(open.dueAt, now) }
          : null,
        movements: asset.movements,
        maintenance: asset.maintenance.map((m) => ({
          ...m,
          amount: canSeeFigures ? (m.amount === null ? null : Number(m.amount)) : undefined,
        })),
      },
      access: { canManage: hasPermission(req.user!, 'asset.manage'), canSeeFigures },
    });
  } catch (e) {
    next(e);
  }
});

const patchSchema = createSchema
  .partial()
  .omit({ createCost: true })
  .extend({ category: z.nativeEnum(AssetCategory).optional() });

assetsRouter.patch(
  '/:id',
  requirePermission('asset.manage'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = patchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues[0].message });
        return;
      }
      const orgId = req.user!.organizationId;
      const id = String(req.params.id);

      const existing = await prisma.asset.findFirst({
        where: { id, organizationId: orgId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ success: false, error: 'Asset not found' });
        return;
      }

      const d = parsed.data;
      const data: Prisma.AssetUpdateInput = {};
      if (d.name !== undefined) data.name = d.name.trim();
      // The category is NOT re-tagged. The sticker on the lens still says
      // EL/LEN/003 whatever the record is corrected to say afterwards.
      if (d.category !== undefined) data.category = d.category;
      if (d.make !== undefined) data.make = d.make?.trim() || null;
      if (d.model !== undefined) data.model = d.model?.trim() || null;
      if (d.serialNumber !== undefined) data.serialNumber = d.serialNumber?.trim() || null;
      if (d.condition !== undefined) data.condition = d.condition;
      if (d.bookable !== undefined) data.bookable = d.bookable;
      if (d.purchasePrice !== undefined) data.purchasePrice = d.purchasePrice;
      if (d.purchasedAt !== undefined) {
        const parsedDate = asDate(d.purchasedAt);
        if (!parsedDate) {
          res.status(400).json({ success: false, error: 'Give a valid purchase date' });
          return;
        }
        data.purchasedAt = parsedDate;
      }
      if (d.vendor !== undefined) data.vendor = d.vendor?.trim() || null;
      if (d.invoiceNumber !== undefined) data.invoiceNumber = d.invoiceNumber?.trim() || null;
      if (d.usefulLifeMonths !== undefined) data.usefulLifeMonths = d.usefulLifeMonths;
      if (d.salvageValue !== undefined) data.salvageValue = d.salvageValue;
      if (d.warrantyUntil !== undefined) data.warrantyUntil = asDate(d.warrantyUntil);
      if (d.insuredUntil !== undefined) data.insuredUntil = asDate(d.insuredUntil);
      if (d.billUrl !== undefined) data.billUrl = d.billUrl?.trim() || null;
      if (d.photoUrl !== undefined) data.photoUrl = d.photoUrl?.trim() || null;
      if (d.notes !== undefined) data.notes = d.notes?.trim() || null;
      if (d.costId !== undefined) {
        data.cost = d.costId ? { connect: { id: d.costId } } : { disconnect: true };
      }

      const updated = await prisma.asset.update({
        where: { id },
        data,
        include: { currentHolder: holderSelect },
      });

      await logAsset(orgId, req.user!.userId, id, 'asset.updated', {
        tag: updated.tag,
        fields: Object.keys(d),
      });

      res.json({ success: true, data: present(updated, hasPermission(req.user!, 'money.figures')) });
    } catch (e) {
      next(e);
    }
  },
);

/** DELETE /api/assets/:id — soft, and refused while somebody is holding it. */
assetsRouter.delete(
  '/:id',
  requirePermission('asset.manage'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const orgId = req.user!.organizationId;
      const id = String(req.params.id);
      const existing = await prisma.asset.findFirst({
        where: { id, organizationId: orgId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ success: false, error: 'Asset not found' });
        return;
      }

      const open = await openMovementFor(id);
      if (open) {
        res.status(409).json({
          success: false,
          error: `${existing.tag} is still out with somebody. Check it in first.`,
          code: 'ASSET_STILL_OUT',
        });
        return;
      }

      await prisma.asset.update({ where: { id }, data: { deletedAt: new Date() } });
      await logAsset(orgId, req.user!.userId, id, 'asset.deleted', { tag: existing.tag });
      res.json({ success: true, message: 'Asset removed' });
    } catch (e) {
      next(e);
    }
  },
);

const retireSchema = z.object({
  outcome: z.enum(['RETIRED', 'SOLD', 'LOST']),
  disposalValue: z.number().nonnegative().optional(),
  note: z.string().optional().nullable(),
  disposedAt: z.string().optional(),
});

/**
 * POST /api/assets/:id/retire — write it off, sell it, or lose it.
 *
 * Refused while a movement is open, because retiring kit that is with somebody
 * would silently strand the chain of custody: the register would say the item
 * is off the books and the last thing it recorded is that a person still has
 * it. If it is genuinely gone, check it in first and then mark it LOST — which
 * is a real record of what happened rather than an absence of one.
 */
assetsRouter.post(
  '/:id/retire',
  requirePermission('asset.manage'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = retireSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues[0].message });
        return;
      }
      const orgId = req.user!.organizationId;
      const id = String(req.params.id);

      const existing = await prisma.asset.findFirst({
        where: { id, organizationId: orgId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ success: false, error: 'Asset not found' });
        return;
      }

      const open = await openMovementFor(id);
      if (open) {
        res.status(409).json({
          success: false,
          error: `${existing.tag} is still out with somebody. Check it in before retiring it.`,
          code: 'ASSET_STILL_OUT',
        });
        return;
      }

      const updated = await prisma.asset.update({
        where: { id },
        data: {
          status: parsed.data.outcome as AssetStatus,
          disposedAt: asDate(parsed.data.disposedAt) ?? new Date(),
          disposalValue: parsed.data.outcome === 'SOLD' ? (parsed.data.disposalValue ?? 0) : null,
          disposalNote: parsed.data.note?.trim() || null,
          currentHolderId: null,
        },
        include: { currentHolder: holderSelect },
      });

      await logAsset(orgId, req.user!.userId, id, 'asset.retired', {
        tag: updated.tag,
        outcome: parsed.data.outcome,
      });

      res.json({ success: true, data: present(updated, hasPermission(req.user!, 'money.figures')) });
    } catch (e) {
      next(e);
    }
  },
);

// ─── Custody and booking ─────────────────────────────────────────────────────

/** A MovementConflict is a 409 with its own code, never a 500. */
function sendMovementError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof MovementConflict) {
    const status = err.code === 'ASSET_NOT_FOUND' || err.code === 'HOLDER_NOT_FOUND' ? 404 : 409;
    res.status(status).json({ success: false, error: err.message, code: err.code });
    return;
  }
  next(err);
}

const assignSchema = z.object({
  userId: z.string().min(1, 'Who is taking it?'),
  conditionOut: z.nativeEnum(AssetCondition).optional(),
  notes: z.string().optional().nullable(),
});

assetsRouter.post(
  '/:id/assign',
  requirePermission('asset.manage'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = assignSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues[0].message });
        return;
      }
      const { asset, movement } = await assignCustody({
        assetId: String(req.params.id),
        organizationId: req.user!.organizationId,
        issuedById: req.user!.userId,
        ...parsed.data,
      });
      await logAsset(req.user!.organizationId, req.user!.userId, asset.id, 'asset.assigned', {
        tag: asset.tag,
        to: parsed.data.userId,
      });
      res.status(201).json({ success: true, data: { movement } });
    } catch (e) {
      sendMovementError(e, res, next);
    }
  },
);

const checkoutSchema = assignSchema.extend({
  dueAt: z.string().min(1, 'When is it due back?'),
  projectId: z.string().optional().nullable(),
  monthCardId: z.string().optional().nullable(),
  purpose: z.string().optional().nullable(),
});

assetsRouter.post(
  '/:id/checkout',
  requirePermission('asset.manage'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = checkoutSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues[0].message });
        return;
      }
      const dueAt = asDate(parsed.data.dueAt);
      if (!dueAt) {
        res.status(400).json({ success: false, error: 'Give a valid date it is due back' });
        return;
      }
      const { asset, movement } = await checkOut({
        assetId: String(req.params.id),
        organizationId: req.user!.organizationId,
        issuedById: req.user!.userId,
        ...parsed.data,
        dueAt,
      });
      await logAsset(req.user!.organizationId, req.user!.userId, asset.id, 'asset.checked_out', {
        tag: asset.tag,
        to: parsed.data.userId,
        dueAt,
      });
      res.status(201).json({ success: true, data: { movement } });
    } catch (e) {
      sendMovementError(e, res, next);
    }
  },
);

const returnSchema = z.object({
  conditionIn: z.nativeEnum(AssetCondition).default(AssetCondition.GOOD),
  notes: z.string().optional().nullable(),
});

assetsRouter.post(
  '/:id/return',
  requirePermission('asset.manage'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = returnSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues[0].message });
        return;
      }
      const { asset, movement } = await returnAsset({
        assetId: String(req.params.id),
        organizationId: req.user!.organizationId,
        receivedById: req.user!.userId,
        ...parsed.data,
      });
      await logAsset(req.user!.organizationId, req.user!.userId, asset.id, 'asset.returned', {
        tag: asset.tag,
        condition: parsed.data.conditionIn,
      });
      res.json({ success: true, data: { movement, status: asset.status } });
    } catch (e) {
      sendMovementError(e, res, next);
    }
  },
);

assetsRouter.post(
  '/:id/transfer',
  requirePermission('asset.manage'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = assignSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues[0].message });
        return;
      }
      const { asset, movement } = await transfer({
        assetId: String(req.params.id),
        organizationId: req.user!.organizationId,
        issuedById: req.user!.userId,
        receivedById: req.user!.userId,
        ...parsed.data,
      });
      await logAsset(req.user!.organizationId, req.user!.userId, asset.id, 'asset.transferred', {
        tag: asset.tag,
        to: parsed.data.userId,
      });
      res.status(201).json({ success: true, data: { movement } });
    } catch (e) {
      sendMovementError(e, res, next);
    }
  },
);

// ─── Maintenance ─────────────────────────────────────────────────────────────

const maintenanceSchema = z.object({
  kind: z.nativeEnum(AssetMaintenanceKind).default(AssetMaintenanceKind.REPAIR),
  vendor: z.string().optional().nullable(),
  amount: z.number().nonnegative().optional(),
  sentAt: z.string().optional(),
  notes: z.string().optional().nullable(),
  /** Off by default: small repairs are noise in the P&L. */
  recordCost: z.boolean().optional(),
});

assetsRouter.post(
  '/:id/maintenance',
  requirePermission('asset.manage'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = maintenanceSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues[0].message });
        return;
      }
      const orgId = req.user!.organizationId;
      const id = String(req.params.id);
      const asset = await prisma.asset.findFirst({
        where: { id, organizationId: orgId, deletedAt: null },
      });
      if (!asset) {
        res.status(404).json({ success: false, error: 'Asset not found' });
        return;
      }

      const open = await openMovementFor(id);
      if (open) {
        res.status(409).json({
          success: false,
          error: `${asset.tag} is out with somebody. Check it in before sending it for repair.`,
          code: 'ASSET_STILL_OUT',
        });
        return;
      }

      const d = parsed.data;
      const sentAt = asDate(d.sentAt) ?? new Date();

      const record = await prisma.$transaction(async (tx) => {
        let costId: string | null = null;
        if (d.recordCost && d.amount) {
          const cost = await tx.cost.create({
            data: {
              organizationId: orgId,
              type: CostType.COMPANY,
              category: 'Equipment repair',
              vendor: d.vendor?.trim() || 'Unknown',
              amount: d.amount,
              incurredAt: sentAt,
              paidBy: CostPaidBy.COMPANY,
              treatment: CostTreatment.COMPANY_EXPENSE,
              enteredById: req.user!.userId,
              notes: `${asset.tag} — ${asset.name}`,
            },
          });
          costId = cost.id;
        }

        const maintenance = await tx.assetMaintenance.create({
          data: {
            assetId: id,
            kind: d.kind,
            vendor: d.vendor?.trim() || null,
            amount: d.amount ?? null,
            costId,
            sentAt,
            notes: d.notes?.trim() || null,
            createdById: req.user!.userId,
          },
        });

        await tx.asset.update({ where: { id }, data: { status: AssetStatus.IN_REPAIR } });
        return maintenance;
      });

      await logAsset(orgId, req.user!.userId, id, 'asset.maintenance_opened', {
        tag: asset.tag,
        kind: d.kind,
      });
      res.status(201).json({ success: true, data: record });
    } catch (e) {
      next(e);
    }
  },
);

const closeMaintenanceSchema = z.object({
  returnedAt: z.string().optional(),
  condition: z.nativeEnum(AssetCondition).default(AssetCondition.GOOD),
  amount: z.number().nonnegative().optional(),
  notes: z.string().optional().nullable(),
});

/** PATCH .../maintenance/:mid — it came back from the shop. */
assetsRouter.patch(
  '/:id/maintenance/:mid',
  requirePermission('asset.manage'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = closeMaintenanceSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues[0].message });
        return;
      }
      const orgId = req.user!.organizationId;
      const id = String(req.params.id);
      const mid = String(req.params.mid);

      const record = await prisma.assetMaintenance.findFirst({
        where: { id: mid, assetId: id, asset: { organizationId: orgId, deletedAt: null } },
        include: { asset: { select: { tag: true } } },
      });
      if (!record) {
        res.status(404).json({ success: false, error: 'Maintenance record not found' });
        return;
      }

      const updated = await prisma.$transaction(async (tx) => {
        const m = await tx.assetMaintenance.update({
          where: { id: mid },
          data: {
            returnedAt: asDate(parsed.data.returnedAt) ?? new Date(),
            amount: parsed.data.amount ?? record.amount,
            notes: parsed.data.notes?.trim() ?? record.notes,
          },
        });
        await tx.asset.update({
          where: { id },
          data: { status: AssetStatus.IN_STOCK, condition: parsed.data.condition },
        });
        return m;
      });

      await logAsset(orgId, req.user!.userId, id, 'asset.maintenance_closed', {
        tag: record.asset.tag,
      });
      res.json({ success: true, data: updated });
    } catch (e) {
      next(e);
    }
  },
);
