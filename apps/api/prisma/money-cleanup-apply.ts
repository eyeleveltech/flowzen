/**
 * Money Plan 2: applies the APPROVED rows of a money-cleanup-report.ts report.
 *
 *   npx tsx prisma/money-cleanup-apply.ts --report <report.json>            (shows what it would do)
 *   npx tsx prisma/money-cleanup-apply.ts --report <report.json> --yes      (does it)
 *
 * Only rows with "approved": true are touched ("--all-proposed" also takes
 * every row whose proposed action is soft-delete or re-point; "decide" rows
 * always need a person to set their action and approve them).
 *
 * The rules it keeps (the plan's "Data safety"):
 *   · No hard deletes. A row is soft-deleted (deletedAt) or re-pointed to its
 *     own month's card. The row itself always stays.
 *   · Before anything changes, the old values go to an undo file
 *     (D:\Harish\Flowzen\cleanup-undo-<date>.json) — money-cleanup-undo.ts
 *     puts them back — and every change writes an Activity row with them.
 *   · A row that has changed since the report is left alone, and said so.
 *   · In production: take a pg_dump right before running this with --yes.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import type { ReportRow, Snapshot } from './money-cleanup-report.js';

const prisma = new PrismaClient();

export interface UndoEntry {
  id: string;
  organizationId: string;
  action: 'soft-delete' | 're-point';
  /** What the row was — the undo puts these back. */
  before: Snapshot;
  /** What this run made it — the undo only acts on a row still like this. */
  after: { deletedAt: string | null; monthCardId: string | null; workId: string | null };
  reason: string[];
}

const snap = (c: { deletedAt: Date | null; monthCardId: string | null; workId: string | null; updatedAt: Date }): Snapshot => ({
  deletedAt: c.deletedAt ? c.deletedAt.toISOString() : null,
  monthCardId: c.monthCardId,
  workId: c.workId,
  updatedAt: c.updatedAt.toISOString(),
});
const sameState = (a: Omit<Snapshot, 'updatedAt'>, b: Omit<Snapshot, 'updatedAt'>) =>
  a.deletedAt === b.deletedAt && a.monthCardId === b.monthCardId && a.workId === b.workId;

function dbName(): string {
  const m = (process.env.DATABASE_URL ?? '').match(/@([^/]+)\/([^?]+)/);
  return m ? `${m[2]} on ${m[1]}` : '(DATABASE_URL not set)';
}

/** A file name that is not taken yet: never overwrite an earlier undo file. */
function freshPath(base: string): string {
  if (!existsSync(base)) return base;
  for (let i = 2; ; i++) {
    const p = base.replace(/\.json$/, `-${i}.json`);
    if (!existsSync(p)) return p;
  }
}

export async function applyCleanup(
  rows: ReportRow[],
  opts: { allProposed?: boolean; write: boolean; undoPath: string; now?: Date },
): Promise<{ applied: UndoEntry[]; skipped: { id: string; why: string }[]; undoPath: string | null }> {
  const now = opts.now ?? new Date();
  const chosen = rows.filter((r) => r.approved || (opts.allProposed && r.action !== 'decide'));
  const plan: UndoEntry[] = [];
  const skipped: { id: string; why: string }[] = [];

  for (const r of chosen) {
    if (r.action === 'decide') {
      skipped.push({ id: r.id, why: 'approved, but its action is still "decide" — set "soft-delete" or "re-point"' });
      continue;
    }
    if (r.action === 're-point' && !r.to) {
      skipped.push({ id: r.id, why: 're-point with no "to" card' });
      continue;
    }
    const row = await prisma.cost.findUnique({ where: { id: r.id } });
    if (!row) {
      skipped.push({ id: r.id, why: 'not found' });
      continue;
    }
    const before = snap(row);
    if (!sameState(before, r.before)) {
      skipped.push({ id: r.id, why: 'changed since the report — run the report again' });
      continue;
    }
    if (r.action === 'soft-delete' && row.deletedAt) {
      skipped.push({ id: r.id, why: 'already deleted' });
      continue;
    }
    if (r.action === 're-point' && r.to!.monthCardId) {
      const card = await prisma.monthCard.findUnique({ where: { id: r.to!.monthCardId }, select: { id: true } });
      if (!card) {
        skipped.push({ id: r.id, why: `the card ${r.to!.monthCardId} it was to move to is gone` });
        continue;
      }
    }
    plan.push({
      id: row.id,
      organizationId: row.organizationId,
      action: r.action,
      before,
      after:
        r.action === 'soft-delete'
          ? { deletedAt: now.toISOString(), monthCardId: row.monthCardId, workId: row.workId }
          : { deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null, monthCardId: r.to!.monthCardId, workId: r.to!.workId },
      reason: r.why,
    });
  }

  if (!opts.write || plan.length === 0) return { applied: plan, skipped, undoPath: null };

  // The old values are on disk before a single row changes.
  const undoPath = freshPath(opts.undoPath);
  writeFileSync(undoPath, JSON.stringify({ createdAt: now.toISOString(), database: dbName(), entries: plan }, null, 2));

  await prisma.$transaction(async (tx) => {
    for (const e of plan) {
      await tx.cost.update({
        where: { id: e.id },
        data:
          e.action === 'soft-delete'
            ? { deletedAt: new Date(e.after.deletedAt!) }
            : { monthCardId: e.after.monthCardId, workId: e.after.workId },
      });
      await tx.activity.create({
        data: {
          organizationId: e.organizationId,
          entityType: 'Cost',
          entityId: e.id,
          actorId: null,
          verb: e.action === 'soft-delete' ? 'cleanup_soft_deleted' : 'cleanup_moved_month',
          payload: { plan: 'Money Plan 2', before: { ...e.before }, after: { ...e.after }, reason: e.reason, undoFile: undoPath },
        },
      });
    }
  });

  return { applied: plan, skipped, undoPath };
}

async function main() {
  const args = process.argv.slice(2);
  const at = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const reportPath = at('--report');
  if (!reportPath) throw new Error('Usage: money-cleanup-apply.ts --report <report.json> [--all-proposed] [--yes]');
  const write = args.includes('--yes');
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as { database: string; rows: ReportRow[] };

  console.log(`Money clean-up — database ${dbName()}${write ? '' : ' — DRY RUN, nothing will change (add --yes)'}`);
  if (report.database !== dbName()) console.log(`  Note: the report was made on ${report.database}.`);

  const result = await applyCleanup(report.rows, {
    allProposed: args.includes('--all-proposed'),
    write,
    undoPath: at('--undo-out') ?? `D:/Harish/Flowzen/cleanup-undo-${new Date().toISOString().slice(0, 10)}.json`,
  });

  for (const e of result.applied) {
    console.log(
      `  ${write ? '' : 'would '}${e.action === 'soft-delete' ? 'soft-delete' : `move to card ${e.after.monthCardId ?? 'none'}`}  ${e.id}`,
    );
  }
  for (const s of result.skipped) console.log(`  skipped ${s.id}: ${s.why}`);
  console.log(`\n${result.applied.length} ${write ? 'changed' : 'to change'}, ${result.skipped.length} skipped.`);
  if (result.undoPath) console.log(`Undo file: ${result.undoPath}\nTo undo: npx tsx prisma/money-cleanup-undo.ts --undo "${result.undoPath}" --yes`);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('prisma/money-cleanup-apply.ts')) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
