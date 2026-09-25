'use client';

/**
 * Every task in the agency, for the people who run the work.
 *
 * ─── Why this screen exists ─────────────────────────────────────────────────
 *
 * My Work answers "what am I doing". A project or a retainer month answers
 * "what is happening on this one job". Nothing answered the question a head of
 * department or the management actually asks, which is about PEOPLE rather than
 * jobs: what is the team carrying right now, who is behind, and what is stuck
 * waiting on somebody else.
 *
 * The only way to it was opening fourteen drawers one at a time, or asking in
 * the morning meeting — which is how work goes missing between a designer who
 * thinks it is with the client and an account manager who thinks it is in
 * design.
 *
 * ─── Who sees it ────────────────────────────────────────────────────────────
 *
 * `work.all`, which is exactly Head and Management and nobody else — the same
 * switch that opens Live work and a project. BD and Accounts do not get a list
 * of what everybody is doing, and an Employee has My Work.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api, fileUrl, formatDate } from '@/lib/api-v2';
import { useConfig, useTeamMembers } from '@/hooks/queries';
import { usePageHeader } from '@/hooks/usePageHeader';
import { StatTile, StatRow } from '@/components/ui/stat-tile';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { MultiSelect } from '@/components/ui/multi-select';
import { Button } from '@/components/ui/button';
import { ExportCsvButton } from '@/components/ui/export-csv-button';
import { ErrorNote } from '@/components/ui/empty-state';
import { TableRowsSkeleton } from '@/components/ui/skeleton-loaders';
import { TaskDrawer, type DrawerTask } from '@/components/work/TaskDrawer';
import { getInitials, getAvatarColor } from '@/lib/utils';
import { personOption } from '@/lib/people';

const STATUS_OPTIONS = [
  /*
   * The default, and not a status in the database.
   *
   * Due-date order with everything included opened the screen on work
   * delivered in June. What a head of department came to see is what is still
   * owed, which spans To do, In progress and On hold — the server reads this
   * one value as all three, and it can be ticked alongside Done, which is how
   * "everything except cancelled" gets asked for.
   */
  { value: 'UNFINISHED', label: 'Unfinished' },
  { value: 'TODO', label: 'To do' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'DONE', label: 'Done' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

/** The drawer's own list: real statuses only, so it cannot set "Unfinished". */
const DRAWER_STATUS_OPTIONS = STATUS_OPTIONS.filter((o) => o.value && o.value !== 'UNFINISHED');

const STATUS_TONE: Record<string, string> = {
  TODO: 'border-border text-secondary',
  IN_PROGRESS: 'border-info/30 text-info bg-info-tint',
  ON_HOLD: 'border-warning/30 text-warning-ink bg-warning-tint',
  DONE: 'border-success/30 text-success bg-success-tint',
  CANCELLED: 'border-border text-secondary',
};

type Task = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string;
  assignees: { id: string; name: string; designation?: string | null }[];
  assignedAt: string | null;
  clientName: string | null;
  companyId: string | null;
  projectId: string | null;
  projectName: string | null;
  monthCardMonth: string | null;
  retainerId: string | null;
  workingHoursText: string | null;
  isOverdue: boolean;
  isToday: boolean;
};

export default function AllWorkPage() {
  const { data: config } = useConfig();
  const team = useTeamMembers();
  const departments = config?.organization.departments ?? [];

  /*
   * Lists, not single values.
   *
   * "How are Design and Content doing this week" and "what are these two
   * carrying between them" are the normal questions, and a one-at-a-time filter
   * makes somebody run the screen twice and add up in their head.
   */
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [depts, setDepts] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>(['UNFINISHED']);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [q, setQ] = useState('');
  const [openTask, setOpenTask] = useState<Task | null>(null);

  /*
   * The filters ARE the query key.
   *
   * Filtering in the browser would mean holding every task in memory and
   * quietly lying about the counts once the list is capped. The server already
   * knows how to narrow this, and the counts come back describing what was
   * actually asked for.
   */
  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (assigneeIds.length > 0) p.assigneeId = assigneeIds.join(',');
    if (depts.length > 0) p.dept = depts.join(',');
    if (statuses.length > 0) p.status = statuses.join(',');
    if (overdueOnly) p.overdue = '1';
    if (q.trim()) p.q = q.trim();
    return p;
  }, [assigneeIds, depts, statuses, overdueOnly, q]);

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['all-work', params],
    queryFn: () => api.tasks.all(params),
    staleTime: 30_000,
  });

  const tasks = (data?.tasks ?? []) as Task[];
  const counts = data?.counts ?? { total: 0, open: 0, waiting: 0, overdue: 0, unassigned: 0 };

  usePageHeader('All tasks', `${counts.total} shown`);

  const filtered =
    assigneeIds.length > 0 ||
    depts.length > 0 ||
    overdueOnly ||
    q.trim().length > 0 ||
    !(statuses.length === 1 && statuses[0] === 'UNFINISHED');

  const drawerTask: DrawerTask | null = openTask
    ? {
        ...openTask,
        assignee: openTask.assignees[0] ?? null,
        clientHref: openTask.companyId ? `/companies/${openTask.companyId}` : null,
        workLabel: openTask.projectName ?? (openTask.monthCardMonth ? `Retainer · ${openTask.monthCardMonth}` : null),
        workHref: openTask.projectId
          ? `/projects/${openTask.projectId}`
          : openTask.retainerId
            ? `/retainers/${openTask.retainerId}`
            : null,
      }
    : null;

  return (
    <div className="page-shell space-y-6">
      {error && (
        <ErrorNote onDismiss={() => void refetch()}>
          {error instanceof Error ? error.message : 'Could not load the work'}
        </ErrorNote>
      )}

      <StatRow>
        <StatTile label="Open" value={counts.open} note="still owed" />
        <StatTile label="Overdue" value={counts.overdue} note="past the date" tone={counts.overdue > 0 ? 'danger' : undefined} />
        <StatTile label="On hold" value={counts.waiting} note="waiting on somebody" />
        <StatTile label="Nobody on it" value={counts.unassigned} note="no assignee" tone={counts.unassigned > 0 ? 'warning' : undefined} />
      </StatRow>

      <Card padding="none">
        {/* ── What you are looking at ── */}
        <div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
          <Field
            label="Search"
            className="min-w-[12rem] flex-1"
            value={q}
            onChange={setQ}
            placeholder="Find a task by name…"
          />
          <div className="w-48">
            <span className="eyebrow mb-1.25 block" id="filter-person">
              Person
            </span>
            <MultiSelect
              ariaLabel="Filter by person"
              value={assigneeIds}
              onChange={setAssigneeIds}
              placeholder="Anybody"
              options={team.map((m) => personOption(m))}
            />
          </div>
          <div className="w-48">
            <span className="eyebrow mb-1.25 block">Department</span>
            {/*
              The organisation's list, edited in Settings — the same source the
              member edit form and the invite form read, so a department added
              there can be filtered by here without anybody being moved first.
            */}
            <MultiSelect
              ariaLabel="Filter by department"
              value={depts}
              onChange={setDepts}
              placeholder="Any department"
              options={departments.map((d) => ({ value: d, label: d }))}
            />
          </div>
          <div className="w-44">
            <span className="eyebrow mb-1.25 block">Status</span>
            <MultiSelect
              ariaLabel="Filter by status"
              value={statuses}
              onChange={setStatuses}
              placeholder="Any status"
              options={STATUS_OPTIONS.filter((o) => o.value)}
            />
          </div>
          <Button
            type="button"
            variant={overdueOnly ? 'primary' : 'secondary'}
            onClick={() => setOverdueOnly((v) => !v)}
            aria-pressed={overdueOnly}
          >
            Overdue only
          </Button>
          <ExportCsvButton href={fileUrl(`/tasks/all?format=csv&${new URLSearchParams(params)}`)} />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full data-table">
            <thead>
              <tr className="border-b border-border bg-subtle">
                <th className="eyebrow text-left">Assigned</th>
                <th className="eyebrow text-left">Task</th>
                <th className="eyebrow text-left">For</th>
                <th className="eyebrow text-left">Who</th>
                <th className="eyebrow text-left">Due</th>
                <th className="eyebrow text-left">Status</th>
                <th className="eyebrow text-right">Elapsed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isPending && <TableRowsSkeleton rows={6} cols={6} />}
              {!isPending && tasks.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-sm text-secondary">
                    {filtered ? 'Nothing matches those filters.' : 'No work on anybody’s plate.'}
                  </td>
                </tr>
              )}
              {tasks.map((t) => (
                <tr
                  key={t.id}
                  className="cursor-pointer transition-colors hover:bg-subtle"
                  onClick={() => setOpenTask(t)}
                >
                  {/* When it landed on their plate, first: read down the
                      column against Due and the question answers itself —
                      two days to do it, or two weeks. */}
                  <td className="whitespace-nowrap text-secondary">
                    {t.assignedAt
                      ? formatDate(t.assignedAt, config?.organization.timezone, config?.organization.locale)
                      : '—'}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="rounded-sm text-left text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      {t.title}
                    </button>
                  </td>
                  <td className="text-secondary">
                    {t.companyId ? (
                      <Link
                        href={`/companies/${t.companyId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded-sm hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        {t.clientName}
                      </Link>
                    ) : (
                      t.clientName
                    )}
                    {/* The job by name — a one-off project or the stream of
                        work inside a retainer. Not the billing month, which is
                        what this said before and is not what the work is. */}
                    {t.projectName && (
                      <span className="block text-micro text-secondary">{t.projectName}</span>
                    )}
                  </td>
                  <td>
                    {t.assignees.length === 0 ? (
                      <span className="text-micro font-medium text-warning-ink">Nobody</span>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        {/* Faces rather than a list of names: the column is
                            scanned for "who is carrying too much", not read. */}
                        {t.assignees.slice(0, 3).map((a) => (
                          <span
                            key={a.id}
                            title={a.name}
                            className={`flex h-6 w-6 items-center justify-center rounded-full text-micro font-bold ${getAvatarColor(a.name)}`}
                          >
                            {getInitials(a.name)}
                          </span>
                        ))}
                        <span className="min-w-0">
                          <span className="block truncate text-xs text-primary">
                            {t.assignees[0].name}
                            {t.assignees.length > 1 ? ` +${t.assignees.length - 1}` : ''}
                          </span>
                          {/* What they are called, not what the app lets them
                              do — see lib/people.ts. It answers "should this
                              person be carrying this?" at a glance. */}
                          {t.assignees[0].designation && (
                            <span className="block truncate text-micro text-secondary">
                              {t.assignees[0].designation}
                            </span>
                          )}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className={t.isOverdue ? 'font-semibold text-danger' : t.isToday ? 'font-semibold text-primary' : 'text-secondary'}>
                    {formatDate(t.dueDate, config?.organization.timezone, config?.organization.locale)}
                    {t.isOverdue && <span className="block text-micro">overdue</span>}
                    {t.isToday && <span className="block text-micro">today</span>}
                  </td>
                  <td>
                    <span className={`rounded border px-2 py-0.5 text-micro font-medium ${STATUS_TONE[t.status] ?? 'border-border text-secondary'}`}>
                      {STATUS_OPTIONS.find((o) => o.value === t.status)?.label ?? t.status}
                    </span>
                  </td>
                  <td className="text-right text-secondary">{t.workingHoursText ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <TaskDrawer
        task={drawerTask}
        statusOptions={DRAWER_STATUS_OPTIONS}
        team={team}
        onClose={() => setOpenTask(null)}
        onStatusChange={async (t, next) => {
          await api.tasks.updateStatus(t.id, next);
          setOpenTask(null);
          void refetch();
        }}
        onChanged={() => void refetch()}
      />
    </div>
  );
}
