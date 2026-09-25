'use client';

/**
 * One retainer: its projects first, and a month at a time behind them.
 *
 * §10 asks for "one month of a retainer — tasks, costs, allocations, invoice,
 * profit", and that is what this was: a flat list of everything the client was
 * owed that month, thirty rows with no shape. Which is the problem retainer
 * projects were added to solve and then did not, because the list was still
 * the first thing you saw and the grouping was a heading inside it.
 *
 * So the order is inverted. A retainer is a handful of named pieces of work —
 * a Diwali campaign, an always-on stream, a brand film — and a task is
 * something you reach by opening the one it belongs to. There is no ungrouped
 * retainer work: a task on a month card names a project, the database enforces
 * it, and every retainer is created with a default one that catches the
 * monthly baseline.
 *
 * Opening a project shows its tasks across EVERY month it touches, grouped by
 * the month that bills each one. Scoping that to the month in the header would
 * put a campaign crossing October into November back into the two unrelated
 * piles the feature exists to join. Costs, allocations and the invoice are the
 * other way round — they belong to one month, and the month pill scopes them.
 *
 * The retainer itself (company, term, renewal, owner) is fetched separately
 * from the month card, because a month with no card yet — before the retainer
 * started, or one the roll-month job hasn't reached — still needs that header
 * to render while the body says so.
 *
 * No Team tab, same reasoning as the Project page: v2 has one ownerId, not a
 * roster. Allocations are shown read-only here — confirming them is a monthly,
 * org-wide action (§13's allocation job, one screen across every job) not a
 * per-retainer one, so it isn't duplicated on this screen.
 */

import { useCallback, useEffect, useState } from 'react';
import { useWorkCacheNudge } from '@/hooks/useWorkCacheNudge';
import { cn } from '@/lib/utils';
import { MultiSelect } from '@/components/ui/multi-select';
import { useAuthStore } from '@/stores';
import { useConfirmStore } from '@/stores/confirm';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ChevronLeft, ChevronRight, CircleSlash, LockOpen, Pencil, Plus, Printer, ReceiptText, Trash2 } from 'lucide-react';
import { api, ApiError, formatMoney, formatDate, type OrgConfig } from '@/lib/api-v2';
import { useTeamMembers } from '@/hooks/queries';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Badge, type Tone } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { plural } from '@/lib/utils';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Field, FieldSelect } from '@/components/ui/field';
import { EmptyState, ErrorNote } from '@/components/ui/empty-state';
import { PageSkeleton } from '@/components/ui/skeleton-loaders';
import { StatTile } from '@/components/ui/stat-tile';
import { Tabs, useTabState, type TabDef } from '@/components/ui/tabs';
import { TaskDrawer, type DrawerTask } from '@/components/work/TaskDrawer';
import { NewWorkTaskModal } from '@/components/work/NewWorkTaskModal';
import { RetainerProjectModal } from '@/components/work/RetainerProjectModal';
import { EditRetainerModal } from '@/components/work/EditRetainerModal';
import type { RetainerProject } from '@/lib/api-v2';
import { NewWorkCostModal } from '@/components/work/NewWorkCostModal';
import { EditCostModal } from '@/components/work/EditCostModal';
import { RecordPaymentModal } from '@/components/work/RecordPaymentModal';
import { getPriorityDot, getPriorityLabel } from '@/lib/priority';

type RStatus = 'ACTIVE' | 'STOPPED';
type TStatus = 'TODO' | 'IN_PROGRESS' | 'ON_HOLD' | 'DONE' | 'CANCELLED';

const TASK_STATUS_OPTIONS = [
  { value: 'TODO', label: 'To do' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'DONE', label: 'Done' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

type Retainer = {
  id: string;
  companyId: string;
  company: { id: string; name: string; vertical: string; city: string };
  monthlyValue: string | number | null;
  startDate: string;
  termMonths: number | null;
  renewalDate: string | null;
  status: RStatus;
  /** Set the day it ended, with the reason somebody typed. Null while it runs. */
  stoppedAt: string | null;
  stopReason: string | null;
  owner: { id: string; name: string; email: string; dept: string } | null;
  template: { id: string; name: string } | null;
  monthCards: { id: string; month: string; status: string }[];
  /** The named pieces of work inside it. No money on any of them. */
  projects: RetainerProject[];
};

/**
 * When a project runs, in the fewest words that are still true.
 *
 * A missing end date is not missing information — it is what an always-on
 * stream looks like, so it reads "from 1 Sep" rather than "1 Sep – —".
 */
function describeRun(p: RetainerProject): string {
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  if (p.startDate && p.endDate) return `${day(p.startDate)} – ${day(p.endDate)}`;
  if (p.startDate) return `from ${day(p.startDate)}`;
  if (p.endDate) return `until ${day(p.endDate)}`;
  return 'ongoing';
}

type Task = {
  id: string;
  title: string;
  /** Which piece of retainer work it is part of, if any. */
  retainerProject?: { id: string; name: string; status: string } | null;
  status: TStatus;
  priority: string;
  dueDate: string;
  // The API has always sent these; the page just never asked for them, so a
  // task's own dates and note were invisible on the screen that owns it.
  assignedAt: string;
  completedAt: string | null;
  notes: string | null;
  reopenCount: number;
  waitingOn: 'CLIENT' | 'ANOTHER_PERSON' | null;
  taskType: string | null;
  assignee: { id: string; name: string; designation?: string | null; dept: string } | null;
  /** Everybody on it, lead first. */
  assignees?: { id: string; name: string; designation?: string | null }[];
  assignedBy?: { id: string; name: string } | null;
  creator?: { id: string; name: string } | null;
  reviewer?: { id: string; name: string } | null;
};
type Cost = { id: string; category: string; vendor: string; paidBy?: string | null; amount: string | number | null; incurredAt: string; enteredBy: { id: string; name: string } | null };
type Allocation = {
  id: string;
  percent: number;
  proposedPercent: number;
  confirmedAt: string | null;
  user: { id: string; name: string; dept: string };
  confirmedBy: { id: string; name: string } | null;
};
type Payment = { id: string; amount: string | number | null; receivedAt: string; mode: string; reference: string | null };
type Invoice = { id: string; number: string; amount: string | number | null; status: string; dueAt: string; paidAt: string | null; payments: Payment[] };

type MonthCard = {
  id: string;
  month: string;
  status: string;
  /** When the row was made — what says whether the roll or a person opened it. */
  createdAt?: string;
  revenue: string | number | null;
  directCostsTotal: string | number | null;
  /** Whether anybody has recorded what the month cost — see retainers.ts. */
  costBasis?: 'recorded' | 'none';
  tasks: Task[];
  costs: Cost[];
  allocations: Allocation[];
  invoice: Invoice | null;
};

/**
 * One project, opened: its tasks across every month it touches.
 *
 * Grouped by the month that bills them, newest first, because the month is not
 * decoration — it is which card the task's cost lands on, and a closed month is
 * one the screen must not offer to edit. `project` is null for the work that
 * belongs to no project.
 */
type ProjectView = {
  project: RetainerProject | null;
  months: { month: string; status: string; tasks: Task[] }[];
  total: number;
};

const STATUS: Record<RStatus, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'Active', tone: 'good' },
  STOPPED: { label: 'Stopped', tone: 'bad' },
};

const shiftMonth = (month: string, delta: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const monthLabel = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
};

const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

/** "2026-09-20T…" → "2026-09". */
const monthKeyOf = (iso: string | null | undefined) => (iso ? iso.slice(0, 7) : '');

export default function RetainerMonthCardPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const month = searchParams.get('month') || currentMonth();
  const nudgeWorkCaches = useWorkCacheNudge();
  const { user: me } = useAuthStore();
  const confirm = useConfirmStore((st) => st.confirm);

  const [retainer, setRetainer] = useState<Retainer | null>(null);
  const [monthCard, setMonthCard] = useState<MonthCard | null>(null);
  const [config, setConfig] = useState<OrgConfig | null>(null);
  const team = useTeamMembers();
  const [loadingRetainer, setLoadingRetainer] = useState(true);
  const [loadingMonth, setLoadingMonth] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /*
   * The tabs, defined once — the row that draws them and the hook that decides
   * which is open read the same list, so a tab cannot be shown and not
   * selectable, or selectable and not shown.
   *
   * In the URL rather than in state, so a refresh keeps you on Costs and "the
   * costs on this month card" is a link somebody can send. The month was
   * already addressable; the tab was not.
   */
  const tabs: TabDef<'projects' | 'costs' | 'allocations' | 'invoice'>[] = [
    /*
     * Projects first, and they are how you reach the work.
     *
     * The month's tasks used to be a flat list of everything the retainer owed
     * that month — thirty rows with no shape, which is the problem retainer
     * projects were added to solve and then did not, because the list was
     * still the first thing and the grouping was a heading inside it. Now the
     * projects are the screen and a task is something you find by opening the
     * piece of work it belongs to.
     *
     * No count on the tab: the panel always carries one more card than there
     * are projects — the work that belongs to none — and a number that has to
     * be explained is worse than no number.
     */
    { key: 'projects', label: 'Projects' },
    {
      key: 'costs',
      label: 'Costs',
      count: monthCard?.costs.length ?? 0,
      visible: (config?.me.permissions ?? []).some((p) => p === 'cost.enter' || p === 'money.figures'),
    },
    { key: 'allocations', label: 'Allocations', count: monthCard?.allocations.length ?? 0 },
    { key: 'invoice', label: 'Invoice' },
  ];
  const [tab, setTab] = useTabState(tabs);
  const [addingTask, setAddingTask] = useState(false);
  const [addingCost, setAddingCost] = useState(false);
  /** The cost row being corrected, if any. */
  const [editingCost, setEditingCost] = useState<Cost | null>(null);
  const [enteringInvoice, setEnteringInvoice] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [editing, setEditing] = useState(false);
  const [recordingPayment, setRecordingPayment] = useState(false);
  // The row you clicked. Held by id rather than by object so that a reload
  // after an edit reopens the FRESH task rather than the stale copy that was
  // in the list when it was clicked.
  // `null` is closed; `{}` is adding; `{ project }` is editing that one.
  const [projectForm, setProjectForm] = useState<{ project?: RetainerProject } | null>(null);

  /*
   * Which project is open, in the URL rather than in state.
   *
   * "The Diwali campaign on the Carlton retainer" is a thing somebody sends to
   * somebody else, and the back button should close the project rather than
   * leave the screen. `none` is the work that belongs to no project — every
   * task in this database is currently one of those, so it is a real
   * destination, not an edge case.
   */
  const openProjectId = searchParams.get('project');

  /*
   * Where the back link goes. `?from=company` is set by the client's Work tab;
   * anything else lands on Live work, which is where a retainer is found when
   * it is not being looked at from its client.
   */
  const cameFromCompany = searchParams.get('from') === 'company' && Boolean(retainer?.company?.id);
  const backHref = cameFromCompany ? `/companies/${retainer?.company?.id}?tab=WORK` : '/live-work';
  const backLabel = cameFromCompany ? (retainer?.company?.name ?? 'Client') : 'Live work';
  /*
   * What the drill-in is showing, and what it is hiding.
   *
   * A project's tasks were rendered as one Card per month, stacked. A campaign
   * running August into October was three tables down the page, each with its
   * own header and its own column row, and the month you actually wanted was
   * wherever it happened to fall. One container with a month switch shows the
   * same work in a third of the height.
   *
   * `taskMonth` is a FILTER on this project's work, not the page's month card
   * — that one still lives in the header and decides which month is billed.
   */
  /*
   * Empty means no filter, and it is a list rather than a single choice
   * because "Open AND Late" is one question, not two.
   */

  /*
   * A project has its own page now, so opening one is a navigation.
   *
   * `?project=` used to swap this page's body out, which meant a task sat
   * below the retainer's header, its four tiles and its tabs — and needed a
   * second month control that could disagree with the first. Old links still
   * work: the effect below sends them on.
   */
  const openProjectHref = (projectId: string) => `/retainers/${id}/projects/${projectId}`;

  /*
   * Old links still work.
   *
   * `?project=` opened a drill-in on this page for months, so it is in
   * bookmarks, in Slack, and in the URL this app's own project cards used to
   * produce. Send it to the page that now owns that view rather than showing
   * a retainer with no sign of what was asked for.
   */
  useEffect(() => {
    if (openProjectId) router.replace(`/retainers/${id}/projects/${openProjectId}`);
  }, [openProjectId, id, router]);



  /**
   * Taking a cost off the month.
   *
   * Soft-deleted on the server, so the figure it fed into stays explainable —
   * the confirmation says what it changes rather than the usual "cannot be
   * undone", which is not the part anybody worries about here.
   */
  const removeCost = async (c: Cost) => {
    const ok = await confirm({
      title: 'Remove this cost?',
      message: `${c.vendor} — ${money(c.amount)}. This month's profit moves by that much. The row is kept on the server so the figure it fed into stays explainable.`,
      confirmText: 'Remove cost',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.costs.remove(c.id);
      toast.success('Cost removed');
      await loadMonthCard();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not remove that cost');
    }
  };

  const loadRetainer = useCallback(async () => {
    setLoadingRetainer(true);
    try {
      const [rRes, cfg] = await Promise.all([api.retainers.get(id), api.config.get()]);
      setRetainer(rRes.retainer as Retainer);
      setConfig(cfg);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this retainer');
    } finally {
      setLoadingRetainer(false);
    }
  }, [id]);

  const loadMonthCard = useCallback(async () => {
    setLoadingMonth(true);
    try {
      const res = await api.retainers.getMonthCard(id, month);
      setMonthCard(res.monthCard as MonthCard);
      // Every write on this page ends here. A task closed or a month reopened
      // moves a figure on /live-work and /money too, and this page holds none
      // of their caches -- see useWorkCacheNudge for why this is free.
      nudgeWorkCaches();
    } catch {
      setMonthCard(null);
    } finally {
      setLoadingMonth(false);
    }
  }, [id, month, nudgeWorkCaches]);

  useEffect(() => {
    void loadRetainer();
  }, [loadRetainer]);

  useEffect(() => {
    void loadMonthCard();
  }, [loadMonthCard]);

  const goToMonth = (next: string) => {
    // Carry the open tab across. Rebuilding the query string from scratch put
    // you back on Tasks every time you stepped a month, which is the one thing
    // you are not doing when you are reading last month's costs.
    const q = new URLSearchParams(searchParams.toString());
    q.set('month', next);
    router.push(`/retainers/${id}?${q}`);
  };

  if (loadingRetainer) return <PageSkeleton />;

  if (!retainer) {
    return (
      <EmptyState
        title="That retainer does not exist"
        hint={error ?? undefined}
        action={
          <Link href="/live-work">
            <Button>Back to Live work</Button>
          </Link>
        }
      />
    );
  }

  const perms = config?.me.permissions ?? [];
  const canEnterCost = perms.includes('cost.enter');
  const canEnterMoney = perms.includes('money.figures');
  const canWriteCompany = perms.includes('company.write');
  const currency = config?.organization.currency ?? 'INR';
  const locale = config?.organization.locale ?? 'en-IN';
  const tz = config?.organization.timezone ?? 'Asia/Kolkata';
  const date = (v: string | null | undefined) => formatDate(v, tz, locale);
  /** A cost is dated to the day, year included: a list can span two. */
  const fullDate = (v: string | null | undefined) => formatDate(v, tz, locale, true);
  const money = (v: string | number | null | undefined) => formatMoney(v, currency, locale);

  const revenue = monthCard?.revenue != null ? Number(monthCard.revenue) : null;
  const costsTotal = monthCard?.directCostsTotal != null ? Number(monthCard.directCostsTotal) : null;
  const profit = revenue != null && costsTotal != null ? revenue - costsTotal : null;
  // The server's own answer to "has anybody said what this month cost?".
  // A zero here is arithmetic on an empty set, not a finding.
  const noCostBasis = monthCard?.costBasis === 'none';
  const confirmedAllocations = (monthCard?.allocations ?? []).filter((a) => a.confirmedAt);
  /** Days past due, today, for an invoice nobody has paid. Nought when it is fine. */
  const invoiceOverdueDays = (() => {
    const inv = monthCard?.invoice;
    if (!inv || inv.status === 'PAID' || inv.status === 'CANCELLED') return 0;
    const due = new Date(inv.dueAt);
    if (Number.isNaN(due.getTime())) return 0;
    const days = Math.floor((Date.now() - due.getTime()) / 86_400_000);
    return days > 0 ? days : 0;
  })();
  /*
   * Did the 1st-of-month roll make this card, or did creating the retainer?
   *
   * From the card's own timestamp, which is the only thing that actually
   * knows. The roll runs at 00:05 on the 1st, so a card stamped in its own
   * month on the 1st or 2nd came from the roll; one stamped later in the month
   * it covers was opened by hand when the retainer was created.
   *
   * Anything else — a backfill, a card built by a seed — gets neither claim.
   * The sentence exists to tell somebody the month appears on its own; asserting
   * WHICH way this particular card arrived, wrongly, is worse than not saying.
   */
  const cardOrigin: 'rolled' | 'with-retainer' | 'unknown' = (() => {
    if (!monthCard?.createdAt) return 'unknown';
    const made = new Date(monthCard.createdAt);
    if (Number.isNaN(made.getTime())) return 'unknown';
    const madeMonth = `${made.getFullYear()}-${String(made.getMonth() + 1).padStart(2, '0')}`;
    if (madeMonth !== monthCard.month) return 'unknown';
    if (made.getDate() <= 2) return 'rolled';
    return monthCard.month === monthKeyOf(retainer.startDate) ? 'with-retainer' : 'unknown';
  })();
  const tasks = monthCard?.tasks ?? [];

  /**
   * The month's tasks, under the piece of work each is part of.
   *
   * Order follows the retainer's own project list so the headings read the
   * same here as they do in the section above, and anything not in a project
   * falls to the bottom under one honest heading rather than being hidden.
   */
  const taskGroups = (() => {
    const order = (retainer?.projects ?? []).map((p) => p.id);
    const byProject = new Map<string, { name: string; tasks: Task[] }>();
    const loose: Task[] = [];
    for (const t of tasks) {
      if (!t.retainerProject) {
        loose.push(t);
        continue;
      }
      const found = byProject.get(t.retainerProject.id);
      if (found) found.tasks.push(t);
      else byProject.set(t.retainerProject.id, { name: t.retainerProject.name, tasks: [t] });
    }
    const groups = [...byProject.entries()]
      .sort((a, b) => {
        const ai = order.indexOf(a[0]);
        const bi = order.indexOf(b[0]);
        return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi);
      })
      .map(([id, g]) => ({ id, name: g.name, tasks: g.tasks }));
    // A loose task cannot exist any more — the CHECK constraint refuses one —
    // but a row that somehow arrives without a project is still work somebody
    // has to do, so it is shown rather than dropped.
    if (loose.length > 0) groups.push({ id: '', name: 'No project on this task', tasks: loose });
    return groups;
  })();

  // One project and nothing loose is not a grouping, it is a heading over the
  // whole table — so the rows are left plain until there is something to tell
  // apart.
  const showGroups = taskGroups.length > 1;
  const openTasks = tasks.filter((t) => t.status !== 'DONE' && t.status !== 'CANCELLED');
  const doneTasks = tasks.filter((t) => t.status === 'DONE');
  /*
   * Cancelled work is not outstanding work.
   *
   * `openTasks` has always excluded it and the denominator did not, so the
   * card read "1 of 6 · 4 open" — one done plus four open is five, and the
   * sixth was a task somebody had called off. Live work counts the same six
   * tasks as five (retainers.ts filters CANCELLED there), so the two screens
   * disagreed about the same month, and a cancelled task dragged the month's
   * completion down for as long as the card existed.
   */
  const countedTasks = tasks.filter((t) => t.status !== 'CANCELLED');
  const cancelledCount = tasks.length - countedTasks.length;
  const donePercent = countedTasks.length
    ? Math.round((doneTasks.length / countedTasks.length) * 100)
    : 0;
  const todayStr = new Date().toISOString().slice(0, 10);

  /*
   * A closed month is a reported month.
   *
   * Closing is what fixes the profit figure — the fee is settled, the costs
   * are in, and somebody has looked at the margin. The screen showed a closed
   * month as fully editable: Task and Cost enabled, every status dropdown
   * live. The API refuses these now; this is what stops the screen offering
   * them in the first place, which is the difference between a guard rail and
   * an error message.
   */
  const monthClosed = monthCard?.status === 'CLOSED';
  const canReopenMonth = perms.includes('setup.admin');

  const reopenMonth = async () => {
    const why = window.prompt(
      `Reopen ${monthLabel(month)}?\n\nIts profit has already been reported. Say what needs to change — it goes on the record.`,
    );
    if (why === null) return;
    if (why.trim().length < 3) {
      toast.error('Say why the month is being reopened');
      return;
    }
    try {
      await api.retainers.reopenMonth(id, month, why.trim());
      toast.success(`${monthLabel(month)} is open again`);
      await loadMonthCard();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not reopen that month');
    }
  };



  /**
   * The way into a retainer's work.
   *
   * A retainer is not thirty tasks, it is a handful of named pieces of work
   * with tasks under them — a Diwali campaign, an always-on stream, a brand
   * film. The month card bills; these say what the work IS. So this is the
   * first panel, and a task is something you reach by opening the project it
   * belongs to.
   *
   * Every retainer has at least one — "Monthly Retainer Work", created with
   * the retainer — because a task on a month card must name a project and the
   * roll needs somewhere to put the monthly baseline on the 1st. So this list
   * is never empty, and there is no leftover card beside it.
   */
  /*
   * Called, not mounted — `ProjectsPanel()` rather than `<ProjectsPanel />`.
   *
   * These are defined inside the page component, so each render makes a NEW
   * function identity. Mounted as elements, React sees a different component
   * type every time and unmounts the whole subtree: every piece of local state
   * under here is destroyed on any parent state change. That is invisible
   * until something below holds state — a dropdown closed itself the instant
   * you picked a value from it, because picking re-rendered the page and threw
   * the dropdown away.
   *
   * Calling them inlines the JSX into this component's own tree, which is what
   * it always was in spirit.
   */
  const ProjectsPanel = () => {

    const projects = retainer.projects ?? [];

    return (
      <>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-primary">Projects</h2>
            <p className="mt-0.5 text-micro text-secondary">
              Covered by the monthly fee — nothing here is billed separately. Open one to see its work.
            </p>
          </div>
          <Button size="sm" icon={Plus} onClick={() => setProjectForm({})}>
            Project
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>

        {projects.length === 0 && (
          <p className="mt-4 text-sm text-secondary">
            No projects on this retainer yet — which should not happen, since one is created with every
            retainer. Add one and its monthly work will have somewhere to go.
          </p>
        )}
      </>
    );
  };

  /** One project as a card: what it is, and how its work is going. */
  const ProjectCard = ({ project }: { project: RetainerProject }) => {
    const c = project.taskCounts;
    const months = project.months;
    const total = c?.total ?? 0;
    const done = c?.done ?? 0;
    const pct = c?.donePercent ?? null;

    return (
      <button
        type="button"
        onClick={() => router.push(openProjectHref(project.id))}
        className="flex flex-col rounded-xl border border-border bg-white p-4 text-left outline-none transition-colors hover:border-primary/40 hover:bg-subtle/40 focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <div className="flex items-start justify-between gap-2">
          <span
            className={`text-sm font-semibold ${
              project.status === 'DONE' ? 'text-secondary line-through' : 'text-primary'
            }`}
          >
            {project.name}
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            {/* The one the monthly work lands in, so it reads as the floor of
                the retainer rather than as another campaign. */}
            {project.isDefault && <Badge tone="info">Monthly</Badge>}
            {project.status === 'DONE' && <Badge tone="neutral">Done</Badge>}
          </div>
        </div>

        <p className="mt-0.5 text-micro text-secondary">
          {describeRun(project)}
          {project.owner && ` · ${project.owner.name}`}
        </p>

        {/* Progress, and the two facts that change what you do next: how much
            is left, and how much of it is already late. */}
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-subtle">
            <div
              className={`h-full rounded-full ${pct === 100 ? 'bg-success' : 'bg-primary'}`}
              style={{ width: `${pct ?? 0}%` }}
            />
          </div>
          <p className="mt-1.5 text-micro text-secondary">
            {total === 0 ? (
              'no tasks yet'
            ) : (
              <>
                {done} of {plural(total, 'task')} done
                {c?.late ? <span className="font-medium text-danger"> · {c.late} late</span> : null}
              </>
            )}
          </p>
        </div>

        {/* Which months it actually lands in — the thing a project exists to
            make visible, since a campaign crossing a month used to look like
            two unrelated piles. */}
        {months && months.length > 0 && (
          <p className="mt-2 text-micro text-secondary">
            {months.length === 1
              ? monthLabel(months[0])
              : `${monthLabel(months[0])} – ${monthLabel(months[months.length - 1])}`}
          </p>
        )}
      </button>
    );
  };


  return (
    <>
      {/* Back to the client when that is where this was opened from — see the
          note on the project page's own back link. */}
      <Link href={backHref} className="mb-4 inline-flex items-center gap-1.5 text-sm text-secondary transition-colors hover:text-primary">
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} /> {backLabel}
      </Link>

      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0 sm:flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-primary">{retainer.company.name}</h1>
            <Badge tone="info">Retainer</Badge>
            <Badge tone={STATUS[retainer.status].tone}>{STATUS[retainer.status].label}</Badge>
            {/* Which month you are in matters more than usual once it is shut. */}
            {monthClosed && <Badge tone="neutral">{monthLabel(month)} closed</Badge>}
          </div>

          {/*
            The month is named, not just navigated. It reads as a statement of
            which card you are looking at, with the arrows attached to it —
            rather than a stepper parked in the corner away from the sentence
            it changes.
          */}
          <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1.5 text-xs text-secondary">
            <span className="inline-flex items-center gap-0.5 rounded-full bg-primary py-0.5 pr-1 pl-1 text-white">
              <button
                onClick={() => goToMonth(shiftMonth(month, -1))}
                className="rounded-full p-0.5 text-white/70 transition-colors hover:bg-white/15 hover:text-white"
                aria-label="Previous month"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="px-1 text-micro font-semibold tracking-[0.03em] whitespace-nowrap">{monthLabel(month)}</span>
              <button
                onClick={() => goToMonth(shiftMonth(month, 1))}
                className="rounded-full p-0.5 text-white/70 transition-colors hover:bg-white/15 hover:text-white"
                aria-label="Next month"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </span>
            <span>
              Month card, created automatically on the 1st · owner {retainer.owner?.name ?? 'nobody'} ·{' '}
              {retainer.termMonths ? `${retainer.termMonths}-month term` : 'no fixed term'}
              {retainer.renewalDate && ` · renews ${date(retainer.renewalDate)}`}
              {retainer.status === 'STOPPED' && retainer.stoppedAt && (
                <>
                  {' · '}
                  <span className="text-danger">
                    stopped {date(retainer.stoppedAt)}
                    {retainer.stopReason ? ` — ${retainer.stopReason}` : ''}
                  </span>
                </>
              )}{' · '}
              <Link href={`/companies/${retainer.company.id}`} className="underline-offset-2 hover:underline">
                company record
              </Link>
            </span>
          </div>
        </div>

        {/* What you came here to do, where the prototype puts it. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
              size="sm"
              variant="secondary"
              icon={Plus}
              onClick={() => setAddingTask(true)}
              disabled={!monthCard || monthClosed}
              title={monthClosed ? `${monthLabel(month)} is closed` : undefined}
            >
              Task
          </Button>
          {canEnterCost && (
            <Button
              size="sm"
              variant="secondary"
              icon={Plus}
              onClick={() => setAddingCost(true)}
              disabled={!monthCard || monthClosed}
              title={monthClosed ? `${monthLabel(month)} is closed` : undefined}
            >
              Cost
            </Button>
          )}
          {/*
            What this month cost, on paper. Works on a closed month too — that
            is when somebody is most likely to want it.
          */}
          {monthCard && (
            <Button
              size="sm"
              variant="ghost"
              icon={Printer}
              onClick={() =>
                window.open(
                  `/print/costs?monthCardId=${monthCard.id}&client=${encodeURIComponent(retainer?.company?.name ?? '')}&job=${encodeURIComponent(`Retainer · ${monthLabel(month)}`)}`,
                  '_blank',
                )
              }
            >
              Print costs
            </Button>
          )}
          {canEnterMoney && monthCard && !monthCard.invoice && !monthClosed && (
            <Button size="sm" variant="secondary" icon={ReceiptText} onClick={() => setEnteringInvoice(true)}>
              Enter invoice
            </Button>
          )}
          {/*
            The way back in. Offering nothing at all would only mean a cost
            that genuinely belongs to August never gets recorded, and the
            number stays wrong for a better-sounding reason.
          */}
          {monthClosed && canReopenMonth && (
            <Button size="sm" variant="ghost" icon={LockOpen} onClick={() => void reopenMonth()}>
              Reopen month
            </Button>
          )}
          {/*
            Correcting it. Gated on seeing figures as well as writing, because
            the form's first field is the monthly value — and someone who
            cannot be shown that number would be editing a blank.
          */}
          {retainer.status === 'ACTIVE' && canEnterMoney && canWriteCompany && (
            <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>
              Edit retainer
            </Button>
          )}
          {/*
            Ending it. Quiet and last, because it is the one action here that
            takes something away — but present, because until now there was no
            way at all: a retainer once started kept opening month cards and
            spawning tasks for a client who had gone, and kept counting towards
            the monthly recurring figure.
          */}
          {retainer.status === 'ACTIVE' && (
            <Button
              size="sm"
              variant="ghost"
              icon={CircleSlash}
              className="text-danger hover:bg-danger-tint hover:text-danger"
              onClick={() => setStopping(true)}
            >
              Stop retainer
            </Button>
          )}
        </div>
      </div>

      {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

      {/*
        The month figures, when there is a month. Above the tabs because
        every one of them is an input to Profit, and below the header because
        the header is what says which month they belong to.
      */}
      {!loadingMonth && monthCard && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              dense
              label="Tasks"
              value={
                <>
                  {doneTasks.length}{' '}
                  <span className="text-sm font-semibold text-secondary">of {countedTasks.length}</span>
                </>
              }
              // "N open" used to sit in the Tasks card's own header, one line
              // under a tab that already said Tasks (6). It belongs with the
              // other task figures, not on a second header repeating the first.
              note={
                countedTasks.length
                  ? `${openTasks.length} open · ${donePercent}% of the month done${
                      cancelledCount ? ` · ${cancelledCount} cancelled` : ''
                    }`
                  : 'nothing scheduled yet'
              }
            />
            <StatTile
              dense
              label="Fee"
              value={canEnterMoney ? money(revenue) : 'Hidden'}
              note={
                canEnterMoney
                  ? monthCard.invoice
                    ? `invoiced ${date(monthCard.invoice.dueAt)}`
                    : 'not invoiced yet'
                  : 'needs the money figures permission'
              }
            />
            {/*
              A number, including when the number is nought — same as a
              one-time project's. "Nothing entered" is the same fact written as
              prose, and a row of figures with a sentence in it reads as an
              error rather than an answer. The note carries "nothing recorded
              yet", which is the part somebody might act on.
            */}
            <StatTile
              dense
              label="Cost"
              value={canEnterMoney ? money(costsTotal ?? 0) : 'Hidden'}
              note={noCostBasis ? 'nothing recorded yet' : 'external and people'}
            />
            {/*
              The one dark card on the screen. Profit is what the month is FOR,
              and the prototype gives it the ink block so it reads first —
              every other figure on the page is an input to this one.

              Which is exactly why it must not answer when it cannot. With no
              cost rows and no allocations the arithmetic returns the whole fee
              and a 100% margin, and this card said so in its confident voice:
              a month nobody had costed read as the best month the studio had
              ever had. Nought spent and nobody having said what was spent are
              different facts, and only one of them is a result.
            */}
            <StatTile
              dark
              dense
              label="Profit"
              value={!canEnterMoney ? 'Hidden' : profit != null ? money(profit) : 'Hidden'}
              note={
                !canEnterMoney
                  ? 'management only'
                  : noCostBasis
                    ? 'the whole fee — nothing costed against this month yet'
                    : profit != null && revenue
                      ? `${((profit / Number(revenue)) * 100).toFixed(1)}% margin`
                      : 'management only'
              }
            />
          </div>

          {/*
            The "month cards appear on their own" banner used to sit here.

            It explained, in three branches and about seventy pixels, how this
            card came to exist -- which the subtitle above already says in six
            words: "Month card, created automatically on the 1st". So it was a
            permanent slot spent restating the line directly above it.

            It cost more than its height. Measured down this page, roughly
            440px went on chrome before the first project card and 580px
            before the first task row, which on a laptop is the whole fold
            spent before any work appears. Onboarding text earns a permanent
            slot only while it is still telling you something.
          */}
          {!canEnterMoney && (
            <div className="mb-5 rounded-xl border border-dashed border-line bg-subtle/40 px-4 py-3.5 text-xs text-secondary">
              <b className="mb-0.5 block font-semibold text-body">Cost and profit are hidden</b>
              The work on this card is yours to see. The figures need the money figures permission.
            </div>
          )}
        </>
      )}


        {/*
          The tab is the heading.

          Each of these four panels used to open with a card header naming
          itself — so the Tasks panel read "Tasks (6)" in the tab, "Tasks"
          again as a card title, and "TASK" once more as a column, three
          deep in a column of eighty pixels. Two of those headers also
          carried a create button that is already in the page header above,
          gated identically, so the same action sat on the screen twice.
        */}
        <Tabs className="mb-5" tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'projects' && ProjectsPanel()}

      {/*
        Costs, allocations and the invoice belong to ONE month — they are the
        billing side, and the month pill in the header is what scopes them.
        Projects do not: a campaign runs across months, so its panel is
        outside this guard and works on a month with no card at all.
      */}
      {tab !== 'projects' &&
        (loadingMonth ? (
          <PageSkeleton />
        ) : !monthCard ? (
          <EmptyState
            title="No month card here"
            hint={`Nothing was rolled for ${monthLabel(month)}. Month cards are created automatically on the 1st for an active retainer.`}
          />
        ) : (
          <>
          {tab === 'costs' && (
            <Card padding="none">
              <CardBody className="p-0!">
                {monthCard.costs.length === 0 ? (
                  <div className="p-6">
                    <EmptyState title="Nothing spent yet" hint="Ad spend, freelancers, and other costs entered against this month show up here." />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                  <table className="w-full text-sm data-table">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="eyebrow text-left">Paid towards</th>
                        <th className="eyebrow text-left">Paid to</th>
                        <th className="eyebrow text-left">Company</th>
                        <th className="eyebrow text-left">Entered by</th>
                        <th className="eyebrow text-left">Date</th>
                        <th className="eyebrow text-right">Amount</th>
                        {canEnterCost && !monthClosed && <th className="eyebrow text-right">{''}</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {monthCard.costs.map((c) => (
                        <tr key={c.id}>
                          <td className="font-medium text-primary">{c.category}</td>
                          <td className="text-secondary">{c.vendor}</td>
                          <td className="text-secondary">{c.paidBy || '—'}</td>
                          <td className="text-secondary">{c.enteredBy?.name ?? '—'}</td>
                          <td className="text-secondary whitespace-nowrap">{fullDate(c.incurredAt)}</td>
                          <td className="text-right tabular-nums">{money(c.amount)}</td>
                          {/*
                            A cost could be entered and never corrected. A
                            mistyped amount could only be deleted and
                            re-entered, which loses who entered it and when, so
                            in practice the wrong figure stayed and skewed the
                            month's margin for good.
                          */}
                          {canEnterCost && !monthClosed && (
                            <td className="text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => setEditingCost(c)}
                                className="rounded-lg border border-border px-2.5 py-1 text-micro font-medium text-body transition-colors hover:bg-subtle"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => void removeCost(c)}
                                aria-label={`Remove the ${c.vendor} cost`}
                                className="ml-1.5 rounded-lg border border-border p-1 text-secondary transition-colors hover:border-danger/40 hover:text-danger"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                    {/*
                      What the rows come to. The Cost so far tile adds people
                      cost on top, so without this line the two numbers look
                      like a contradiction rather than two different totals.
                    */}
                    <tfoot>
                      <tr className="border-t border-border">
                        <td colSpan={5} className="text-secondary">
                          External costs, this month
                        </td>
                        <td className="text-right font-semibold text-primary tabular-nums">
                          {money(monthCard.costs.reduce((a, c) => a + Number(c.amount ?? 0), 0))}
                        </td>
                        {canEnterCost && !monthClosed && <td />}
                      </tr>
                    </tfoot>
                  </table>
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          {tab === 'allocations' && (
            <Card padding="none">
              <CardBody className="p-0!">
                {monthCard.allocations.length === 0 ? (
                  <div className="p-6">
                    <EmptyState title="Nothing allocated yet" hint="Heads confirm each person's split for the month on the monthly time split screen — it isn't set from here." />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                  <table className="w-full text-sm data-table">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="eyebrow text-left">Person</th>
                        <th className="eyebrow text-right">Proposed</th>
                        <th className="eyebrow text-right">Confirmed</th>
                        <th className="eyebrow text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {monthCard.allocations.map((a) => (
                        <tr key={a.id}>
                          <td className="font-medium text-primary">{a.user.name} <span className="text-secondary font-normal">· {a.user.dept}</span></td>
                          <td className="text-right text-secondary tabular-nums">{a.proposedPercent}%</td>
                          {/*
                            Blank until somebody has actually confirmed it.
                            `percent` carries the proposed figure until then, so
                            the column read as a confirmed 30% on a row whose
                            own status said Proposed — two claims about the
                            same allocation, in adjacent cells.
                          */}
                          <td className="text-right font-medium text-primary tabular-nums">
                            {a.confirmedAt ? `${a.percent}%` : <span className="text-secondary">—</span>}
                          </td>
                          <td className="">
                            {a.confirmedAt ? (
                              <Badge tone="good">Confirmed{a.confirmedBy ? ` · ${a.confirmedBy.name}` : ''}</Badge>
                            ) : (
                              <Badge tone="neutral">Proposed</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {/*
                      What the month adds up to for these people. Over 100% of
                      somebody's month is the thing this table exists to catch,
                      and it could not be seen without adding the column up by
                      eye.
                    */}
                    <tfoot>
                      <tr className="border-t border-border">
                        <td className="text-secondary">
                          {plural(monthCard.allocations.length, 'person', 'people')} on this month
                        </td>
                        <td className="text-right font-semibold text-primary tabular-nums">
                          {monthCard.allocations.reduce((a, x) => a + x.proposedPercent, 0)}%
                        </td>
                        <td className="text-right font-semibold text-primary tabular-nums">
                          {confirmedAllocations.length > 0
                            ? `${confirmedAllocations.reduce((a, x) => a + x.percent, 0)}%`
                            : '—'}
                        </td>
                        <td className="text-micro text-secondary">
                          {confirmedAllocations.length === monthCard.allocations.length
                            ? 'all confirmed'
                            : `${monthCard.allocations.length - confirmedAllocations.length} still proposed`}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          {tab === 'invoice' && (
            <Card padding="none">
              <CardBody>
                {!monthCard.invoice ? (
                  <EmptyState title="No invoice entered yet" hint="Once accounts raise it in Tally, enter the number, date and amount here to mirror it." />
                ) : (
                  <div className="space-y-4">
                    {/*
                      Overdue is a fact about today, not a status somebody
                      remembered to set. The row showed RAISED in amber five
                      days after the due date, because nothing recomputes the
                      stored status between the nightly scan and this screen —
                      so the one number on the page that needed chasing was the
                      one that looked fine.
                    */}
                    <div
                      className={`flex items-center justify-between rounded-xl border p-4 ${
                        invoiceOverdueDays > 0 ? 'border-danger/40 bg-danger-tint/40' : 'border-border'
                      }`}
                    >
                      <div>
                        <p className="text-sm font-semibold text-primary">{monthCard.invoice.number}</p>
                        <p className={`mt-0.5 text-xs ${invoiceOverdueDays > 0 ? 'font-medium text-danger' : 'text-secondary'}`}>
                          Due {date(monthCard.invoice.dueAt)}
                          {invoiceOverdueDays > 0 && ` · ${plural(invoiceOverdueDays, 'day')} overdue`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-primary">{money(monthCard.invoice.amount)}</p>
                        <Badge
                          tone={
                            monthCard.invoice.status === 'PAID'
                              ? 'good'
                              : monthCard.invoice.status === 'OVERDUE' || invoiceOverdueDays > 0
                                ? 'bad'
                                : 'warn'
                          }
                        >
                          {invoiceOverdueDays > 0 && monthCard.invoice.status !== 'PAID'
                            ? 'OVERDUE'
                            : monthCard.invoice.status}
                        </Badge>
                      </div>
                    </div>

                    {monthCard.invoice.payments.length > 0 && (
                      <div>
                        <p className="eyebrow mb-2">Payments</p>
                        <ul className="space-y-2">
                          {monthCard.invoice.payments.map((p) => (
                            <li key={p.id} className="flex items-center justify-between rounded-lg bg-subtle/40 px-3 py-2 text-sm">
                              <span className="text-secondary">{date(p.receivedAt)} · {p.mode}{p.reference ? ` · ${p.reference}` : ''}</span>
                              <span className="font-medium text-primary">{money(p.amount)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {canEnterMoney && monthCard.invoice.status !== 'PAID' && monthCard.invoice.status !== 'CANCELLED' && (
                      <Button variant="secondary" onClick={() => setRecordingPayment(true)}>
                        Record payment
                      </Button>
                    )}
                  </div>
                )}
              </CardBody>
            </Card>
          )}
          </>
        ))}

      <NewWorkTaskModal
        open={addingTask}
        team={team}
        companyId={retainer.companyId}
        defaultTarget={{ kind: 'MONTH_CARD', monthCardId: monthCard?.id ?? '' }}
        retainerProjects={retainer.projects ?? []}
        // Opened from inside a project, the task belongs to it — asking again
        // on the form would be asking a question the screen already answered.
        onClose={() => setAddingTask(false)}
        onCreated={() => {
          setAddingTask(false);
          void loadMonthCard();
          void loadRetainer();
        }}
      />

      {editingCost && (
        <EditCostModal
          cost={editingCost}
          onClose={() => setEditingCost(null)}
          onSaved={() => {
            setEditingCost(null);
            void loadMonthCard();
          }}
        />
      )}

      {projectForm && (
        <RetainerProjectModal
          retainerId={id}
          project={projectForm.project}
          onClose={() => setProjectForm(null)}
          onSaved={() => {
            setProjectForm(null);
            void loadRetainer();
            void loadMonthCard();
          }}
        />
      )}

      {editing && (
        <EditRetainerModal
          retainer={retainer}
          companyName={retainer.company.name}
          /*
           * Only a month that is open and not yet invoiced can be repriced, and
           * the server decides that. Naming the month the page is on is enough
           * for the checkbox to be specific; `repricedCards` in the reply is
           * what actually reports whether it moved.
           */
          openMonthLabel={monthCard && monthCard.status === 'OPEN' && !monthCard.invoice ? monthLabel(month) : null}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void loadRetainer();
            void loadMonthCard();
          }}
        />
      )}

      <StopRetainerModal
        open={stopping}
        retainer={retainer}
        onClose={() => setStopping(false)}
        onStopped={() => {
          setStopping(false);
          void loadRetainer();
          void loadMonthCard();
        }}
      />

      <NewWorkCostModal
        open={addingCost}
        target={{ kind: 'MONTH_CARD', monthCardId: monthCard?.id ?? '' }}
        onClose={() => setAddingCost(false)}
        onCreated={() => {
          setAddingCost(false);
          void loadMonthCard();
        }}
      />

      {/*
        Everything about the task that will not fit in a row a person scans.
        Read from `tasks` by id so an edit shows the saved values rather than
        the copy that was in the list when the row was clicked.

        No project link: a month card's task and a project's task are mutually
        exclusive in the data — 0 of 82 rows carry both — so on this screen
        that row would be a dash on every task.
      */}

      {enteringInvoice && monthCard && (
        <EnterInvoiceModal
          companyId={retainer.companyId}
          monthCardId={monthCard.id}
          defaultAmount={revenue ?? 0}
          onClose={() => setEnteringInvoice(false)}
          onCreated={() => {
            setEnteringInvoice(false);
            void loadMonthCard();
          }}
        />
      )}

      {recordingPayment && monthCard?.invoice && (
        <RecordPaymentModal
          invoiceId={monthCard.invoice.id}
          defaultAmount={Number(monthCard.invoice.amount ?? 0)}
          onClose={() => setRecordingPayment(false)}
          onRecorded={() => {
            setRecordingPayment(false);
            void loadMonthCard();
          }}
        />
      )}
    </>
  );
}

function EnterInvoiceModal({
  companyId,
  monthCardId,
  defaultAmount,
  onClose,
  onCreated,
}: {
  companyId: string;
  monthCardId: string;
  defaultAmount: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [number, setNumber] = useState('');
  const [amount, setAmount] = useState(defaultAmount > 0 ? String(defaultAmount) : '');
  const [raisedAt, setRaisedAt] = useState(new Date().toISOString().slice(0, 10));
  const [dueAt, setDueAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = Boolean(number.trim()) && Number(amount) > 0 && Boolean(raisedAt);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await api.invoices.create({
        companyId,
        monthCardId,
        workType: 'RETAINER',
        amount: Number(amount),
        raisedAt,
        dueAt: dueAt || undefined,
        customNumber: number.trim(),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not enter this invoice');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Enter invoice" description="Mirrors the tax invoice already raised in Tally — this doesn't issue anything.">
      <form onSubmit={submit}>
        <ModalBody className="space-y-4">
          <Field label="Invoice number (from Tally)" value={number} onChange={setNumber} required placeholder="e.g. INV-2026-0142" />
          <Field label="Amount (₹)" value={amount} onChange={setAmount} type="number" required />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Raised on" value={raisedAt} onChange={setRaisedAt} type="date" required />
            <Field label="Due date" value={dueAt} onChange={setDueAt} type="date" hint="Defaults to 15 days from raised" />
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!canSave}>
            Enter invoice
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}


/**
 * Ending a retainer.
 *
 * A reason is required rather than optional. It is the one fact nobody
 * remembers six months later, and the only thing that makes a churned client
 * tell you anything — "price" and "they hired in-house" are different problems
 * and the difference is invisible without this box.
 *
 * The dialog says what will happen to the month you are part way through
 * BEFORE it happens, because the answer is not obvious and it involves money:
 * a month that has been worked stays and is billed, a month nothing has
 * happened on is dropped.
 */
function StopRetainerModal({
  open,
  retainer,
  onClose,
  onStopped,
}: {
  open: boolean;
  retainer: { id: string; company: { name: string } };
  onClose: () => void;
  onStopped: () => void;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.retainers.stop(retainer.id, reason.trim());
      // Say what actually happened to the months, rather than "done" — the
      // difference between a month kept and a month dropped is a bill.
      const kept = res.closedMonths?.length ? ` ${res.closedMonths.join(', ')} closed and still to invoice.` : '';
      const gone = res.removedMonths?.length ? ` ${res.removedMonths.join(', ')} removed — nothing had happened on it.` : '';
      toast.success(`${retainer.company.name}'s retainer stopped.${kept}${gone}`);
      onStopped();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not stop that retainer');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Stop ${retainer.company.name}'s retainer`}>
      <form onSubmit={submit}>
        <ModalBody className="space-y-4">
          <p className="text-sm text-secondary">
            No more month cards will be created on the 1st, the monthly tasks stop being scheduled, and the fee comes out
            of the recurring revenue figure.
          </p>
          <p className="rounded-xl border border-border bg-subtle/60 px-3.5 py-3 text-sm text-secondary">
            A month that has been worked stays open on the books and still wants invoicing. A month nothing has happened
            on yet is removed, so nobody bills for a month that never ran.
          </p>
          <Field
            label="Why is it ending?"
            value={reason}
            onChange={setReason}
            textarea
            rows={3}
            required
            placeholder="Moved in-house, budget cut, price, unhappy with the work…"
          />
          {error && <ErrorNote>{error}</ErrorNote>}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={saving} disabled={!reason.trim()}>
            Stop retainer
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
