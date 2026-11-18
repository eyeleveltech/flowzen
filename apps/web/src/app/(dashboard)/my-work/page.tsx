'use client';

/**
 * My Work — the one screen ~25 people open daily (§ "the daily screen stays
 * trivial. If it gets heavy, the data dies and every number in the system
 * dies with it.").
 *
 * Trivial means few verbs, not a thin screen. Status is the one you reach for
 * without stopping — a control in the row, not a tick, because a task can be
 * Open, On hold (waiting on the client) or Done and the same dropdown handles
 * all of those plus reopening. Everything else about a task happens in the
 * drawer, which is the same drawer a retainer opens.
 */

import { Fragment, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { DragDropContext, Droppable, Draggable, type BeforeCapture, type DropResult } from '@hello-pangea/dnd';
import { plural } from '@/lib/utils';
import { api, ApiError, formatDate } from '@/lib/api-v2';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { usePageHeader } from '@/hooks/usePageHeader';
import { useCreateFlag } from '@/hooks/useCreateFlag';
import { useRouter, useSearchParams } from 'next/navigation';
import { InlineDueDate } from '@/components/work/InlineDueDate';
import { changeTaskStatus, waitingWords } from '@/lib/task-status';
import { optimistic, changedBackMessage } from '@/lib/optimistic';
import { MyWorkSkeleton } from '@/components/ui/skeleton-screens';
import { getPriorityDot, getPriorityLabel } from '@/lib/priority';
import { StatTile, StatRow } from '@/components/ui/stat-tile';
import { TaskDrawer, type DrawerTask } from '@/components/work/TaskDrawer';
import { FollowUps } from '@/components/sales/FollowUps';
import toast from 'react-hot-toast';
import { Check, CheckSquare, ChevronRight, Plus, GripVertical } from 'lucide-react';
import type { TaskRepeatInfo } from '@/lib/repeat';
import { RepeatMark } from '@/components/work/RepeatMark';
import { NewTaskModal } from '@/components/work/NewTaskModal';
import { taskTypeLabel } from '@/lib/task-type';
import { NowBadge, canBeNow, useWorkingOnNow } from '@/components/work/WorkingOnNow';
import { qk, useLastChoices } from '@/hooks/queries';
import { GettingStartedCard } from '@/components/work/GettingStartedCard';
import { quickAddBody, quickAddSummary } from '@/lib/quickAdd';
import { withDueTime } from '@/lib/due-time';
import { toastWithAction } from '@/lib/actionToast';
import { useRemembered } from '@/lib/remembered';
import { ColumnFilter, ColumnTextFilter } from '@/components/ui/column-filter';
import { NO_FILTERS, filterOptions, isFiltering, matchesFilters, type MyWorkFilters } from '@/lib/myWorkFilters';


type TStatus = 'TODO' | 'IN_PROGRESS' | 'ON_HOLD' | 'DONE' | 'CANCELLED';

type Person = { id: string; name: string; designation: string | null };

interface TaskItem {
  id: string;
  title: string;
  status: TStatus;
  priority: string;
  waitingOn?: 'CLIENT' | 'ANOTHER_PERSON' | null;
  waitingSince?: string | null;
  dueDate: string;
  /** Optional, "17:30" — shown after the date. */
  dueTime?: string | null;
  assignedAt: string;
  completedAt?: string | null;
  reopenCount: number;
  notes?: string | null;
  taskType?: string | null;
  assignee?: Person | null;
  assignees?: Person[];
  assignedBy?: Person | null;
  creator?: Person | null;
  reviewer?: Person | null;
  clientName: string;
  /** Exactly one of these is ever set — the two are mutually exclusive in the data. */
  monthCardMonth?: string | null;
  projectName?: string | null;
  /** Filed under an internal project — or neither, for "Internal — no project". */
  internalProjectId?: string | null;
  internalProjectName?: string | null;
  workingHoursText: string;
  workingMinutes: number;
  typeMedianMinutes: number | null;
  typeMedianText: string | null;
  /** The repeat, if it is a copy in one — the small mark beside the title. */
  repeat?: TaskRepeatInfo | null;
}

/** "2026-09" is a key. This is the label. */
const monthLabel = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
};

/** The retainer month a task hangs off, if it hangs off one at all. */
const retainerLabel = (t: TaskItem) => (t.monthCardMonth ? `${monthLabel(t.monthCardMonth)} retainer` : null);

/**
 * Which job the task hangs off, in one line, for the row.
 *
 * A task belongs to a month card or to a project, never both — 0 of 83 rows
 * carry the two — so one line always has exactly one answer to give.
 */
const jobLabel = (t: TaskItem) => retainerLabel(t) ?? t.projectName ?? null;

/*
 * The same drawer the retainer screen opens, fed from this screen's own row.
 *
 * My Work used to open a dialog of its own that could change one thing — the
 * note — so the identical task read one way from a retainer and another way
 * from here, and a wrong due date could only be fixed by cancelling the task
 * and typing it again. Every one of those routes already accepts `work.own`,
 * which is the permission this whole screen runs on; the editing was never
 * withheld, it just was not offered.
 *
 * No hrefs. An employee's sidebar is My Work and Assets, so a link to the
 * company behind the task lands them on a screen they cannot open.
 *
 * `workLabel` is the RETAINER only. The drawer has a "Project" row of its own
 * fed by `projectName`, so a `workLabel` that fell back to the project name
 * put the same string in two rows — "Work: Website and Booking System" over
 * "Project: Website and Booking System" — on every project task. The row's
 * one line still wants either, which is why the two are separate functions.
 */
const toDrawerTask = (t: TaskItem | null): DrawerTask | null =>
  t && { ...t, workLabel: retainerLabel(t) };

type Buckets = {
  overdue: TaskItem[];
  today: TaskItem[];
  thisWeek: TaskItem[];
  later: TaskItem[];
  completed: TaskItem[];
};
const EMPTY_BUCKETS: Buckets = { overdue: [], today: [], thisWeek: [], later: [], completed: [] };

/** Today on this computer's calendar, as "2026-10-26" — the date the due filter reads from. */
const localDayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** The cells of one draggable row on the page, found by its task id. */
const rowCells = (id: string) =>
  Array.from(
    document.querySelector<HTMLTableRowElement>(`tr[data-task-row="${CSS.escape(id)}"]`)?.cells ?? [],
  );

/**
 * The piece of work a task on this list belongs to, for "Group by Project or
 * retainer": a client's retainer month or project, an internal project, or
 * "Internal — no project" for the one-off studio jobs.
 */
const workGroupOf = (t: TaskItem): { key: string; label: string; sub?: string; rank: number } => {
  if (t.monthCardMonth) return { key: `R:${t.clientName}:${t.monthCardMonth}`, label: t.clientName, sub: retainerLabel(t) ?? undefined, rank: 0 };
  if (t.internalProjectId)
    return { key: `IP:${t.internalProjectId}`, label: t.internalProjectName ?? t.projectName ?? 'Internal project', sub: 'Internal', rank: 2 };
  if (t.projectName) return { key: `P:${t.clientName}:${t.projectName}`, label: t.projectName, sub: t.clientName, rank: 0 };
  if (t.clientName && t.clientName !== 'Internal') return { key: `C:${t.clientName}`, label: `${t.clientName} — no project`, rank: 1 };
  return { key: 'NO_PROJECT', label: 'Internal — no project', rank: 3 };
};

const GROUP_BY_KEYS = ['when', 'work'] as const;
type GroupBy = (typeof GROUP_BY_KEYS)[number];

const STATUS_OPTIONS = [
  { value: 'TODO', label: 'To do' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'DONE', label: 'Done' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export default function MyWorkPage() {
  /**
   * Server data lives in the query cache, not in component state.
   *
   * This screen used to hold the tasks in `useState` and fill them from a
   * `useEffect` on mount, which meant every visit — including coming straight
   * back from a task you just opened — refetched and re-rendered from empty.
   * React Query was already installed and mounted app-wide and used by nothing.
   * With a 30s `staleTime` a return trip inside that window paints from cache
   * immediately and revalidates behind the paint.
   */
  const { data, isPending, refetch } = useQuery({
    queryKey: ['tasks', 'my'],
    queryFn: () => api.tasks.my(),
  });

  /*
   * "Show older" under Done (Perf Plan 2): the list carries the last 14 days
   * of finished work, and older comes 50 at a time, only when asked for.
   */
  const [showOlder, setShowOlder] = useState(false);
  const older = useInfiniteQuery({
    queryKey: ['tasks', 'myDoneOlder'],
    queryFn: ({ pageParam }) => api.tasks.myDoneOlder(pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasMore ? last.nextSkip : undefined),
    enabled: showOlder,
  });
  const olderDone = useMemo(() => (older.data?.pages ?? []).flatMap((p) => p.tasks as TaskItem[]), [older.data]);

  const buckets: Buckets = useMemo(() => {
    const base: Buckets = data?.success ? { ...EMPTY_BUCKETS, ...(data.tasks as Partial<Buckets>) } : EMPTY_BUCKETS;
    if (olderDone.length === 0) return base;
    // Once, under Done: a task reopened since it was loaded is back in its own group.
    const onList = new Set([...base.overdue, ...base.today, ...base.thisWeek, ...base.later, ...base.completed].map((t) => t.id));
    return { ...base, completed: [...base.completed, ...olderDone.filter((t) => !onList.has(t.id))] };
  }, [data, olderDone]);
  /** The last 14 days' finished work, without anything "Show older" added. */
  const recentDone: TaskItem[] = data?.success ? ((data.tasks.completed as TaskItem[]) ?? []) : [];
  const queryClient = useQueryClient();

  /*
   * A drag, within one group.
   *
   * Moved on screen first and saved second, so the row lands where it was
   * dropped instead of snapping back for a round trip. If the save fails the
   * list goes back to what the server has — a desk that silently disagrees
   * with itself on the next reload is worse than a visible undo.
   *
   * Never across groups: the groups are WHEN things are due, and dragging a
   * task from Overdue into Today would be a claim about its due date that
   * nothing here makes. Each group is its own drop zone for that reason.
   *
   * "Later this week" is two server buckets shown as one, so it is arranged as
   * one. Done is history, not a plan, and is not arrangeable.
   */
  /*
   * A lifted row keeps its columns.
   *
   * While dragged, a row is lifted out of the table, and a row outside its
   * table sizes each cell to its own text — the task, client, date and status
   * bunch up against the left edge. Each cell is pinned to the width it had at
   * rest just before it lifts, and let go again when it lands.
   */
  const onBeforeCapture = useCallback((before: BeforeCapture) => {
    for (const cell of rowCells(before.draggableId)) cell.style.width = `${cell.getBoundingClientRect().width}px`;
  }, []);

  const onDragEnd = useCallback(
    async (result: DropResult) => {
      for (const cell of rowCells(result.draggableId)) cell.style.width = '';
      const { source, destination } = result;
      if (!destination || destination.droppableId !== source.droppableId) return;
      if (destination.index === source.index) return;

      const group = source.droppableId;
      const current =
        group === 'overdue'
          ? buckets.overdue
          : group === 'today'
            ? buckets.today
            : group === 'week'
              ? [...buckets.thisWeek, ...buckets.later]
              : null;
      if (!current) return;

      const list = [...current];
      const [moved] = list.splice(source.index, 1);
      list.splice(destination.index, 0, moved);

      queryClient.setQueryData(['tasks', 'my'], (prev: any) => {
        if (!prev?.tasks) return prev;
        const tasks = { ...prev.tasks };
        if (group === 'overdue') tasks.overdue = list;
        if (group === 'today') tasks.today = list;
        if (group === 'week') {
          // One group on screen, two buckets underneath: each task goes back
          // into the bucket it came from, in the arranged order.
          const weekIds = new Set(prev.tasks.thisWeek.map((t: TaskItem) => t.id));
          tasks.thisWeek = list.filter((t) => weekIds.has(t.id));
          tasks.later = list.filter((t) => !weekIds.has(t.id));
        }
        return { ...prev, tasks };
      });

      try {
        await api.tasks.saveMyOrder(list.map((t) => t.id));
      } catch (e) {
        toast.error(changedBackMessage(e));
        void refetch();
      }
    },
    [buckets, queryClient, refetch],
  );
  const counts = { today: 0, overdue: 0, thisWeek: 0, later: 0, completed: 0, ...(data?.counts ?? {}) };
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  /** What quick add hands the full form when it cannot file the task itself. */
  const [creatingTitle, setCreatingTitle] = useState('');
  /*
   * Quick add (Ease Plan 1, decision 3): one line, Enter, done — for you, due
   * today, filed where your last hand-made task was.
   */
  const [quickTitle, setQuickTitle] = useState('');
  const [quickBusy, setQuickBusy] = useState(false);
  const lastChoices = useLastChoices();
  /** "Add your first task" on the Getting started card puts the cursor here. */
  const quickAddRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<TaskItem | null>(null);
  /*
   * What this person said they are working on now (Team plan 1): the Now badge
   * on that row, "Working on this now" on the others, and Clear. No time goes
   * with it.
   */
  const { focus, busy: focusBusy, start: startNow, clear: clearNow } = useWorkingOnNow();
  /*
   * Group by When (the groups below, and the default) or by Project or
   * retainer. Remembered per browser. Arranging by drag is a When thing: the
   * order is per group of due dates.
   */
  const [groupBy, setGroupBy] = useRemembered<GroupBy>('flowzen.myWork.groupBy', 'when', GROUP_BY_KEYS);
  /** Folded work groups, by key. */
  const [folded, setFolded] = useState<Set<string>>(() => new Set());

  /*
   * /my-work?task=… — the link the bell, the brief and Zen give a task.
   *
   * A task on this person's own list opens from the list. Anything else — a
   * Head following somebody else's overdue task — is fetched on its own and
   * opens in the same drawer (`linkedId`), if they may read it. Closing it
   * takes the id back out of the address, so a refresh does not reopen it.
   */
  const router = useRouter();
  const searchParams = useSearchParams();
  const taskParam = searchParams.get('task');
  const [linkedId, setLinkedId] = useState<string | null>(null);
  const everyTask = useMemo(
    () => [...buckets.overdue, ...buckets.today, ...buckets.thisWeek, ...buckets.later, ...buckets.completed],
    [buckets],
  );
  const forgetTaskParam = () => {
    if (taskParam) router.replace('/my-work');
  };
  const openLinked = async (id: string, opts: { afterChange?: boolean } = {}) => {
    try {
      const { task } = await api.tasks.one(id);
      setLinkedId(id);
      setSelected(task as unknown as TaskItem);
    } catch (e) {
      // Re-read after a change — a delete, say: it is gone because they
      // removed it, so close quietly. "That task isn't here" right after
      // "Task deleted" read as a fault.
      if (opts.afterChange && e instanceof ApiError && e.status === 404) {
        setSelected(null);
        setLinkedId(null);
        forgetTaskParam();
        return;
      }
      toast.error(
        e instanceof ApiError && e.status === 404
          ? "That task isn't here — it may have been deleted, or it isn't one you can open."
          : 'Could not open that task.',
      );
      forgetTaskParam();
    }
  };
  useEffect(() => {
    if (!taskParam || isPending) return;
    const mine = everyTask.find((t) => t.id === taskParam);
    if (mine) setSelected(mine);
    else void openLinked(taskParam);
    // Only when the link or the list arrives, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskParam, isPending]);

  /*
   * The column filters. Nothing ticked is everything; every column's filter
   * has to pass. Held for this visit — the list itself is what is remembered.
   */
  const [filters, setFilters] = useState<MyWorkFilters>(NO_FILTERS);
  const filtering = isFiltering(filters);
  const setFilter = <K extends keyof MyWorkFilters>(key: K) => (value: MyWorkFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));
  const filterCtx = useMemo(
    () => ({ today: localDayKey(), dayMinutes: data?.success ? (data.dayMinutes ?? 540) : 540 }),
    [data],
  );
  // Offered from the whole list, so a value never disappears from its own filter.
  const options = useMemo(() => filterOptions(everyTask, filterCtx), [everyTask, filterCtx]);
  /** The list as the filters leave it — what the table draws. */
  const shown: Buckets = useMemo(() => {
    if (!filtering) return buckets;
    const keep = (list: TaskItem[]) => list.filter((t) => matchesFilters(t, filters, filterCtx));
    return {
      overdue: keep(buckets.overdue),
      today: keep(buckets.today),
      thisWeek: keep(buckets.thisWeek),
      later: keep(buckets.later),
      completed: keep(buckets.completed),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [everyTask, filters, filtering, filterCtx]);
  const shownTotal =
    shown.overdue.length + shown.today.length + shown.thisWeek.length + shown.later.length + shown.completed.length;

  // The open task follows the list: after an edit, the drawer shows the task
  // as it is now, not as it was clicked.
  useEffect(() => {
    if (!selected) return;
    const fresh = everyTask.find((t) => t.id === selected.id);
    if (fresh && fresh !== selected) setSelected(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [everyTask]);

  /*
   * "Project or retainer": the work still to do — late, today, this week and
   * later, in that order as the When view shows it — under what it belongs
   * to. Client work first, then internal projects, then "Internal — no
   * project".
   */
  const workGroups = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; sub?: string; rank: number; tasks: TaskItem[] }>();
    for (const t of [...shown.overdue, ...shown.today, ...shown.thisWeek, ...shown.later]) {
      const w = workGroupOf(t);
      const g = groups.get(w.key) ?? { ...w, tasks: [] };
      g.tasks.push(t);
      groups.set(w.key, g);
    }
    return [...groups.values()].sort(
      (a, b) => a.rank - b.rank || `${a.sub ?? ''} ${a.label}`.localeCompare(`${b.sub ?? ''} ${b.label}`),
    );
  }, [shown]);

  // Derived from the tasks above rather than stored beside them — three more
  // pieces of state that could go stale against the list they describe.
  const onHoldCount = useMemo(
    () => buckets.today.filter((t) => t.status === 'ON_HOLD').length,
    [buckets],
  );

  const oldestOpen = useMemo(() => {
    if (buckets.overdue.length === 0) return 'nothing open';
    const oldest = buckets.overdue.reduce(
      (old, current) => (new Date(current.assignedAt) < new Date(old.assignedAt) ? current : old),
      buckets.overdue[0],
    );
    return oldest.workingHoursText;
  }, [buckets]);

  // Over the last 14 days, as the tile says — not whatever "Show older" has added.
  const avgClose = useMemo(() => {
    if (recentDone.length === 0) return '0h';
    const totalMins = recentDone.reduce((acc, t) => acc + t.workingMinutes, 0);
    const avgMins = Math.floor(totalMins / recentDone.length);
    const days = Math.floor(avgMins / 540);
    const hours = Math.floor((avgMins % 540) / 60);
    return days > 0 && hours > 0 ? `${days}d ${hours}h` : days > 0 ? `${days}d` : hours > 0 ? `${hours}h` : '<1h';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  /** What the mutation handlers call after they change something. */
  const load = useCallback(async () => {
    await refetch();
    // A task finished or held stops being "now" on the server.
    void queryClient.invalidateQueries({ queryKey: qk.myFocus });
    // A quick add, a tick, a status change: each can tick a Getting started step.
    void queryClient.invalidateQueries({ queryKey: qk.gettingStarted });
  }, [refetch, queryClient]);

  // Quick Create's "New task" lands here — including when you are already
  // here, which is the case the old mount-only check missed.
  useCreateFlag(() => setCreating(true), '/my-work');

  /** Resolves true once the change has been saved; false when nothing moved. */
  const changeStatus = async (task: TaskItem, next: TStatus): Promise<boolean> => {
    if (next === task.status) return false;
    setBusyId(task.id);
    try {
      if (next === 'ON_HOLD') {
        // On hold goes through /wait, so the wait is timed — and asks what it
        // is waiting on first. Nothing moves until that is answered; cancelled,
        // nothing moved.
        if (!(await changeTaskStatus(task, next))) return false;
      } else {
        // The row changes now and the save follows (lib/optimistic). Refused
        // or failed, it goes back with "Couldn't save — changed back".
        const saved = await optimistic<NonNullable<typeof data>>(
          queryClient,
          ['tasks', 'my'],
          (cur) => ({
            ...cur,
            tasks: Object.fromEntries(
              Object.entries(cur.tasks).map(([group, list]) => [
                group,
                list.map((t: TaskItem) => (t.id === task.id ? { ...t, status: next } : t)),
              ]),
            ) as typeof cur.tasks,
          }),
          () => api.tasks.updateStatus(task.id, next),
        );
        if (!saved) return false;
      }
      await load();
      setSelected((s) => (s && s.id === task.id ? { ...s, status: next } : s));
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update that task');
      return false;
    } finally {
      setBusyId(null);
    }
  };

  /** A row quick add has put up and the server has not answered for yet. */
  const isPlaceholder = (t: TaskItem) => t.id.startsWith('quick-');

  /*
   * One tap to Done (Ease Plan 1, decision 4): the row changes now and the
   * save follows, as any status change does, and the toast offers Undo for
   * five seconds. Undo puts back what it was — a held task back on hold with
   * what it was waiting on, without asking again. The status dropdown stays
   * for everything else.
   */
  const markDone = async (task: TaskItem) => {
    if (isPlaceholder(task)) return;
    const was = task.status;
    const waitingOn = task.waitingOn ?? null;
    if (!(await changeStatus(task, 'DONE'))) return;
    toastWithAction(`Done · ${task.title}`, {
      label: 'Undo',
      onClick: () => {
        void (async () => {
          try {
            if (was === 'ON_HOLD') await api.tasks.wait(task.id, waitingOn);
            else await api.tasks.updateStatus(task.id, was);
            await load();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not put it back');
          }
        })();
      },
    });
  };

  /*
   * Enter in the quick add line. Nothing is filed under a guess: with no
   * last choices — a first task, or the last one's work has closed — the
   * full form opens with the title already typed.
   */
  const quickAdd = async () => {
    const title = quickTitle.trim();
    if (!title || quickBusy) return;
    const choices = lastChoices.data?.choices ?? null;
    // The studio's today from the server, unless this device has since passed midnight.
    const localToday = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();
    const today = [lastChoices.data?.today ?? '', localToday].sort().at(-1)!;
    const body = quickAddBody(title, choices, today);
    if (!body || !choices) {
      // The typed title stays in the line until the task exists, so a form
      // closed by a stray click loses nothing.
      setCreatingTitle(title);
      setCreating(true);
      return;
    }
    setQuickBusy(true);
    setQuickTitle('');
    const placeholder: TaskItem = {
      id: `quick-${Date.now()}`,
      title: body.title,
      status: 'TODO',
      priority: body.priority,
      dueDate: `${body.dueDate}T00:00:00.000Z`,
      assignedAt: new Date().toISOString(),
      reopenCount: 0,
      taskType: body.taskType,
      clientName: choices.target?.scope === 'CLIENT' ? choices.target.name : 'Internal',
      workingHoursText: '0h 0m',
      workingMinutes: 0,
      typeMedianMinutes: null,
      typeMedianText: null,
    };
    let createdId: string | null = null;
    const saved = await optimistic<NonNullable<typeof data>>(
      queryClient,
      ['tasks', 'my'],
      (cur) => ({
        ...cur,
        counts: { ...cur.counts, today: (cur.counts?.today ?? 0) + 1 },
        tasks: { ...cur.tasks, today: [placeholder, ...cur.tasks.today] },
      }),
      async () => {
        const res = await api.tasks.create(body);
        createdId = res.task?.id ?? null;
      },
    );
    setQuickBusy(false);
    if (!saved) {
      // Changed back: what they typed is still theirs to send again.
      setQuickTitle(title);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: qk.lastChoices });
    await load();
    toastWithAction(
      `Added · ${quickAddSummary(choices)} · due today`,
      {
        label: 'Change',
        // The same address the bell gives a task: opens it in the drawer from the list.
        onClick: () => createdId && router.replace(`/my-work?task=${createdId}`),
      },
      6000,
    );
  };

  const todayStr = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  /* Local, not UTC. `toISOString()` rolls over five and a half hours early
     here, so a task due today reads as late all evening. */
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  usePageHeader('My Work', todayStr);
  const total = counts.today + counts.overdue + counts.thisWeek + counts.later + counts.completed;

  if (isPending) return <MyWorkSkeleton />;

  /*
   * A row, at the density every other list in the product runs at.
   *
   * This was two stacked lines with its own padding — 67px tall against the
   * 33px a `.data-table` row is — and everything except the title was crushed
   * into one grey sentence: client, due date, elapsed and the median all
   * separated by middots. Nothing lined up down the page, so nothing could be
   * compared between two rows, and the only element with any weight to it was
   * the status control, repeated nine times down the right-hand edge.
   *
   * Same columns and the same treatment as the task table on a retainer, so
   * one task looks like itself wherever you meet it.
   */
  /*
   * A row, as its cells.
   *
   * Split from the <tr> so the same cells can sit in a plain row (Done this
   * week, which is history) or a draggable one (everything still to do),
   * without two copies of the row that drift apart.
   */
  /** The round tick at the start of an open task: one tap and it is Done. */
  const tick = (t: TaskItem, className = '') => (
    <button
      type="button"
      aria-label={`Mark “${t.title}” done`}
      title="Mark done"
      disabled={busyId === t.id || isPlaceholder(t)}
      onClick={(e) => {
        e.stopPropagation();
        void markDone(t);
      }}
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-white text-transparent outline-none transition-colors hover:border-success hover:text-success focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50 ${className}`}
    >
      <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
    </button>
  );

  /*
   * My Work on a phone (Ease Plan 1, decision 5): below `md` each task is a
   * card — tick, title, client · type of work, due date — and tapping it
   * opens the drawer. The same groups and the same Group by as the table;
   * arranging by drag stays on the desktop.
   */
  const card = (t: TaskItem) => {
    const finished = t.status === 'DONE' || t.status === 'CANCELLED';
    const late = !finished && t.status !== 'ON_HOLD' && t.dueDate.slice(0, 10) < todayKey;
    const kind = taskTypeLabel(t.taskType);
    return (
      <li key={t.id} data-task-card={t.id} className="flex items-start gap-3 px-4 py-3">
        {finished ? <span className="h-5 w-5 shrink-0" aria-hidden="true" /> : tick(t, 'mt-0.5')}
        <button
          type="button"
          onClick={() => !isPlaceholder(t) && setSelected(t)}
          className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <span className={`block text-sm font-medium ${finished ? 'text-secondary line-through' : 'text-primary'}`}>{t.title}</span>
          <span className="mt-0.5 block truncate text-micro text-secondary">
            {[t.clientName, kind].filter(Boolean).join(' · ')}
            {t.status === 'ON_HOLD' && t.waitingOn ? ` · ${waitingWords(t.waitingOn)}` : t.status === 'ON_HOLD' ? ' · on hold' : ''}
          </span>
        </button>
        <span className={`shrink-0 whitespace-nowrap pt-0.5 text-micro ${late ? 'font-semibold text-danger' : 'text-secondary'}`}>
          {/* As the table's date reads: InlineDueDate's own format. */}
          {withDueTime(formatDate(t.dueDate), t.dueTime ?? null)}
        </span>
      </li>
    );
  };

  const cardGroup = (key: string, label: string, items: TaskItem[], sub?: string) =>
    items.length === 0 ? null : (
      <section key={key}>
        <h3 className="eyebrow border-y border-border bg-surface px-4 py-2">
          {label}
          {sub && <span className="ml-1.5 normal-case tracking-normal text-secondary">{sub}</span>}
        </h3>
        <ul className="divide-y divide-border">{items.map(card)}</ul>
      </section>
    );

  const phoneCards = () => {
    const more = Boolean(data?.success && (showOlder ? older.hasNextPage : data.hasOlderDone));
    return (
      <div className="md:hidden">
        {filtering && shownTotal === 0 && (
          <p className="px-4 py-8 text-center text-sm text-secondary">No tasks match these filters.</p>
        )}
        {groupBy === 'work'
          ? workGroups.map((g) => cardGroup(`work:${g.key}`, g.label, g.tasks, g.sub))
          : [
              cardGroup('overdue', 'Overdue', shown.overdue),
              cardGroup('today', 'Due today', shown.today),
              cardGroup('week', 'Coming up', [...shown.thisWeek, ...shown.later]),
            ]}
        {cardGroup('done', olderDone.length > 0 ? 'Done' : `Done in the last ${data?.doneDays ?? 14} days`, shown.completed)}
        {more && (
          <div className="border-t border-border px-4 py-3">
            <Button
              variant="ghost"
              size="sm"
              loading={older.isFetching}
              onClick={() => (showOlder ? void older.fetchNextPage() : setShowOlder(true))}
            >
              Show older
            </Button>
          </div>
        )}
      </div>
    );
  };

  const cells = (t: TaskItem, grip: React.ReactNode) => {
    const finished = t.status === 'DONE' || t.status === 'CANCELLED';
    // On hold is never late: it is waiting, and says on what.
    const late = !finished && t.status !== 'ON_HOLD' && t.dueDate.slice(0, 10) < todayKey;
    const job = jobLabel(t);
    return (
      <>
        <td className="w-8 text-secondary">{grip}</td>
        <td>
          {/*
            A button inside the row rather than a click handler alone: the row
            is the target for a mouse, and this is what a keyboard and a screen
            reader get to open the same thing.
          */}
          {!finished && tick(t, 'mr-2 align-middle')}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); if (!isPlaceholder(t)) setSelected(t); }}
            className={`rounded-sm text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${finished ? 'text-secondary line-through' : 'text-primary'}`}
          >
            {t.title}
          </button> <RepeatMark repeat={t.repeat} />
          {canBeNow(t.status) &&
            (focus?.id === t.id ? (
              <NowBadge className="ml-1 align-middle" />
            ) : (
              // On hover, so twenty rows don't each carry a button; the drawer
              // offers the same on a phone.
              <button
                type="button"
                disabled={focusBusy}
                onClick={(e) => {
                  e.stopPropagation();
                  void startNow(t.id, t).then((now) => now && load());
                }}
                className="ml-2 rounded-sm text-micro font-semibold text-primary underline-offset-2 opacity-0 outline-none transition-opacity hover:underline focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary/40 group-hover/row:opacity-100"
              >
                Working on this now
              </button>
            ))}
          {t.status === 'ON_HOLD' && t.waitingOn && (
            <p className="mt-0.5 text-micro text-secondary">
              {waitingWords(t.waitingOn)}
            </p>
          )}
        </td>
        <td className="whitespace-nowrap text-secondary">{taskTypeLabel(t.taskType) ?? '—'}</td>
        {/* Who it is for, over which job of theirs it belongs to — the second
            was on no screen this side of the drawer until now. */}
        <td>
          <p className="text-body">{t.clientName}</p>
          {job && <p className="text-micro text-secondary">{job}</p>}
        </td>
        {/* Click the date to move it — no need to open the task. */}
        <td className="whitespace-nowrap">
          <InlineDueDate
            taskId={t.id}
            title={t.title}
            value={t.dueDate}
            time={t.dueTime}
            disabled={finished || isPlaceholder(t)}
            className={late ? 'font-semibold text-danger' : 'text-secondary'}
          />
        </td>
        <td>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-secondary">
            <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${getPriorityDot(t.priority)}`} />
            {getPriorityLabel(t.priority)}
          </span>
        </td>
        {/* One column, both readings: how long it has been open, or how long
            it took. The median sits under it rather than in a parenthesis, so
            the figures above stay in a line you can run your eye down. */}
        <td className="whitespace-nowrap text-secondary">
          {t.workingHoursText}
          {t.typeMedianText && <p className="text-micro">usually ~{t.typeMedianText}</p>}
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          <Select
            value={t.status}
            onChange={(v) => void changeStatus(t, v as TStatus)}
            options={STATUS_OPTIONS}
            ariaLabel={`Status for ${t.title}`}
            buttonClassName="px-2.5 py-1.5 text-xs w-32"
            disabled={busyId === t.id || isPlaceholder(t)}
          />
        </td>
      </>
    );
  };

  /** A finished task: history, so it does not move. */
  const row = (t: TaskItem) => (
    <tr key={t.id} onClick={() => !isPlaceholder(t) && setSelected(t)} className="group/row cursor-pointer transition-colors hover:bg-subtle">
      {cells(t, null)}
    </tr>
  );

  /*
   * A task still to do, which can be moved.
   *
   * Only the grip starts a drag. The row itself opens the task on a click and
   * holds a status menu, and a whole-row drag handle turns every attempt to
   * read or change something into an accidental move.
   */
  const dragRow = (t: TaskItem, index: number) => (
    <Draggable key={t.id} draggableId={t.id} index={index}>
      {(drag, snap) => (
        <tr
          ref={drag.innerRef}
          {...drag.draggableProps}
          data-task-row={t.id}
          onClick={() => !isPlaceholder(t) && setSelected(t)}
          className={`group/row cursor-pointer transition-colors hover:bg-subtle ${
            snap.isDragging ? 'bg-white shadow-card ring-1 ring-primary/20' : ''
          }`}
        >
          {cells(
            t,
            <span
              {...drag.dragHandleProps}
              onClick={(e) => e.stopPropagation()}
              aria-label={`Move ${t.title}`}
              title="Drag to arrange"
              className="flex h-7 w-6 cursor-grab items-center justify-center rounded hover:bg-subtle hover:text-primary active:cursor-grabbing"
            >
              <GripVertical className="h-4 w-4" />
            </span>,
          )}
        </tr>
      )}
    </Draggable>
  );

  /*
   * A bucket heading, as a row of the table rather than a bar above one — so
   * the columns underneath stay in the same six tracks all the way down.
   * `<th scope="colgroup">` because that is what it is: a heading for the rows
   * that follow. It also keeps the 11px, since `.data-table td` sets a font
   * size and would otherwise beat `.eyebrow` on a `<td>`.
   */
  /*
   * One group.
   *
   * Arrangeable groups are their own <tbody> and their own drop zone, so a
   * task can be moved within Overdue, within Today, within the rest of the
   * week — and never between them, since the groups are WHEN things are due.
   */
  const heading = (label: string) => (
    <tr className="bg-surface">
      <th colSpan={8} scope="colgroup" className="eyebrow border-y border-border text-left">
        {label}
      </th>
    </tr>
  );
  const section = (label: string, items: TaskItem[], arrange?: string) => {
    if (items.length === 0) return null;
    // Arranging saves a group's whole order, so it waits until every row of it is on screen.
    if (!arrange || filtering) {
      return (
        <tbody key={label} className="divide-y divide-border">
          {heading(label)}
          {items.map(row)}
        </tbody>
      );
    }
    return (
      <Droppable key={label} droppableId={arrange}>
        {(drop) => (
          <tbody ref={drop.innerRef} {...drop.droppableProps} className="divide-y divide-border">
            {heading(label)}
            {items.map((t, i) => dragRow(t, i))}
            {drop.placeholder}
          </tbody>
        )}
      </Droppable>
    );
  };

  /*
   * Done: the last 14 days, then "Show older" — 50 more each press, newest
   * first, until there are none. History, not a plan, so never arrangeable.
   */
  const doneGroup = () => {
    const more = Boolean(data?.success && (showOlder ? older.hasNextPage : data.hasOlderDone));
    if (shown.completed.length === 0 && !more) return null;
    return (
      <tbody key="done" className="divide-y divide-border">
        {heading(olderDone.length > 0 ? 'Done' : `Done in the last ${data?.doneDays ?? 14} days`)}
        {shown.completed.map(row)}
        {more && (
          <tr>
            <td colSpan={8} className="px-5 py-3">
              <Button
                variant="ghost"
                size="sm"
                loading={older.isFetching}
                onClick={() => (showOlder ? void older.fetchNextPage() : setShowOlder(true))}
              >
                Show older
              </Button>
            </td>
          </tr>
        )}
      </tbody>
    );
  };

  return (
    <div className="page-shell">
      {/*
        Quick add (Ease Plan 1): a title and Enter makes it — for you, due
        today, filed where your last task was. With nothing to go on, Enter
        opens the full form with the title in it.
      */}
      {/* Getting started (Ease Plan 2): above the quick add, until every step is done or it is hidden. */}
      <GettingStartedCard
        onAddTask={() => {
          quickAddRef.current?.focus();
          quickAddRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }}
        onFinishTask={() => document.getElementById('my-work-list')?.scrollIntoView({ block: 'start', behavior: 'smooth' })}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void quickAdd();
        }}
        className="mb-6"
      >
        <label htmlFor="quick-add" className="sr-only">
          Add a task for myself
        </label>
        <div className="flex items-center gap-2 rounded-xl border border-border bg-white px-3 py-2.5 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
          <Plus className="h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
          <input
            id="quick-add"
            ref={quickAddRef}
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            placeholder="Add a task for myself — press Enter"
            maxLength={300}
            enterKeyHint="done"
            autoComplete="off"
            disabled={quickBusy}
            className="min-w-0 flex-1 bg-transparent text-sm text-body outline-none placeholder:text-secondary"
          />
        </div>
      </form>

      <StatRow className="mb-8">
        <StatTile label="Due Today" value={counts.today} note={`${onHoldCount} on hold`} />
        {/*
          Red only when there IS something overdue. This was `tone="danger"`
          flat, so a clear morning opened on a red zero — the good outcome
          styled as an alarm, on the first screen everybody sees. The note
          beside it was already conditional, so zero was known to be reachable;
          the colour just never got the same treatment. Three other screens do
          it this way (members, money, assets).
        */}
        <StatTile
          label="Overdue"
          value={counts.overdue}
          note={counts.overdue > 0 ? `oldest open ${oldestOpen}` : 'nothing late'}
          tone={counts.overdue > 0 ? 'danger' : 'default'}
        />
        {/*
          The note used to read "nothing at risk" as a string literal — a claim
          about the week that never looked at the week. It now counts.
        */}
        <StatTile
          label="Rest of the week"
          value={counts.thisWeek}
          note={counts.thisWeek === 0 ? 'nothing due' : `${plural(counts.thisWeek, 'task')} due`}
        />
        <StatTile label="Your average close" value={avgClose} note={`across ${plural(counts.completed, 'task')}`} />
      </StatRow>

      {/* Deals and leads with a next step due — only for someone who has any. */}
      <div className="mb-6">
        <FollowUps />
      </div>

      <Card padding="none" className="overflow-hidden" id="my-work-list">
        <CardHeader className="flex-wrap gap-2">
          <CardTitle>Everything assigned to you</CardTitle>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-micro text-secondary">
              Group by
              <select
                aria-label="Group your tasks by"
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                className="h-8 rounded-lg border border-border bg-white px-2.5 text-sm text-body outline-none focus:border-primary"
              >
                <option value="when">When</option>
                <option value="work">Project or retainer</option>
              </select>
            </label>
            <Button variant="secondary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
              Task for myself
            </Button>
          </div>
        </CardHeader>

        {/* Filtered: say how much is showing, and how to get the rest back. */}
        {filtering && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface px-5 py-2 text-xs text-secondary">
            <span>
              Showing <span className="font-semibold tabular-nums text-primary">{shownTotal}</span> of {plural(total, 'task')}
            </span>
            <button
              type="button"
              onClick={() => setFilters(NO_FILTERS)}
              className="rounded-sm font-semibold text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Clear filters
            </button>
            {groupBy === 'when' && <span className="ml-auto">Arranging by drag is off while filtering.</span>}
          </div>
        )}

        {/* What they said they are on — wherever that row is on the list. */}
        {focus && (
          <div className="flex items-center gap-2 border-b border-border bg-info-tint/40 px-5 py-2.5 text-sm">
            <NowBadge />
            <span className="shrink-0 text-secondary">Working on</span>
            <button
              type="button"
              onClick={() => {
                const t = everyTask.find((x) => x.id === focus.id);
                if (t) setSelected(t);
              }}
              className="min-w-0 truncate rounded-sm text-left font-medium text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {focus.title}
            </button>
            <Button variant="ghost" size="sm" className="ml-auto shrink-0" loading={focusBusy} onClick={() => void clearNow()}>
              Clear
            </Button>
          </div>
        )}

        {total === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={CheckSquare}
              title="Nothing assigned"
              hint="When someone gives you work it lands here."
              action={
                <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
                  Task for myself
                </Button>
              }
            />
          </div>
        ) : (
          <>
          {phoneCards()}
          <div className="hidden overflow-x-auto md:block">
            {/*
              `min-w` so the columns keep their own width on a phone and the box
              scrolls, instead of the browser compressing six columns into 356px
              and stacking "October Instagram Growth Content Calendar" four words
              deep. Nothing else in the app sets one yet and every table in it
              shreds the same way at that width — this is the screen to fix
              first, because it is the only one somebody reads standing up.
            */}
            <table className="w-full min-w-220 text-sm data-table">
              <thead>
                <tr className="border-b border-border">
                  {/* The grip column — the grip is its own label. */}
                  <th className="w-8" aria-label="Arrange" />
                  <th className="eyebrow text-left">
                    <span className="inline-flex items-center gap-1.5">
                      Task
                      <ColumnTextFilter column="Task" value={filters.text} onChange={setFilter('text')} placeholder="Task, client or project…" />
                    </span>
                  </th>
                  <th className="eyebrow text-left">
                    <span className="inline-flex items-center gap-1.5">
                      Type of work
                      <ColumnFilter column="Type of work" options={options.type} selected={filters.type} onChange={setFilter('type')} />
                    </span>
                  </th>
                  <th className="eyebrow text-left">
                    <span className="inline-flex items-center gap-1.5">
                      For
                      <ColumnFilter column="Client" options={options.client} selected={filters.client} onChange={setFilter('client')} />
                    </span>
                  </th>
                  <th className="eyebrow text-left">
                    <span className="inline-flex items-center gap-1.5">
                      Due
                      <ColumnFilter column="Due" options={options.due} selected={filters.due} onChange={setFilter('due')} />
                    </span>
                  </th>
                  <th className="eyebrow text-left">
                    <span className="inline-flex items-center gap-1.5">
                      Priority
                      <ColumnFilter column="Priority" options={options.priority} selected={filters.priority} onChange={setFilter('priority')} />
                    </span>
                  </th>
                  <th className="eyebrow text-left">
                    <span className="inline-flex items-center gap-1.5">
                      Elapsed
                      <ColumnFilter column="Elapsed" options={options.elapsed} selected={filters.elapsed} onChange={setFilter('elapsed')} />
                    </span>
                  </th>
                  <th className="eyebrow text-left">
                    <span className="inline-flex items-center gap-1.5">
                      Status
                      <ColumnFilter column="Status" options={options.status} selected={filters.status} onChange={setFilter('status')} />
                    </span>
                  </th>
                </tr>
              </thead>
              {filtering && shownTotal === 0 && (
                <tbody>
                  <tr>
                    <td colSpan={8} className="px-5 py-10 text-center text-sm text-secondary">
                      No tasks match these filters.{' '}
                      <button
                        type="button"
                        onClick={() => setFilters(NO_FILTERS)}
                        className="rounded-sm font-semibold text-primary underline-offset-2 hover:underline"
                      >
                        Clear filters
                      </button>
                    </td>
                  </tr>
                </tbody>
              )}
              {groupBy === 'work' ? (
                <>
                  {/* The work still to do, under what it belongs to — in My Work's own order. */}
                  {workGroups.map((g) => {
                    const open = !folded.has(g.key);
                    return (
                      <tbody key={`work:${g.key}`} className="divide-y divide-border">
                        <tr className="bg-surface">
                          <td colSpan={8} className="border-y border-border">
                            <button
                              type="button"
                              aria-expanded={open}
                              onClick={() =>
                                setFolded((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(g.key)) next.delete(g.key);
                                  else next.add(g.key);
                                  return next;
                                })
                              }
                              className="flex w-full items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                            >
                              <ChevronRight
                                className={`h-4 w-4 shrink-0 text-secondary transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
                              />
                              <span className="text-sm font-semibold text-primary">{g.label}</span>
                              {g.sub && <span className="truncate text-micro text-secondary">{g.sub}</span>}
                              <span className="ml-auto rounded-full border border-border bg-white px-2 py-0.5 text-micro font-semibold tabular-nums text-secondary">
                                {g.tasks.length}
                              </span>
                            </button>
                          </td>
                        </tr>
                        {open && g.tasks.map(row)}
                      </tbody>
                    );
                  })}
                  {doneGroup()}
                </>
              ) : (
                <DragDropContext onBeforeCapture={onBeforeCapture} onDragEnd={(r) => void onDragEnd(r)}>
                  {section('Overdue', shown.overdue, 'overdue')}
                  {section('Due today', shown.today, 'today')}
                  {/* This week and beyond, arranged as one: "Later this week" was
                      wrong for a task due next month. */}
                  {section('Coming up', [...shown.thisWeek, ...shown.later], 'week')}
                  {doneGroup()}
                </DragDropContext>
              )}
            </table>
          </div>
          </>
        )}
      </Card>

      <NewTaskModal
        open={creating}
        initialTitle={creatingTitle || undefined}
        onClose={() => {
          setCreating(false);
          setCreatingTitle('');
        }}
        onCreated={() => {
          setCreating(false);
          // Made from the quick add line: it has done its job.
          if (creatingTitle) setQuickTitle('');
          setCreatingTitle('');
          void load();
        }}
      />
      <TaskDrawer
        task={toDrawerTask(selected)}
        statusOptions={STATUS_OPTIONS}
        busy={busyId === selected?.id}
        onClose={() => {
          setSelected(null);
          setLinkedId(null);
          forgetTaskParam();
        }}
        onStatusChange={(t, next) => void changeStatus(t as unknown as TaskItem, next as TStatus)}
        onChanged={async () => {
          await load();
          // Not on this list, so the list cannot refresh it: ask for it again.
          if (linkedId) void openLinked(linkedId, { afterChange: true });
        }}
      />
    </div>
  );
}
