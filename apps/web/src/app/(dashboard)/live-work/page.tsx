'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useConfig, qk } from '@/hooks/queries';
import { ErrorNote } from '@/components/ui/empty-state';
import { plural } from '@/lib/utils';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, apiGet, formatMoney } from '@/lib/api-v2';
import { usePageHeader } from '@/hooks/usePageHeader';
import { NewInternalProjectModal } from '@/components/work/NewInternalProjectModal';
import { getPriorityBadge, getPriorityLabel } from '@/lib/priority';
import { StatTile, StatRow } from '@/components/ui/stat-tile';
import { Tabs, useTabState, type TabDef } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';

interface LiveAlert { rule: string; severity: 'HIGH' | 'MED' | 'LOW'; message: string }

interface LiveProject {
  id: string;
  name: string;
  company: { id: string; name: string; vertical: string };
  owner?: { id: string; name: string } | null;
  quotedValue: number | string | null;
  estimatedCost?: number | string | null;
  actualCostTotal: number | string | null;
  /** `'none'` when nobody has recorded a cost or an allocation — see jobProfit.ts. */
  profit?: { costBasis?: 'recorded' | 'none' };
  startDate?: string | null;
  endDate?: string | null;
  status: string;
  priority: string;
  milestoneProgress: number;
  openTasksCount: number;
  totalTasksCount: number;
  milestones: { id: string; label: string; status: string; amount: number | string | null }[];
  alerts: LiveAlert[];
}

const PROJECT_STATUS_OPTIONS = [
  { value: 'LIVE', label: 'Live' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: '', label: 'All statuses' },
];

interface LiveRetainer {
  id: string;
  companyName: string;
  owner?: { id: string; name: string } | null;
  monthlyValue: number | string;
  status: string;
  termMonths: number | null;
  renewalDate?: string | null;
  renewalDaysLeft: number | null;
  isExpiringSoon: boolean;
  noFixedTermRisk: boolean;
  monthTasksDone: number;
  monthTasksTotal: number;
  /** Past due and neither done nor cancelled — what makes a row worth opening. */
  monthTasksLate: number;
  /** The named pieces of work inside it — what the client is actually buying. */
  projects?: { id: string; name: string; status: string; endDate?: string | null }[];
  activeProjectCount?: number;
}

/**
 * A thin progress bar, tinted by how far along it is — the same shape the
 * prototype uses for "tasks done this month" and project completion.
 *
 * The track was `bg-line2`, a class used in this one place and defined
 * nowhere: no CSS variable, no Tailwind token. It resolved to nothing, so
 * every bar on the screen was a floating dash over the page background with no
 * track behind it — and a bar with no track cannot show 20% apart from 80%,
 * which is the only thing a bar is for. `--color-line` is the real token.
 */
function Bar({ pct, tone = 'default' }: { pct: number; tone?: 'default' | 'good' | 'warn' }) {
  const fill = tone === 'good' ? 'bg-success' : tone === 'warn' ? 'bg-warning' : 'bg-primary';
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div
      className="h-1.5 w-full min-w-20 overflow-hidden rounded-full bg-line"
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

export default function LiveWorkPage() {
  const router = useRouter();
  /** A failed load, said out loud instead of only in the console. */
  const queryClient = useQueryClient();
  /*
   * The tab lives in the URL, like every other tabbed screen in the app.
   *
   * It was local state read once from `?tab=PROJECTS` on mount and never
   * written back, so clicking Projects left the address bar saying Retainers:
   * the tab could not be linked to, and a refresh threw you back. The shared
   * hook also matches case-insensitively, which the hand-rolled read did not —
   * `?tab=projects` silently did nothing.
   */
  /*
   * Three kinds of work, not two.
   *
   * The studio's own work had nowhere on this screen: Retainers and Projects
   * are both a client's, so a hiring round or the website refresh was visible
   * only as loose tasks on somebody's My Work. It sits beside them rather than
   * on a page of its own because "what is the studio working on" is one
   * question, and the answer was being given in two halves.
   */
  const TABS: TabDef<'RETAINERS' | 'PROJECTS' | 'INTERNAL'>[] = [
    { key: 'RETAINERS', label: 'Retainers' },
    { key: 'PROJECTS', label: 'Projects' },
    { key: 'INTERNAL', label: 'Internal' },
  ];
  const [tab, setTab] = useTabState(TABS);
  // Defaults to Live — the one status this screen is actually about — but a
  // project doesn't stop existing once delivered or cancelled, and this page
  // absorbed the old standalone /projects list, so switching it away from
  // Live is how you still find those.
  const [projectStatusFilter, setProjectStatusFilter] = useState('LIVE');
  const [creatingProject, setCreatingProject] = useState(false);
  /** The At Risk tile names its rows rather than only counting them. */
  const [showAtRisk, setShowAtRisk] = useState(false);

  /**
   * The two lists this screen is, as one cached query.
   *
   * Config comes from `useConfig()` instead of being fetched here: seven
   * screens were each asking for the same organisation settings on every
   * mount. It is now fetched once and shared, with an hour of staleness.
   */
  const { data: config } = useConfig();

  const { data, isPending, error } = useQuery({
    queryKey: qk.liveWork,
    queryFn: async () => {
      const [projRes, retRes] = await Promise.all([
        apiGet<{ success: boolean; projects: LiveProject[] }>('/projects'),
        api.retainers.list({ status: 'ACTIVE' }),
      ]);
      const retainers: LiveRetainer[] = (retRes.retainers ?? []).map((r: any) => ({
        id: r.id,
        companyName: r.company.name,
        owner: r.owner,
        monthlyValue: r.monthlyValue,
        status: r.status,
        termMonths: r.termMonths,
        renewalDate: r.renewalDate,
        renewalDaysLeft: r.renewalDaysLeft,
        isExpiringSoon: r.isExpiringSoon,
        noFixedTermRisk: r.noFixedTermRisk,
        monthTasksDone: r.monthTasksDone ?? 0,
        monthTasksTotal: r.monthTasksTotal ?? 0,
        monthTasksLate: r.monthTasksLate ?? 0,
        // This map is a whitelist, not a spread — a field the server starts
        // sending is a field this screen silently drops until it is named here.
        projects: r.projects ?? [],
        activeProjectCount: r.activeProjectCount ?? 0,
      }));
      return { allProjects: projRes.projects ?? [], retainers };
    },
  });

  const allProjects = data?.allProjects ?? [];
  /*
   * Late work first.
   *
   * The table was ordered by whatever the API returned, and every column on it
   * — owner, monthly, contract, renewal — is a fact about the AGREEMENT. None
   * of them says whether anything needs you today, so finding the client who
   * does meant opening each one in turn. That is the opposite of what a list
   * is for.
   *
   * Ties keep the server's order, which is alphabetical by client.
   */
  const retainers = [...(data?.retainers ?? [])].sort(
    (a, b) => (b.monthTasksLate ?? 0) - (a.monthTasksLate ?? 0),
  );
  const loading = isPending;
  const loadError = error instanceof Error ? error.message : error ? 'Could not load live work' : null;

  /*
   * Every internal project, finished ones included.
   *
   * Unlike the other two tabs, which show live work and filter the rest away:
   * a finished piece of internal work is not a delivered project with a value
   * and an invoice behind it, it is simply a bucket nobody is adding to, and
   * hiding it would mean the only way to see last quarter's hiring round was
   * Settings. Done rows are marked and sort last.
   */
  const { data: internalData } = useQuery({
    queryKey: ['internal-projects'],
    queryFn: () => api.internalProjects.list(),
  });
  const internalProjects = internalData?.projects ?? [];

  /** What the create flows call once they have added something. */
  const load = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: qk.liveWork });
    void queryClient.invalidateQueries({ queryKey: ['internal-projects'] });
  }, [queryClient]);

  // Quick Create's "New project" lands here with ?create=true — same pattern
  // as /companies and /my-work's own handling. It opens the internal form now,
  // because that is the only kind of project this screen starts.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    // The tab itself is the hook's business now; this is only the create flag.
    if (params.get('create') === 'true') {
      setCreatingProject(true);
      router.replace('/live-work?tab=internal');
    }
  }, [router]);

  const currency = config?.organization.currency ?? 'INR';
  const locale = config?.organization.locale ?? 'en-IN';
  const canSeeFigures = config?.me.permissions?.includes('money.figures') ?? false;
  const canCreateProject = config?.me.permissions?.includes('company.write') ?? false;
  const money = (n: number | string | null | undefined) => formatMoney(n, currency, locale);
  const monthLabel = new Date().toLocaleString('en-IN', { month: 'long' });

  const liveProjects = allProjects.filter((p) => p.status === 'LIVE');
  const projects = projectStatusFilter ? allProjects.filter((p) => p.status === projectStatusFilter) : allProjects;

  usePageHeader('Live work', `${retainers.length} retainer${retainers.length === 1 ? '' : 's'}, ${liveProjects.length} project${liveProjects.length === 1 ? '' : 's'}`);

  const noContractCount = retainers.filter((r) => r.noFixedTermRisk).length;
  const flaggedProjects = liveProjects.filter((p) => p.alerts.length > 0);
  const oneTimeInFlight = liveProjects.reduce((s, p) => s + Number(p.quotedValue || 0), 0);
  /*
   * "At risk" — flagged by rule, not opinion: a retainer close to lapsing (or
   * with no contract at all) plus a project the alert engine has actually
   * flagged.
   *
   * It was a bare number with nothing behind it. "10" told you to go and find
   * ten things across two tabs by eye, which is the work the tile was supposed
   * to save — so the rows are named here, each with the reason it qualified.
   */
  const atRisk: { id: string; href: string; name: string; why: string }[] = [
    ...retainers
      .filter((r) => r.isExpiringSoon || r.noFixedTermRisk)
      .map((r) => ({
        id: `r:${r.id}`,
        href: `/retainers/${r.id}`,
        name: r.companyName,
        why: r.noFixedTermRisk
          ? 'no contract on file'
          : `renews in ${plural(r.renewalDaysLeft ?? 0, 'day')}`,
      })),
    ...flaggedProjects.map((p) => ({
      id: `p:${p.id}`,
      href: `/projects/${p.id}`,
      name: p.name,
      why: p.alerts[0]?.message ?? 'flagged by the alert engine',
    })),
  ];
  const atRiskCount = atRisk.length;

  const projectStatus = (p: LiveProject): { label: string; tone: 'bad' | 'warn' | 'good' | 'neutral' } => {
    if (p.status === 'DELIVERED') return { label: 'Delivered', tone: 'good' };
    if (p.status === 'CANCELLED') return { label: 'Cancelled', tone: 'neutral' };
    if (p.alerts.some((a) => a.rule.includes('OVER_ESTIMATE'))) return { label: 'Over estimate', tone: 'bad' };
    if (p.alerts.some((a) => a.rule.includes('BEHIND_SCHEDULE'))) return { label: 'Behind schedule', tone: 'warn' };
    if (p.alerts.length > 0) return { label: 'Flagged', tone: 'warn' };
    return { label: 'On track', tone: 'good' };
  };
  const STATUS_STYLE: Record<string, string> = {
    bad: 'border border-danger/30 text-danger bg-danger-tint',
    warn: 'border border-warning/30 text-warning-ink bg-warning-tint',
    good: 'border border-success/30 text-success bg-success-tint',
    neutral: 'border border-border text-secondary bg-subtle',
  };

  return (
    <div className="page-shell">
      {loadError && (
        <div className="mb-6">
          {/*
            A failed load used to reach console.error and stop, so the screen
            rendered its empty state and "the server is down" looked exactly
            like "you have nothing yet".
          */}
          <ErrorNote onDismiss={() => queryClient.resetQueries({ queryKey: qk.liveWork })}>{loadError}</ErrorNote>
        </div>
      )}
      {/*
        Header.

        Down to one button. The two CSV exports and New retainer have gone: a
        retainer is started from the client it belongs to, which is where the
        won proposal behind it lives, and this screen is for reading what is
        running rather than for starting it.
      */}
      <div className="flex flex-wrap items-center justify-end gap-2 mb-8">
        {/*
          An INTERNAL project, and only that.

          This used to open the client project form, which was the one place in
          the app a client project could be started without a deal behind it —
          everywhere else it comes off a won proposal, which is what ties the
          work to what was sold. A retainer is different and keeps its button:
          "we agreed a retainer" needs a route from the screen that lists them.
          A client project already has one, on the company.
        */}
        {canCreateProject && (
          <button
            className="flex items-center gap-1.5 bg-primary text-white text-sm font-semibold px-4 h-8 rounded-lg hover:bg-primary/90 transition-colors"
            onClick={() => { setTab('INTERNAL'); setCreatingProject(true); }}
          >
            <span className="text-base leading-none">+</span> New internal project
          </button>
        )}
      </div>

      <StatRow className="mb-8">
        <StatTile
          label="Live Retainers"
          value={retainers.length}
          note={`${noContractCount} with no contract`}
        />
        <StatTile
          label="Live Projects"
          value={liveProjects.length}
          note={`${flaggedProjects.length} flagged`}
        />
        <StatTile
          label="One Time In Flight"
          value={canSeeFigures ? money(oneTimeInFlight) : '—'}
          note="quoted value running"
        />
        <button
          type="button"
          onClick={() => setShowAtRisk((v) => !v)}
          disabled={atRiskCount === 0}
          aria-expanded={showAtRisk}
          className="rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-default"
        >
          <StatTile
            label="At Risk"
            value={atRiskCount}
            note={atRiskCount === 0 ? 'flagged by rule, not opinion' : showAtRisk ? 'hide the list' : 'show which ones'}
            tone={atRiskCount > 0 ? 'danger' : 'default'}
            className={atRiskCount > 0 ? 'h-full transition-colors hover:border-danger/40' : 'h-full'}
          />
        </button>
      </StatRow>

      {showAtRisk && atRiskCount > 0 && (
        <div className="mb-8 overflow-hidden rounded-xl border border-danger/30">
          <ul className="divide-y divide-border">
            {atRisk.map((x) => (
              <li key={x.id}>
                <Link
                  href={x.href}
                  className="flex flex-wrap items-center justify-between gap-2 bg-white px-5 py-3 transition-colors hover:bg-subtle"
                >
                  <span className="text-sm font-semibold text-primary">{x.name}</span>
                  <span className="text-micro text-secondary">{x.why}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Tabs */}
      <Tabs
        tabs={[
          { key: 'RETAINERS', label: 'Retainers', count: retainers.length },
          { key: 'PROJECTS', label: 'Projects', count: projects.length },
          { key: 'INTERNAL', label: 'Internal', count: internalProjects.length },
        ] as TabDef<'RETAINERS' | 'PROJECTS' | 'INTERNAL'>[]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'RETAINERS' && (
        <div className="border border-border rounded-xl overflow-hidden mt-6">
          <div className="overflow-x-auto">
            <table className="w-full data-table">
              <thead>
                <tr className="border-b border-border bg-subtle">
                  <th className="eyebrow text-left">Client</th>
                  <th className="eyebrow text-left">Owner</th>
                  <th className="eyebrow text-right">Monthly</th>
                  <th className="eyebrow text-left">Contract</th>
                  <th className="eyebrow text-left">Renewal</th>
                  <th className="eyebrow text-left">Projects</th>
                  <th className="eyebrow text-left">{monthLabel}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {retainers.length === 0 && !loading && (
                  <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-secondary">No active retainers.</td></tr>
                )}
                {retainers.map((r) => {
                  const monthPct = r.monthTasksTotal > 0 ? Math.round((r.monthTasksDone / r.monthTasksTotal) * 100) : 0;
                  return (
                    <tr key={r.id} className="hover:bg-subtle transition-colors cursor-pointer" onClick={() => router.push(`/retainers/${r.id}`)}>
                      <td className="">
                        {/* A row is not focusable. Without this link there is
                            no keyboard route into a retainer at all. */}
                        <Link
                          href={`/retainers/${r.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-sm font-semibold text-primary rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                        >
                          {r.companyName}
                        </Link>
                      </td>
                      <td className="text-secondary">{r.owner?.name ?? '—'}</td>
                      <td className="font-semibold text-primary text-right">{canSeeFigures ? money(r.monthlyValue) : '—'}</td>
                      <td className="">
                        {r.termMonths ? (
                          <span className="text-micro font-medium px-2 py-0.5 rounded border border-success/30 text-success bg-success-tint">
                            {r.termMonths} month{r.termMonths === 1 ? '' : 's'}
                          </span>
                        ) : (
                          <span className="text-micro font-medium px-2 py-0.5 rounded border border-danger/30 text-danger bg-danger-tint">No contract</span>
                        )}
                      </td>
                      <td className="text-secondary">
                        {r.renewalDate ? (
                          <span className={r.isExpiringSoon ? 'text-warning-ink font-medium' : ''}>
                            {new Date(r.renewalDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                            {r.renewalDaysLeft !== null && ` (${r.renewalDaysLeft}d)`}
                          </span>
                        ) : 'No contract'}
                      </td>
                      {/*
                        What the client is buying, by name.
                        
                        The only column about the work was the month's task
                        count — a number that says how busy the month is and
                        nothing about what the retainer IS. A retainer is a
                        Diwali campaign and an always-on stream; the month's
                        progress is the column beside it, not instead of it.
                      */}
                      <td style={{ minWidth: 190 }}>
                        {(r.activeProjectCount ?? 0) === 0 ? (
                          <span className="text-micro text-secondary">
                            {(r.projects?.length ?? 0) > 0 ? 'all finished' : 'none named yet'}
                          </span>
                        ) : (
                          <>
                            <p className="flex items-center gap-2 text-sm font-medium text-primary">
                              {plural(r.activeProjectCount ?? 0, 'project')}
                              {/* The reason to open this row, said on the row.
                                  "11 of 18 done" reads the same whether the
                                  rest is due next week or was due last week. */}
                              {r.monthTasksLate > 0 && (
                                <span className="rounded-full bg-danger-tint px-2 py-0.5 text-micro font-semibold text-danger">
                                  {r.monthTasksLate} late
                                </span>
                              )}
                            </p>
                            {/* The first two by name, because "3 projects" is a
                                number and "Diwali Campaign" is the answer. */}
                            <p className="mt-0.5 text-micro text-secondary">
                              {(r.projects ?? [])
                                .filter((p) => p.status === 'ACTIVE')
                                .slice(0, 2)
                                .map((p) => p.name)
                                .join(', ')}
                              {(r.activeProjectCount ?? 0) > 2 && ` +${(r.activeProjectCount ?? 0) - 2}`}
                            </p>
                          </>
                        )}
                      </td>
                      <td className="" style={{ width: 160 }}>
                        <Bar pct={monthPct} />
                        <div className="text-micro text-secondary mt-1">{r.monthTasksDone} of {plural(r.monthTasksTotal, 'task')} done</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-2.5 bg-subtle border-t border-border text-micro text-secondary">
            Click a row to open that client's month card.
          </div>
        </div>
      )}

      {tab === 'PROJECTS' && (
        <>
          <div className="flex justify-end mt-4 mb-2">
            <select
              aria-label="Filter projects by status"
              value={projectStatusFilter}
              onChange={(e) => setProjectStatusFilter(e.target.value)}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs text-body outline-none focus-visible:border-primary"
            >
              {PROJECT_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full data-table">
                <thead>
                  <tr className="border-b border-border bg-subtle">
                    <th className="eyebrow text-left">Project</th>
                    <th className="eyebrow text-left">Client</th>
                    <th className="eyebrow text-left">Owner</th>
                    <th className="eyebrow text-left">Priority</th>
                    <th className="eyebrow text-right">Quoted</th>
                    <th className="eyebrow text-left">Progress</th>
                    <th className="eyebrow text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {projects.length === 0 && !loading && (
                    <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-secondary">No projects match this filter.</td></tr>
                  )}
                  {projects.map((p) => {
                    const quoted = p.quotedValue != null ? Number(p.quotedValue) : null;
                    const actual = p.actualCostTotal != null ? Number(p.actualCostTotal) : null;
                    const over = quoted != null && actual != null && actual > (Number(p.estimatedCost) || quoted);
                    const donePct = p.totalTasksCount > 0 ? Math.round(((p.totalTasksCount - p.openTasksCount) / p.totalTasksCount) * 100) : 0;
                    const status = projectStatus(p);
                    return (
                      <tr key={p.id} className="hover:bg-subtle transition-colors cursor-pointer" onClick={() => router.push(`/projects/${p.id}`)}>
                        <td className="">
                          <Link
                            href={`/projects/${p.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-sm font-semibold text-primary rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                          >
                            {p.name}
                          </Link>
                        </td>
                        <td className="text-secondary">{p.company.name}</td>
                        <td className="text-secondary">{p.owner?.name ?? '—'}</td>
                        <td className="">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-micro font-semibold tracking-[0.03em] ${getPriorityBadge(p.priority)}`}>
                            {getPriorityLabel(p.priority)}
                          </span>
                        </td>
                        <td className="font-semibold text-primary text-right">{canSeeFigures ? money(quoted) : '—'}</td>
                        <td className="" style={{ width: 140 }}>
                          <Bar pct={donePct} tone={over ? 'warn' : donePct === 100 ? 'good' : 'default'} />
                          <div className="text-micro text-secondary mt-1">
                            {donePct}%{p.endDate && ` · ends ${new Date(p.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
                          </div>
                        </td>
                        <td className="">
                          <span
                            title={p.alerts.map((a) => a.message).join(' ')}
                            className={`text-micro font-medium px-2 py-0.5 rounded ${STATUS_STYLE[status.tone]}`}
                          >
                            {status.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-2.5 bg-subtle border-t border-border text-micro text-secondary">
              Click a row for the full cost breakdown and billing.
            </div>
          </div>
        </>
      )}

      {tab === 'INTERNAL' && (
        <div className="border border-border rounded-xl overflow-hidden mt-6">
          <div className="overflow-x-auto">
            <table className="w-full data-table">
              <thead>
                <tr className="border-b border-border bg-subtle">
                  <th className="eyebrow text-left">Internal project</th>
                  <th className="eyebrow text-left">Owner</th>
                  <th className="eyebrow text-right">Open</th>
                  <th className="eyebrow text-right">Done</th>
                  <th className="eyebrow text-right">Late</th>
                  <th className="eyebrow text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {internalProjects.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-sm text-secondary">
                      Nothing yet. Internal tasks work perfectly well without one — start a project when several
                      belong together.
                    </td>
                  </tr>
                )}
                {/* Done last: still here to be found, out of the way of what is running. */}
                {[...internalProjects]
                  .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'ACTIVE' ? -1 : 1))
                  .map((ip) => (
                    <tr key={ip.id} className={ip.status === 'DONE' ? 'text-secondary' : undefined}>
                      <td className="font-medium text-primary">
                        {ip.name}
                        {ip.description && (
                          <span className="block text-micro font-normal text-secondary">{ip.description}</span>
                        )}
                      </td>
                      <td className="text-secondary">{ip.owner?.name ?? '—'}</td>
                      <td className="text-right tabular-nums">{ip.taskCounts.open}</td>
                      <td className="text-right tabular-nums text-secondary">{ip.taskCounts.done}</td>
                      <td className={`text-right tabular-nums ${ip.taskCounts.late > 0 ? 'font-semibold text-danger' : 'text-secondary'}`}>
                        {ip.taskCounts.late || '—'}
                      </td>
                      <td>
                        <Badge tone={ip.status === 'ACTIVE' ? 'good' : 'neutral'}>
                          {ip.status === 'ACTIVE' ? 'Active' : 'Done'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && liveProjects.length === 0 && retainers.length === 0 && (
        <div className="border border-border rounded-xl py-16 text-center mt-6">
          <p className="text-sm font-bold text-primary mb-1">Nothing live</p>
          <p className="text-sm text-secondary">Win a deal and it will appear here automatically.</p>
        </div>
      )}

      {/* No redirect afterwards: an internal project has no page of its own —
          it is a bucket, and the list it lands in is this one. */}
      <NewInternalProjectModal
        open={creatingProject}
        onClose={() => setCreatingProject(false)}
        onCreated={() => {
          setCreatingProject(false);
          setTab('INTERNAL');
          load();
        }}
      />

    </div>
  );
}
