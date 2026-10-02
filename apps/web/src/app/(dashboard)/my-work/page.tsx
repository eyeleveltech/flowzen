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

import { Fragment, useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DragDropContext, Droppable, Draggable, type BeforeCapture, type DropResult } from '@hello-pangea/dnd';
import { plural } from '@/lib/utils';
import { api, formatDate, ApiError } from '@/lib/api-v2';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { usePageHeader } from '@/hooks/usePageHeader';
import { useCreateFlag } from '@/hooks/useCreateFlag';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApprovalQueue } from '@/components/work/ApprovalQueue';
import { ApprovalDrawer } from '@/components/work/ApprovalDrawer';
import { StuckApproval } from '@/components/work/Approval';
import { InlineDueDate } from '@/components/work/InlineDueDate';
import { changeTaskStatus } from '@/lib/task-status';
import { statusChoices } from '@/components/retainers/task-shared';
import { Badge } from '@/components/ui/badge';
import type { LastReview } from '@/lib/api-v2';
import { getPriorityDot, getPriorityLabel } from '@/lib/priority';
import { StatTile, StatRow } from '@/components/ui/stat-tile';
import { TaskDrawer, type DrawerTask } from '@/components/work/TaskDrawer';
import toast from 'react-hot-toast';
import { CheckSquare, Plus, GripVertical } from 'lucide-react';
import type { TaskRepeatInfo } from '@/lib/repeat';
import { RepeatMark } from '@/components/work/RepeatMark';
import { NewTaskModal } from '@/components/work/NewTaskModal';
import { taskTypeLabel } from '@/lib/task-type';


type TStatus = 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'ON_HOLD' | 'DONE' | 'CANCELLED';

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
  workingHoursText: string;
  workingMinutes: number;
  typeMedianMinutes: number | null;
  typeMedianText: string | null;
  /** Needs an approver's sign-off before it is done. */
  needsApproval?: boolean;
  /** The last round of approval — what "Changes requested" and its feedback come from. */
  lastReview?: LastReview | null;
  /** How long the waiting round has waited, in working time. */
  reviewWaitingText?: string | null;
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
  /** Sent for approval, waiting on an approver — out of this person's hands. */
  inReview: TaskItem[];
  completed: TaskItem[];
};
const EMPTY_BUCKETS: Buckets = { overdue: [], today: [], thisWeek: [], later: [], inReview: [], completed: [] };

/** The cells of one draggable row on the page, found by its task id. */
const rowCells = (id: string) =>
  Array.from(
    document.querySelector<HTMLTableRowElement>(`tr[data-task-row="${CSS.escape(id)}"]`)?.cells ?? [],
  );

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

  const buckets: Buckets = data?.success ? { ...EMPTY_BUCKETS, ...(data.tasks as Partial<Buckets>) } : EMPTY_BUCKETS;
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
   * one. "Done this week" is history, not a plan, and is not arrangeable.
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
        toast.error(e instanceof ApiError ? e.message : 'Could not save that order');
        void refetch();
      }
    },
    [buckets, queryClient, refetch],
  );
  const counts = { today: 0, overdue: 0, thisWeek: 0, later: 0, inReview: 0, completed: 0, ...(data?.counts ?? {}) };
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<TaskItem | null>(null);

  /*
   * /my-work?task=… — the WhatsApp approval link.
   *
   * A task on this person's own list opens in the usual drawer. Anything else
   * — which is every approval, since approvers are not on the work — opens
   * the approval drawer, drawn from the task's review history. Closing either
   * takes the id back out of the address, so a refresh does not reopen it.
   */
  const router = useRouter();
  const searchParams = useSearchParams();
  const taskParam = searchParams.get('task');
  const [approvalTaskId, setApprovalTaskId] = useState<string | null>(null);
  const everyTask = useMemo(
    () => [
      ...buckets.overdue,
      ...buckets.today,
      ...buckets.thisWeek,
      ...buckets.later,
      ...buckets.inReview,
      ...buckets.completed,
    ],
    [buckets],
  );
  useEffect(() => {
    if (!taskParam || isPending) return;
    const mine = everyTask.find((t) => t.id === taskParam);
    if (mine) setSelected(mine);
    else setApprovalTaskId(taskParam);
    // Only when the link or the list arrives, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskParam, isPending]);
  const forgetTaskParam = () => {
    if (taskParam) router.replace('/my-work');
  };

  // The open task follows the list: after an edit, an approval sent or a
  // decision, the drawer shows the task as it is now, not as it was clicked.
  useEffect(() => {
    if (!selected) return;
    const fresh = everyTask.find((t) => t.id === selected.id);
    if (fresh && fresh !== selected) setSelected(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [everyTask]);

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

  const avgClose = useMemo(() => {
    if (buckets.completed.length === 0) return '0h';
    const totalMins = buckets.completed.reduce((acc, t) => acc + t.workingMinutes, 0);
    const avgMins = Math.floor(totalMins / buckets.completed.length);
    const days = Math.floor(avgMins / 540);
    const hours = Math.floor((avgMins % 540) / 60);
    return days > 0 && hours > 0 ? `${days}d ${hours}h` : days > 0 ? `${days}d` : hours > 0 ? `${hours}h` : '<1h';
  }, [buckets]);

  /** What the mutation handlers call after they change something. */
  const load = useCallback(async () => {
    await refetch();
  }, [refetch]);

  // Quick Create's "New task" lands here — including when you are already
  // here, which is the case the old mount-only check missed.
  useCreateFlag(() => setCreating(true), '/my-work');

  const changeStatus = async (task: TaskItem, next: TStatus) => {
    if (next === task.status) return;
    setBusyId(task.id);
    try {
      // On hold goes through /wait and /resume, so the wait is timed.
      await changeTaskStatus(task, next);
      await load();
      setSelected((s) => (s && s.id === task.id ? { ...s, status: next } : s));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update that task');
    } finally {
      setBusyId(null);
    }
  };

  const todayStr = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  /* Local, not UTC. `toISOString()` rolls over five and a half hours early
     here, so a task due today reads as late all evening. */
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  usePageHeader('My Work', todayStr);
  const total = counts.today + counts.overdue + counts.thisWeek + counts.later + counts.inReview + counts.completed;

  if (isPending) return null;

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
  const cells = (t: TaskItem, grip: React.ReactNode) => {
    const finished = t.status === 'DONE' || t.status === 'CANCELLED';
    // Waiting on an approver is not this person's lateness.
    const late = !finished && t.status !== 'IN_REVIEW' && t.dueDate.slice(0, 10) < todayKey;
    const job = jobLabel(t);
    // Sent back, and not yet sent again: the feedback is the work.
    const sentBack =
      t.lastReview?.decision === 'CHANGES_REQUESTED' && (t.status === 'TODO' || t.status === 'IN_PROGRESS');
    return (
      <>
        <td className="w-8 pr-0 text-secondary">{grip}</td>
        <td>
          {/*
            A button inside the row rather than a click handler alone: the row
            is the target for a mouse, and this is what a keyboard and a screen
            reader get to open the same thing.
          */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setSelected(t); }}
            className={`rounded-sm text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${finished ? 'text-secondary line-through' : 'text-primary'}`}
          >
            {t.title}
          </button> <RepeatMark repeat={t.repeat} />
          {t.status === 'ON_HOLD' && t.waitingOn && (
            <p className="mt-0.5 text-micro text-secondary">
              waiting on {t.waitingOn === 'CLIENT' ? 'the client' : 'someone else'}
            </p>
          )}
          {t.status === 'IN_REVIEW' && t.lastReview && (
            <p className="mt-0.5 text-micro text-secondary">
              round {t.lastReview.round} · sent {formatDate(t.lastReview.submittedAt)}
            </p>
          )}
          {/* Past the reminder time with no answer: say so, and offer the nudge. */}
          {t.status === 'IN_REVIEW' && t.lastReview && !t.lastReview.decision && t.lastReview.remindedAt && (
            <StuckApproval
              taskId={t.id}
              title={t.title}
              clientName={t.clientName}
              projectName={t.projectName ?? null}
              waited={t.reviewWaitingText ?? null}
              escalatedTo={t.lastReview.escalatedAt ? (t.lastReview.escalatedTo ?? []) : null}
            />
          )}
          {sentBack && (() => {
            // Everybody's changes, not only the first approver's — the others
            // can add theirs while it is with you.
            const changes = [
              ...(t.lastReview?.feedback ? [{ who: t.lastReview.decidedBy?.name, text: t.lastReview.feedback }] : []),
              ...(t.lastReview?.notes ?? []).map((n) => ({ who: n.author.name, text: n.feedback })),
            ];
            return (
              <div className="mt-1 max-w-md">
                <Badge tone="warn">
                  Changes requested{changes.length > 1 ? ` · ${changes.length}` : ''}
                </Badge>
                {changes.slice(0, 2).map((c, i) => (
                  <p key={i} className="mt-0.5 line-clamp-2 text-micro text-body">
                    “{c.text}”{c.who && <span className="text-secondary"> — {c.who}</span>}
                  </p>
                ))}
                {changes.length > 2 && (
                  <p className="mt-0.5 text-micro text-secondary">+{changes.length - 2} more — open the task to see them all</p>
                )}
              </div>
            );
          })()}
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
            disabled={finished}
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
            options={statusChoices(STATUS_OPTIONS, t)}
            ariaLabel={`Status for ${t.title}`}
            buttonClassName="px-2.5 py-1.5 text-xs w-32"
            disabled={busyId === t.id}
          />
        </td>
      </>
    );
  };

  /** A finished task: history, so it does not move. */
  const row = (t: TaskItem) => (
    <tr key={t.id} onClick={() => setSelected(t)} className="group/row cursor-pointer transition-colors hover:bg-subtle">
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
          onClick={() => setSelected(t)}
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
    if (!arrange) {
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

  return (
    <div className="page-shell">
      {/* Only for approvers, and only when something is waiting. */}
      <ApprovalQueue onOpen={(id) => setApprovalTaskId(id)} />

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

      <Card padding="none" className="overflow-hidden">
        <CardHeader>
          <CardTitle>Everything assigned to you</CardTitle>
          <Button variant="secondary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
            Task for myself
          </Button>
        </CardHeader>

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
          <div className="overflow-x-auto">
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
                  <th className="eyebrow text-left">Task</th>
                  <th className="eyebrow text-left">Type of work</th>
                  <th className="eyebrow text-left">For</th>
                  <th className="eyebrow text-left">Due</th>
                  <th className="eyebrow text-left">Priority</th>
                  <th className="eyebrow text-left">Elapsed</th>
                  <th className="eyebrow text-left">Status</th>
                </tr>
              </thead>
              <DragDropContext onBeforeCapture={onBeforeCapture} onDragEnd={(r) => void onDragEnd(r)}>
                {section('Overdue', buckets.overdue, 'overdue')}
                {section('Due today', buckets.today, 'today')}
                {section('Later this week', [...buckets.thisWeek, ...buckets.later], 'week')}
                {/* Below the active work: open, but the approver's move. */}
                {section('Waiting for approval', buckets.inReview)}
                {section('Done this week', buckets.completed)}
              </DragDropContext>
            </table>
          </div>
        )}
      </Card>

      <NewTaskModal open={creating} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); void load(); }} />
      <TaskDrawer
        task={toDrawerTask(selected)}
        statusOptions={STATUS_OPTIONS}
        busy={busyId === selected?.id}
        onClose={() => {
          setSelected(null);
          forgetTaskParam();
        }}
        onStatusChange={(t, next) => void changeStatus(t as unknown as TaskItem, next as TStatus)}
        onChanged={load}
      />
      <ApprovalDrawer
        taskId={approvalTaskId}
        onClose={() => {
          setApprovalTaskId(null);
          forgetTaskParam();
        }}
        onChanged={load}
      />
    </div>
  );
}
