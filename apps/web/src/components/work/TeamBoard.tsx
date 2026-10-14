'use client';

/**
 * Team → Board (Team plan 1): in one place, what each person is on now, what
 * is next, and what needs attention.
 *
 * One row per person — Now (what they SAID they are working on; they set it
 * themselves), Next up (the top of their own My Work order), and plain counts.
 * "Needs attention" sits above it. Clicking a task opens it; clicking a count
 * lists the tasks behind it.
 *
 * What is deliberately not here: no "overloaded" or "idle" label (those were
 * taken off this screen once already because they misled), no ranking — people
 * are in their departments' order, then by name — and no timer. "Now" carries
 * no time, because nobody is being watched.
 */

import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api, formatDate, type TeamBoard as Board, type TeamBoardList, type TeamBoardReason } from '@/lib/api-v2';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, type Tone } from '@/components/ui/badge';
import { Modal, ModalBody } from '@/components/ui/modal';
import { ErrorNote } from '@/components/ui/empty-state';
import { TableRowsSkeleton } from '@/components/ui/skeleton-loaders';
import { TaskDrawer, type DrawerTask } from '@/components/work/TaskDrawer';
import { NowBadge } from '@/components/work/WorkingOnNow';
import { changeTaskStatus } from '@/lib/task-status';
import { cn, getAvatarColor, getInitials, plural } from '@/lib/utils';
import { monthLabel } from '@/lib/retainerBilling';

type BoardTask = Board['tasks'][string];
type BoardRow = Board['people'][number];

const STATUS_OPTIONS = [
  { value: 'TODO', label: 'To do' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'IN_REVIEW', label: 'In review' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'DONE', label: 'Done' },
  { value: 'CANCELLED', label: 'Cancelled' },
];
const statusLabel = (s: string) => STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s;

/** The columns, in the plan's order. Each is a list of task ids on the row. */
const COUNTS: { key: TeamBoardList; label: string; hint: string }[] = [
  { key: 'open', label: 'Open', hint: 'To do, In progress and On hold' },
  { key: 'dueThisWeek', label: 'Due this week', hint: 'Open, due from today to Sunday' },
  { key: 'overdue', label: 'Overdue', hint: 'Open, past its due date' },
  { key: 'waiting', label: 'Waiting', hint: 'On hold' },
  { key: 'inReview', label: 'In review', hint: 'Sent for approval, with an approver' },
  { key: 'doneThisWeek', label: 'Done this week', hint: 'Finished since Monday' },
];

const REASON: Record<TeamBoardReason, { label: string; tone: Tone }> = {
  OVERDUE: { label: 'Overdue', tone: 'bad' },
  WAITING_LONG: { label: 'On hold 3+ working days', tone: 'warn' },
  REVIEW_LONG: { label: 'Waiting for approval', tone: 'review' },
  URGENT_NOT_STARTED: { label: 'Urgent, not started', tone: 'warn' },
};

/** The one fact behind the first reason: a date, never a running clock. */
function reasonDetail(reason: TeamBoardReason, t: BoardTask): string {
  switch (reason) {
    case 'OVERDUE':
      return `was due ${formatDate(t.dueDate)}`;
    case 'WAITING_LONG':
      return `on hold since ${formatDate(t.waitingSince)}${
        t.waitingOn === 'CLIENT' ? ', waiting on the client' : t.waitingOn === 'ANOTHER_PERSON' ? ', waiting on someone else' : ''
      }`;
    case 'REVIEW_LONG':
      return `sent ${formatDate(t.lastReview?.submittedAt)}, past the reminder time`;
    case 'URGENT_NOT_STARTED':
      return `still to do, due ${formatDate(t.dueDate)}`;
  }
}

/** Where the task belongs, in one short line. */
const placeLine = (t: BoardTask) =>
  [t.clientName, t.projectName ?? (t.monthCardMonth ? `${monthLabel(t.monthCardMonth)} retainer` : null)]
    .filter(Boolean)
    .join(' · ');

const toDrawerTask = (t: BoardTask): DrawerTask =>
  ({ ...t, workLabel: t.monthCardMonth ? `${monthLabel(t.monthCardMonth)} retainer` : null }) as unknown as DrawerTask;

/** How many of "Needs attention" show before "Show all". */
const ATTENTION_SHOWN = 8;

export function TeamBoard({
  deptFilter,
  header,
}: {
  /** A department's id, NONE for nobody placed, or ALL. */
  deptFilter: string;
  /** The scope line and the department picker, from the page. */
  header: React.ReactNode;
}) {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['team', 'board', deptFilter],
    placeholderData: keepPreviousData,
    queryFn: () => api.team.board(deptFilter !== 'ALL' ? { departmentId: deptFilter } : {}),
  });
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [listing, setListing] = useState<{ row: BoardRow; key: TeamBoardList } | null>(null);
  const [allAttention, setAllAttention] = useState(false);
  const [busy, setBusy] = useState(false);

  const tasks = data?.tasks ?? {};
  const people = data?.people ?? [];
  const attention = (data?.attention ?? []).filter((a) => tasks[a.taskId]);
  const openTask = openTaskId && tasks[openTaskId] ? toDrawerTask(tasks[openTaskId]) : null;
  const loadError = error instanceof Error ? error.message : error ? 'Could not load the board' : null;

  const setStatus = async (t: DrawerTask, next: string) => {
    setBusy(true);
    try {
      await changeTaskStatus(t, next);
      toast.success(`Moved to ${statusLabel(next)}`);
      await refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update that task');
    } finally {
      setBusy(false);
    }
  };

  /** A task's title, as the way into it. The Now column says what it is, so no badge here. */
  const taskLink = (id: string | null) => {
    const t = id ? tasks[id] : null;
    if (!t) return <span className="text-secondary">—</span>;
    return (
      <button
        type="button"
        onClick={() => setOpenTaskId(t.id)}
        className="group/task block min-w-0 max-w-full rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <span
          className={cn(
            'block truncate font-medium underline-offset-2 group-hover/task:underline',
            t.overdue ? 'text-danger' : 'text-primary',
          )}
        >
          {t.title}
        </span>
        <span className="block truncate text-micro text-secondary">{placeLine(t)}</span>
      </button>
    );
  };

  /** A count, and the way to the tasks behind it. Plain numbers — red only for overdue above zero. */
  const count = (row: BoardRow, k: TeamBoardList) => {
    const n = row.lists[k].length;
    if (n === 0) return <span className="text-secondary">0</span>;
    return (
      <button
        type="button"
        onClick={() => setListing({ row, key: k })}
        aria-label={`${row.name}: ${n} ${COUNTS.find((c) => c.key === k)!.label.toLowerCase()}`}
        className={cn(
          'rounded-sm px-1 tabular-nums underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40',
          k === 'overdue' ? 'font-semibold text-danger' : 'text-body',
        )}
      >
        {n}
      </button>
    );
  };

  const person = (row: BoardRow) => (
    <div className="flex min-w-0 items-center gap-3">
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-micro font-bold ${getAvatarColor(row.name)}`}>
        {getInitials(row.name)}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-primary">{row.name}</p>
        <p className="truncate text-micro text-secondary">{row.designation || row.department || '—'}</p>
      </div>
    </div>
  );

  const shownAttention = allAttention ? attention : attention.slice(0, ATTENTION_SHOWN);
  const listed = listing ? listing.row.lists[listing.key].map((id) => tasks[id]).filter(Boolean) : [];

  return (
    <div className="space-y-6">
      {header}

      {loadError && <ErrorNote onDismiss={() => void refetch()}>{loadError}</ErrorNote>}

      {/* ── Needs attention ── */}
      <Card padding="none" className="overflow-hidden">
        <CardHeader>
          <CardTitle>Needs attention</CardTitle>
          {!isPending && attention.length > 0 && (
            <span className="text-micro text-secondary">{plural(attention.length, 'task')}</span>
          )}
        </CardHeader>
        {isPending ? (
          <p className="px-5 py-4 text-sm text-secondary">Loading…</p>
        ) : attention.length === 0 ? (
          <p className="px-5 py-4 text-sm text-secondary">
            Nothing needs attention: nothing overdue, nothing on hold over 3 working days, nothing stuck in review, no
            urgent task waiting to start.
          </p>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {shownAttention.map((a) => {
                const t = tasks[a.taskId];
                return (
                  <li key={a.taskId}>
                    <button
                      type="button"
                      onClick={() => setOpenTaskId(t.id)}
                      className="group/att flex w-full flex-col gap-1 px-5 py-2.5 text-left outline-none transition-colors hover:bg-subtle focus-visible:bg-subtle sm:flex-row sm:items-center sm:gap-3"
                    >
                      <span className="flex shrink-0 flex-wrap gap-1">
                        {a.reasons.map((r) => (
                          <Badge key={r} tone={REASON[r].tone}>
                            {REASON[r].label}
                          </Badge>
                        ))}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-primary underline-offset-2 group-hover/att:underline">
                        {t.title}
                      </span>
                      <span className="min-w-0 truncate text-micro text-secondary sm:max-w-[45%] sm:text-right">
                        {t.assignees.map((p) => p.name).join(', ')} · {reasonDetail(a.reasons[0], t)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {attention.length > ATTENTION_SHOWN && (
              <div className="border-t border-border px-5 py-2.5">
                <button
                  type="button"
                  onClick={() => setAllAttention((v) => !v)}
                  className="rounded-sm text-xs font-semibold text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  {allAttention ? 'Show fewer' : `Show all ${attention.length}`}
                </button>
              </div>
            )}
          </>
        )}
      </Card>

      {/* ── One row per person ── */}
      <Card padding="none" className="overflow-hidden">
        <CardHeader className="flex-wrap gap-x-4 gap-y-1">
          <CardTitle>Board</CardTitle>
          <span className="text-micro text-secondary">
            Now is what each person said they’re on — they set it themselves. Next up is the top of their own My Work.
          </span>
        </CardHeader>

        {/* Wide: one table. */}
        <div className="hidden overflow-x-auto md:block">
          <table className="data-table w-full min-w-[60rem] table-fixed">
            <colgroup>
              <col className="w-[12rem]" />
              <col />
              <col />
              {COUNTS.map((c) => (
                <col key={c.key} className="w-[5rem]" />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b border-border">
                <th className="eyebrow text-left">Person</th>
                <th className="eyebrow text-left">Now</th>
                <th className="eyebrow text-left">Next up</th>
                {COUNTS.map((c) => (
                  <th key={c.key} className="eyebrow text-center" title={c.hint}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isPending ? (
                <TableRowsSkeleton cols={9} />
              ) : people.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-16 text-center text-sm text-secondary">
                    Nobody in this department yet.
                  </td>
                </tr>
              ) : (
                people.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {person(row)}
                    </td>
                    <td>
                      {taskLink(row.nowTaskId)}
                    </td>
                    <td>
                      {taskLink(row.nextUpTaskId)}
                    </td>
                    {COUNTS.map((c) => (
                      <td key={c.key} className="text-center">
                        {count(row, c.key)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* A phone: one card per person. */}
        <div className="divide-y divide-border md:hidden">
          {isPending ? (
            <p className="px-4 py-6 text-sm text-secondary">Loading…</p>
          ) : people.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-secondary">Nobody in this department yet.</p>
          ) : (
            people.map((row) => (
              <div key={row.id} className="space-y-3 px-4 py-4">
                {person(row)}
                <dl className="space-y-2 text-sm">
                  <div className="flex gap-3">
                    <dt className="w-16 shrink-0 pt-0.5 text-micro font-semibold uppercase tracking-[0.06em] text-secondary">Now</dt>
                    <dd className="min-w-0 flex-1">
                      {taskLink(row.nowTaskId)}
                    </dd>
                  </div>
                  <div className="flex gap-3">
                    <dt className="w-16 shrink-0 pt-0.5 text-micro font-semibold uppercase tracking-[0.06em] text-secondary">Next up</dt>
                    <dd className="min-w-0 flex-1">
                      {taskLink(row.nextUpTaskId)}
                    </dd>
                  </div>
                </dl>
                <div className="grid grid-cols-3 gap-2">
                  {COUNTS.map((c) => {
                    const n = row.lists[c.key].length;
                    return (
                      <button
                        key={c.key}
                        type="button"
                        disabled={n === 0}
                        onClick={() => setListing({ row, key: c.key })}
                        className="rounded-lg border border-border px-2.5 py-1.5 text-left outline-none enabled:hover:bg-subtle focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        <span className="block truncate text-micro text-secondary">{c.label}</span>
                        <span
                          className={cn(
                            'block text-sm font-semibold tabular-nums',
                            c.key === 'overdue' && n > 0 ? 'text-danger' : n === 0 ? 'text-secondary' : 'text-primary',
                          )}
                        >
                          {n}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* A count, opened: the tasks behind it. */}
      {listing && (
        <Modal
          open
          onClose={() => setListing(null)}
          title={`${listing.row.name} · ${COUNTS.find((c) => c.key === listing.key)!.label}`}
          description={COUNTS.find((c) => c.key === listing.key)!.hint}
        >
          <ModalBody className="px-0 py-0">
            <ul className="divide-y divide-border">
              {listed.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setListing(null);
                      setOpenTaskId(t.id);
                    }}
                    className="group/item w-full px-6 py-3 text-left outline-none transition-colors hover:bg-subtle focus-visible:bg-subtle"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      {listing.row.nowTaskId === t.id && <NowBadge />}
                      <span className="truncate text-sm font-medium text-primary underline-offset-2 group-hover/item:underline">
                        {t.title}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-micro text-secondary">
                      {[
                        placeLine(t),
                        statusLabel(t.status),
                        t.status === 'DONE' && t.completedAt
                          ? `done ${formatDate(t.completedAt)}`
                          : `${t.overdue ? 'was due' : 'due'} ${formatDate(t.dueDate)}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </ModalBody>
        </Modal>
      )}

      <TaskDrawer
        task={openTask}
        statusOptions={STATUS_OPTIONS}
        busy={busy}
        onClose={() => setOpenTaskId(null)}
        onStatusChange={(t, next) => void setStatus(t, next)}
        onChanged={() => void refetch()}
      />
    </div>
  );
}
