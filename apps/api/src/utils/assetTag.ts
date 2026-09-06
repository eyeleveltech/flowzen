import { prisma } from '../lib/prisma.js';
import { ASSET_CATEGORY_CODE } from '@flowzen/shared';
import type { AssetCategory } from '@prisma/client';

/**
 * The number printed on the sticker.
 *
 *   EL/CAM/001    the first camera body
 *   EL/LAP/004    the fourth laptop
 *
 * Prefix from `Organization.assetTagPrefix`, a three-letter category code from
 * `ASSET_CATEGORY_CODE`, and a per-category sequence. Per-category rather than
 * one running number for the whole register, because the tag is read off a
 * sticker by a person: `EL/LEN/003` says what it is before you have found the
 * thing it is stuck to.
 *
 * This is the same read-highest-then-insert shape as `documentNumber.ts`, and
 * for the same reason it makes the same two promises: the sequence is compared
 * NUMERICALLY, so it survives passing 999 with the padding gone, and the race
 * between two people entering kit at once is settled by the unique index on
 * (organizationId, tag) plus `tagWithRetry` rather than by hoping.
 */

const SEQUENCE_WIDTH = 3;

export async function nextAssetTag(
  organizationId: string,
  category: AssetCategory,
): Promise<string> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { assetTagPrefix: true },
  });

  const prefix = (org?.assetTagPrefix || 'EL').replace(/\/+$/, '');
  const code = ASSET_CATEGORY_CODE[category] ?? 'GEN';
  const searchPrefix = `${prefix}/${code}/`;

  // Soft-deleted assets are INCLUDED on purpose. A tag belongs to the physical
  // sticker, not to the row — reissuing `EL/CAM/003` because the old one was
  // deleted puts two different cameras in the history under one number.
  const existing = await prisma.asset.findMany({
    where: { organizationId, tag: { startsWith: searchPrefix } },
    select: { tag: true },
  });

  let highest = 0;
  for (const { tag } of existing) {
    const parsed = parseInt(tag.slice(searchPrefix.length), 10);
    if (!Number.isNaN(parsed) && parsed > highest) highest = parsed;
  }

  return `${searchPrefix}${String(highest + 1).padStart(SEQUENCE_WIDTH, '0')}`;
}

/**
 * Enter an asset, and lose the race gracefully.
 *
 * `create` receives the tag to use and does the insert. If somebody else took
 * it first the unique index rejects it (P2002) and this reads the sequence
 * again, rather than showing a 500 to somebody whose only mistake was entering
 * a lens at the same moment as a colleague.
 */
export async function tagWithRetry<T>(
  organizationId: string,
  category: AssetCategory,
  create: (tag: string) => Promise<T>,
  maxAttempts = 5,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const tag = await nextAssetTag(organizationId, category);
    try {
      return await create(tag);
    } catch (err) {
      const tagTaken = (err as { code?: string }).code === 'P2002';
      if (!tagTaken || attempt >= maxAttempts) throw err;
      // Somebody else took this tag. Read the sequence again and retry.
    }
  }
}
