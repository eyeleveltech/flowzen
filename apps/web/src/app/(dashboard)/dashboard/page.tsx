'use client';

/**
 * The morning screen.
 *
 * What needs attention today. Everything is computed at read time — a stored
 * "overdue" is wrong the night a job fails (master plan §3.8).
 *
 * What appears depends on the role, and the server decides that. This only
 * renders what it was given: hiding a card is presentation, not security (§5).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Clock, FileClock, Wallet, Briefcase, Users, Building2, Folder, AlertTriangle, Bell, CheckCircle, Zap } from 'lucide-react';
import { api, formatMoney, type CompanyStatus, type Dashboard, type OrgConfig, type Member } from '@/lib/api-v2';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge, COMPANY_TONE } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/card';
import { EmptyState, ErrorNote } from '@/components/ui/empty-state';
import { PageSkeleton } from '@/components/ui/skeleton-loaders';
import { useModuleStore } from '@/stores';

export default function DashboardPage() {
  const activeModule = useModuleStore((s) => s.activeModule);
  const hydrateModule = useModuleStore((s) => s.hydrate);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    hydrateModule();
    setMounted(true);
  }, [hydrateModule]);

  if (!mounted) return <PageSkeleton />;

  if (activeModule === 'PM') {
    return <PMDashboard />;
  }

  return <DefaultDashboard />;
}

function DefaultDashboard() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [config, setConfig] = useState<OrgConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [d, c] = await Promise.all([api.dashboard.get(), api.config.get()]);
        setData(d);
        setConfig(c);
      } catch (e) {
        // A failed load renders as a message. Left uncaught it becomes an
        // unhandled rejection in the console and a spinner that never stops.
        setError(e instanceof Error ? e.message : 'Could not load your dashboard');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (error) {
    return (
      <EmptyState
        title="Could not load your day"
        hint={error}
        action={<Button onClick={() => window.location.reload()}>Try again</Button>}
      />
    );
  }

  if (loading || !data) return <PageSkeleton />;

  const currency = config?.organization.currency ?? 'INR';
  const locale = config?.organization.locale ?? 'en-IN';
  const money = (v: string | undefined) => formatMoney(v, currency, locale);

  return (
    <>
      <PageHeader title="Today" subtitle="What needs you, and what the numbers say" />

      <div className="space-y-6">
        {/* ── Your own work ─────────────────────────────────────────────── */}
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat
            label="Overdue"
            value={data.work.overdue}
            tone={data.work.overdue > 0 ? 'bad' : 'plain'}
          />
          <Stat label="Due today" value={data.work.dueToday} />
          <Stat label="Waiting for your review" value={data.work.awaitingMyReview} />
        </section>

        {/* ── Money — Admin and above only ──────────────────────────────── */}
        {data.money && (
          <Card padding="none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-secondary" strokeWidth={1.75} /> Money
              </CardTitle>
            </CardHeader>
            <CardBody>
              {/*
                Three numbers, and none is derived from another. A month can look
                excellent on the first and be empty on the third (§3.8).
              */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Figure
                  label="Monthly revenue"
                  value={money(data.money.mrr)}
                  hint="What the agreements say you earn"
                />
                <Figure
                  label="Billed this month"
                  value={money(data.money.billedThisMonth)}
                  hint="What you actually invoiced"
                />
                <Figure
                  label="Collected"
                  value={money(data.money.collectedThisMonth)}
                  hint="What actually arrived"
                />
                <Figure
                  label="Overdue"
                  value={money(data.money.overdue)}
                  hint={`${money(data.money.outstanding)} outstanding`}
                  tone={Number(data.money.overdue) > 0 ? 'bad' : 'plain'}
                />
              </div>

              {(data.money.invoicesDueToRaise > 0 || data.money.pricesDueForReview > 0) && (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
                  {data.money.invoicesDueToRaise > 0 && (
                    <Link href="/revenue">
                      <Button size="sm">
                        {data.money.invoicesDueToRaise} invoice
                        {data.money.invoicesDueToRaise === 1 ? '' : 's'} to raise
                      </Button>
                    </Link>
                  )}
                  {data.money.pricesDueForReview > 0 && (
                    <Link href="/revenue">
                      <Button size="sm">
                        {data.money.pricesDueForReview} price
                        {data.money.pricesDueForReview === 1 ? '' : 's'} due for review
                      </Button>
                    </Link>
                  )}
                </div>
              )}
            </CardBody>
          </Card>
        )}

        {/* ── Pipeline — Sales and above ────────────────────────────────── */}
        {data.pipeline && (
          <div className="grid gap-4 lg:grid-cols-2">
            {data.pipeline.rotting.length > 0 && (
              <Card className="border-amber-200 bg-amber-50/40">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary">
                  <Clock className="h-4 w-4 text-amber-600" strokeWidth={1.75} /> Gone quiet
                </h2>
                <ul className="space-y-1">
                  {data.pipeline.rotting.slice(0, 5).map((d) => (
                    <li key={d.id}>
                      <Link
                        href={`/pipeline/${d.id}`}
                        className="block rounded-lg p-2 transition-colors hover:bg-white"
                      >
                        <p className="text-sm font-medium text-primary">
                          {d.title ?? d.company.name}
                        </p>
                        <p className="text-xs text-secondary">
                          {d.daysInStage} days in {d.stage}
                          {d.blockedOn ? ` · waiting on ${d.blockedOn}` : ''}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {data.pipeline.quotesAwaitingReply.length > 0 && (
              <Card>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary">
                  <FileClock className="h-4 w-4 text-secondary" strokeWidth={1.75} /> Quotes with no
                  reply
                </h2>
                {/*
                  Accepted and declined both get recorded by somebody. Silence is
                  recorded by nobody — which is why it is surfaced here (§3.12).
                */}
                <ul className="space-y-1">
                  {data.pipeline.quotesAwaitingReply.slice(0, 5).map((q) => (
                    <li key={q.id} className="rounded-lg p-2 transition-colors hover:bg-surface">
                      <p className="text-sm font-medium text-primary">
                        {q.company.name} · {money(q.total)}
                      </p>
                      <p className="text-xs text-secondary">
                        {q.number} · sent {q.daysWaiting} days ago
                      </p>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        )}

        {/* ── Clients ───────────────────────────────────────────────────── */}
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-primary">Clients</h2>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(COMPANY_TONE) as CompanyStatus[]).map((status) => {
              const count = data.clients[status] ?? 0;
              if (count === 0 && status !== 'ACTIVE') return null;
              return (
                <Link key={status} href={`/clients?status=${status}`}>
                  <Badge tone={COMPANY_TONE[status].tone} className="gap-1.5 px-3 py-1.5">
                    <span className="text-sm font-semibold tabular-nums">{count}</span>
                    {COMPANY_TONE[status].label}
                  </Badge>
                </Link>
              );
            })}
          </div>
          {/*
            A finished project is not churn, so it gets its own tile and its own
            next action rather than being filed with the losses (§3.2).
          */}
          {(data.clients.PROJECT_COMPLETED ?? 0) > 0 && (
            <p className="mt-3 text-xs text-secondary">
              {data.clients.PROJECT_COMPLETED} finished a project — the warmest leads you have.
            </p>
          )}
        </Card>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  tone = 'plain',
}: {
  label: string;
  value: number;
  tone?: 'plain' | 'bad';
}) {
  return (
    <Card
      padding="sm"
      className={tone === 'bad' && value > 0 ? 'border-red-200 bg-red-50' : 'bg-surface'}
    >
      <p className="text-2xl font-semibold tabular-nums tracking-tight text-primary">{value}</p>
      <p className="mt-0.5 text-xs text-secondary">{label}</p>
    </Card>
  );
}

function Figure({
  label,
  value,
  hint,
  tone = 'plain',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'plain' | 'bad';
}) {
  return (
    <div>
      <p className="text-xs text-secondary">{label}</p>
      <p
        className={`mt-0.5 text-lg font-semibold tabular-nums tracking-tight ${
          tone === 'bad' ? 'text-danger' : 'text-primary'
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-secondary">{hint}</p>}
    </div>
  );
}

function WidgetCard({ label, value, icon }: { label: string; value: number | string; icon: React.ReactNode }) {
  return (
    <Card className="flex h-24 flex-col justify-between rounded-xl border border-border bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <span className="text-[11px] font-bold tracking-wider text-secondary uppercase">{label}</span>
        {icon}
      </div>
      <span className="text-3xl font-semibold tracking-tight text-primary">{value}</span>
    </Card>
  );
}

function PMDashboard() {
  const [data, setData] = useState<Dashboard | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [projects, setProjects] = useState<any[] | null>(null);
  const [team, setTeam] = useState<Member[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [clients, setClients] = useState<any[] | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [d, p, u, c, acts] = await Promise.all([
          api.dashboard.get(),
          api.projects.list(),
          api.users.list().catch(() => []),
          api.companies.list({ status: 'ACTIVE' }).catch(() => []),
          api.activities.list({ take: '10' }).catch(() => []),
        ]);
        setData(d);
        setProjects(p);
        setTeam(u.filter((m) => m.status === 'ACTIVE'));
        setClients(c);
        setActivities(Array.isArray(acts) ? acts : []);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load your PM dashboard');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (error) {
    return (
      <EmptyState
        title="Could not load your day"
        hint={error}
        action={<Button onClick={() => window.location.reload()}>Try again</Button>}
      />
    );
  }

  if (loading || !data || !projects || !clients) return <PageSkeleton />;

  const activeProjects = projects.filter((p) => p.status === 'ACTIVE');
  const delayedProjects = activeProjects.filter((p) => p.health === 'OFF_TRACK').length;
  const pendingTasks = data.work.tasks || [];

  const now = new Date();
  const next7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const upcomingDeadlines = pendingTasks.filter((t) => {
    if (!t.dueDate) return false;
    const d = new Date(t.dueDate);
    return d >= now && d <= next7Days;
  });

  return (
    <div className="space-y-6">
      {/* Top Widgets */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <WidgetCard label="ACTIVE CLIENTS" value={clients.length} icon={<Building2 className="h-4 w-4 text-secondary" />} />
        <WidgetCard label="ACTIVE PROJECTS" value={activeProjects.length} icon={<Folder className="h-4 w-4 text-secondary" />} />
        <WidgetCard label="DELAYED PROJECTS" value={delayedProjects} icon={<AlertTriangle className="h-4 w-4 text-secondary" />} />
        <WidgetCard label="TEAM MEMBERS" value={team.length} icon={<Users className="h-4 w-4 text-secondary" />} />
        <WidgetCard label="OVERDUE TASKS" value={data.work.overdue} icon={<Clock className="h-4 w-4 text-secondary" />} />
      </div>

      {/* Main Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Pending Tasks */}
          <section className="flex flex-col rounded-card border border-border bg-white min-h-75 lg:col-span-2">
            <div className="flex items-center justify-between border-b border-border pb-4 p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-primary">
                <Bell className="h-4 w-4 text-secondary" /> Pending Tasks
              </h2>
              <Link href="/tasks" className="text-xs font-medium text-primary hover:underline">
                View All
              </Link>
            </div>
            {pendingTasks.length > 0 ? (
              <ul className="mt-4 space-y-2 px-5 pb-5">
                {pendingTasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                    <div>
                      <p className="text-sm font-medium text-primary">{t.title}</p>
                      {t.project && <p className="text-xs text-secondary">{t.project.name}</p>}
                    </div>
                    <span className="text-xs text-secondary">
                      {t.dueDate ? new Date(t.dueDate).toLocaleDateString() : 'No date'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
                <span className="text-3xl">🎉</span>
                <p className="mt-4 font-medium text-green-600">You're all caught up!</p>
                <p className="mt-1 text-sm text-secondary">No pending tasks right now.</p>
              </div>
            )}
          </section>

          {/* Pending Approvals */}
          <section className="flex flex-col rounded-card border border-border bg-white min-h-75">
            <div className="flex items-center justify-between border-b border-border pb-4 p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-primary">
                <CheckCircle className="h-4 w-4 text-secondary" /> Pending Approvals
              </h2>
            </div>
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
              {data.work.awaitingMyReview > 0 ? (
                <div>
                  <p className="text-sm font-semibold text-primary">
                    {data.work.awaitingMyReview} task(s) awaiting your review.
                  </p>
                  <Link href="/tasks" className="mt-2 inline-block text-xs font-medium text-primary underline">
                    Go to task queue
                  </Link>
                </div>
              ) : (
                <p className="text-sm text-secondary">No tasks waiting for review.</p>
              )}
            </div>
          </section>
        </div>

        <div className="space-y-6">
          {/* Upcoming Deadlines */}
          <Card className="flex min-h-50 flex-col p-5">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-primary">
                <Clock className="h-4 w-4 text-secondary" /> Upcoming Deadlines
              </h2>
            </div>
            {upcomingDeadlines.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {upcomingDeadlines.slice(0, 4).map((t) => (
                  <li key={t.id} className="flex items-center justify-between border-b border-subtle pb-2 last:border-b-0">
                    <span className="truncate text-xs font-medium text-primary max-w-[140px]">{t.title}</span>
                    <span className="text-[11px] text-secondary">
                      {t.dueDate ? new Date(t.dueDate).toLocaleDateString() : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
                <p className="text-sm text-secondary">No deadlines in next 7 days.</p>
              </div>
            )}
          </Card>

          {/* Overdue Tasks */}
          <Card className="flex min-h-50 flex-col p-5">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-danger">
                <AlertTriangle className="h-4 w-4 text-danger" /> Overdue Tasks
              </h2>
            </div>
            {data.work.overdue > 0 ? (
              <div className="mt-4 space-y-2">
                <p className="text-sm text-secondary">You have {data.work.overdue} overdue task(s).</p>
                <Link href="/tasks" className="inline-block text-xs font-semibold text-danger underline">
                  Review overdue work
                </Link>
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
                <span className="text-3xl">🎉</span>
                <p className="mt-4 font-medium text-green-600">No overdue tasks. Great job!</p>
              </div>
            )}
          </Card>

          {/* Activity Feed */}
          <section className="flex flex-col rounded-card border border-border bg-white min-h-75 p-5">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-primary">
                <Zap className="h-4 w-4 text-secondary" /> Activity Feed
              </h2>
            </div>
            {activities.length > 0 ? (
              <ul className="mt-3 divide-y divide-border text-xs">
                {activities.slice(0, 5).map((a) => (
                  <li key={a.id} className="py-2.5 first:pt-0">
                    <p className="font-medium text-primary">{a.message}</p>
                    <p className="mt-0.5 text-[11px] text-secondary">
                      {a.user?.name ?? 'System'} · {new Date(a.occurredAt).toLocaleDateString()}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
                <p className="text-sm text-secondary">No recent activity.</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
