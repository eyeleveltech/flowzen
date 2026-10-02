'use client';

/**
 * The Monday brief — an executive one-page.
 *
 * Read top to bottom like a short report: who it is for and which week, a few
 * sentences on how it went, last week's numbers with eight weeks behind each,
 * what needs a decision, the week ahead, the risks, the team by department.
 *
 * It used to be four boxes of problems in a fixed two-column grid: nothing
 * about last week, invoices under 30 days late invisible, rows that went
 * nowhere, and a team box that named people. Now every row opens its record,
 * "needs action" and "risks" are the bell's own open alerts, and the team is
 * counted by department, never by name.
 *
 * The week switcher goes back 26 weeks. A past week shows its numbers and the
 * summary written for it; what needs action, the week ahead, the risks and the
 * team describe now, and are left to the current week.
 */

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Hourglass,
  MessagesSquare,
  Receipt,
  Sparkles,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api, ApiError, formatMoney, type BriefMetric, type MondayBrief } from '@/lib/api-v2';
import { usePageHeader } from '@/hooks/usePageHeader';
import { useAuthStore } from '@/stores';
import { Button } from '@/components/ui/button';
import { ScreenMessage } from '@/components/ui/screen-message';
import { Skeleton } from '@/components/ui/skeleton';
import { getInitials, cn } from '@/lib/utils';
import { TrendTile } from '@/components/brief/TrendTile';
import { AlertGroup } from '@/components/brief/AlertGroup';
import { WeekTimeline } from '@/components/brief/WeekTimeline';
import { TeamBars } from '@/components/brief/TeamBars';
import { DetailsDrawer } from '@/components/brief/DetailsDrawer';
import { addDays, compactMoney, minutesLabel, weekLabel } from '@/components/brief/format';

const GROUP_ICON: Record<string, LucideIcon> = {
  'Money to collect': Wallet,
  'Sales follow-ups': MessagesSquare,
  'Billing to do': Receipt,
  'Stuck approvals': Hourglass,
  Delivery: Gauge,
  Clients: Building2,
};
/** The groups whose card header carries the money in it. */
const MONEY_GROUPS = new Set(['Money to collect', 'Billing to do']);

/** "Good morning" by the studio's clock, not the laptop's. */
function greeting(timezone: string): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

function Heading({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-base font-semibold text-primary">{children}</h2>
      {aside}
    </div>
  );
}

/** The page's shape while it loads — not a sentence saying it is loading. */
function BriefSkeleton() {
  const block = (cls: string) => <Skeleton className={cn('rounded-card motion-reduce:animate-none', cls)} />;
  return (
    <div className="mx-auto w-full max-w-240 space-y-8" aria-busy="true" aria-label="Loading the brief">
      <div className="space-y-2">
        {block('h-4 w-40')}
        {block('h-7 w-64')}
      </div>
      {block('h-28')}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i}>{block('h-36')}</div>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {block('h-48')}
        {block('h-48')}
      </div>
      {block('h-32')}
      {block('h-40')}
    </div>
  );
}

export default function MondayBriefPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const asked = params.get('week') ?? undefined;
  const user = useAuthStore((s) => s.user);
  const reduce = useReducedMotion();
  const [detail, setDetail] = useState<BriefMetric | null>(null);
  const [writing, setWriting] = useState(false);
  const [written, setWritten] = useState<{ week: string; value: MondayBrief['summary'] } | null>(null);

  const { data: brief, error, isPending, isFetching, refetch } = useQuery({
    queryKey: ['monday-brief', asked ?? 'current'],
    queryFn: () => api.brief.monday(asked),
    placeholderData: keepPreviousData,
  });

  const shownWeek = brief ? weekLabel(brief.weeks.last.from, brief.weeks.last.to) : '';
  usePageHeader('Monday brief', shownWeek ? `Week of ${shownWeek}` : null);

  if (isPending && !brief) {
    return (
      <div className="page-shell">
        <BriefSkeleton />
      </div>
    );
  }
  if (error && !brief) {
    const badWeek = error instanceof ApiError && error.status === 400;
    return (
      <div className="page-shell">
        <ScreenMessage
          icon={AlertTriangle}
          title={badWeek ? 'That week isn’t available' : 'Couldn’t load the brief'}
          message={error instanceof ApiError ? error.message : 'Check your connection, then try again.'}
          actions={
            badWeek
              ? [{ label: 'Go to this week', href: '/brief', primary: true }]
              : [{ label: 'Try again', onClick: () => refetch(), primary: true }]
          }
        />
      </div>
    );
  }
  if (!brief) return null;

  const cur = brief.currency;
  const s = brief.scoreboard;
  const t = brief.trends;
  const week = brief.week;
  const current = week.current;
  const money = (n: number) => formatMoney(Math.round(n), cur);
  const short = (n: number) => compactMoney(n, cur);
  const count = (n: number) => String(Math.round(n));
  const firstName = user?.name?.split(/\s+/)[0];
  const summary = written && written.week === week.shown ? written.value : brief.summary;
  const needsAction = brief.needsAction ?? [];
  const risks = brief.risks ?? [];
  const team = brief.team ?? [];
  const needsCount = needsAction.reduce((n, g) => n + g.items.length, 0);
  const at = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: brief.timezone, ...opts }).format(new Date(iso));

  /** Sections fade and rise in, staggered — on first load and a change of week only. */
  const enter = (i: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 8 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.35, delay: i * 0.05, ease: 'easeOut' as const },
        };

  const goTo = (monday: string) => {
    router.replace(monday === week.latest ? pathname : `${pathname}?week=${monday}`, { scroll: false });
  };

  const writeSummary = async () => {
    setWriting(true);
    try {
      const res = await api.brief.writeSummary();
      setWritten({ week: week.shown, value: res.summary });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'The summary could not be written.');
    } finally {
      setWriting(false);
    }
  };

  /** "Written Monday 07:00 from that morning's numbers". */
  const writtenLine = (iso: string) => {
    const time = at(iso, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    return `Written ${at(iso, { weekday: 'long' })} ${time} from that ${Number(time.slice(0, 2)) < 12 ? 'morning' : 'day'}’s numbers`;
  };

  const arrow =
    'rounded-md p-1 text-secondary hover:bg-subtle hover:text-primary disabled:opacity-30 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';

  return (
    <div className="page-shell">
      <div className={cn('mx-auto w-full max-w-240 space-y-9 transition-opacity', isFetching && 'opacity-70')}>
        {/* ─── Header ─────────────────────────────────────────────────── */}
        <motion.header key={`${week.shown}-head`} {...enter(0)} className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <p className="text-sm text-secondary">
              {greeting(brief.timezone)}
              {firstName ? `, ${firstName}` : ''}
            </p>
            <div className="-ml-1.5 mt-1 flex items-center gap-1">
              <button type="button" onClick={() => goTo(addDays(week.shown, -7))} disabled={week.shown <= week.earliest} aria-label="The week before" className={arrow}>
                <ChevronLeft className="h-5 w-5" />
              </button>
              <h2 className="text-2xl font-semibold tracking-tight text-primary">Week of {shownWeek}</h2>
              <button type="button" onClick={() => goTo(addDays(week.shown, 7))} disabled={current} aria-label="The week after" className={arrow}>
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </div>
          <div className="flex flex-col items-start gap-1.5 sm:items-end">
            {current && (
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
                  needsCount ? 'bg-warning-tint text-warning-ink' : 'bg-success-tint text-success',
                )}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', needsCount ? 'bg-warning' : 'bg-success')} aria-hidden="true" />
                {needsCount ? `${needsCount} ${needsCount === 1 ? 'thing needs' : 'things need'} you` : 'All clear'}
              </span>
            )}
            <p className="text-xs text-secondary">
              Updated {at(brief.generatedAt, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })} ·{' '}
              <button
                type="button"
                onClick={() => void refetch()}
                className="rounded font-medium underline-offset-2 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                Refresh
              </button>
              {!current && (
                <>
                  {' · '}
                  <Link href={pathname} className="font-medium underline-offset-2 hover:text-primary hover:underline">
                    Back to this week
                  </Link>
                </>
              )}
            </p>
          </div>
        </motion.header>

        {/* ─── The summary ────────────────────────────────────────────── */}
        <motion.section
          key={`${week.shown}-summary`}
          {...enter(1)}
          aria-label="Summary"
          className="rounded-card border border-border border-l-[3px] border-l-accent bg-white px-5 py-4"
        >
          <p className="eyebrow mb-2 inline-flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
            Summary
          </p>
          {summary ? (
            <>
              <p className="max-w-[68ch] text-base leading-relaxed text-primary">{summary.text}</p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-secondary">{writtenLine(summary.generatedAt)}</p>
                {current && brief.aiConfigured && (
                  <button
                    type="button"
                    onClick={() => void writeSummary()}
                    disabled={writing}
                    className="rounded text-xs font-medium text-secondary hover:text-primary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    {writing ? 'Writing…' : 'Regenerate'}
                  </button>
                )}
              </div>
            </>
          ) : !current ? (
            <p className="text-sm text-secondary">No summary that week.</p>
          ) : brief.aiConfigured ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-secondary">Not written yet — it’s written at 07:00 on Monday.</p>
              <Button size="sm" variant="primary" icon={Sparkles} onClick={() => void writeSummary()} loading={writing}>
                Write summary
              </Button>
            </div>
          ) : (
            <p className="text-sm text-secondary">
              AI isn’t set up —{' '}
              <Link href="/settings" className="font-medium text-primary underline underline-offset-2">
                Settings
              </Link>
            </p>
          )}
        </motion.section>

        {/* ─── Last week ──────────────────────────────────────────────── */}
        <motion.section key={`${week.shown}-numbers`} {...enter(2)} aria-labelledby="numbers">
          <Heading>
            <span id="numbers">{current ? 'Last week' : 'That week'}</span>
          </Heading>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <TrendTile
              label="Cash collected"
              value={s.cashCollected.last}
              previous={s.cashCollected.before}
              format={money}
              points={t.cashCollected}
              pointFormat={short}
              note={`vs ${short(s.cashCollected.before)} the week before`}
              onOpen={() => setDetail('cash')}
              openLabel="Cash collected: see the payments"
            />
            <TrendTile
              label="Invoiced"
              value={s.invoiced.last.amount}
              previous={s.invoiced.before.amount}
              format={money}
              points={t.invoiced}
              pointFormat={short}
              note={`${s.invoiced.last.count} ${s.invoiced.last.count === 1 ? 'invoice' : 'invoices'} · vs ${short(s.invoiced.before.amount)}`}
              onOpen={() => setDetail('invoiced')}
              openLabel="Invoiced: see the invoices"
            />
            <TrendTile
              label="Deals won"
              value={s.dealsWon.last.value}
              previous={s.dealsWon.before.value}
              format={money}
              points={t.dealsWon}
              pointFormat={short}
              note={`${s.dealsWon.last.count} ${s.dealsWon.last.count === 1 ? 'deal' : 'deals'} · vs ${short(s.dealsWon.before.value)}`}
              onOpen={() => setDetail('deals')}
              openLabel="Deals won: see the proposals"
            />
            <TrendTile
              label="Proposals sent"
              value={s.proposalsSent.last}
              previous={s.proposalsSent.before}
              format={count}
              points={t.proposalsSent}
              pointFormat={count}
              note={`Revisions included · vs ${s.proposalsSent.before}`}
              onOpen={() => setDetail('proposals')}
              openLabel="Proposals sent: see the versions"
            />
            <TrendTile
              label="Tasks done"
              value={s.tasksDone.last.count}
              previous={s.tasksDone.before.count}
              format={count}
              points={t.tasksDone}
              pointFormat={count}
              note={`${
                s.tasksDone.last.count ? `${Math.round((s.tasksDone.last.onTime / s.tasksDone.last.count) * 100)}% on time · ` : ''
              }vs ${s.tasksDone.before.count}`}
              onOpen={() => setDetail('tasks')}
              openLabel="Tasks done: see by department"
            />
            {s.approvals.map((a) => (
              <TrendTile
                key={a.group}
                label={`Approvals · ${a.group}`}
                value={a.last.medianDecisionMinutes}
                previous={a.before?.medianDecisionMinutes ?? null}
                format={minutesLabel}
                // Longer is worse.
                upIsGood={false}
                points={t.approvals.find((g) => g.group === a.group)?.points ?? []}
                pointFormat={minutesLabel}
                note={`Typical time · ${a.last.decided} decided · ${a.last.escalated} escalated`}
                onOpen={() => router.push('/members?tab=approvals')}
                openLabel={`Approvals, ${a.group}: open the approvals report`}
              />
            ))}
          </div>
        </motion.section>

        {!current ? (
          <motion.p key={`${week.shown}-past`} {...enter(3)} className="border-t border-border pt-6 text-sm text-secondary">
            Actions, the week ahead, risks and team are shown for the current week only.
          </motion.p>
        ) : (
          <>
            {/* ─── Needs your action ─────────────────────────────────── */}
            <motion.section key={`${week.shown}-action`} {...enter(3)} aria-labelledby="action">
              <Heading>
                <span id="action">Needs your action</span>
              </Heading>
              {needsAction.length > 0 ? (
                <div className="grid items-start gap-3 md:grid-cols-2">
                  {needsAction.map((g) => (
                    <AlertGroup
                      key={g.group}
                      group={g.group}
                      items={g.items}
                      icon={GROUP_ICON[g.group] ?? Wallet}
                      tone="action"
                      currency={cur}
                      showTotal={MONEY_GROUPS.has(g.group)}
                    />
                  ))}
                </div>
              ) : (
                <p className="inline-flex items-center gap-2 text-sm font-medium text-success">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  Nothing waiting on you.
                </p>
              )}
            </motion.section>

            {/* ─── This week ─────────────────────────────────────────── */}
            {brief.comingUp && brief.weeks.days && brief.weeks.today && (
              <motion.section key={`${week.shown}-week`} {...enter(4)} aria-labelledby="this-week">
                <Heading>
                  <span id="this-week">This week</span>
                </Heading>
                <WeekTimeline
                  days={brief.weeks.days}
                  today={brief.weeks.today}
                  comingUp={brief.comingUp}
                  timezone={brief.timezone}
                  currency={cur}
                />
              </motion.section>
            )}

            {/* ─── Risks ─────────────────────────────────────────────── */}
            <motion.section key={`${week.shown}-risks`} {...enter(5)} aria-labelledby="risks">
              <Heading>
                <span id="risks">Risks</span>
              </Heading>
              {risks.length > 0 ? (
                <div className="grid items-start gap-3 md:grid-cols-2">
                  {risks.map((g) => (
                    <AlertGroup key={g.group} group={g.group} items={g.items} icon={GROUP_ICON[g.group] ?? Gauge} tone="risk" currency={cur} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-secondary">No risks flagged.</p>
              )}
            </motion.section>

            {/* ─── Team, by department — never by name ───────────────── */}
            <motion.section key={`${week.shown}-team`} {...enter(6)} aria-labelledby="team">
              <Heading aside={<span className="text-xs text-secondary">Counts only — nobody is named here.</span>}>
                <span id="team">Team by department</span>
              </Heading>
              {team.length > 0 ? <TeamBars rows={team} /> : <p className="text-sm text-secondary">No open work.</p>}
            </motion.section>

            {/* ─── Management only: who hasn't opened Flowzen ────────── */}
            {brief.notUsingFlowzen && (
              <motion.section key={`${week.shown}-usage`} {...enter(7)} aria-labelledby="usage">
                <Heading
                  aside={<span className="text-xs text-secondary">{weekLabel(brief.notUsingFlowzen.from, brief.notUsingFlowzen.to)}</span>}
                >
                  <span id="usage">{brief.notUsingFlowzen.title}</span>
                </Heading>
                {brief.notUsingFlowzen.people.length ? (
                  <ul className="flex flex-wrap gap-2">
                    {brief.notUsingFlowzen.people.map((p) => (
                      <li key={p.id} className="inline-flex items-center gap-2 rounded-full border border-border bg-white py-1 pl-1 pr-3 text-sm">
                        <span
                          className="flex h-6 w-6 items-center justify-center rounded-full bg-subtle text-micro font-semibold text-secondary"
                          aria-hidden="true"
                        >
                          {getInitials(p.name)}
                        </span>
                        <span className="text-primary">{p.name}</span>
                        <span className="text-xs text-secondary">{p.lastActive ? `last active ${p.lastActive}` : 'never'}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-secondary">{brief.notUsingFlowzen.line}</p>
                )}
              </motion.section>
            )}
          </>
        )}
      </div>

      <DetailsDrawer metric={detail} week={brief.weeks.last} currency={cur} onClose={() => setDetail(null)} />
    </div>
  );
}
