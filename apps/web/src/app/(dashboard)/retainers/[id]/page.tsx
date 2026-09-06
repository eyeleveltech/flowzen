'use client';

/**
 * One retainer, one month at a time — the Month Card cockpit the brief
 * calls for (§10: "One month of a retainer. Tasks, costs, allocations,
 * invoice, profit.") and the last of the three detail views that had no
 * screen at all: `GET /retainers/:id/month-cards/:month` has existed since
 * the CRM rebuild and nothing ever called it.
 *
 * The retainer itself (company, term, renewal, owner) is fetched separately
 * from the month card, because a month with no card yet — before the
 * retainer started, or one the roll-month job hasn't reached — still needs
 * that header to render while the body says so.
 *
 * No Team tab, same reasoning as the Project page: v2 has one ownerId, not
 * a roster. Allocations are shown read-only here — confirming them is a
 * monthly, org-wide action (§13's allocation job, one screen across every
 * job) not a per-retainer one, so it isn't duplicated on this screen.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ChevronLeft, ChevronRight, CircleSlash, Plus, ReceiptText } from 'lucide-react';
import { api, ApiError, formatMoney, formatDate, type OrgConfig } from '@/lib/api-v2';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Badge, type Tone } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { Card, CardBody } from '@/components/ui/card';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Field, FieldSelect } from '@/components/ui/field';
import { EmptyState, ErrorNote } from '@/components/ui/empty-state';
import { PageSkeleton } from '@/components/ui/skeleton-loaders';
import { StatTile } from '@/components/ui/stat-tile';
import { Tabs, useTabState, type TabDef } from '@/components/ui/tabs';
import { TaskDrawer, type DrawerTask } from '@/components/work/TaskDrawer';
import { NewWorkTaskModal } from '@/components/work/NewWorkTaskModal';
import { NewWorkCostModal } from '@/components/work/NewWorkCostModal';
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
};

type Task = {
  id: string;
  title: string;
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
type Cost = { id: string; category: string; vendor: string; amount: string | number | null; incurredAt: string; enteredBy: { id: string; name: string } | null };
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
  revenue: string | number | null;
  directCostsTotal: string | number | null;
  tasks: Task[];
  costs: Cost[];
  allocations: Allocation[];
  invoice: Invoice | null;
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

export default function RetainerMonthCardPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const month = searchParams.get('month') || currentMonth();

  const [retainer, setRetainer] = useState<Retainer | null>(null);
  const [monthCard, setMonthCard] = useState<MonthCard | null>(null);
  const [config, setConfig] = useState<OrgConfig | null>(null);
  const [team, setTeam] = useState<{ id: string; name: string; dept: string }[]>([]);
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
  const tabs: TabDef<'tasks' | 'costs' | 'allocations' | 'invoice'>[] = [
    { key: 'tasks', label: 'Tasks', count: monthCard?.tasks.length ?? 0 },
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addingTask, setAddingTask] = useState(false);
  const [addingCost, setAddingCost] = useState(false);
  const [enteringInvoice, setEnteringInvoice] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [recordingPayment, setRecordingPayment] = useState(false);
  // The row you clicked. Held by id rather than by object so that a reload
  // after an edit reopens the FRESH task rather than the stale copy that was
  // in the list when it was clicked.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const loadRetainer = useCallback(async () => {
    setLoadingRetainer(true);
    try {
      const [rRes, cfg] = await Promise.all([api.retainers.get(id), api.config.get()]);
      setRetainer(rRes.retainer as Retainer);
      setConfig(cfg);
      setError(null);
      void api.team.members().then((r) => setTeam(r.members)).catch(() => {});
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
    } catch {
      setMonthCard(null);
    } finally {
      setLoadingMonth(false);
    }
  }, [id, month]);

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
  const currency = config?.organization.currency ?? 'INR';
  const locale = config?.organization.locale ?? 'en-IN';
  const tz = config?.organization.timezone ?? 'Asia/Kolkata';
  const date = (v: string | null | undefined) => formatDate(v, tz, locale);
  const money = (v: string | number | null | undefined) => formatMoney(v, currency, locale);

  const revenue = monthCard?.revenue != null ? Number(monthCard.revenue) : null;
  const costsTotal = monthCard?.directCostsTotal != null ? Number(monthCard.directCostsTotal) : null;
  const profit = revenue != null && costsTotal != null ? revenue - costsTotal : null;
  const tasks = monthCard?.tasks ?? [];
  const openTasks = tasks.filter((t) => t.status !== 'DONE' && t.status !== 'CANCELLED');
  const doneTasks = tasks.filter((t) => t.status === 'DONE');
  const donePercent = tasks.length ? Math.round((doneTasks.length / tasks.length) * 100) : 0;
  const todayStr = new Date().toISOString().slice(0, 10);

  // Read back out of `tasks` rather than stored on click, so that saving an
  // edit shows the saved values instead of the copy that was in the list when
  // the row was pressed. The client and the month are context the row does not
  // carry and the drawer should not have to fetch.
  const openRow = openTaskId ? tasks.find((t) => t.id === openTaskId) : undefined;
  const openTask: DrawerTask | null = openRow
    ? {
        ...openRow,
        clientName: retainer.company?.name ?? null,
        clientHref: retainer.company?.id ? `/companies/${retainer.company.id}` : null,
        workLabel: `${monthLabel(month)} retainer`,
      }
    : null;

  const changeTaskStatus = async (t: Task, next: TStatus) => {
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
      await loadMonthCard();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update that task');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <Link href="/live-work" className="mb-4 inline-flex items-center gap-1.5 text-sm text-secondary transition-colors hover:text-primary">
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} /> Live work
      </Link>

      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0 sm:flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-primary">{retainer.company.name}</h1>
            <Badge tone="info">Retainer</Badge>
            <Badge tone={STATUS[retainer.status].tone}>{STATUS[retainer.status].label}</Badge>
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
          <Button size="sm" variant="secondary" icon={Plus} onClick={() => setAddingTask(true)} disabled={!monthCard}>
            Task
          </Button>
          {canEnterCost && (
            <Button size="sm" variant="secondary" icon={Plus} onClick={() => setAddingCost(true)} disabled={!monthCard}>
              Cost
            </Button>
          )}
          {canEnterMoney && monthCard && !monthCard.invoice && (
            <Button size="sm" variant="secondary" icon={ReceiptText} onClick={() => setEnteringInvoice(true)}>
              Enter invoice
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

      {loadingMonth ? (
        <PageSkeleton />
      ) : !monthCard ? (
        <EmptyState title="No month card here" hint={`Nothing was rolled for ${monthLabel(month)}. Month cards are created automatically on the 1st for an active retainer.`} />
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Tasks"
              value={
                <>
                  {doneTasks.length}{' '}
                  <span className="text-sm font-semibold text-secondary">of {tasks.length}</span>
                </>
              }
              // "N open" used to sit in the Tasks card's own header, one line
              // under a tab that already said Tasks (6). It belongs with the
              // other task figures, not on a second header repeating the first.
              note={tasks.length ? `${openTasks.length} open · ${donePercent}% of the month done` : 'nothing scheduled yet'}
            />
            <StatTile
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
            <StatTile
              label="Cost so far"
              value={canEnterMoney ? money(costsTotal) : 'Hidden'}
              note="external and people"
            />
            {/*
              The one dark card on the screen. Profit is what the month is FOR,
              and the prototype gives it the ink block so it reads first —
              every other figure on the page is an input to this one.
            */}
            <StatTile
              dark
              label="Profit"
              value={canEnterMoney && profit != null ? money(profit) : 'Hidden'}
              note={
                canEnterMoney && profit != null && revenue
                  ? `${((profit / Number(revenue)) * 100).toFixed(1)}% margin`
                  : 'management only'
              }
            />
          </div>

          {/*
            The point of the whole screen, said once. A month card is the thing
            nobody has to remember, and that is invisible unless it is written
            down next to the evidence.
          */}
          <div className="mb-5 rounded-r-xl border-l-[3px] border-accent bg-subtle/60 px-4 py-3 text-xs text-body">
            <b className="mb-0.5 block font-semibold text-primary">Nobody created this card</b>
            It appeared on the 1st{retainer.template ? ` and its tasks came from the "${retainer.template.name}" template` : ''}. Next month
            the same happens again, with nothing for anyone to remember.
          </div>

          {!canEnterMoney && (
            <div className="mb-5 rounded-xl border border-dashed border-line bg-subtle/40 px-4 py-3.5 text-xs text-secondary">
              <b className="mb-0.5 block font-semibold text-body">Cost and profit are hidden</b>
              The work on this card is yours to see. The figures need the money figures permission.
            </div>
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

          {tab === 'tasks' && (
            <Card padding="none">
              <CardBody className="p-0!">
                {tasks.length === 0 ? (
                  <div className="p-6">
                    <EmptyState title="No tasks yet" hint="The retainer's task template fires on the 1st. Add one by hand if it's needed sooner." action={<Button icon={Plus} onClick={() => setAddingTask(true)}>Task</Button>} />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm data-table">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="eyebrow text-left">Task</th>
                          <th className="eyebrow text-left">Assigned to</th>
                          <th className="eyebrow text-left">Assigned</th>
                          <th className="eyebrow text-left">Due</th>
                          <th className="eyebrow text-left">Priority</th>
                          <th className="eyebrow text-left">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {tasks.map((t) => {
                          const late = t.status !== 'DONE' && t.status !== 'CANCELLED' && t.dueDate.slice(0, 10) < todayStr;
                          return (
                            <tr
                              key={t.id}
                              onClick={() => setOpenTaskId(t.id)}
                              className="cursor-pointer transition-colors hover:bg-subtle"
                            >
                              <td className="">
                                {/*
                                  A button inside the row rather than a click
                                  handler alone: the row is the target for a
                                  mouse, and this is what a keyboard and a
                                  screen reader get to open the same thing.
                                */}
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); setOpenTaskId(t.id); }}
                                  className={`rounded-sm text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${t.status === 'DONE' || t.status === 'CANCELLED' ? 'text-secondary line-through' : 'text-primary'}`}
                                >
                                  {t.title}
                                </button>
                                {t.status === 'ON_HOLD' && t.waitingOn && (
                                  <p className="mt-0.5 text-micro text-secondary">
                                    waiting on {t.waitingOn === 'CLIENT' ? 'the client' : 'someone else'}
                                  </p>
                                )}
                              </td>
                              {/*
                                Name over title. The title used to be inside
                                the name — "Janani (Head, Design)" — so this
                                column was quietly two facts wide; now it is
                                two lines, and the name is the one you scan.
                              */}
                              <td className="">
                                {/*
                                  The lead, and how many others are on it —
                                  "Janani +2" rather than three names wrapping
                                  a column that has to stay scannable. The
                                  drawer lists them.
                                */}
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
                              <td className="whitespace-nowrap text-secondary">{date(t.assignedAt)}</td>
                              <td className={`whitespace-nowrap ${late ? 'font-semibold text-danger' : 'text-secondary'}`}>
                                {date(t.dueDate)}
                              </td>
                              <td className="">
                                <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-secondary">
                                  <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${getPriorityDot(t.priority)}`} />
                                  {getPriorityLabel(t.priority)}
                                </span>
                              </td>
                              <td className="" onClick={(e) => e.stopPropagation()}>
                                <Select
                                  value={t.status}
                                  onChange={(v) => void changeTaskStatus(t, v as TStatus)}
                                  options={TASK_STATUS_OPTIONS}
                                  ariaLabel={`Status for ${t.title}`}
                                  buttonClassName="px-2.5 py-1.5 text-xs w-32"
                                  disabled={busyId === t.id}
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
          )}

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
                        <th className="eyebrow text-left">Category</th>
                        <th className="eyebrow text-left">Vendor</th>
                        <th className="eyebrow text-left">Entered by</th>
                        <th className="eyebrow text-left">Date</th>
                        <th className="eyebrow text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {monthCard.costs.map((c) => (
                        <tr key={c.id}>
                          <td className="font-medium text-primary">{c.category}</td>
                          <td className="text-secondary">{c.vendor}</td>
                          <td className="text-secondary">{c.enteredBy?.name ?? '—'}</td>
                          <td className="text-secondary">{date(c.incurredAt)}</td>
                          <td className="text-right">{money(c.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
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
                          <td className="text-right text-secondary">{a.proposedPercent}%</td>
                          <td className="text-right font-medium text-primary">{a.percent}%</td>
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
                    <div className="flex items-center justify-between rounded-xl border border-border p-4">
                      <div>
                        <p className="text-sm font-semibold text-primary">{monthCard.invoice.number}</p>
                        <p className="text-xs text-secondary mt-0.5">Due {date(monthCard.invoice.dueAt)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-primary">{money(monthCard.invoice.amount)}</p>
                        <Badge tone={monthCard.invoice.status === 'PAID' ? 'good' : monthCard.invoice.status === 'OVERDUE' ? 'bad' : 'warn'}>
                          {monthCard.invoice.status}
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
      )}

      <NewWorkTaskModal
        open={addingTask}
        team={team}
        companyId={retainer.companyId}
        defaultTarget={{ kind: 'MONTH_CARD', monthCardId: monthCard?.id ?? '' }}
        onClose={() => setAddingTask(false)}
        onCreated={() => {
          setAddingTask(false);
          void loadMonthCard();
        }}
      />

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
      <TaskDrawer
        task={openTask}
        statusOptions={TASK_STATUS_OPTIONS}
        team={team}
        busy={busyId === openTaskId}
        onClose={() => setOpenTaskId(null)}
        onStatusChange={(t, next) => void changeTaskStatus(t as unknown as Task, next as TStatus)}
        onChanged={() => void loadMonthCard()}
      />

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
