'use client';

/**
 * One person, and the work that is actually on them.
 *
 * ─── Why ────────────────────────────────────────────────────────────────────
 *
 * The team table answers "who is overloaded". It could not answer the question
 * anybody asks straight afterwards — overloaded with *what*. It counts a
 * person's tasks and never names one, so a Head could read that Sneha sits at
 * 333% of a normal load and had nowhere to go from there except to guess, or
 * to open every project in turn looking for her name.
 *
 * ─── Doing, then To do, then Waiting ────────────────────────────────────────
 *
 * Grouped by status rather than listed by date, because the three answer
 * different questions. "Doing" is what to leave alone. "To do" is what can be
 * moved to somebody else. "Waiting" is not this person's delay at all and
 * counting it against them is how a busy designer looks idle. Finished work is
 * last and collapsed, because it is evidence rather than a queue.
 *
 * Every task names the job it belongs to and links to it. A task lives under
 * either a project or a month of a retainer — never both, and the two arrive
 * down different columns — so the API resolves them to one shape and this only
 * has to render it.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, formatDate, formatMoney } from '@/lib/api-v2';
import { Drawer } from '@/components/ui/drawer';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { getPriorityBadge, getPriorityLabel } from '@/lib/priority';
import { presetLabel } from '@/lib/people';
import { getInitials, getAvatarColor, plural } from '@/lib/utils';

type Work = {
  kind: 'PROJECT' | 'RETAINER' | 'INTERNAL';
  label: string;
  clientName: string | null;
  href: string | null;
};

type MemberTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string;
  waitingOn: string | null;
  overdue: boolean;
  work: Work;
};

type MemberDetail = {
  id: string;
  name: string;
  designation: string | null;
  email: string;
  dept: string | null;
  preset: string | null;
  active: boolean;
  monthlyCost: string | number | null;
  openTasksCount: number;
  overdueTasksCount: number;
  waitingTasksCount: number;
  completedTasksCount: number;
  avgTurnaround: string | null;
  loadPercentage: number;
};

const GROUPS: { key: string; title: string; hint: string }[] = [
  { key: 'IN_PROGRESS', title: 'Doing now', hint: 'Started and not finished' },
  { key: 'TODO', title: 'To do', hint: 'Not started — the part that can move to somebody else' },
  { key: 'ON_HOLD', title: 'Waiting', hint: 'Blocked on someone else, so not this person’s delay' },
];

export function MemberDrawer({ memberId, onClose }: { memberId: string | null; onClose: () => void }) {
  const [member, setMember] = useState<MemberDetail | null>(null);
  const [tasks, setTasks] = useState<MemberTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    if (!memberId) return;
    let live = true;
    setLoading(true);
    setError(null);
    setShowDone(false);
    api.team
      .get(memberId)
      .then((res) => {
        if (!live) return;
        setMember(res.member);
        setTasks(res.tasks);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load that person'))
      .finally(() => live && setLoading(false));
    // Cancelled on close, so a slow reply for the person you just closed does
    // not paint itself over the one you opened next.
    return () => {
      live = false;
    };
  }, [memberId]);

  const done = tasks.filter((t) => t.status === 'DONE');

  return (
    <Drawer
      isOpen={Boolean(memberId)}
      onClose={onClose}
      variant="slideover"
      title={member?.name ?? 'Loading…'}
      description={[member?.designation, member?.dept].filter(Boolean).join(' · ') || undefined}
    >
      <div className="flex h-full flex-col">
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {error && (
            <p className="rounded-xl border border-danger/30 bg-danger-tint px-3.5 py-3 text-sm text-danger">{error}</p>
          )}

          {loading && !member && <p className="text-sm text-secondary">Loading…</p>}

          {member && (
            <>
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold ${getAvatarColor(member.name)}`}
                >
                  {getInitials(member.name)}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-base font-semibold text-primary">{member.name}</p>
                    {member.preset && <Badge tone="neutral">{presetLabel(member.preset)}</Badge>}
                    {!member.active && <Badge tone="bad">Switched off</Badge>}
                  </div>
                  <p className="truncate text-xs text-secondary">{member.email}</p>
                </div>
              </div>

              <Card padding="none" className="overflow-hidden">
                <dl className="divide-y divide-border text-sm">
                  <Row label="Designation" value={member.designation ?? '—'} />
                  <Row label="Department" value={member.dept ?? '—'} />
                  <Row
                    label="Load"
                    value={
                      <span className={member.loadPercentage >= 100 ? 'text-danger' : undefined}>
                        {member.loadPercentage}% of normal
                      </span>
                    }
                  />
                  <Row
                    label="Open"
                    value={
                      member.overdueTasksCount > 0 ? (
                        <span>
                          {member.openTasksCount}{' '}
                          {/* Not `plural` — "overdue" is an adjective and it
                              produced "3 overdues". */}
                          <span className="text-danger">({member.overdueTasksCount} overdue)</span>
                        </span>
                      ) : (
                        member.openTasksCount
                      )
                    }
                  />
                  {/* A dash rather than "0h 0m" when nothing has been
                      finished — zero is not a fast turnaround, it is no
                      turnaround. */}
                  <Row
                    label="Average close"
                    value={member.avgTurnaround ?? <span className="text-secondary">Nothing finished yet</span>}
                  />
                  {/* Null, not zero — §9 keeps a salary behind setup.admin, and
                      a masked figure printed as ₹0 is a wrong number rather
                      than a hidden one. */}
                  {member.monthlyCost != null && <Row label="Monthly cost" value={formatMoney(member.monthlyCost)} />}
                </dl>
              </Card>

              {GROUPS.map((g) => {
                const rows = tasks.filter((t) => t.status === g.key);
                if (rows.length === 0) return null;
                return (
                  <section key={g.key}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3">
                      {/* A real heading, so the three groups are navigable —
                          at semibold, because the eyebrow's `font-bold` is for
                          labels and this app keeps headings at one weight. */}
                      <h4 className="eyebrow">
                        {g.title} ({rows.length})
                      </h4>
                    </div>
                    <p className="mb-2 text-micro text-secondary">{g.hint}</p>
                    <div className="space-y-2">
                      {rows.map((t) => (
                        <TaskRow key={t.id} task={t} />
                      ))}
                    </div>
                  </section>
                );
              })}

              {member.openTasksCount === 0 && (
                <p className="rounded-xl border border-dashed border-line bg-subtle/40 px-3.5 py-3 text-sm text-secondary">
                  Nothing open. {done.length > 0 ? `${plural(done.length, 'task')} finished.` : ''}
                </p>
              )}

              {done.length > 0 && (
                <section>
                  <button
                    type="button"
                    onClick={() => setShowDone((v) => !v)}
                    className="eyebrow rounded-sm underline underline-offset-2 outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    {showDone ? 'Hide' : 'Show'} finished ({done.length})
                  </button>
                  {showDone && (
                    <div className="mt-2 space-y-2">
                      {done.map((t) => (
                        <TaskRow key={t.id} task={t} muted />
                      ))}
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </Drawer>
  );
}

function TaskRow({ task, muted = false }: { task: MemberTask; muted?: boolean }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className={`text-sm font-medium ${muted ? 'text-secondary line-through' : 'text-primary'}`}>{task.title}</p>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-micro font-semibold tracking-[0.03em] ${getPriorityBadge(task.priority)}`}
        >
          {getPriorityLabel(task.priority)}
        </span>
      </div>
      <p className="mt-1 text-micro text-secondary">
        {/* The job this task belongs to, which is the thing the team table
            could never say. A client name without the piece of work is not
            enough to act on; the piece of work without the client is not
            enough to recognise. */}
        <span className="font-medium text-body">{task.work.label}</span>
        {task.work.clientName && ` · ${task.work.clientName}`}
        {' · due '}
        <span className={task.overdue ? 'font-semibold text-danger' : undefined}>{formatDate(task.dueDate)}</span>
        {task.status === 'ON_HOLD' &&
          task.waitingOn &&
          ` · waiting on ${task.waitingOn === 'CLIENT' ? 'the client' : 'someone else'}`}
      </p>
    </>
  );

  const className =
    'block rounded-xl border border-border px-3.5 py-3 transition-colors hover:bg-subtle outline-none focus-visible:ring-2 focus-visible:ring-primary/40';

  return task.work.href ? (
    <Link href={task.work.href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={`${className} hover:bg-transparent`}>{body}</div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <dt className="shrink-0 text-secondary">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-primary">{value}</dd>
    </div>
  );
}
