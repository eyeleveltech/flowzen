'use client';

/**
 * One piece of retainer work, on its own page.
 *
 * ─── Why it is not a drill-in any more ──────────────────────────────────────
 *
 * This lived inside `retainers/[id]`, swapping that page's body out while
 * keeping its header, its four month-card tiles and its tabs. So reaching a
 * task meant scrolling past roughly 440px of someone else's chrome, twice: the
 * retainer's, then the project's own.
 *
 * It also meant two month controls on one screen. The retainer's header month
 * decides which card is billed; the list needed a month too, and when a
 * project had no work in the month the page was on, the two disagreed —
 * October in the header, September in the table, under tiles counting October.
 *
 * On its own page there is one month, and it belongs to the work you are
 * looking at. The money stays where it belongs, on the retainer.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import toast from 'react-hot-toast';

import { api, ApiError, type RetainerProject } from '@/lib/api-v2';
import { useTeamMembers } from '@/hooks/queries';
import { useAuthStore } from '@/stores';
import { useConfirmStore } from '@/stores/confirm';
import { useWorkCacheNudge } from '@/hooks/useWorkCacheNudge';
import { cn, plural } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { EmptyState } from '@/components/ui/empty-state';
import { PageSkeleton } from '@/components/ui/skeleton-loaders';
import { TaskDrawer, type DrawerTask } from '@/components/work/TaskDrawer';
import { NewWorkTaskModal } from '@/components/work/NewWorkTaskModal';
import { RetainerProjectModal } from '@/components/work/RetainerProjectModal';
import { getPriorityDot, getPriorityLabel } from '@/lib/priority';
import { formatDate } from '@/lib/api-v2';
import {
  TASK_STATUS_OPTIONS,
  TASK_FILTER_OPTIONS,
  matchesStatusFilter,
  isTaskLate,
  monthLabel,
  currentMonth,
  describeRun,
  type ProjectTaskView,
  type RetainerTask,
  type TaskStatusValue,
} from '@/components/retainers/task-shared';

export default function RetainerProjectPage() {
  const { id, projectId } = useParams<{ id: string; projectId: string }>();
  const router = useRouter();
  const team = useTeamMembers();
  const { user: me } = useAuthStore();
  const confirm = useConfirmStore((st) => st.confirm);
  const nudgeWorkCaches = useWorkCacheNudge();

  const [view, setView] = useState<ProjectTaskView | null>(null);
  const [companyName, setCompanyName] = useState('');
  /* The task form fetches the company's month cards and projects to build its
     "Belongs to" options, so it needs the id even when it will not ask. */
  const [companyId, setCompanyId] = useState('');
  const [projects, setProjects] = useState<RetainerProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** The month this page is on. Its own — nothing else on the screen has one. */
  const [month, setMonth] = useState(currentMonth());
  const [allMonths, setAllMonths] = useState(false);
  const [monthCardId, setMonthCardId] = useState<string | null>(null);
  const [monthClosed, setMonthClosed] = useState(false);

  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [mineOnly, setMineOnly] = useState(false);

  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addingTask, setAddingTask] = useState(false);
  const [editing, setEditing] = useState(false);

  const todayStr = new Date().toISOString().slice(0, 10);

  const load = useCallback(async () => {
    try {
      const [tasks, retainer] = await Promise.all([
        api.retainers.projectTasks(id, projectId),
        api.retainers.get(id),
      ]);
      setView(tasks as unknown as ProjectTaskView);
      setCompanyName((retainer as any).retainer?.company?.name ?? '');
      setCompanyId((retainer as any).retainer?.companyId ?? (retainer as any).retainer?.company?.id ?? '');
      setProjects((retainer as any).retainer?.projects ?? []);
      setError(null);
      nudgeWorkCaches();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this project');
    } finally {
      setLoading(false);
    }
  }, [id, projectId, nudgeWorkCaches]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * The month card is what a new task attaches to, and what says whether the
   * month is shut. Loaded separately because it changes with the stepper while
   * the project's tasks do not.
   */
  const loadMonthCard = useCallback(async () => {
    try {
      const res = await api.retainers.getMonthCard(id, month);
      const card = (res as any).monthCard;
      setMonthCardId(card?.id ?? null);
      setMonthClosed(card?.status === 'CLOSED');
    } catch {
      setMonthCardId(null);
      setMonthClosed(false);
    }
  }, [id, month]);

  useEffect(() => {
    void loadMonthCard();
  }, [loadMonthCard]);

  const project = view?.project ?? null;
  const projectMonths = view?.months ?? [];

  /** Every task in view, carrying the month it is billed on. */
  const scoped = projectMonths
    .filter((g) => allMonths || g.month === month)
    .flatMap((g) => g.tasks.map((task) => ({ task, month: g.month, closed: g.status === 'CLOSED' })));

  const lateCount = scoped.filter((r) => isTaskLate(r.task, todayStr)).length;

  const visible = scoped.filter(({ task }) => {
    if (!matchesStatusFilter(task, statusFilter, todayStr)) return false;
    if (mineOnly && me?.id) {
      const onIt = task.assignee?.id === me.id || (task.assignees ?? []).some((a) => a.id === me.id);
      if (!onIt) return false;
    }
    return true;
  });

  /*
   * The drawer needs more than the task row carries.
   *
   * Which client, which month pays for it, and which piece of work it is part
   * of — all context this page has and the task record does not. Without it
   * the drawer says "Work" and stops, which is what it did before anyone
   * noticed a task opened inside a campaign never named the campaign.
   */
  const openRow = scoped.find((r) => r.task.id === openTaskId) ?? null;
  const openTask: DrawerTask | null = openRow
    ? ({
        ...openRow.task,
        clientName: companyName || null,
        clientHref: companyId ? `/companies/${companyId}` : null,
        workLabel: `${monthLabel(openRow.month)} retainer`,
        projectName: openRow.task.retainerProject?.name ?? project?.name ?? null,
        projectHref: openRow.task.retainerProject
          ? `/retainers/${id}/projects/${openRow.task.retainerProject.id}`
          : `/retainers/${id}/projects/${projectId}`,
      } as unknown as DrawerTask)
    : null;

  const changeStatus = async (t: RetainerTask, next: TaskStatusValue) => {
    if (next === t.status) return;
    setBusyId(t.id);
    try {
      if (next === 'ON_HOLD') {
        await api.tasks.wait(t.id, 'CLIENT');
      } else if (t.status === 'ON_HOLD') {
        // /resume is the only route that closes out waitingSince — always go
        // through it first, then layer the real target status on top.
        await api.tasks.resume(t.id);
        if (next !== 'IN_PROGRESS') await api.tasks.updateStatus(t.id, next);
      } else {
        await api.tasks.updateStatus(t.id, next);
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update that task');
    } finally {
      setBusyId(null);
    }
  };

  const removeProject = async () => {
    if (!project) return;
    const count = scoped.length;
    const ok = await confirm({
      title: `Remove "${project.name}"?`,
      message: count
        ? `Its ${plural(count, 'task')} stay on their month cards and move to the retainer's monthly work — they just stop being grouped under this name. The project itself cannot be brought back.`
        : 'It has no tasks on it. The project itself cannot be brought back.',
      confirmText: 'Remove project',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.retainers.deleteProject(id, projectId);
      toast.success('Project removed');
      router.push(`/retainers/${id}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not remove that project');
    }
  };

  if (loading) return <PageSkeleton />;
  if (error || !project) {
    return (
      <EmptyState
        title="This project is not here"
        hint={error ?? 'It may have been removed. Its tasks, if it had any, are on the retainer.'}
      />
    );
  }

  return (
    <>
      <Link
        href={`/retainers/${id}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-secondary transition-colors hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
        {companyName || 'Retainer'}
      </Link>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-primary">{project.name}</h1>
            {project.isDefault && <Badge tone="info">Monthly</Badge>}
            {project.status === 'DONE' && <Badge tone="neutral">Done</Badge>}
          </div>
          <p className="mt-1 text-xs text-secondary">
            {describeRun(project)}
            {project.owner ? ` · ${project.owner.name}` : ''}
            {companyName ? ` · ${companyName}` : ''}
          </p>
          {project.description && (
            <p className="mt-2 max-w-2xl text-sm text-secondary">{project.description}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/*
            The only Task button on this screen, and the form does not ask
            which project — standing here, the answer is already known.
          */}
          <Button
            size="sm"
            variant="secondary"
            icon={Plus}
            onClick={() => setAddingTask(true)}
            disabled={!monthCardId || monthClosed}
            title={monthClosed ? `${monthLabel(month)} is closed` : undefined}
          >
            Task
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-danger hover:bg-danger-tint hover:text-danger"
            onClick={() => void removeProject()}
          >
            Remove
          </Button>
        </div>
      </div>

      <Card padding="none">
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {/*
              One month control, and it is this page's own. The retainer's
              header had one too, which is how a project could show September's
              tasks while the tiles above counted October.
            */}
            <span
              role="group"
              aria-label="Month"
              className={cn(
                'inline-flex items-center gap-0.5 rounded-full py-0.5 pr-1 pl-1 text-white',
                allMonths ? 'bg-secondary/40' : 'bg-primary',
              )}
            >
              <button
                type="button"
                onClick={() => setMonth(shift(month, -1))}
                disabled={allMonths}
                className="rounded-full p-0.5 text-white/70 transition-colors hover:bg-white/15 hover:text-white disabled:opacity-30"
                aria-label="Previous month"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="px-1 text-micro font-semibold tracking-[0.03em] whitespace-nowrap">
                {allMonths ? 'Every month' : monthLabel(month)}
              </span>
              <button
                type="button"
                onClick={() => setMonth(shift(month, 1))}
                disabled={allMonths}
                className="rounded-full p-0.5 text-white/70 transition-colors hover:bg-white/15 hover:text-white disabled:opacity-30"
                aria-label="Next month"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </span>

            <span className="text-micro text-secondary">
              {plural(scoped.length, 'task')}
              {lateCount > 0 && <span className="ml-1.5 font-semibold text-danger">{lateCount} late</span>}
            </span>
            {!allMonths && monthClosed && <Badge tone="neutral">Closed</Badge>}

            {projectMonths.length > 1 && (
              <button
                type="button"
                onClick={() => setAllMonths((v) => !v)}
                className={cn(
                  'h-7 rounded-lg border px-2.5 text-xs font-semibold transition-colors',
                  allMonths
                    ? 'border-primary bg-primary text-white'
                    : 'border-border text-secondary hover:bg-subtle hover:text-primary',
                )}
              >
                All months
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <MultiSelect
              compact
              ariaLabel="Filter by status"
              placeholder="Any status"
              options={TASK_FILTER_OPTIONS}
              value={statusFilter}
              onChange={setStatusFilter}
              triggerClassName="h-8 min-w-[9rem] text-xs"
            />
            {me?.id && (
              <button
                type="button"
                onClick={() => setMineOnly((v) => !v)}
                className={cn(
                  'h-8 rounded-lg border px-2.5 text-xs font-semibold transition-colors',
                  mineOnly
                    ? 'border-primary bg-primary text-white'
                    : 'border-border text-secondary hover:bg-subtle hover:text-primary',
                )}
              >
                Mine
              </button>
            )}
          </div>
        </CardHeader>

        <CardBody className="p-0!">
          {visible.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-secondary">
              {scoped.length === 0 && !allMonths
                ? `Nothing on this project in ${monthLabel(month)}. It has ${plural(view?.total ?? 0, 'task')} in other months — try All months, or step to one of them.`
                : `Nothing matches that. ${plural(scoped.length, 'task')} here altogether.`}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="eyebrow text-left">Task</th>
                    {allMonths && <th className="eyebrow text-left">Month</th>}
                    <th className="eyebrow text-left">Assigned to</th>
                    <th className="eyebrow text-left">Assigned</th>
                    <th className="eyebrow text-left">Due</th>
                    <th className="eyebrow text-left">Priority</th>
                    <th className="eyebrow text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visible.map(({ task: t, month: m, closed }) => {
                    const late = isTaskLate(t, todayStr);
                    return (
                      <tr
                        key={t.id}
                        onClick={() => setOpenTaskId(t.id)}
                        className="cursor-pointer transition-colors hover:bg-subtle"
                      >
                        <td>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenTaskId(t.id);
                            }}
                            className={cn(
                              'rounded-sm text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                              t.status === 'DONE' || t.status === 'CANCELLED'
                                ? 'text-secondary line-through'
                                : 'text-primary',
                            )}
                          >
                            {t.title}
                          </button>
                          {t.status === 'ON_HOLD' && t.waitingOn && (
                            <p className="mt-0.5 text-micro text-secondary">
                              waiting on {t.waitingOn === 'CLIENT' ? 'the client' : 'someone else'}
                            </p>
                          )}
                        </td>
                        {allMonths && (
                          <td className="whitespace-nowrap text-secondary">{monthLabel(m)}</td>
                        )}
                        <td>
                          <p className="text-body">
                            {t.assignee?.name ?? 'Unassigned'}
                            {(t.assignees?.length ?? 1) > 1 && (
                              <span className="text-secondary"> +{(t.assignees?.length ?? 1) - 1}</span>
                            )}
                          </p>
                          {t.assignee?.designation && (
                            <p className="text-micro text-secondary">{t.assignee.designation}</p>
                          )}
                        </td>
                        <td className="whitespace-nowrap text-secondary">{formatDate(t.assignedAt)}</td>
                        <td
                          className={cn(
                            'whitespace-nowrap',
                            late ? 'font-semibold text-danger' : 'text-secondary',
                          )}
                        >
                          {formatDate(t.dueDate)}
                        </td>
                        <td className="whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 text-secondary">
                            <span className={getPriorityDot(t.priority)} />
                            {getPriorityLabel(t.priority)}
                          </span>
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <Select
                            aria-label={`Status for ${t.title}`}
                            value={t.status}
                            disabled={closed || busyId === t.id}
                            onChange={(v) => void changeStatus(t, v as TaskStatusValue)}
                            options={TASK_STATUS_OPTIONS}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <TaskDrawer
        task={openTask}
        statusOptions={TASK_STATUS_OPTIONS}
        team={team}
        busy={busyId === openTaskId}
        onClose={() => setOpenTaskId(null)}
        onStatusChange={(t, next) => void changeStatus(t as unknown as RetainerTask, next as TaskStatusValue)}
        onChanged={() => void load()}
      />

      <NewWorkTaskModal
        open={addingTask}
        team={team}
        companyId={companyId}
        defaultTarget={{ kind: 'MONTH_CARD', monthCardId: monthCardId ?? '' }}
        retainerProjects={projects}
        defaultRetainerProjectId={projectId}
        onClose={() => setAddingTask(false)}
        onCreated={() => {
          setAddingTask(false);
          void load();
          void loadMonthCard();
        }}
      />

      {editing && (
        <RetainerProjectModal
          retainerId={id}
          project={project}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void load();
          }}
        />
      )}
    </>
  );
}

/** "2026-09" shifted by whole months. Local, because only the stepper needs it. */
function shift(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
