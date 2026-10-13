/**
 * Money Plan 2: undoes a money-cleanup-apply.ts run, from its undo file.
 *
 *   npx tsx prisma/money-cleanup-undo.ts --undo <cleanup-undo-<date>.json>         (shows what it would do)
 *   npx tsx prisma/money-cleanup-undo.ts --undo <cleanup-undo-<date>.json> --yes   (does it)
 *
 * Each row goes back to exactly what it was — deletedAt, its card, and its
 * updatedAt too, so the costs table reads as it did before the clean-up. A row
 * somebody has changed since the clean-up is left alone, and said so. The
 * Activity rows the clean-up wrote stay (no hard deletes); the undo adds its own.
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import type { UndoEntry } from './money-cleanup-apply.js';

const prisma = new PrismaClient();

function dbName(): string {
  const m = (process.env.DATABASE_URL ?? '').match(/@([^/]+)\/([^?]+)/);
  return m ? `${m[2]} on ${m[1]}` : '(DATABASE_URL not set)';
}

export async function undoCleanup(
  entries: UndoEntry[],
  opts: { write: boolean; undoFile?: string },
): Promise<{ undone: UndoEntry[]; skipped: { id: string; why: string }[] }> {
  const undone: UndoEntry[] = [];
  const skipped: { id: string; why: string }[] = [];

  for (const e of entries) {
    const row = await prisma.cost.findUnique({ where: { id: e.id } });
    if (!row) {
      skipped.push({ id: e.id, why: 'not found' });
      continue;
    }
    const now = { deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null, monthCardId: row.monthCardId, workId: row.workId };
    if (now.deletedAt !== e.after.deletedAt || now.monthCardId !== e.after.monthCardId || now.workId !== e.after.workId) {
      skipped.push({ id: e.id, why: 'changed since the clean-up — left as it is' });
      continue;
    }
    undone.push(e);
  }

  if (!opts.write || undone.length === 0) return { undone, skipped };

  await prisma.$transaction(async (tx) => {
    for (const e of undone) {
      await tx.cost.update({
        where: { id: e.id },
        data: {
          deletedAt: e.before.deletedAt ? new Date(e.before.deletedAt) : null,
          monthCardId: e.before.monthCardId,
          workId: e.before.workId,
          // Given explicitly, Prisma keeps it instead of stamping now.
          updatedAt: new Date(e.before.updatedAt),
        },
      });
      await tx.activity.create({
        data: {
          organizationId: e.organizationId,
          entityType: 'Cost',
          entityId: e.id,
          actorId: null,
          verb: 'cleanup_undone',
          payload: { plan: 'Money Plan 2', restored: { ...e.before }, from: { ...e.after }, undoFile: opts.undoFile ?? null },
        },
      });
    }
  });
  return { undone, skipped };
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.includes('--undo') ? args[args.indexOf('--undo') + 1] : undefined;
  if (!file) throw new Error('Usage: money-cleanup-undo.ts --undo <cleanup-undo.json> [--yes]');
  const write = args.includes('--yes');
  const data = JSON.parse(readFileSync(file, 'utf8')) as { database: string; entries: UndoEntry[] };

  console.log(`Undo the money clean-up — database ${dbName()}${write ? '' : ' — DRY RUN, nothing will change (add --yes)'}`);
  if (data.database !== dbName()) console.log(`  Note: the clean-up ran on ${data.database}.`);

  const result = await undoCleanup(data.entries, { write, undoFile: file });
  for (const e of result.undone) console.log(`  ${write ? 'restored' : 'would restore'} ${e.id} (${e.action})`);
  for (const s of result.skipped) console.log(`  skipped ${s.id}: ${s.why}`);
  console.log(`\n${result.undone.length} ${write ? 'restored' : 'to restore'}, ${result.skipped.length} skipped.`);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('prisma/money-cleanup-undo.ts')) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
