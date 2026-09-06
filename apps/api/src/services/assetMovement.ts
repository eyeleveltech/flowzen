import { prisma } from '../lib/prisma.js';
import {
  AssetCondition,
  AssetMovementKind,
  AssetStatus,
  type Asset,
  type AssetMovement,
} from '@prisma/client';

/**
 * Moving an asset from one pair of hands to another.
 *
 * ─── The invariant ──────────────────────────────────────────────────────────
 *
 * An asset has AT MOST ONE movement with `returnedAt: null`.
 *
 * It is enforced here, in a transaction, rather than by a database constraint,
 * because Postgres cannot express "at most one null per group" without a
 * partial unique index — and because the transaction is the honest place for it
 * anyway. `Asset.status` and `Asset.currentHolderId` are denormalised copies of
 * what the open movement says; they exist so the register can render 200 rows
 * without an N+1 over movement history. Three facts that must agree can only be
 * kept in step by one writer that changes all three in a single commit, which is
 * what every function in this file is.
 *
 * Every one of them re-reads the open movement INSIDE the transaction. Checking
 * before opening one and trusting the answer is exactly the race that lets two
 * people check the same camera out to two different shoots.
 */

export class MovementConflict extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'MovementConflict';
  }
}

/** Statuses from which nothing can be handed over — the asset is off the floor. */
const CLOSED_STATUSES: AssetStatus[] = [AssetStatus.RETIRED, AssetStatus.SOLD, AssetStatus.LOST];

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** The open movement for an asset, or null. The source of truth for "who has it". */
export async function openMovementFor(assetId: string, tx: Tx | typeof prisma = prisma) {
  return tx.assetMovement.findFirst({
    where: { assetId, returnedAt: null },
    orderBy: { outAt: 'desc' },
  });
}

/** Read the asset inside the org, or refuse. The house scoped-read pattern. */
async function loadAsset(tx: Tx, assetId: string, organizationId: string): Promise<Asset> {
  const asset = await tx.asset.findFirst({
    where: { id: assetId, organizationId, deletedAt: null },
  });
  if (!asset) throw new MovementConflict('Asset not found', 'ASSET_NOT_FOUND');
  return asset;
}

function refuseIfClosed(asset: Asset): void {
  if (CLOSED_STATUSES.includes(asset.status)) {
    throw new MovementConflict(
      `${asset.tag} is ${asset.status.toLowerCase()} and cannot be handed over.`,
      'ASSET_CLOSED',
    );
  }
}

/** The person receiving it has to be real, active, and in this organisation. */
async function requireHolder(tx: Tx, userId: string, organizationId: string): Promise<void> {
  const user = await tx.user.findFirst({
    where: { id: userId, organizationId, active: true },
    select: { id: true },
  });
  if (!user) throw new MovementConflict('That person is not on the team', 'HOLDER_NOT_FOUND');
}

export type OpenInput = {
  assetId: string;
  organizationId: string;
  userId: string;
  issuedById: string;
  conditionOut?: AssetCondition;
  notes?: string | null;
  /** BOOKING only. */
  dueAt?: Date;
  projectId?: string | null;
  monthCardId?: string | null;
  purpose?: string | null;
};

/**
 * Open a movement — the shared body of assign and checkout.
 *
 * The only differences between long-term custody and a shoot booking are the
 * `kind`, whether `dueAt` is required, and the status the asset lands in. Every
 * other line — the conflict check, the three-way write, the activity row — is
 * identical, and duplicating it is how the two halves drift.
 */
async function open(
  input: OpenInput,
  kind: AssetMovementKind,
  nextStatus: AssetStatus,
): Promise<{ asset: Asset; movement: AssetMovement }> {
  return prisma.$transaction(async (tx) => {
    const asset = await loadAsset(tx as Tx, input.assetId, input.organizationId);
    refuseIfClosed(asset);
    await requireHolder(tx as Tx, input.userId, input.organizationId);

    const existing = await openMovementFor(input.assetId, tx as Tx);
    if (existing) {
      throw new MovementConflict(
        `${asset.tag} is already out. Check it in before handing it over again.`,
        'ALREADY_OUT',
      );
    }

    const movement = await tx.assetMovement.create({
      data: {
        assetId: input.assetId,
        kind,
        userId: input.userId,
        issuedById: input.issuedById,
        conditionOut: input.conditionOut ?? asset.condition,
        dueAt: kind === AssetMovementKind.BOOKING ? input.dueAt : null,
        projectId: input.projectId ?? null,
        monthCardId: input.monthCardId ?? null,
        purpose: input.purpose ?? null,
        notes: input.notes ?? null,
      },
    });

    const updated = await tx.asset.update({
      where: { id: input.assetId },
      data: { status: nextStatus, currentHolderId: input.userId },
    });

    return { asset: updated, movement };
  });
}

/** Long-term custody. No due date — this is "who is responsible for it". */
export function assignCustody(input: OpenInput) {
  return open(input, AssetMovementKind.CUSTODY, AssetStatus.ASSIGNED);
}

/** A shoot checkout. `dueAt` is required by the caller's schema, not optional here. */
export function checkOut(input: OpenInput) {
  if (!input.dueAt) {
    throw new MovementConflict('A booking needs a date it is due back', 'DUE_DATE_REQUIRED');
  }
  return open(input, AssetMovementKind.BOOKING, AssetStatus.BOOKED_OUT);
}

export type ReturnInput = {
  assetId: string;
  organizationId: string;
  receivedById: string;
  conditionIn: AssetCondition;
  notes?: string | null;
};

/**
 * Close whichever movement is open.
 *
 * Kit that comes back DAMAGED lands in IN_REPAIR rather than IN_STOCK, so the
 * next person to look for a free lens is not offered a broken one. That is the
 * single most useful thing this function does: the alternative is a register
 * that says a camera is available and a shoot that finds out it is not.
 */
export async function returnAsset(
  input: ReturnInput,
): Promise<{ asset: Asset; movement: AssetMovement }> {
  return prisma.$transaction(async (tx) => {
    const asset = await loadAsset(tx as Tx, input.assetId, input.organizationId);

    const existing = await openMovementFor(input.assetId, tx as Tx);
    if (!existing) {
      throw new MovementConflict(
        `${asset.tag} is not out with anybody — there is nothing to check in.`,
        'NOT_OUT',
      );
    }

    const movement = await tx.assetMovement.update({
      where: { id: existing.id },
      data: {
        returnedAt: new Date(),
        receivedById: input.receivedById,
        conditionIn: input.conditionIn,
        notes: input.notes ?? existing.notes,
      },
    });

    const damaged = input.conditionIn === AssetCondition.DAMAGED;
    const updated = await tx.asset.update({
      where: { id: input.assetId },
      data: {
        status: damaged ? AssetStatus.IN_REPAIR : AssetStatus.IN_STOCK,
        currentHolderId: null,
        condition: input.conditionIn,
      },
    });

    return { asset: updated, movement };
  });
}

export type TransferInput = OpenInput & { receivedById: string };

/**
 * Hand it straight to somebody else.
 *
 * Close and reopen in ONE commit, so the chain of custody never has a gap in
 * it. Doing this as a return followed by an assign leaves a window — however
 * short — in which the register says the camera is in the cupboard and it is
 * actually in somebody's hands, and a crash between the two calls makes that
 * window permanent.
 */
export async function transfer(
  input: TransferInput,
): Promise<{ asset: Asset; movement: AssetMovement }> {
  return prisma.$transaction(async (tx) => {
    const asset = await loadAsset(tx as Tx, input.assetId, input.organizationId);
    refuseIfClosed(asset);
    await requireHolder(tx as Tx, input.userId, input.organizationId);

    const existing = await openMovementFor(input.assetId, tx as Tx);
    if (!existing) {
      throw new MovementConflict(
        `${asset.tag} is not out with anybody. Assign it or check it out instead.`,
        'NOT_OUT',
      );
    }
    if (existing.userId === input.userId) {
      throw new MovementConflict('That person already holds it', 'SAME_HOLDER');
    }

    const conditionIn = input.conditionOut ?? asset.condition;
    await tx.assetMovement.update({
      where: { id: existing.id },
      data: {
        returnedAt: new Date(),
        receivedById: input.receivedById,
        conditionIn,
        notes: existing.notes,
      },
    });

    const kind = existing.kind;
    const movement = await tx.assetMovement.create({
      data: {
        assetId: input.assetId,
        kind,
        userId: input.userId,
        issuedById: input.issuedById,
        conditionOut: conditionIn,
        dueAt: kind === AssetMovementKind.BOOKING ? (input.dueAt ?? existing.dueAt) : null,
        projectId: input.projectId ?? existing.projectId,
        monthCardId: input.monthCardId ?? existing.monthCardId,
        purpose: input.purpose ?? existing.purpose,
        notes: input.notes ?? null,
      },
    });

    const updated = await tx.asset.update({
      where: { id: input.assetId },
      data: { status: asset.status, currentHolderId: input.userId, condition: conditionIn },
    });

    return { asset: updated, movement };
  });
}
