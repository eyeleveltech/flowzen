'use client';

/**
 * One project.
 *
 * Rewritten against the real v2 API (routes/projects.ts). The previous
 * version of this page destructured `project.type`, `.platform`, `.scope`,
 * `.health`, `.company.engagements`, `.members`, and rendered a task board
 * with statuses (TODO/IN_PROGRESS/IN_REVIEW/DONE/BLOCKED) and a `reviewer`
 * field — none of which the backend has returned since the CRM rebuild.
 * Every field here is one the API actually sends.
 *
 * Milestone billing (advance/mid/final…) has no owner concept — v2's Project
 * has one ownerId, not a member roster — so there is no "Team" tab; who did
 * what shows up through task assignees and the activity feed instead.
 */

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Settings2, Trash2 } from 'lucide-react';
import { api, ApiError, formatMoney, formatDate, type OrgConfig, type Company } from '@/lib/api-v2';
import toast from 'react-hot-toast';
import { useConfirmStore } from '@/stores/confirm';
import { Button } from '@/components/ui/button';
import { Badge, type Tone } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/card';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Field, FieldSelect } from '@/components/ui/field';
import { EmptyState, ErrorNote } from '@/components/ui/empty-state';
import { ActivityFeed, type FeedItem } from '@/components/activities/ActivityFeed';
import { PageSkeleton } from '@/components/ui/skeleton-loaders';
import { StatTile } from '@/components/ui/stat-tile';
import { Tabs, useTabState, type TabDef } from '@/components/ui/tabs';
import { NewProformaModal } from '@/components/clients/NewProformaModal';
import { NewWorkTaskModal } from '@/components/work/NewWorkTaskModal';
import { NewWorkCostModal } from '@/components/work/NewWorkCostModal';
import { PRIORITY_CONFIG, getPriorityDot, getPriorityBadge, getPriorityLabel } from '@/lib/priority';
import { personOptions } from '@/lib/people';

const PRIORITY_OPTIONS = Object.entries(PRIORITY_CONFIG).map(([value, cfg]) => ({ value, label: cfg.label }));

type Status = 'LIVE' | 'DELIVERED' | 'CANCELLED';
type MStatus = 'PENDING' | 'PROFORMA_RAISED' | 'INVOICED' | 'PAID';
type TStatus = 'TODO' | 'IN_PROGRESS' | 'ON_HOLD' | 'DONE' | 'CANCELLED';

const TASK_STATUS_OPTIONS = [
  { value: 'TODO', label: 'To do' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'DONE', label: 'Done' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

type Milestone = {
  id: string;
  label: string;
  percent: number;
  amount: string | number | null;
  status: MStatus;
  order: number;
  proformas?: { id: string; number: string; status: string }[];
};
type Task = {
  id: string;
  title: string;
  status: TStatus;
  priority: string;
  dueDate: string;
  assignedAt: string;
  completedAt: string | null;
  waitingOn: 'CLIENT' | 'ANOTHER_PERSON' | null;
  waitingSince: string | null;
  reopenCount: number;
  assignee: { id: string; name: string; dept: string } | null;
};
type Cost = { id: string; category: string; vendor: string; amount: string | number | null; incurredAt: string; enteredBy: { id: string; name: string } | null };
type Invoice = { id: string; number: string; amount: string | number | null; status: string; dueAt: string };
type Allocation = {
  id: string;
  month: string;
  percent: number;
  user: { id: string; name: string; dept: string; monthlyCost?: string | number | null };
};

type ProjectDetail = {
  id: string;
  name: string;
  companyId: string;
  company: { id: string; name: string; vertical: string; city: string };
  quotedValue: string | number | null;
  estimatedCost: string | number | null;
  actualCostTotal: string | number | null;
  /** Absent without money.figures — the server does not send it. */
  profit?: {
    revenue: number;
    directCost: number;
    peopleCost: number;
    actualCost: number;
    profit: number;
    marginPercent: number | null;
    estimatedCost: number | null;
    costVariance: number | null;
    costVariancePercent: number | null;
  };
  costRisk?: {
    projectedCost: number | null;
    projectedProfit: number | null;
    level: 'OK' | 'WATCH' | 'OVER' | 'LOSS';
    reason: string | null;
  };
  /** How far through the work is. Not a figure, so everybody sees it. */
  percentComplete: number;
  percentCompleteBasis: 'milestones' | 'calendar';
  startDate: string;
  endDate: string;
  status: Status;
  priority: string;
  description: string | null;
  ownerId: string;
  owner: { id: string; name: string; email: string; dept: string } | null;
  milestones: Milestone[];
  costs: Cost[];
  invoices: Invoice[];
  allocations: Allocation[];
};

const STATUS: Record<Status, { label: string; tone: Tone }> = {
  LIVE: { label: 'Live', tone: 'good' },
  DELIVERED: { label: 'Delivered', tone: 'info' },
  CANCELLED: { label: 'Cancelled', tone: 'bad' },
};

const MSTATUS: Record<MStatus, { label: string; tone: Tone }> = {
  PENDING: { label: 'Pending', tone: 'neutral' },
  PROFORMA_RAISED: { label: 'Proforma raised', tone: 'info' },
  INVOICED: { label: 'Invoiced', tone: 'warn' },
  PAID: { label: 'Paid', tone: 'good' },
};
const MSTATUS_NEXT: Record<MStatus, MStatus | null> = {
  PENDING: 'PROFORMA_RAISED',
  PROFORMA_RAISED: 'INVOICED',
  INVOICED: 'PAID',
  PAID: null,
};

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const confirm = useConfirmStore((st) => st.confirm);

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [config, setConfig] = useState<OrgConfig | null>(null);
  const [team, setTeam] = useState<{ id: string; name: string; dept: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /*
   * One list, read by both the row that draws the tabs and the hook that
   * decides which is open, so a tab cannot be shown without being selectable.
   * `people` counts distinct people across the allocation rows — the same
   * thing peopleBreakdown groups by further down.
   */
  const tabs: TabDef<'milestones' | 'tasks' | 'costs' | 'people' | 'activity'>[] = [
    { key: 'milestones', label: 'Milestones', count: project?.milestones.length ?? 0 },
    { key: 'tasks', label: 'Tasks', count: tasks.length },
    {
      key: 'costs',
      label: 'Costs',
      count: project?.costs.length ?? 0,
      visible: (config?.me.permissions ?? []).some((p) => p === 'cost.enter' || p === 'money.figures'),
    },
    { key: 'people', label: 'People', count: new Set((project?.allocations ?? []).map((a) => a.user.id)).size },
    { key: 'activity', label: 'Activity' },
  ];
  const [tab, setTab] = useTabState(tabs);
  const [activity, setActivity] = useState<FeedItem[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [addingCost, setAddingCost] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [raisingProformaForMilestone, setRaisingProformaForMilestone] = useState<Milestone | null>(null);
  const [addingMilestone, setAddingMilestone] = useState(false);
  const [editingMilestone, setEditingMilestone] = useState<Milestone | null>(null);

  const load = useCallback(async () => {
    try {
      const [pRes, tRes, cfg] = await Promise.all([
        api.projects.get(id),
        api.tasks.list({ projectId: id }),
        api.config.get(),
      ]);
      setProject(pRes.project as ProjectDetail);
      setTasks((tRes.tasks ?? []) as Task[]);
      setConfig(cfg);
      setError(null);
      void api.team.members().then((r) => setTeam(r.members)).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this project');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadActivity = useCallback(async () => {
    try {
      const res = await api.activities.list({ entityType: 'Project', entityId: id });
      setActivity(
        (res ?? []).map((a: any) => ({
          key: a.id,
          at: a.at,
          text: humanizeVerb(a.verb, a.payload),
          body: null,
          userName: a.actor?.name,
        })),
      );
    } catch {
      setActivity([]);
    }
  }, [id]);

  useEffect(() => {
    if (tab === 'activity' && activity === null) void loadActivity();
  }, [tab, activity, loadActivity]);

  if (loading) return <PageSkeleton />;

  if (!project) {
    return (
      <EmptyState
        title="That project does not exist"
        hint={error ?? undefined}
        action={
          <Link href="/live-work?tab=PROJECTS">
            <Button>Back to projects</Button>
          </Link>
        }
      />
    );
  }

  const perms = config?.me.permissions ?? [];
  const canManage = perms.includes('company.write');
  const canDelete = perms.includes('setup.admin');
  const canEnterCost = perms.includes('cost.enter');
  const canSeeFigures = perms.includes('money.figures');
  const currency = config?.organization.currency ?? 'INR';
  const locale = config?.organization.locale ?? 'en-IN';
  const tz = config?.organization.timezone ?? 'Asia/Kolkata';
  const date = (v: string | null | undefined) => formatDate(v, tz, locale);
  const money = (v: string | number | null) => formatMoney(v, currency, locale);

  const actual = project.actualCostTotal != null ? Number(project.actualCostTotal) : null;
  const estimated = project.estimatedCost != null ? Number(project.estimatedCost) : null;
  const overEstimate = actual != null && estimated != null && actual > estimated;
  const openTasks = tasks.filter((t) => t.status !== 'DONE' && t.status !== 'CANCELLED');

  // Cost breakdown by person (brief §10: Project screen requires this).
  // Grouped across every month the project ran, since a person's allocation
  // is stored per-month — the same rows allocationCost() sums server-side
  // for actualCostTotal. monthlyCost arrives undefined for anyone without
  // setup.admin (server-masked), so a viewer without it still sees who
  // worked on the job and their percent, just not the rupee figure.
  const peopleBreakdown = Object.values(
    project.allocations.reduce<Record<string, { user: Allocation['user']; months: number; totalPercent: number; cost: number | null }>>((acc, a) => {
      const entry = acc[a.user.id] ?? { user: a.user, months: 0, totalPercent: 0, cost: a.user.monthlyCost != null ? 0 : null };
      entry.months += 1;
      entry.totalPercent += a.percent;
      if (entry.cost != null && a.user.monthlyCost != null) {
        entry.cost += (a.percent / 100) * Number(a.user.monthlyCost);
      }
      acc[a.user.id] = entry;
      return acc;
    }, {}),
  ).sort((a, b) => (b.cost ?? b.totalPercent) - (a.cost ?? a.totalPercent));

  const advanceMilestone = async (m: Milestone) => {
    const next = MSTATUS_NEXT[m.status];
    if (!next) return;
    setBusyId(m.id);
    try {
      await api.projects.updateMilestone(project.id, m.id, next);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update that milestone');
    } finally {
      setBusyId(null);
    }
  };

  const removeMilestone = async (m: Milestone) => {
    const ok = await confirm({
      title: 'Delete this milestone?',
      message: `${m.label} — ${m.percent}%, ${money(m.amount)}. Only possible because nothing has been billed against it yet.`,
      confirmText: 'Delete milestone',
      variant: 'danger',
    });
    if (!ok) return;
    setBusyId(m.id);
    try {
      await api.projects.deleteMilestone(project.id, m.id);
      toast.success('Milestone deleted.');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete that milestone');
    } finally {
      setBusyId(null);
    }
  };

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
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update that task');
    } finally {
      setBusyId(null);
    }
  };

  const removeCost = async (c: Cost) => {
    const ok = await confirm({
      title: 'Delete this cost?',
      message: `${c.category} — ${c.vendor}, ${money(c.amount)}. It will be removed from the project's actuals immediately.`,
      confirmText: 'Delete cost',
      variant: 'danger',
    });
    if (!ok) return;
    setBusyId(c.id);
    try {
      await api.costs.delete(c.id);
      toast.success('Cost deleted.');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete that cost');
    } finally {
      setBusyId(null);
    }
  };

  const removeProject = async () => {
    const ok = await confirm({
      title: 'Delete this project?',
      message:
        'It will be removed from every list immediately. If any tasks, costs, or billing are attached the server will refuse — set it to Cancelled instead, which stops it counting as live work and keeps the record.',
      confirmText: 'Delete project',
      variant: 'danger',
      requireText: project.name,
      requireTextLabel: 'Type the project name to confirm',
    });
    if (!ok) return;
    try {
      await api.projects.delete(id);
      toast.success('Project deleted.');
      router.push('/live-work?tab=PROJECTS');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete this project.');
    }
  };

  return (
    <>
      <Link href="/live-work?tab=PROJECTS" className="mb-4 inline-flex items-center gap-1.5 text-sm text-secondary transition-colors hover:text-primary">
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} /> Projects
      </Link>

      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-primary">{project.name}</h1>
            <Badge tone={STATUS[project.status].tone}>{STATUS[project.status].label}</Badge>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${getPriorityBadge(project.priority)}`}>
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${getPriorityDot(project.priority)}`} />
              {getPriorityLabel(project.priority)}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-secondary">
            <Link href={`/companies/${project.company.id}`} className="hover:underline">
              {project.company.name}
            </Link>
            {project.owner && <span>· owner {project.owner.name}</span>}
            {/* The dates moved here when Profit took the fourth figure slot. A
                timeline is context for the work, not one of the four numbers
                the screen exists to produce. */}
            <span>
              · {date(project.startDate)} – {date(project.endDate)}
            </span>
          </div>
          {project.description && <p className="mt-2 max-w-2xl text-sm text-secondary">{project.description}</p>}
        </div>

        <div className="flex items-center gap-2">
          {canManage && (
            <Button variant="ghost" icon={Settings2} onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
          {canDelete && (
            <Button variant="ghost" icon={Trash2} onClick={() => void removeProject()}>
              Delete
            </Button>
          )}
          <Button variant="primary" icon={Plus} onClick={() => setAddingTask(true)}>
            Task
          </Button>
        </div>
      </div>

      {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

      {/*
        The four figures a project exists to produce, in the same treatment the
        retainer month card uses — and Profit as the single dark card, because
        every other number here is an input to it.

        This used to be Quoted / Estimated / Actual / Timeline: three costs and
        a date, with no profit anywhere. A retainer could answer "did we make
        money on that job" per month card and a project could not answer it at
        all, which is the half of the business where it matters most, because a
        project ENDS.
      */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Quoted" value={money(project.quotedValue)} note={`${project.percentComplete}% done`} />
        <StatTile
          label="Cost estimate"
          value={estimated != null ? money(estimated) : 'Not set'}
          note={estimated == null ? 'nothing to compare against' : 'what we thought it would take'}
        />
        <StatTile
          label="Cost so far"
          value={actual != null ? money(actual) : '—'}
          note={
            project.profit
              ? `${money(project.profit.directCost)} external · ${money(project.profit.peopleCost)} people`
              : 'external and people'
          }
          tone={overEstimate ? 'danger' : undefined}
        />
        {project.profit ? (
          <StatTile
            label={project.status === 'DELIVERED' ? 'Final profit' : 'Profit so far'}
            value={money(project.profit.profit)}
            note={
              project.profit.marginPercent === null
                ? 'no quoted value to measure against'
                : `${project.profit.marginPercent}% margin`
            }
            dark
          />
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-surface p-5">
            <p className="eyebrow">Profit</p>
            <p className="mt-2 text-sm text-secondary">
              What this job costs and makes is hidden. The work on it is yours to see.
            </p>
          </div>
        )}
      </div>

      {/*
        The early warning the brief asks for (§11.3 step 4) — "while there is
        still time to act". Comparing spend to estimate only says something on
        the last day; comparing it to how much is actually FINISHED says it in
        week two.
      */}
      {project.costRisk && project.costRisk.reason && (
        <div
          className={`mb-6 rounded-xl border px-4 py-3 ${
            project.costRisk.level === 'LOSS'
              ? 'border-danger/30 bg-danger-tint'
              : 'border-warning/30 bg-warning-tint'
          }`}
        >
          <p
            className={`text-sm font-semibold ${
              project.costRisk.level === 'LOSS' ? 'text-danger' : 'text-warning-ink'
            }`}
          >
            {project.costRisk.level === 'LOSS' ? 'On course to lose money' : 'Running above the estimate'}
          </p>
          <p
            className={`mt-0.5 text-sm ${
              project.costRisk.level === 'LOSS' ? 'text-danger' : 'text-warning-ink'
            }`}
          >
            {project.costRisk.reason}
            {project.costRisk.projectedCost != null && (
              <> At this rate it finishes at {money(project.costRisk.projectedCost)}.</>
            )}
          </p>
        </div>
      )}

      <Tabs className="mb-5" tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'milestones' && (
        <div className="space-y-5">
          <Card padding="none">
            <CardHeader>
              <CardTitle>Billing milestones</CardTitle>
              {canManage && (
                <Button size="sm" variant="ghost" icon={Plus} className="ml-auto" onClick={() => setAddingMilestone(true)}>
                  Milestone
                </Button>
              )}
            </CardHeader>
            <CardBody className="p-0!">
              {project.milestones.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No milestones set" hint="This project has no billing stages." />
                </div>
              ) : (
                <div className="overflow-x-auto">
                <table className="w-full text-sm data-table">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="eyebrow text-left">Stage</th>
                      <th className="eyebrow text-right">%</th>
                      <th className="eyebrow text-right">Amount</th>
                      <th className="eyebrow text-left">Status</th>
                      <th className="eyebrow text-left">Document</th>
                      <th className="" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {project.milestones.map((m) => (
                      <tr key={m.id}>
                        <td className="font-medium text-primary">{m.label}</td>
                        <td className="text-right text-secondary">{m.percent}%</td>
                        <td className="text-right">{money(m.amount)}</td>
                        <td className="">
                          <Badge tone={MSTATUS[m.status].tone}>{MSTATUS[m.status].label}</Badge>
                        </td>
                        <td className="text-secondary font-mono text-xs">
                          {m.proformas?.[0]?.number ?? '—'}
                        </td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {canManage && m.status === 'PENDING' && (
                              <>
                                <Button size="sm" variant="ghost" onClick={() => setRaisingProformaForMilestone(m)}>
                                  Raise proforma
                                </Button>
                                <button
                                  onClick={() => setEditingMilestone(m)}
                                  disabled={busyId === m.id}
                                  title="Edit milestone"
                                  className="rounded-lg p-1.5 text-secondary hover:bg-subtle hover:text-primary transition-colors"
                                >
                                  <Settings2 className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => void removeMilestone(m)}
                                  disabled={busyId === m.id}
                                  title="Delete milestone"
                                  className="rounded-lg p-1.5 text-secondary hover:bg-danger-tint hover:text-danger transition-colors"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </>
                            )}
                            {canManage && m.status !== 'PENDING' && MSTATUS_NEXT[m.status] && (
                              <Button size="sm" variant="ghost" loading={busyId === m.id} onClick={() => void advanceMilestone(m)}>
                                Mark {MSTATUS[MSTATUS_NEXT[m.status]!].label.toLowerCase()}
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </CardBody>
          </Card>

          {project.invoices.length > 0 && (
            <Card padding="none">
              <CardHeader>
                <CardTitle>Invoices raised against this project</CardTitle>
              </CardHeader>
              <CardBody className="p-0!">
                <div className="overflow-x-auto">
                <table className="w-full text-sm data-table">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="eyebrow text-left">Number</th>
                      <th className="eyebrow text-right">Amount</th>
                      <th className="eyebrow text-left">Due</th>
                      <th className="eyebrow text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {project.invoices.map((inv) => (
                      <tr key={inv.id}>
                        <td className="font-medium text-primary">{inv.number}</td>
                        <td className="text-right">{money(inv.amount)}</td>
                        <td className="text-secondary">{date(inv.dueAt)}</td>
                        <td className="text-secondary">{inv.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {tab === 'tasks' && (
        <Card padding="none">
          <CardHeader>
            <CardTitle>Tasks</CardTitle>
            <span className="ml-auto text-micro text-secondary">{openTasks.length} open</span>
          </CardHeader>
          <CardBody className="p-0!">
            {tasks.length === 0 ? (
              <div className="p-6">
                <EmptyState title="No tasks yet" hint="Add the first one." action={<Button icon={Plus} onClick={() => setAddingTask(true)}>Task</Button>} />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {tasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className={`flex items-center gap-1.5 text-sm font-medium ${t.status === 'DONE' || t.status === 'CANCELLED' ? 'text-secondary line-through' : 'text-primary'}`}>
                        {(t.priority === 'HIGH' || t.priority === 'URGENT') && (
                          <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${getPriorityDot(t.priority)}`} title={getPriorityLabel(t.priority)} />
                        )}
                        {t.title}
                      </p>
                      <p className="text-xs text-secondary mt-0.5">
                        {t.assignee?.name ?? 'Unassigned'} · due {date(t.dueDate)}
                        {t.status === 'ON_HOLD' && t.waitingOn && ' · waiting on ' + (t.waitingOn === 'CLIENT' ? 'client' : 'someone else')}
                      </p>
                    </div>
                    <div className="shrink-0">
                      <Select
                        value={t.status}
                        onChange={(v) => void changeTaskStatus(t, v as TStatus)}
                        options={TASK_STATUS_OPTIONS}
                        ariaLabel={`Status for ${t.title}`}
                        buttonClassName="px-2.5 py-1.5 text-xs w-32"
                        disabled={busyId === t.id}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {tab === 'costs' && (
        <Card padding="none">
          <CardHeader>
            <CardTitle>Costs</CardTitle>
            {canEnterCost && (
              <Button size="sm" variant="ghost" icon={Plus} className="ml-auto" onClick={() => setAddingCost(true)}>
                Cost
              </Button>
            )}
          </CardHeader>
          <CardBody className="p-0!">
            {project.costs.length === 0 ? (
              <div className="p-6">
                <EmptyState title="Nothing spent yet" hint="Vendor bills and expenses entered against this project show up here." />
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
                    {canEnterCost && <th className="w-10"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {project.costs.map((c) => (
                    <tr key={c.id}>
                      <td className="font-medium text-primary">{c.category}</td>
                      <td className="text-secondary">{c.vendor}</td>
                      <td className="text-secondary">{c.enteredBy?.name ?? '—'}</td>
                      <td className="text-secondary">{date(c.incurredAt)}</td>
                      <td className="text-right">{money(c.amount)}</td>
                      {canEnterCost && (
                        <td className="text-right">
                          <button
                            onClick={() => void removeCost(c)}
                            disabled={busyId === c.id}
                            title="Delete cost"
                            className="rounded-lg p-1.5 text-secondary hover:bg-danger-tint hover:text-danger transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {tab === 'people' && (
        <Card padding="none">
          <CardHeader>
            <CardTitle>Cost breakdown by person</CardTitle>
          </CardHeader>
          <CardBody className="p-0!">
            {peopleBreakdown.length === 0 ? (
              <div className="p-6">
                <EmptyState title="Nobody allocated yet" hint="Heads confirm each person's split for the month on the monthly time split screen." />
              </div>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full text-sm data-table">
                <thead>
                  <tr className="border-b border-border">
                    <th className="eyebrow text-left">Person</th>
                    <th className="eyebrow text-right">Months</th>
                    <th className="eyebrow text-right">Total split</th>
                    <th className="eyebrow text-right">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {peopleBreakdown.map((p) => (
                    <tr key={p.user.id}>
                      <td className="font-medium text-primary">{p.user.name} <span className="text-secondary font-normal">· {p.user.dept}</span></td>
                      <td className="text-right text-secondary">{p.months}</td>
                      <td className="text-right text-secondary">{p.totalPercent}%</td>
                      <td className="text-right font-medium text-primary">{p.cost != null ? money(p.cost) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {tab === 'activity' && (
        <Card>
          {activity === null ? (
            <p className="text-sm text-secondary">Loading…</p>
          ) : (
            <ActivityFeed items={activity} />
          )}
        </Card>
      )}

      <NewWorkTaskModal
        open={addingTask}
        team={team}
        companyId={project.companyId}
        defaultTarget={{ kind: 'PROJECT', projectId: id }}
        onClose={() => setAddingTask(false)}
        onCreated={() => {
          setAddingTask(false);
          void load();
        }}
      />

      <NewWorkCostModal
        open={addingCost}
        target={{ kind: 'PROJECT', projectId: id }}
        onClose={() => setAddingCost(false)}
        onCreated={() => {
          setAddingCost(false);
          void load();
        }}
      />

      <EditProjectModal
        project={editing ? project : null}
        team={team}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          void load();
        }}
      />

      {raisingProformaForMilestone && (
        <NewProformaModal
          companyId={project.companyId}
          companyName={project.company.name}
          source={{ type: 'MILESTONE', projectId: project.id, milestoneId: raisingProformaForMilestone.id }}
          defaultAmount={Number(raisingProformaForMilestone.amount ?? 0)}
          defaultDescription={`${raisingProformaForMilestone.label} — ${project.name}`}
          onCancel={() => setRaisingProformaForMilestone(null)}
          onConfirm={() => {
            setRaisingProformaForMilestone(null);
            void load();
          }}
        />
      )}

      <MilestoneFormModal
        open={addingMilestone || Boolean(editingMilestone)}
        milestone={editingMilestone}
        quotedValue={project.quotedValue != null ? Number(project.quotedValue) : null}
        onClose={() => {
          setAddingMilestone(false);
          setEditingMilestone(null);
        }}
        onSave={async (body) => {
          if (editingMilestone) {
            await api.projects.editMilestone(project.id, editingMilestone.id, body);
            toast.success('Milestone updated.');
          } else {
            await api.projects.addMilestone(project.id, body);
            toast.success('Milestone added.');
          }
          setAddingMilestone(false);
          setEditingMilestone(null);
          await load();
        }}
      />
    </>
  );
}

function humanizeVerb(verb: string, payload: Record<string, unknown> | null | undefined): string {
  const p = payload ?? {};
  switch (verb) {
    case 'project_created':
      return `Project created${p.quotedValue ? ` at ₹${Number(p.quotedValue).toLocaleString('en-IN')}` : ''}.`;
    case 'project_edited':
      return `Project details updated (${Array.isArray(p.fields) ? p.fields.join(', ') : 'fields changed'}).`;
    case 'milestone_status_changed':
      return `Milestone "${p.label ?? ''}" moved from ${p.from ?? '?'} to ${p.to ?? '?'}.`;
    case 'milestone_added':
      return `Milestone "${p.label ?? ''}" added${p.percent ? ` (${p.percent}%)` : ''}.`;
    case 'milestone_edited':
      return `Milestone "${p.label ?? ''}" edited.`;
    case 'milestone_deleted':
      return `Milestone "${p.label ?? ''}" deleted.`;
    case 'task_created':
      return `Task "${p.title ?? ''}" created.`;
    case 'task_completed':
      return `Task marked done.`;
    case 'task_reopened':
      return `Task reopened.`;
    case 'task_waiting':
      return `Task put on hold, waiting on ${p.waitingOn === 'CLIENT' ? 'the client' : 'another person'}.`;
    case 'task_resumed':
      return `Task resumed.`;
    case 'created':
      return `Cost recorded — ${p.category ?? ''}, ${p.vendor ?? ''}${p.amount ? ` (₹${Number(p.amount).toLocaleString('en-IN')})` : ''}.`;
    default:
      return verb.replace(/_/g, ' ');
  }
}

function EditProjectModal({
  project,
  team,
  onClose,
  onSaved,
}: {
  project: ProjectDetail | null;
  team: { id: string; name: string; dept: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [quotedValue, setQuotedValue] = useState('');
  const [estimatedCost, setEstimatedCost] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [status, setStatus] = useState<Status>('LIVE');
  const [priority, setPriority] = useState('MEDIUM');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!project) return;
    setName(project.name);
    setQuotedValue(project.quotedValue != null ? String(Number(project.quotedValue)) : '');
    setEstimatedCost(project.estimatedCost != null ? String(Number(project.estimatedCost)) : '');
    setStartDate(project.startDate.slice(0, 10));
    setEndDate(project.endDate.slice(0, 10));
    setOwnerId(project.ownerId);
    setStatus(project.status);
    setPriority(project.priority);
    setDescription(project.description ?? '');
    setError(null);
  }, [project]);

  if (!project) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.projects.update(project.id, {
        name: name.trim(),
        quotedValue: quotedValue ? Number(quotedValue) : undefined,
        estimatedCost: estimatedCost ? Number(estimatedCost) : null,
        startDate,
        endDate,
        ownerId: ownerId || undefined,
        status,
        priority,
        description: description.trim() || null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this project');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={Boolean(project)} onClose={onClose} title="Edit project" size="lg">
      <form onSubmit={submit}>
        <ModalBody className="space-y-4">
          <Field label="Project name" value={name} onChange={setName} required />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Quoted value (₹)" value={quotedValue} onChange={setQuotedValue} type="number" required />
            <Field label="Your cost estimate (₹)" value={estimatedCost} onChange={setEstimatedCost} type="number" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start date" value={startDate} onChange={setStartDate} type="date" required />
            <Field label="Expected end" value={endDate} onChange={setEndDate} type="date" required />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldSelect label="Owner" value={ownerId} onChange={setOwnerId} options={personOptions(team)} />
            <FieldSelect
              label="Status"
              value={status}
              onChange={(v) => setStatus(v as Status)}
              options={[
                { value: 'LIVE', label: 'Live' },
                { value: 'DELIVERED', label: 'Delivered' },
                { value: 'CANCELLED', label: 'Cancelled' },
              ]}
            />
          </div>
          <FieldSelect label="Priority" value={priority} onChange={setPriority} options={PRIORITY_OPTIONS} />
          <Field label="Description" value={description} onChange={setDescription} textarea rows={3} />
          {error && <ErrorNote>{error}</ErrorNote>}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!name.trim()}>
            Save changes
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

function MilestoneFormModal({
  open,
  milestone,
  quotedValue,
  onClose,
  onSave,
}: {
  open: boolean;
  milestone: Milestone | null;
  quotedValue: number | null;
  onClose: () => void;
  onSave: (body: { label: string; percent: number; amount: number }) => Promise<void>;
}) {
  const [label, setLabel] = useState('');
  const [percent, setPercent] = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLabel(milestone?.label ?? '');
    setPercent(milestone ? String(milestone.percent) : '');
    setAmount(milestone?.amount != null ? String(Number(milestone.amount)) : '');
    setError(null);
  }, [open, milestone]);

  const suggestedAmount = quotedValue != null && Number(percent) > 0 ? Math.round((quotedValue * Number(percent)) / 100) : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const percentNum = Number(percent);
    const amountNum = Number(amount);
    if (!label.trim() || !(percentNum > 0) || !(amountNum > 0)) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({ label: label.trim(), percent: percentNum, amount: amountNum });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that milestone');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={milestone ? 'Edit milestone' : 'Add milestone'}>
      <form onSubmit={submit}>
        <ModalBody className="space-y-4">
          <Field label="Stage" value={label} onChange={setLabel} placeholder="e.g. Design sign-off" required />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Percent" type="number" value={percent} onChange={setPercent} required />
            <Field
              label="Amount"
              type="number"
              value={amount}
              onChange={setAmount}
              hint={suggestedAmount != null ? `${suggestedAmount.toLocaleString('en-IN')} at ${percent}% of quoted value` : undefined}
              required
            />
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!label.trim() || !(Number(percent) > 0) || !(Number(amount) > 0)}>
            {milestone ? 'Save changes' : 'Add milestone'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
