'use client';

import { useState, useEffect, useCallback } from 'react';
import { ErrorNote } from '@/components/ui/empty-state';
import { plural } from '@/lib/utils';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, apiGet, formatMoney, fileUrl, type OrgConfig } from '@/lib/api-v2';
import { ExportCsvButton } from '@/components/ui/export-csv-button';
import { usePageHeader } from '@/hooks/usePageHeader';
import { NewProjectModal } from '@/components/clients/NewProjectModal';
import { getPriorityBadge, getPriorityLabel } from '@/lib/priority';
import { StatTile, StatRow } from '@/components/ui/stat-tile';
import { Tabs, type TabDef } from '@/components/ui/tabs';

interface LiveAlert { rule: string; severity: 'HIGH' | 'MED' | 'LOW'; message: string }

interface LiveProject {
  id: string;
  name: string;
  company: { id: string; name: string; vertical: string };
  owner?: { id: string; name: string } | null;
  quotedValue: number | string | null;
  estimatedCost?: number | string | null;
  actualCostTotal: number | string | null;
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
}

/** A thin progress bar, tinted by how far along it is — the same shape the
 * prototype uses for "tasks done this month" and project completion. */
function Bar({ pct, tone = 'default' }: { pct: number; tone?: 'default' | 'good' | 'warn' }) {
  const fill = tone === 'good' ? 'bg-success' : tone === 'warn' ? 'bg-warning' : 'bg-primary';
  return (
    <div className="h-1.5 w-full min-w-20 rounded-full bg-line2 overflow-hidden">
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

export default function LiveWorkPage() {
  const router = useRouter();
  const [allProjects, setAllProjects] = useState<LiveProject[]>([]);
  /** A failed load, said out loud instead of only in the console. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retainers, setRetainers] = useState<LiveRetainer[]>([]);
  const [config, setConfig] = useState<OrgConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'RETAINERS' | 'PROJECTS'>('RETAINERS');
  // Defaults to Live — the one status this screen is actually about — but a
  // project doesn't stop existing once delivered or cancelled, and this page
  // absorbed the old standalone /projects list, so switching it away from
  // Live is how you still find those.
  const [projectStatusFilter, setProjectStatusFilter] = useState('LIVE');
  const [creatingProject, setCreatingProject] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [projRes, retRes, cfg] = await Promise.all([
        apiGet<{ success: boolean; projects: LiveProject[] }>('/projects'),
        api.retainers.list({ status: 'ACTIVE' }),
        api.config.get(),
      ]);
      setAllProjects(projRes.projects ?? []);
      setConfig(cfg);

      const rets: LiveRetainer[] = (retRes.retainers ?? []).map((r: any) => ({
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
      }));
      setRetainers(rets);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load live work');
    }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Quick Create's "New project" lands here with ?tab=PROJECTS&create=true —
  // same pattern as /companies and /my-work's own ?create=true handling.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'PROJECTS') setTab('PROJECTS');
    if (params.get('create') === 'true') {
      setTab('PROJECTS');
      setCreatingProject(true);
      router.replace('/live-work');
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
  // "At risk" — flagged by rule, not opinion: a retainer close to lapsing (or
  // with no contract at all) plus a project the alert engine has actually flagged.
  const atRiskCount = retainers.filter((r) => r.isExpiringSoon || r.noFixedTermRisk).length + flaggedProjects.length;

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
          <ErrorNote onDismiss={() => setLoadError(null)}>{loadError}</ErrorNote>
        </div>
      )}
      {/* Header */}
      <div className="flex flex-wrap items-center justify-end gap-2 mb-8">
        <ExportCsvButton href={fileUrl('/retainers?format=csv')} label="Export retainers CSV" />
        <ExportCsvButton href={fileUrl('/projects?format=csv')} label="Export projects CSV" />
        {canCreateProject && (
          <button
            className="flex items-center gap-1.5 bg-primary text-white text-sm font-semibold px-4 h-8 rounded-lg hover:bg-primary/90 transition-colors"
            onClick={() => { setTab('PROJECTS'); setCreatingProject(true); }}
          >
            <span className="text-base leading-none">+</span> New project
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
        <StatTile
          label="At Risk"
          value={atRiskCount}
          note="flagged by rule, not opinion"
          tone={atRiskCount > 0 ? 'danger' : 'default'}
        />
      </StatRow>

      {/* Tabs */}
      <Tabs
        tabs={[
          { key: 'RETAINERS', label: 'Retainers', count: retainers.length },
          { key: 'PROJECTS', label: 'Projects', count: projects.length },
        ] as TabDef<'RETAINERS' | 'PROJECTS'>[]}
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
                  <th className="eyebrow text-left">{monthLabel}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {retainers.length === 0 && !loading && (
                  <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-secondary">No active retainers.</td></tr>
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
                    <th className="eyebrow text-right">Cost so far</th>
                    <th className="eyebrow text-left">Progress</th>
                    <th className="eyebrow text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {projects.length === 0 && !loading && (
                    <tr><td colSpan={8} className="px-5 py-12 text-center text-sm text-secondary">No projects match this filter.</td></tr>
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
                        <td className={`text-right font-semibold ${over ? 'text-danger' : 'text-secondary'}`}>
                          {canSeeFigures ? money(actual) : '—'}
                        </td>
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

      {!loading && liveProjects.length === 0 && retainers.length === 0 && (
        <div className="border border-border rounded-xl py-16 text-center mt-6">
          <p className="text-sm font-bold text-primary mb-1">Nothing live</p>
          <p className="text-sm text-secondary">Win a deal and it will appear here automatically.</p>
        </div>
      )}

      <NewProjectModal
        open={creatingProject}
        onClose={() => setCreatingProject(false)}
        onCreated={(id) => {
          setCreatingProject(false);
          router.push(`/projects/${id}`);
        }}
      />
    </div>
  );
}
