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
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api, fileUrl, formatDate } from '@/lib/api-v2';
import { useConfig, useDepartments, useTeamMembers } from '@/hooks/queries';
import { usePageHeader } from '@/hooks/usePageHeader';
import { TeamScopeLine } from '@/components/work/TeamScopeLine';
import { StatTile, StatRow } from '@/components/ui/stat-tile';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { MultiSelect } from '@/components/ui/multi-select';
import { Button } from '@/components/ui/button';
import { ExportCsvButton } from '@/components/ui/export-csv-button';
import { ErrorNote } from '@/components/ui/empty-state';
import { TableRowsSkeleton } from '@/components/ui/skeleton-loaders';
import { SortableTH, type SortDir } from '@/components/ui/table';
import { Select } from '@/components/ui/select';
import { InlineDueDate } from '@/components/work/InlineDueDate';
import { statusChoices } from '@/components/retainers/task-shared';
import { changeTaskStatus } from '@/lib/task-status';
import toast from 'react-hot-toast';
import { TaskDrawer, type DrawerTask } from '@/components/work/TaskDrawer';
import { getInitials, getAvatarColor } from '@/lib/utils';
import { personOption } from '@/lib/people';
import { RepeatMark } from '@/components/work/RepeatMark';
import type { TaskRepeatInfo } from '@/lib/repeat';
import { TASK_TYPE_OPTIONS, taskTypeLabel } from '@/lib/task-type';

const STATUS_OPTIONS = [
  /*
   * The default, and not a status in the database.
   *
   * Due-date order with everything included opened the screen on work
   * delivered in June. What a head of department came to see is what is still
   * owed, which spans To do, In progress, In review and On hold — the server
   * reads this one value as all four, and it can be ticked alongside Done, which is how
   * "everything except cancelled" gets asked for.
   */
  { value: 'UNFINISHED', label: 'Unfinished' },
  { value: 'TODO', label: 'To do' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'IN_REVIEW', label: 'In review' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'DONE', label: 'Done' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

/** The drawer's own list: real statuses only, so it cannot set "Unfinished". */
const DRAWER_STATUS_OPTIONS = STATUS_OPTIONS.filter((o) => o.value && o.value !== 'UNFINISHED');

const STATUS_TONE: Record<string, string> = {
  TODO: 'border-border text-secondary',
  IN_PROGRESS: 'border-info/30 text-info bg-info-tint',
  IN_REVIEW: 'border-review/30 text-review bg-review-tint',
  ON_HOLD: 'border-warning/30 text-warning-ink bg-warning-tint',
  DONE: 'border-success/30 text-success bg-success-tint',
  CANCELLED: 'border-border text-secondary',
};

/** The columns a click on the header sorts by — the server's names for them. */
type SortKey = 'assigned' | 'task' | 'type' | 'for' | 'who' | 'due' | 'status' | 'elapsed';
const DEFAULT_SORT: { key: SortKey; dir: SortDir } = { key: 'due', dir: 'asc' };

type Task = {
  id: string;
  title: string;
  status: string;
  priority: string;
  /** Type of work — Design, Video… — or null when nobody gave it one. */
  taskType?: string | null;
  dueDate: string;
  /** Optional, "17:30" — shown after the date. */
  dueTime?: string | null;
  assignees: { id: string; name: string; designation?: string | null; dept?: string | null }[];
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
  /** Approval-flagged work reaches Done through Approve, not the menu. */
  needsApproval?: boolean;
  /** The repeat, if it is a copy in one — the small mark beside the title. */
  repeat?: TaskRepeatInfo | null;
};

export default function AllWorkPage() {
  const { data: config } = useConfig();
  const team = useTeamMembers();
  // The one department list, in Settings' order; filtered by id.
  const { departments } = useDepartments();

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
  const [clients, setClients] = useState<string[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [q, setQ] = useState('');
  const [openTask, setOpenTask] = useState<Task | null>(null);
  /** The row whose status is being changed — its menu waits for the answer. */
  const [busyId, setBusyId] = useState<string | null>(null);
  // Due date, oldest first, until a header is clicked. Clicking the same
  // header again flips it.
  const [sort, setSort] = useState(DEFAULT_SORT);
  const sortBy = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

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
    // Ids, so a name with a comma in it is still one department.
    if (depts.length > 0) p.departmentId = depts.join(',');
    if (clients.length > 0) p.companyId = clients.join(',');
    if (projects.length > 0) p.project = projects.join(',');
    if (statuses.length > 0) p.status = statuses.join(',');
    if (types.length > 0) p.taskType = types.join(',');
    if (overdueOnly) p.overdue = '1';
    if (q.trim()) p.q = q.trim();
    if (sort.key !== DEFAULT_SORT.key || sort.dir !== DEFAULT_SORT.dir) {
      p.sort = sort.key;
      p.dir = sort.dir;
    }
    return p;
  }, [assigneeIds, depts, clients, projects, statuses, types, overdueOnly, q, sort]);

  const { data, isPending, isPlaceholderData, error, refetch } = useQuery({
    queryKey: ['all-work', params],
    queryFn: () => api.tasks.all(params),
    staleTime: 30_000,
    // The rows stay on screen while a new sort or filter loads, rather than
    // blanking to a skeleton on every click.
    placeholderData: keepPreviousData,
  });

  const tasks = (data?.tasks ?? []) as Task[];

  // Right on the row, or from the drawer — the same call either way.
  const setStatus = async (t: { id: string; status: string }, next: string) => {
    if (next === t.status) return;
    setBusyId(t.id);
    try {
      await changeTaskStatus(t, next);
      toast.success(`Moved to ${STATUS_OPTIONS.find((o) => o.value === next)?.label ?? next}`);
      void refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not change the status');
    } finally {
      setBusyId(null);
    }
  };
  const counts = data?.counts ?? { total: 0, open: 0, waiting: 0, overdue: 0, unassigned: 0 };

  usePageHeader('All tasks', `${counts.total} shown`);

  /*
   * The projects on offer, narrowed to the clients already picked.
   *
   * "Carlton Wellness" then "which of their projects" is the usual order, and
   * a list of every project in the agency under a client filter is forty rows
   * to scroll for three. Anything already ticked stays, so narrowing the
   * client never silently hides a project the list is still filtered on.
   */
  const projectOptions = useMemo(() => {
    const all = (data?.projects ?? []) as { value: string; name: string; client: string; companyId: string | null }[];
    const inClients = (o: (typeof all)[number]) =>
      clients.length === 0 ||
      (o.companyId ? clients.includes(o.companyId) : clients.includes('INTERNAL')) ||
      projects.includes(o.value);
    return all.filter(inClients).map((o) => ({ value: o.value, label: o.name, sublabel: o.client }));
  }, [data?.projects, clients, projects]);

  const filtered =
    assigneeIds.length > 0 ||
    depts.length > 0 ||
    clients.length > 0 ||
    projects.length > 0 ||
    types.length > 0 ||
    overdueOnly ||
    q.trim().length > 0 ||
    !(statuses.length === 1 && statuses[0] === 'UNFINISHED');

  // The row as the list has it now, not as it was clicked — an edit or a
  // status change shows in the open drawer as soon as the list refetches.
  const current = openTask ? (tasks.find((t) => t.id === openTask.id) ?? openTask) : null;
  const drawerTask: DrawerTask | null = current
    ? {
        ...current,
        assignee: current.assignees[0] ?? null,
        clientHref: current.companyId ? `/companies/${current.companyId}` : null,
        workLabel: current.projectName ?? (current.monthCardMonth ? `Retainer · ${current.monthCardMonth}` : null),
        workHref: current.projectId
          ? `/projects/${current.projectId}`
          : current.retainerId
            ? `/retainers/${current.retainerId}`
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

      {/* A Head sees their departments' work; this says so. */}
      <TeamScopeLine />

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
              The department records, edited in Settings → Departments — the
              same list every screen offers, chosen by id.
            */}
            <MultiSelect
              ariaLabel="Filter by department"
              value={depts}
              onChange={setDepts}
              placeholder="Any department"
              options={departments.map((d) => ({ value: d.id, label: d.name }))}
            />
          </div>
          <div className="w-48">
            <span className="eyebrow mb-1.25 block">Client</span>
            {/*
              Internal first, and deliberately: work with no client — the
              showreel, our own site — is the one thing nobody is looking for
              by name, and burying it under twenty company names is how it
              goes unnoticed. The list holds the clients that actually have
              work, taken from every task rather than the filtered ones.
            */}
            <MultiSelect
              ariaLabel="Filter by client"
              value={clients}
              onChange={setClients}
              placeholder="Any client"
              options={[
                ...(data?.hasInternal ? [{ value: 'INTERNAL', label: 'Internal' }] : []),
                ...((data?.clients ?? []) as { id: string; name: string }[]).map((c) => ({
                  value: c.id,
                  label: c.name,
                })),
              ]}
            />
          </div>
          <div className="w-52">
            <span className="eyebrow mb-1.25 block">Project</span>
            <MultiSelect
              ariaLabel="Filter by project"
              value={projects}
              onChange={setProjects}
              placeholder="Any project"
              options={projectOptions}
            />
          </div>
          <div className="w-48">
            <span className="eyebrow mb-1.25 block">Type of work</span>
            <MultiSelect
              ariaLabel="Filter by type of work"
              value={types}
              onChange={setTypes}
              placeholder="Any type"
              options={[...TASK_TYPE_OPTIONS, { value: 'NONE', label: 'Not set' }]}
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
                <SortableTH label="Assigned" column="assigned" sort={sort} onSort={sortBy} />
                <SortableTH label="Task" column="task" sort={sort} onSort={sortBy} />
                <SortableTH label="Type of work" column="type" sort={sort} onSort={sortBy} />
                <SortableTH label="For" column="for" sort={sort} onSort={sortBy} />
                <SortableTH label="Who" column="who" sort={sort} onSort={sortBy} />
                <SortableTH label="Due" column="due" sort={sort} onSort={sortBy} />
                <SortableTH label="Status" column="status" sort={sort} onSort={sortBy} />
                <SortableTH label="Elapsed" column="elapsed" sort={sort} onSort={sortBy} align="right" />
              </tr>
            </thead>
            <tbody className={`divide-y divide-border transition-opacity ${isPlaceholderData ? 'opacity-60' : ''}`}>
              {isPending && <TableRowsSkeleton rows={6} cols={8} />}
              {!isPending && tasks.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-sm text-secondary">
                    {filtered ? 'Nothing matches those filters.' : 'No work on anybody’s plate.'}
                  </td>
                </tr>
              )}
              {tasks.map((t) => (
                <tr
                  key={t.id}
                  className="group/row cursor-pointer transition-colors hover:bg-subtle"
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
                    </button>{' '}
                    <RepeatMark repeat={t.repeat} />
                  </td>
                  <td className="whitespace-nowrap text-secondary">{taskTypeLabel(t.taskType) ?? '—'}</td>
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
                          {/* Their department, then what they are called —
                              not what the app lets them do (lib/people.ts).
                              Together they answer "should this person be
                              carrying this?" at a glance. The job title is
                              left off when it only repeats the department
                              ("Digital Marketing · Digital Marketing"). */}
                          {(() => {
                            const a = t.assignees[0];
                            const line = [
                              a.dept,
                              a.designation && a.designation.toLowerCase() !== a.dept?.toLowerCase() ? a.designation : null,
                            ].filter(Boolean);
                            return line.length > 0 ? (
                              <span className="block truncate text-micro text-secondary" title={line.join(' · ')}>
                                {line.join(' · ')}
                              </span>
                            ) : null;
                          })()}
                        </span>
                      </div>
                    )}
                  </td>
                  {/* Click the date to move it, or pick a status, without opening the task. */}
                  <td className={t.isOverdue ? 'font-semibold text-danger' : t.isToday ? 'font-semibold text-primary' : 'text-secondary'}>
                    <InlineDueDate
                      taskId={t.id}
                      title={t.title}
                      value={t.dueDate}
                      time={t.dueTime}
                      disabled={t.status === 'DONE' || t.status === 'CANCELLED'}
                      format={(v) => formatDate(v, config?.organization.timezone, config?.organization.locale)}
                    />
                    {t.isOverdue && <span className="block text-micro">overdue</span>}
                    {t.isToday && <span className="block text-micro">today</span>}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <Select
                      value={t.status}
                      onChange={(v) => void setStatus(t, v)}
                      options={statusChoices(DRAWER_STATUS_OPTIONS, t)}
                      ariaLabel={`Status for ${t.title}`}
                      buttonClassName={`px-2.5 py-1.5 text-xs w-32 ${STATUS_TONE[t.status] ?? ''}`}
                      disabled={busyId === t.id}
                    />
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
          await setStatus(t, next);
          setOpenTask(null);
        }}
        onChanged={() => void refetch()}
      />
    </div>
  );
}
