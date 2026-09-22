import { prisma } from '../lib/prisma.js';

/**
 * The project a retainer's work falls into when nothing else is chosen.
 *
 * A task on a month card must name a retainer project — there is no such thing
 * as ungrouped retainer work, and a CHECK constraint enforces it — so every
 * retainer needs one of these before it can hold a task at all. One is created
 * with the retainer; this creates one anyway rather than throwing, because a
 * retainer made before that rule existed should not fail the first time
 * somebody adds work to it.
 */
export async function defaultProjectId(retainer: {
  id: string;
  ownerId: string;
}): Promise<string> {
  const existing = await prisma.retainerProject.findFirst({
    where: { retainerId: retainer.id, isDefault: true },
    select: { id: true },
  });
  if (existing) return existing.id;
  const made = await prisma.retainerProject.create({
    data: {
      retainerId: retainer.id,
      name: 'Monthly Retainer Work',
      ownerId: retainer.ownerId,
      isDefault: true,
      description: 'The monthly work this retainer is for. Campaigns and one-off pieces sit beside it.',
    },
    select: { id: true },
  });
  return made.id;
}
