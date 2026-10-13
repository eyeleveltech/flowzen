/**
 * Money Plan 2, decisions 2 and 3: the cost rows the old recurring-cost job
 * got wrong, and the company costs that look like salaries — listed with
 * their amounts, for a person to approve before anything changes.
 *
 * Read-only. It changes nothing. Run it on a fresh copy of production first:
 *
 *   npx tsx prisma/money-cleanup-report.ts [--out <file.json>]
 *
 * It lists:
 *
 *   · OWN_MONTH  — a monthly copy in its template's own month. The template is
 *                  already that month's cost, so the month was counted twice.
 *   · RECREATED  — a copy somebody deleted, that the job made again.
 *   · DUPLICATE  — two live copies of one template in one month.
 *   · WRONG_CARD — a retainer's copy put on another month's card (the one the
 *                  template was entered on, usually long closed).
 *   · SALARY     — a company cost that looks like salaries. People cost already
 *                  counts salaries, from Team and the time split.
 *
 * Each row carries a proposed action — soft-delete, re-point (move to the right
 * month's card), or decide (a person chooses) — and `approved: false`. The JSON
 * it writes is what money-cleanup-apply.ts reads once rows are approved.
 */
import { writeFileSync } from 'node:fs';
import { PrismaClient, type Prisma } from '@prisma/client';
import { looksLikeSalary } from '../src/utils/salaryCost.js';

const prisma = new PrismaClient();

export type Kind = 'OWN_MONTH' | 'RECREATED' | 'DUPLICATE' | 'WRONG_CARD' | 'SALARY';
export type Action = 'soft-delete' | 're-point' | 'decide';

/** The fields the clean-up may change, as they are now. The apply script refuses a row that has moved on. */
export interface Snapshot {
  deletedAt: string | null;
  monthCardId: string | null;
  workId: string | null;
  updatedAt: string;
}

export interface ReportRow {
  id: string;
  organization: string;
  kinds: Kind[];
  why: string[];
  action: Action;
  /** For re-point: where it goes. */
  to?: { monthCardId: string | null; workId: string | null };
  before: Snapshot;
  cost: {
    type: string;
    category: string;
    vendor: string;
    amount: string;
    incurredAt: string;
    month: string;
    cardMonth: string | null;
    confirmed: boolean;
    recurring: boolean;
    templateId: string | null;
  };
  approved: boolean;
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const monthOf = (d: Date) => day(d).slice(0, 7);
const nextMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};

/**
 * The month the job meant a copy for. It always dated copies the 1st — but on
 * a server clock ahead of UTC, the 1st at midnight was stored as the last day
 * of the month before. So a copy dated the last day of a month is next month's.
 */
function rolledMonth(incurredAt: Date): { month: string; shifted: boolean } {
  const d = day(incurredAt);
  const tomorrow = new Date(incurredAt.getTime() + 86400000);
  if (d.slice(8) !== '01' && day(tomorrow).slice(8) === '01') return { month: nextMonth(monthOf(incurredAt)), shifted: true };
  return { month: monthOf(incurredAt), shifted: false };
}

const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

function dbName(): string {
  const url = process.env.DATABASE_URL ?? '';
  const m = url.match(/@([^/]+)\/([^?]+)/);
  return m ? `${m[2]} on ${m[1]}` : '(DATABASE_URL not set)';
}

type CostRow = Prisma.CostGetPayload<{ include: { monthCard: { select: { id: true; month: true; status: true; retainerId: true } } } }>;

export async function buildReport(): Promise<ReportRow[]> {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  const rows: ReportRow[] = [];

  for (const org of orgs) {
    // Everything, deleted rows included — a deleted copy is how a re-created one is told apart.
    const costs: CostRow[] = await prisma.cost.findMany({
      where: { organizationId: org.id, OR: [{ recurring: true }, { recurringSourceId: { not: null } }, { type: 'COMPANY' }] },
      include: { monthCard: { select: { id: true, month: true, status: true, retainerId: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const byId = new Map(costs.map((c) => [c.id, c]));
    const found = new Map<string, ReportRow>();

    const flag = (c: CostRow, kind: Kind, why: string, action: Action, to?: ReportRow['to']) => {
      const rank: Record<Action, number> = { 'soft-delete': 3, 're-point': 2, decide: 1 };
      const existing = found.get(c.id);
      if (existing) {
        existing.kinds.push(kind);
        existing.why.push(why);
        // The strongest proposal wins; a person can still change it.
        if (rank[action] > rank[existing.action]) {
          existing.action = action;
          existing.to = to;
        }
        return;
      }
      found.set(c.id, {
        id: c.id,
        organization: org.name,
        kinds: [kind],
        why: [why],
        action,
        to,
        before: {
          deletedAt: c.deletedAt ? c.deletedAt.toISOString() : null,
          monthCardId: c.monthCardId,
          workId: c.workId,
          updatedAt: c.updatedAt.toISOString(),
        },
        cost: {
          type: c.type,
          category: c.category,
          vendor: c.vendor,
          amount: c.amount.toString(),
          incurredAt: day(c.incurredAt),
          month: c.recurringSourceId ? rolledMonth(c.incurredAt).month : monthOf(c.incurredAt),
          cardMonth: c.monthCard?.month ?? null,
          confirmed: c.confirmed,
          recurring: c.recurring,
          templateId: c.recurringSourceId,
        },
        approved: false,
      });
    };

    // ── The copies, by template and month ──
    const groups = new Map<string, CostRow[]>();
    for (const c of costs) {
      if (!c.recurringSourceId) continue;
      const key = `${c.recurringSourceId}|${rolledMonth(c.incurredAt).month}`;
      groups.set(key, [...(groups.get(key) ?? []), c]);
    }

    for (const [key, copies] of groups) {
      const [templateId, month] = key.split('|');
      const template = byId.get(templateId);
      const live = copies.filter((c) => !c.deletedAt);
      const deleted = copies.filter((c) => c.deletedAt);

      // In the template's own month (or before it): the month counted it twice.
      if (template && !template.deletedAt && month <= monthOf(template.incurredAt)) {
        for (const c of live) {
          flag(c, 'OWN_MONTH', `A copy in ${month}, the month the template itself is for — that month counted it twice.`, 'soft-delete');
        }
        continue;
      }

      // Deleted, then made again by the job.
      const firstDeletion = deleted.map((c) => c.deletedAt!.getTime()).sort((a, b) => a - b)[0];
      const recreated = firstDeletion === undefined ? [] : live.filter((c) => c.createdAt.getTime() > firstDeletion);
      for (const c of recreated) {
        if (c.confirmed) {
          flag(c, 'RECREATED', `The ${month} copy was deleted and the job made it again — but someone has confirmed this one since.`, 'decide');
        } else {
          flag(c, 'RECREATED', `The ${month} copy was deleted and the job made it again within the hour.`, 'soft-delete');
        }
      }

      // More than one live copy left for the month: keep one (a confirmed one if any), the rest doubled it.
      const remaining = live.filter((c) => !recreated.includes(c));
      if (remaining.length > 1) {
        const keep = remaining.find((c) => c.confirmed) ?? remaining[0];
        for (const c of remaining) {
          if (c === keep) continue;
          flag(
            c,
            'DUPLICATE',
            `A second live copy for ${month} (keeping ${keep.id}).`,
            c.confirmed ? 'decide' : 'soft-delete',
          );
        }
      }
    }

    // ── Copies on another month's card ──
    for (const c of costs) {
      if (!c.recurringSourceId || c.deletedAt || found.get(c.id)?.action === 'soft-delete') continue;
      const { month, shifted } = rolledMonth(c.incurredAt);
      const cardId = c.monthCardId ?? (c.workType === 'MONTH_CARD' ? c.workId : null);
      if (!cardId) continue;
      const card = c.monthCard ?? (await prisma.monthCard.findUnique({ where: { id: cardId }, select: { id: true, month: true, status: true, retainerId: true } }));
      if (!card || card.month === month) continue;

      const note = shifted ? ` (dated ${day(c.incurredAt)} by the server clock — it is the ${month} copy)` : '';
      if (c.type === 'COMPANY') {
        flag(c, 'WRONG_CARD', `A company cost for ${month} on the ${card.month} card${note}. Company costs belong to no card.`, 're-point', {
          monthCardId: null,
          workId: c.workType === 'MONTH_CARD' && c.workId === card.id ? null : c.workId,
        });
        continue;
      }
      const right = await prisma.monthCard.findFirst({ where: { retainerId: card.retainerId, month }, select: { id: true } });
      if (right) {
        flag(c, 'WRONG_CARD', `The ${month} copy sits on the ${card.month} card (${card.status.toLowerCase()})${note}.`, 're-point', {
          monthCardId: right.id,
          workId: c.workType === 'MONTH_CARD' ? right.id : c.workId,
        });
      } else {
        flag(c, 'WRONG_CARD', `The ${month} copy sits on the ${card.month} card${note}, and the retainer has no ${month} card to move it to.`, 'decide');
      }
    }

    // ── Company costs that look like salaries ──
    for (const c of costs) {
      if (c.type !== 'COMPANY' || c.deletedAt) continue;
      if (!looksLikeSalary(c.category) && !looksLikeSalary(c.vendor)) continue;
      const what = c.recurring ? 'A recurring company cost' : c.recurringSourceId ? "A monthly copy of a recurring company cost" : 'A company cost';
      flag(
        c,
        'SALARY',
        `${what} that looks like salaries ("${c.category}", ${c.vendor}). People cost already counts salaries from Team and the time split.`,
        'decide',
      );
    }

    rows.push(...found.values());
  }
  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const out = outIdx >= 0 ? args[outIdx + 1] : `D:/Harish/Flowzen/cleanup-report-${new Date().toISOString().slice(0, 10)}.json`;

  console.log(`Money clean-up report — read-only — database ${dbName()}`);
  const rows = await buildReport();

  const kinds: Kind[] = ['OWN_MONTH', 'RECREATED', 'DUPLICATE', 'WRONG_CARD', 'SALARY'];
  const title: Record<Kind, string> = {
    OWN_MONTH: 'Copies in their template’s own month (counted twice)',
    RECREATED: 'Deleted copies the job made again',
    DUPLICATE: 'Two live copies in one month',
    WRONG_CARD: 'Copies on another month’s card',
    SALARY: 'Company costs that look like salaries',
  };
  for (const k of kinds) {
    const these = rows.filter((r) => r.kinds[0] === k);
    const total = these.reduce((s, r) => s + Number(r.cost.amount), 0);
    console.log(`\n${title[k]}: ${these.length}${these.length ? `, ${rupees(total)}` : ''}`);
    for (const r of these) {
      console.log(
        `  ${r.cost.month}  ${rupees(Number(r.cost.amount)).padStart(10)}  ${r.cost.category} · ${r.cost.vendor}` +
          `${r.cost.confirmed ? '' : ' (draft)'}  [${r.organization}]  → ${r.action}${r.to ? ` to card ${r.to.monthCardId ?? 'none'}` : ''}  ${r.id}`,
      );
      for (const w of r.why) console.log(`      ${w}`);
    }
  }

  const proposed = rows.filter((r) => r.action !== 'decide');
  console.log(
    `\n${rows.length} rows. ${proposed.length} have a proposed fix (soft-delete or move); ${rows.length - proposed.length} need a person to decide.` +
      `\nNothing has been changed. Approve rows by setting "approved": true in the JSON (and an "action" for any "decide" row), then run money-cleanup-apply.ts.`,
  );

  writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), database: dbName(), rows }, null, 2));
  console.log(`Written: ${out}`);
}

// Run when called as a script; tests import buildReport.
if (process.argv[1]?.replace(/\\/g, '/').endsWith('prisma/money-cleanup-report.ts')) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
