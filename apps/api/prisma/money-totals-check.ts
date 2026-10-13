/**
 * Money Plan 2, data-safety rule 4: existing invoices and proformas keep their
 * stored totals. Read-only.
 *
 * Before the deploy, write down every stored total:
 *
 *   npx tsx prisma/money-totals-check.ts --snapshot D:/Harish/Flowzen/money-totals-before.json
 *
 * After it, compare — every figure must read exactly as it did:
 *
 *   npx tsx prisma/money-totals-check.ts --compare D:/Harish/Flowzen/money-totals-before.json
 *
 * Figures are compared as the text Postgres returns (Decimal), so "1180.00"
 * against "1180" would show; nothing is rounded before comparing. Documents
 * raised after the snapshot are counted, not compared.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const FIELDS = ['amount', 'gstAmount', 'subtotal', 'cgstAmount', 'sgstAmount', 'igstAmount', 'roundOff', 'total'] as const;
type Row = { key: string; number: string } & Record<(typeof FIELDS)[number], string | null>;

const text = (v: unknown) => (v === null || v === undefined ? null : String(v));

async function readAll(): Promise<Row[]> {
  const [invoices, proformas] = await Promise.all([
    prisma.invoice.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, number: true, amount: true, gstAmount: true, subtotal: true, cgstAmount: true, sgstAmount: true, igstAmount: true, roundOff: true, total: true },
    }),
    prisma.proforma.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, number: true, amount: true, subtotal: true, cgstAmount: true, sgstAmount: true, igstAmount: true, roundOff: true, total: true },
    }),
  ]);
  const row = (kind: string, d: Record<string, unknown>): Row =>
    ({ key: `${kind}:${d.id}`, number: String(d.number), ...Object.fromEntries(FIELDS.map((f) => [f, text(d[f])])) }) as Row;
  return [...invoices.map((d) => row('invoice', d)), ...proformas.map((d) => row('proforma', d))];
}

function dbName(): string {
  const m = (process.env.DATABASE_URL ?? '').match(/@([^/]+)\/([^?]+)/);
  return m ? `${m[2]} on ${m[1]}` : '(DATABASE_URL not set)';
}

async function main() {
  const args = process.argv.slice(2);
  const at = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const snapshot = at('--snapshot');
  const compare = at('--compare');
  if (!snapshot && !compare) throw new Error('Usage: money-totals-check.ts --snapshot <file> | --compare <file>');

  const now = await readAll();
  console.log(`Stored document totals — read-only — database ${dbName()}`);

  if (snapshot) {
    writeFileSync(snapshot, JSON.stringify({ takenAt: new Date().toISOString(), database: dbName(), rows: now }, null, 2));
    console.log(`${now.length} invoices and proformas written to ${snapshot}`);
    return;
  }

  const before = JSON.parse(readFileSync(compare!, 'utf8')) as { takenAt: string; rows: Row[] };
  const current = new Map(now.map((r) => [r.key, r]));
  let changed = 0;
  let missing = 0;
  for (const was of before.rows) {
    const is = current.get(was.key);
    if (!is) {
      missing++;
      console.log(`  MISSING  ${was.key} ${was.number}`);
      continue;
    }
    const diffs = FIELDS.filter((f) => was[f] !== is[f]);
    if (diffs.length) {
      changed++;
      console.log(`  CHANGED  ${was.key} ${was.number}: ${diffs.map((f) => `${f} ${was[f]} → ${is[f]}`).join(', ')}`);
    }
  }
  const added = now.filter((r) => !before.rows.some((b) => b.key === r.key)).length;
  console.log(
    `\nCompared ${before.rows.length} documents from ${before.takenAt}: ${changed} changed, ${missing} missing. ${added} raised since (not compared).`,
  );
  console.log(changed === 0 && missing === 0 ? 'Every stored total is exactly as it was.' : 'STOP — stored totals moved. Do not go on; tell the developer.');
  if (changed || missing) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
