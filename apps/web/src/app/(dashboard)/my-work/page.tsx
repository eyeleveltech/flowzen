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

import { Fragment, useState, useEffect, useCallback } from 'react';
import { plural } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { api, formatDate, ApiError, type Company } from '@/lib/api-v2';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Field, FieldSelect } from '@/components/ui/field';
import { EmptyState, ErrorNote } from '@/components/ui/empty-state';
import { usePageHeader } from '@/hooks/usePageHeader';
import { PRIORITY_CONFIG, getPriorityDot, getPriorityLabel } from '@/lib/priority';
import { StatTile, StatRow } from '@/components/ui/stat-tile';
import { TaskDrawer, type DrawerTask } from '@/components/work/TaskDrawer';
import toast from 'react-hot-toast';
import { CheckSquare, Plus } from 'lucide-react';
import { personOptions } from '@/lib/people';
import { useAuthStore } from '@/stores';
import { TASK_TYPE_OPTIONS } from '@/lib/task-type';

const PRIORITY_OPTIONS = Object.entries(PRIORITY_CONFIG).map(([value, cfg]) => ({ value, label: cfg.label }));

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

type Buckets = { overdue: TaskItem[]; today: TaskItem[]; thisWeek: TaskItem[]; later: TaskItem[]; completed: TaskItem[] };
const EMPTY_BUCKETS: Buckets = { overdue: [], today: [], thisWeek: [], later: [], completed: [] };

const STATUS_OPTIONS = [
  { value: 'TODO', label: 'To do' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'DONE', label: 'Done' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export default function MyWorkPage() {
  const router = useRouter();
  const [buckets, setBuckets] = useState<Buckets>(EMPTY_BUCKETS);
  const [counts, setCounts] = useState({ today: 0, overdue: 0, thisWeek: 0, later: 0, completed: 0 });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<TaskItem | null>(null);

  const [onHoldCount, setOnHoldCount] = useState(0);
  const [oldestOpen, setOldestOpen] = useState<string>('nothing open');
  const [avgClose, setAvgClose] = useState<string>('0h');

  const load = useCallback(async () => {
    try {
      const res = await api.tasks.my();
      if (res.success) {
        setBuckets(res.tasks as Buckets);
        setCounts(res.counts);

        const waiting = res.tasks.today.filter((t: TaskItem) => t.status === 'ON_HOLD').length;
        setOnHoldCount(waiting);

        if (res.tasks.overdue.length > 0) {
          const oldest = res.tasks.overdue.reduce((old: TaskItem, current: TaskItem) =>
            new Date(current.assignedAt) < new Date(old.assignedAt) ? current : old, res.tasks.overdue[0]);
          setOldestOpen(oldest.workingHoursText);
        }

        if (res.tasks.completed.length > 0) {
          const totalMins = res.tasks.completed.reduce((acc: number, t: TaskItem) => acc + t.workingMinutes, 0);
          const avgMins = Math.floor(totalMins / res.tasks.completed.length);
          const days = Math.floor(avgMins / 540);
          const hours = Math.floor((avgMins % 540) / 60);
          setAvgClose(days > 0 && hours > 0 ? `${days}d ${hours}h` : days > 0 ? `${days}d` : hours > 0 ? `${hours}h` : '<1h');
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Quick Create's "New task" has nowhere else to land — there is no
  // freestanding /tasks screen, a task always opens from wherever it lives.
  // This mirrors /companies' own ?create=true handling.
  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('create') === 'true') {
      setCreating(true);
      router.replace('/my-work');
    }
  }, [router]);

  const changeStatus = async (task: TaskItem, next: TStatus) => {
    if (next === task.status) return;
    setBusyId(task.id);
    try {
      if (next === 'ON_HOLD') {
        await api.tasks.wait(task.id, 'CLIENT');
      } else if (task.status === 'ON_HOLD') {
        // /resume is the only route that closes out waitingSince and folds
        // it into waitingTotalMinutes — always go through it first, then
        // layer the real target status on top if it's not just "resume".
        await api.tasks.resume(task.id);
        if (next !== 'IN_PROGRESS') await api.tasks.updateStatus(task.id, next);
      } else {
        await api.tasks.updateStatus(task.id, next);
      }
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
  const total = counts.today + counts.overdue + counts.thisWeek + counts.later + counts.completed;

  if (loading) return null;

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
  const row = (t: TaskItem) => {
    const finished = t.status === 'DONE' || t.status === 'CANCELLED';
    const late = !finished && t.dueDate.slice(0, 10) < todayKey;
    const job = jobLabel(t);
    return (
      <tr key={t.id} onClick={() => setSelected(t)} className="cursor-pointer transition-colors hover:bg-subtle">
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
          </button>
          {t.status === 'ON_HOLD' && t.waitingOn && (
            <p className="mt-0.5 text-micro text-secondary">
              waiting on {t.waitingOn === 'CLIENT' ? 'the client' : 'someone else'}
            </p>
          )}
        </td>
        {/* Who it is for, over which job of theirs it belongs to — the second
            was on no screen this side of the drawer until now. */}
        <td>
          <p className="text-body">{t.clientName}</p>
          {job && <p className="text-micro text-secondary">{job}</p>}
        </td>
        <td className={`whitespace-nowrap ${late ? 'font-semibold text-danger' : 'text-secondary'}`}>
          {formatDate(t.dueDate)}
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
            disabled={busyId === t.id}
          />
        </td>
      </tr>
    );
  };

  /*
   * A bucket heading, as a row of the table rather than a bar above one — so
   * the columns underneath stay in the same six tracks all the way down.
   * `<th scope="colgroup">` because that is what it is: a heading for the rows
   * that follow. It also keeps the 11px, since `.data-table td` sets a font
   * size and would otherwise beat `.eyebrow` on a `<td>`.
   */
  const section = (label: string, items: TaskItem[]) =>
    items.length > 0 && (
      <Fragment key={label}>
        <tr className="bg-surface">
          <th colSpan={6} scope="colgroup" className="eyebrow border-y border-border text-left">
            {label}
          </th>
        </tr>
        {items.map(row)}
      </Fragment>
    );

  return (
    <div className="page-shell">
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
                  <th className="eyebrow text-left">Task</th>
                  <th className="eyebrow text-left">For</th>
                  <th className="eyebrow text-left">Due</th>
                  <th className="eyebrow text-left">Priority</th>
                  <th className="eyebrow text-left">Elapsed</th>
                  <th className="eyebrow text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {section('Overdue', buckets.overdue)}
                {section('Due today', buckets.today)}
                {section('Later this week', [...buckets.thisWeek, ...buckets.later])}
                {section('Done this week', buckets.completed)}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <NewTaskModal open={creating} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); void load(); }} />
      <TaskDrawer
        task={toDrawerTask(selected)}
        statusOptions={STATUS_OPTIONS}
        busy={busyId === selected?.id}
        onClose={() => setSelected(null)}
        onStatusChange={(t, next) => void changeStatus(t as unknown as TaskItem, next as TStatus)}
        onChanged={load}
      />
    </div>
  );
}

type Target = { label: string; workType: 'RETAINER' | 'PROJECT'; monthCardId?: string; projectId?: string };

function NewTaskModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const me = useAuthStore((s) => s.user);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [description, setDescription] = useState('');
  /*
   * This form kept its own fields and never got the ones the other two task
   * forms grew — a reviewer and a kind of work — so a task raised from My Work
   * came out different from an identical task raised anywhere else.
   *
   * There is deliberately no assignee picker: the dialog is called "Task for
   * myself" and the server already defaults to the caller. A reviewer is still
   * worth asking for, because "somebody should check this" is a thing you know
   * when you write the task down, whoever is doing it.
   */
  const [reviewerId, setReviewerId] = useState('');
  const [assignedById, setAssignedById] = useState('');
  const [taskType, setTaskType] = useState('');
  const [team, setTeam] = useState<{ id: string; name: string; designation: string | null; dept: string }[]>([]);

  useEffect(() => {
    if (!open) return;
    api.team.members().then((r) => setTeam(r.members ?? [])).catch(() => setTeam([]));
  }, [open]);
  const [scope, setScope] = useState<'INTERNAL' | 'CLIENT'>('INTERNAL');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [targets, setTargets] = useState<Target[]>([]);
  const [targetKey, setTargetKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(''); setDueDate(''); setPriority('MEDIUM'); setDescription('');
      setScope('INTERNAL'); setCompanyId(''); setTargetKey(''); setError(null);
      setAssignedById(me?.id ?? '');
    }
  }, [open, me?.id]);

  useEffect(() => {
    if (scope !== 'CLIENT') return;
    void api.companies.list().then((res) => setCompanies(res.companies)).catch(() => {});
  }, [scope]);

  useEffect(() => {
    setTargets([]);
    setTargetKey('');
    if (scope !== 'CLIENT' || !companyId) return;
    setLoadingTargets(true);
    void api.companies
      .get(companyId)
      .then((res) => {
        const company = (res as { company?: any }).company ?? res;
        const list: Target[] = [];
        for (const r of company.retainers ?? []) {
          if (r.status !== 'ACTIVE') continue;
          const currentMonth = (r.monthCards ?? [])[0];
          if (currentMonth) list.push({ label: `Retainer — ${currentMonth.month}`, workType: 'RETAINER', monthCardId: currentMonth.id });
        }
        for (const p of company.projects ?? []) {
          if (p.status !== 'LIVE') continue;
          list.push({ label: `Project — ${p.name}`, workType: 'PROJECT', projectId: p.id });
        }
        setTargets(list);
      })
      .catch(() => {})
      .finally(() => setLoadingTargets(false));
  }, [companyId, scope]);

  const selectedTarget = targets.find((t) => (t.monthCardId ?? t.projectId) === targetKey);
  const canSave = Boolean(title.trim()) && Boolean(dueDate) && (scope === 'INTERNAL' || Boolean(selectedTarget));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await api.tasks.create({
        title: title.trim(),
        workType: scope === 'INTERNAL' ? 'INTERNAL' : selectedTarget?.workType === 'RETAINER' ? 'MONTH_CARD' : 'PROJECT',
        monthCardId: scope === 'CLIENT' ? selectedTarget?.monthCardId : undefined,
        projectId: scope === 'CLIENT' ? selectedTarget?.projectId : undefined,
        dueDate,
        priority,
        reviewerId: reviewerId || undefined,
        assignedById: assignedById || undefined,
        taskType: taskType || undefined,
        notes: description.trim() || undefined,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the task');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Task for myself">
      <form onSubmit={submit}>
        <ModalBody className="space-y-4">
          <Field label="What needs doing?" value={title} onChange={setTitle} required />

          <FieldSelect
            label="Belongs to"
            value={scope}
            onChange={(v) => setScope(v as 'INTERNAL' | 'CLIENT')}
            required
            options={[
              { value: 'INTERNAL', label: 'Internal — no client' },
              { value: 'CLIENT', label: 'A client’s work' },
            ]}
          />

          {scope === 'CLIENT' && (
            <>
              <FieldSelect
                label="Company"
                value={companyId}
                onChange={setCompanyId}
                required
                placeholder="Choose a company…"
                options={companies.map((c) => ({ value: c.id, label: c.name }))}
              />
              <FieldSelect
                label="Which job"
                value={targetKey}
                onChange={setTargetKey}
                required
                disabled={!companyId || loadingTargets}
                placeholder={!companyId ? 'Choose a company first' : loadingTargets ? 'Loading…' : targets.length === 0 ? 'Nothing live' : 'Choose…'}
                options={targets.map((t) => ({ value: (t.monthCardId ?? t.projectId)!, label: t.label }))}
              />
            </>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field label="Due date" type="date" value={dueDate} onChange={setDueDate} required />
            <FieldSelect label="Priority" value={priority} onChange={setPriority} options={PRIORITY_OPTIONS} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FieldSelect
              label="Assigned by"
              value={assignedById}
              onChange={setAssignedById}
              placeholder="Nobody in particular"
              options={personOptions(team)}
            />
            <FieldSelect
              label="Reviewer"
              value={reviewerId}
              onChange={setReviewerId}
              placeholder="Nobody reviews it"
              options={personOptions(team)}
            />
          </div>
          <FieldSelect
            label="Type of work"
            value={taskType}
            onChange={setTaskType}
            placeholder="Not set"
            options={TASK_TYPE_OPTIONS}
          />
          <Field label="Description" value={description} onChange={setDescription} textarea rows={3} />
          {error && <ErrorNote>{error}</ErrorNote>}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!canSave}>Add task</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
