'use client';

/**
 * Team → Approvals: where approvals get stuck.
 *
 * Heads and management, any day of the week. Top to bottom: the period, one
 * card per task type (the approver GROUP's numbers — any one of them can
 * decide, so a wait belongs to all of them), what is waiting right now, and
 * what each approver did.
 *
 * Nothing about editors. An editor's name appears only on a waiting row, to
 * say which video it is — Akmal has turned down staff monitoring, and this is
 * not a way round it. The approvers table is plain numbers: no ranks, no
 * medals, no red on a person.
 *
 * Times are working time, and "typical" is the median — one video stuck over
 * a long weekend would drag an average for a month.
 */

import { useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, type ApprovalsReport as Report } from '@/lib/api-v2';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatTile } from '@/components/ui/stat-tile';
import { ErrorNote } from '@/components/ui/empty-state';
import { TASK_TYPE_OPTIONS, taskTypeLabel } from '@/lib/task-type';

/** Somebody on every type approves "all work". */
const TASK_TYPE_COUNT = TASK_TYPE_OPTIONS.length;
import { cn } from '@/lib/utils';

/** 100 → "1h 40m", 45 → "45m", 120 → "2h"; nothing → "—". */
const duration = (m: number | null | undefined) => {
  if (m == null) return '—';
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  if (h && r) return `${h}h ${r}m`;
  if (h) return `${h}h`;
  return `${r}m`;
};

const PERIODS = [
  { days: 7 as const, label: 'Last 7 days' },
  { days: 30 as const, label: 'Last 30 days' },
];

export function ApprovalsReport() {
  const [days, setDays] = useState<7 | 30>(7);
  const { data, error, isPending, isPlaceholderData, refetch } = useQuery({
    queryKey: ['team', 'approvals-report', days],
    queryFn: () => api.team.approvalsReport(days),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-6">
      {/* ── The period. "Waiting now" ignores it. ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Period" className="inline-flex rounded-lg border border-border bg-white p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              type="button"
              aria-pressed={days === p.days}
              onClick={() => setDays(p.days)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40',
                days === p.days ? 'bg-primary text-white' : 'text-secondary hover:text-primary',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        {data && (
          <p className="text-xs text-secondary">
            On time means decided within {duration(data.onTimeMinutes)} of working time — the reminder setting.
          </p>
        )}
      </div>

      {error && (
        <ErrorNote onDismiss={() => void refetch()}>
          {error instanceof Error ? error.message : 'Could not load the approvals report'}
        </ErrorNote>
      )}

      {isPending ? (
        <div className="space-y-4" aria-busy="true">
          <div className="h-40 animate-pulse rounded-xl bg-subtle" />
          <div className="h-48 animate-pulse rounded-xl bg-subtle" />
        </div>
      ) : data && data.byType.length === 0 ? (
        <Card>
          <p className="text-sm text-secondary">
            No task type has approvers yet. Set them in Settings → Approvals, and this fills in as work is sent for
            approval.
          </p>
        </Card>
      ) : data ? (
        <div className={cn('space-y-6 transition-opacity', isPlaceholderData && 'opacity-60')}>
          {data.byType.map((t) => (
            <TypeCard key={t.taskType} t={t} onTimeMinutes={data.onTimeMinutes} />
          ))}
          <WaitingNow rows={data.waitingNow} />
          <Approvers rows={data.byPerson} />
        </div>
      ) : null}
    </div>
  );
}

// ── One card per type: the group's numbers ──────────────────────────────────

function TypeCard({ t, onTimeMinutes }: { t: Report['byType'][number]; onTimeMinutes: number }) {
  // Plan 2's thresholds: amber once the oldest wait is past the reminder
  // time, red once any wait has escalated.
  const waitTone = t.anyEscalated
    ? 'danger'
    : t.oldestWaitingMinutes != null && t.oldestWaitingMinutes >= onTimeMinutes
      ? 'warning'
      : 'default';
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-primary">
          {t.allWork ? 'All work' : t.taskTypes.map((x) => taskTypeLabel(x) ?? x).join(' / ')}
          <span className="font-normal text-secondary"> · approvers: {t.approvers.map((a) => a.name).join(', ')}</span>
        </h2>
      </div>
      <div className="grid grid-cols-2 gap-px bg-border lg:grid-cols-5">
        <StatTile
          frame="inset"
          className="col-span-2 lg:col-span-1"
          label="Waiting now"
          value={t.waitingNow}
          tone={waitTone}
          note={t.oldestWaitingMinutes != null ? `oldest ${duration(t.oldestWaitingMinutes)}` : 'nothing waiting'}
        />
        <StatTile
          frame="inset"
          label="Typical time"
          value={duration(t.medianDecisionMinutes)}
          note={t.decided ? `to a decision, over ${t.decided}` : 'nothing decided yet'}
        />
        <StatTile
          frame="inset"
          label="On time"
          value={t.decided ? `${t.onTime} of ${t.decided}` : '—'}
          note={`within ${duration(onTimeMinutes)}`}
        />
        <StatTile
          frame="inset"
          label="Escalated"
          value={t.escalated}
          note={`of ${t.submitted} sent`}
        />
        <StatTile
          frame="inset"
          label="Approved / sent back"
          value={`${t.approved} / ${t.changesRequested}`}
          note="decisions in the period"
        />
      </div>
    </Card>
  );
}

// ── Waiting now, oldest first ───────────────────────────────────────────────

function StatusBadge({ w }: { w: Report['waitingNow'][number] }) {
  if (w.escalatedAt) return <Badge tone="bad">Escalated</Badge>;
  if (w.remindedAt) return <Badge tone="warn">Reminded</Badge>;
  return <span className="text-secondary">—</span>;
}

const waitClass = (w: Report['waitingNow'][number]) =>
  w.escalatedAt ? 'font-semibold text-danger' : w.remindedAt ? 'font-semibold text-warning-ink' : 'text-body';

function WaitingNow({ rows }: { rows: Report['waitingNow'] }) {
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-primary">Waiting now</h2>
        <span className="text-micro text-secondary">live, whatever the period</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-secondary">Nothing waiting for approval.</p>
      ) : (
        <>
          {/* Phone: a stacked row each. */}
          <ul className="divide-y divide-border md:hidden">
            {rows.map((w) => (
              <li key={w.taskId} className="space-y-1 px-5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/my-work?task=${w.taskId}`} className="font-medium text-primary underline-offset-2 hover:underline">
                    {w.title}
                  </Link>
                  <StatusBadge w={w} />
                </div>
                <p className="text-xs text-secondary">
                  {w.clientName} · {taskTypeLabel(w.taskType) ?? w.taskType} · round {w.round} · by {w.editorName}
                </p>
                <p className={cn('text-xs', waitClass(w))}>waiting {duration(w.waitingMinutes)}</p>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="data-table w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="eyebrow text-left">Video</th>
                  <th className="eyebrow text-left">Client</th>
                  <th className="eyebrow text-left">Type</th>
                  <th className="eyebrow text-right">Round</th>
                  <th className="eyebrow text-right">Waiting for</th>
                  <th className="eyebrow text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((w) => (
                  <tr key={w.taskId} className="transition-colors hover:bg-subtle">
                    <td>
                      <Link href={`/my-work?task=${w.taskId}`} className="font-medium text-primary underline-offset-2 hover:underline">
                        {w.title}
                      </Link>
                      <span className="block text-micro text-secondary">by {w.editorName}</span>
                    </td>
                    <td className="text-secondary">{w.clientName}</td>
                    <td className="text-secondary">{taskTypeLabel(w.taskType) ?? w.taskType}</td>
                    <td className="text-right tabular-nums text-secondary">{w.round}</td>
                    <td className={cn('text-right tabular-nums', waitClass(w))}>{duration(w.waitingMinutes)}</td>
                    <td>
                      <StatusBadge w={w} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

// ── What each approver did ──────────────────────────────────────────────────

function Approvers({ rows }: { rows: Report['byPerson'] }) {
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-primary">Approvers</h2>
        <span className="text-micro text-secondary">what each person decided in the period</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-secondary">No approvers set.</p>
      ) : (
        <>
          <ul className="divide-y divide-border md:hidden">
            {rows.map((p) => (
              <li key={p.user.id} className="space-y-1 px-5 py-3">
                <p className="font-medium text-primary">{p.user.name}</p>
                <p className="text-xs text-secondary">
                  {p.approved} approved · {p.changesRequested} sent back · {p.changesAdded ?? 0} changes added · typical{' '}
                  {duration(p.medianDecisionMinutes)} · {p.afterEscalation} after escalation
                </p>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="data-table w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="eyebrow text-left">Person</th>
                  <th className="eyebrow text-right">Approved</th>
                  <th className="eyebrow text-right">Sent back</th>
                  <th className="eyebrow text-right" title="Changes added to work somebody else sent back">
                    Changes added
                  </th>
                  <th className="eyebrow text-right">Typical time</th>
                  <th className="eyebrow text-right">After escalation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((p) => (
                  <tr key={p.user.id}>
                    <td>
                      <span className="font-medium text-primary">{p.user.name}</span>
                      {p.taskTypes.length > 0 && (
                        <span className="block text-micro text-secondary">
                          {p.taskTypes.length >= TASK_TYPE_COUNT
                            ? 'All work'
                            : p.taskTypes.map((t) => taskTypeLabel(t) ?? t).join(', ')}
                        </span>
                      )}
                    </td>
                    <td className="text-right tabular-nums text-body">{p.approved}</td>
                    <td className="text-right tabular-nums text-body">{p.changesRequested}</td>
                    <td className="text-right tabular-nums text-body">{p.changesAdded ?? 0}</td>
                    <td className="text-right tabular-nums text-body">{duration(p.medianDecisionMinutes)}</td>
                    <td className="text-right tabular-nums text-body">{p.afterEscalation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
