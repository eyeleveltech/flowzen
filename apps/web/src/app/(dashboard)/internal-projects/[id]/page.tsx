'use client';

/**
 * One piece of the studio's own work, and everything filed under it.
 *
 * The Internal tab on Live work could list these and nothing more — a name and
 * a count with no way in, so the tasks under a hiring round could be seen only
 * by hunting them out of somebody's My Work one at a time.
 *
 * There are no money tiles here and there never will be: an internal project
 * carries no client, no value and no invoice, and no cost row can point at one.
 * What it has is work, so that is the whole page.
 */

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api, ApiError, formatDate } from '@/lib/api-v2';
import { useConfig, useTeamMembers } from '@/hooks/queries';
import { usePageHeader } from '@/hooks/usePageHeader';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Card, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatTile, StatRow } from '@/components/ui/stat-tile';
import { EmptyState } from '@/components/ui/empty-state';
import { NotFoundPanel } from '@/components/ui/not-found-panel';
import { NewInternalTaskModal } from '@/components/work/NewInternalTaskModal';
import { TaskDrawer, type DrawerTask } from '@/components/work/TaskDrawer';
import { getPriorityBadge, getPriorityLabel } from '@/lib/priority';
import { withDueTime } from '@/lib/due-time';
import { RepeatMark } from '@/components/work/RepeatMark';
import { useConfirmStore } from '@/stores/confirm';
import { taskTypeLabel } from '@/lib/task-type';
import { NewInternalProjectModal } from '@/components/work/NewInternalProjectModal';
import { calendarDay, daysLeftLabel, ProgressBar } from '@/components/work/InternalProjectBits';
import { plural } from '@/lib/utils';
import { changeTaskStatus } from '@/lib/task-status';

const STATUS_OPTIONS = [
  { value: 'TODO', label: 'To do' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'DONE', label: 'Done' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const STATUS_LABEL: Record<string, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  IN_REVIEW: 'In review',
  ON_HOLD: 'On hold',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
};

export default function InternalProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: config } = useConfig();
  const team = useTeamMembers();
  const confirm = useConfirmStore((st) => st.confirm);

  const [adding, setAdding] = useState(false);
  /** The edit form: name, owner, department, dates, description. */
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['internal-project', id],
    queryFn: () => api.internalProjects.get(id),
  });
  const project = data?.project;

  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: ['internal-project', id] });
    // The list on Live work counts these, so it goes stale the moment one changes.
    void queryClient.invalidateQueries({ queryKey: ['internal-projects'] });
  };

  // The tab and the bar name the work (QA19 fixes plan, small wins).
  usePageHeader(project?.name ?? 'Internal work', project?.owner?.name ? `Internal · ${project.owner.name}` : 'Internal');

  const tz = config?.organization.timezone;
  const locale = config?.organization.locale;
  const date = (v: string | null | undefined) => formatDate(v, tz, locale, true);
  const canWrite = config?.me.permissions?.includes('work.all') ?? false;

  const changeStatus = async (task: any, next: string) => {
    setBusyId(task.id);
    try {
      // On hold through /wait, asking what it is waiting on — internal work
      // has no client unless the task is about one (`hasClient`, QA19 F06).
      if (!(await changeTaskStatus(task, next))) return;
      reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not change that');
    } finally {
      setBusyId(null);
    }
  };

  /** Close it, or open it again. Its tasks stay where they are. */
  const setProjectStatus = async (status: 'ACTIVE' | 'DONE') => {
    if (!project) return;
    try {
      await api.internalProjects.update(project.id, { status });
      toast.success(status === 'DONE' ? `${project.name} marked done` : `${project.name} reopened`);
      reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not change that');
    }
  };

  /**
   * Only an empty one, and the server enforces it too — anything that has held
   * work is marked done instead, so the record of where that work sat survives.
   */
  const removeProject = async () => {
    if (!project) return;
    const ok = await confirm({
      title: `Delete ${project.name}?`,
      message: 'Nothing has been filed under it, so nothing is lost.',
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.internalProjects.remove(project.id);
      toast.success(`${project.name} deleted`);
      void queryClient.invalidateQueries({ queryKey: ['internal-projects'] });
      router.push('/live-work?tab=internal');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not delete that');
    }
  };

  // Nothing to show once the load has settled. A background refresh that
  // fails keeps the page it already has.
  if (!isPending && !project) {
    return (
      <NotFoundPanel
        thing="internal project"
        error={error}
        back={{ href: '/live-work?tab=internal', label: 'Back to Internal work' }}
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <div className="page-shell">
      {/* Internal work › the project — back to the Internal tab, not Live work's default. */}
      <Breadcrumbs
        items={[{ label: 'Internal work', href: '/live-work?tab=internal' }, { label: project?.name ?? 'Loading…' }]}
      />

      {isPending || !project ? (
        <p className="text-sm text-secondary">Loading…</p>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-semibold text-primary">{project.name}</h1>
                <Badge tone={project.status === 'ACTIVE' ? 'good' : 'neutral'}>
                  {project.status === 'ACTIVE' ? 'Active' : 'Done'}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-secondary">
                {project.description || 'The studio’s own work — no client, no billing.'}
              </p>
              {/* Who, which team, and when — each said once. */}
              {(() => {
                const left = daysLeftLabel(project.progress, project.status);
                return (
                  <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                    <div>
                      <dt className="eyebrow">Owner</dt>
                      <dd className="mt-0.5 text-body">{project.owner?.name ?? 'Nobody named'}</dd>
                    </div>
                    <div>
                      <dt className="eyebrow">Department</dt>
                      <dd className="mt-0.5 text-body">{project.department?.name ?? 'None'}</dd>
                    </div>
                    <div>
                      <dt className="eyebrow">Dates</dt>
                      <dd className="mt-0.5 text-body">
                        {project.startDate ? `${calendarDay(project.startDate)} → ` : ''}
                        {project.targetDate ? calendarDay(project.targetDate, true) : 'No target date'}
                        {left && (
                          <span
                            className={
                              left.tone === 'bad'
                                ? 'font-semibold text-danger'
                                : left.tone === 'warn'
                                  ? 'font-semibold text-warning-ink'
                                  : 'text-secondary'
                            }
                          >
                            {' '}
                            · {left.text}
                          </span>
                        )}
                      </dd>
                    </div>
                  </dl>
                );
              })()}
            </div>
            {canWrite && (
              <div className="flex shrink-0 items-center gap-2">
                {project.taskCounts.total === 0 && (
                  <button
                    type="button"
                    onClick={() => void removeProject()}
                    aria-label={`Delete ${project.name}`}
                    title="Delete"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-danger-tint hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-body transition-colors hover:bg-subtle"
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>
                <button
                  type="button"
                  onClick={() => void setProjectStatus(project.status === 'DONE' ? 'ACTIVE' : 'DONE')}
                  className="flex h-8 items-center rounded-lg border border-border px-3 text-sm font-medium text-body transition-colors hover:bg-subtle"
                >
                  {project.status === 'DONE' ? 'Reopen' : 'Mark done'}
                </button>
                {project.status === 'ACTIVE' && (
                  <button
                    type="button"
                    onClick={() => setAdding(true)}
                    className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
                  >
                    <Plus className="h-4 w-4" /> New task
                  </button>
                )}
              </div>
            )}
          </div>

          {/* How it is going: % done, what is open and late, and what is next. */}
          <StatRow className="mb-4">
            <StatTile
              dense
              label="Done"
              value={project.progress.percentDone === null ? '—' : `${project.progress.percentDone}%`}
              note={
                project.progress.total === 0
                  ? 'no tasks yet'
                  : `${project.progress.done} of ${plural(project.progress.total, 'task')}`
              }
            />
            <StatTile dense label="Open" value={project.progress.open} note="still to do" />
            <StatTile
              dense
              label="Overdue"
              value={project.progress.overdue}
              note={project.progress.overdue > 0 ? 'past their due date' : 'nothing overdue'}
              tone={project.progress.overdue > 0 ? 'danger' : 'default'}
            />
            <StatTile
              dense
              label="Next due"
              value={project.progress.nextDue ? calendarDay(project.progress.nextDue.dueDate) : '—'}
              note={project.progress.nextDue?.title ?? 'nothing open'}
            />
          </StatRow>
          <div className="mb-8 space-y-3">
            <ProgressBar progress={project.progress} />
            {/* Everyone with open work in it — by name, with how many are theirs. */}
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="eyebrow">People on this</span>
              {project.progress.people.length === 0 ? (
                <span className="text-secondary">Nobody has open work in it.</span>
              ) : (
                project.progress.people.map((person: { id: string; name: string; open: number }) => (
                  <span
                    key={person.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-0.5 text-xs text-body"
                  >
                    {person.name}
                    <span className="tabular-nums text-secondary">{person.open} open</span>
                  </span>
                ))
              )}
            </div>
          </div>

          <Card padding="none">
            <CardBody className="p-0">
              {project.tasks.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="Nothing filed under this yet"
                    hint="Add a task here, or move an existing internal task into it from the task itself."
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full data-table text-sm">
                    <thead>
                      <tr className="border-b border-border bg-subtle">
                        <th className="eyebrow text-left">Task</th>
                        <th className="eyebrow text-left">Type of work</th>
                        <th className="eyebrow text-left">Who</th>
                        <th className="eyebrow text-left">Priority</th>
                        <th className="eyebrow text-left">Due</th>
                        <th className="eyebrow text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {project.tasks.map((t: any) => (
                        <tr
                          key={t.id}
                          className="cursor-pointer transition-colors hover:bg-subtle"
                          onClick={() => setSelected(t)}
                        >
                          <td className="font-medium text-primary">
                            {t.title} <RepeatMark repeat={t.repeat} />
                          </td>
                          <td className="whitespace-nowrap text-secondary">{taskTypeLabel(t.taskType) ?? '—'}</td>
                          <td className="text-secondary">
                            {t.assignee?.name ?? '—'}
                            {t.assignee?.designation && (
                              <span className="block text-micro text-secondary">{t.assignee.designation}</span>
                            )}
                          </td>
                          <td>
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-micro font-semibold tracking-[0.03em] ${getPriorityBadge(t.priority)}`}
                            >
                              {getPriorityLabel(t.priority)}
                            </span>
                          </td>
                          {/* Late is said on the row it applies to, not only counted in a tile. */}
                          <td className={t.isOverdue ? 'font-semibold text-danger' : 'text-secondary'}>
                            {withDueTime(date(t.dueDate), t.dueTime)}
                          </td>
                          <td className="text-secondary">{STATUS_LABEL[t.status] ?? t.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        </>
      )}

      {project && (
        <NewInternalProjectModal
          open={editing}
          project={project}
          onClose={() => setEditing(false)}
          onCreated={() => {
            setEditing(false);
            reload();
          }}
        />
      )}

      {project && (
        <NewInternalTaskModal
          open={adding}
          project={{ id: project.id, name: project.name }}
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            reload();
          }}
        />
      )}

      <TaskDrawer
        // The task as the project has it now — a status change or an edit made
        // in the drawer shows in it as soon as the project refetches.
        task={
          (selected
            ? ((project?.tasks ?? []).find((t: any) => t.id === selected.id) ?? selected)
            : null) as DrawerTask | null
        }
        statusOptions={STATUS_OPTIONS}
        busy={busyId === selected?.id}
        onClose={() => setSelected(null)}
        onStatusChange={(t, next) => void changeStatus(t, next)}
        onChanged={reload}
      />
    </div>
  );
}
