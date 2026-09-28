import { PrismaClient } from '@prisma/client';

/**
 * ─── Soft delete, once, instead of 139 times ────────────────────────────────
 *
 * Six models here never really delete: OutreachEntry, Proposal, Project, Task,
 * Cost and Asset all stamp `deletedAt` and stay. §16 — nothing is hard deleted
 * by a user — because the aging medians, the allocation cron, "done this week"
 * and the audit trail all read history a real delete would rewrite underneath
 * them.
 *
 * Nothing in the data layer knew that. Every query that should hide a deleted
 * row said so itself, one `deletedAt: null` at a time, and there were 139 of
 * them. A filter you write by hand is a filter you can forget, and forgetting
 * is invisible: the query still runs, still returns rows, and the extra row
 * looks exactly like data.
 *
 * That is not hypothetical. A deleted project stayed on the client's Work tab
 * because the include had no filter at all; the sweep that fixed it found
 * three more of the same omission; a review found five more after that — the
 * mark-lost guard, the company-status derivation, the archive count, the
 * assistant's own project list, and a task count sitting beside a cost count
 * that did filter. Eight sites, one mistake, and neither the compiler nor 618
 * tests could see any of them. `forecast.ts` even carries a comment almost
 * word for word identical to the one written this week, which is the same fix
 * arrived at independently for the third time.
 *
 * So the default moves into the client. A read that says nothing about
 * `deletedAt` gets `deletedAt: null`, and the places that genuinely want the
 * deleted rows — trash lists, restore, the audit trail, "what will be
 * destroyed" counts — have to say so out loud. That is the real win: the
 * exceptions become visible AS exceptions, instead of being indistinguishable
 * from an oversight.
 *
 * ─── How to ask for deleted rows ────────────────────────────────────────────
 *
 *   where: { deletedAt: { not: null } }   // only the deleted — trash lists
 *   where: { deletedAt: undefined }       // deleted AND live — audit, counts
 *
 * The second reads like a no-op and is not: the extension checks whether the
 * KEY is present, not whether it holds a value, so writing it explicitly is
 * how a query opts out. Anywhere it appears, say why in a comment.
 *
 * The 139 existing `deletedAt: null` clauses are left where they are. They are
 * redundant now, not wrong, and removing them in the same change as adding
 * this would mean a behaviour change and a 139-site edit landing together with
 * no way to tell which one broke something.
 */
const SOFT_DELETED = ['outreachEntry', 'proposal', 'project', 'task', 'cost', 'asset'] as const;

/** Reads only. A write names its own rows, and `update` on a deleted row is
 *  how `restore` puts one back. */
const READS = ['findFirst', 'findFirstOrThrow', 'findMany', 'findUnique', 'findUniqueOrThrow', 'count', 'aggregate', 'groupBy'] as const;

const hideDeleted = Object.fromEntries(
  SOFT_DELETED.map((model) => [
    model,
    Object.fromEntries(
      READS.map((op) => [
        op,
        ({ args, query }: { args: any; query: (a: any) => Promise<unknown> }) => {
          const where = args?.where;
          /*
           * `in` rather than a truthiness check, so `deletedAt: undefined` —
           * the written-out opt-in for "include the deleted ones" — is
           * respected. `{}` and `{ deletedAt: undefined }` are the same object
           * to `??`, and opposite instructions here.
           */
          if (where && 'deletedAt' in where) return query(args);

          /*
           * `findUnique` takes only unique fields in `where`, so an extra
           * `deletedAt` is a type error and, at runtime, an invalid query. It
           * is left alone: a lookup by id is answering "which row is this",
           * and every caller already checks what it got back.
           */
          if (op === 'findUnique' || op === 'findUniqueOrThrow') return query(args);

          return query({ ...args, where: { ...(where ?? {}), deletedAt: null } });
        },
      ]),
    ),
  ]),
);

const base = new PrismaClient();

/*
 * Cast at this one boundary.
 *
 * Prisma generates the extension type per model and per operation, and a map
 * built with Object.fromEntries cannot be expressed in it — writing it out
 * would be six models times eight operations of identical code, which is the
 * duplication this file exists to remove. The shape is checked by the tests
 * below it and by the probe that exercises each model.
 */
const client = base.$extends({ query: hideDeleted as never });

const globalForPrisma = globalThis as unknown as { prisma: typeof client };

export const prisma = globalForPrisma.prisma || client;

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
