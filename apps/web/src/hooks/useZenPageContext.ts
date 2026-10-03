'use client';

/**
 * Where the person is standing, in a form Zen can resolve.
 *
 * The address and the ids in it, and deliberately nothing else. The screen
 * does NOT hand over what it is showing: Zen looks everything up with its own
 * tools, so what it can see stays governed by those tools rather than by
 * whatever the browser happened to have in memory — which also means a page
 * cannot pass it something the asker was not allowed to read.
 *
 * What this buys is small and constant: "add a task here" resolves "here", and
 * "what still needs billing here?" on Money → Retainer billing resolves
 * "here" too. Without it every question had to name the thing out loud, which
 * is what made the panel slower than the form it was meant to replace.
 */

import { useMemo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

export type ZenPageContext = {
  /** The address without its query: `/money`, `/projects/abc`. */
  path?: string;
  /** The query, as on the address bar: `?tab=billing`. */
  search?: string;
  projectId?: string;
  retainerId?: string;
  retainerProjectId?: string;
  companyId?: string;
  internalProjectId?: string;
  assetId?: string;
};

/** `/projects/abc123` → the id, for the screens that have one. */
const idAfter = (pathname: string, segment: string): string | undefined => {
  const parts = pathname.split('/').filter(Boolean);
  const at = parts.indexOf(segment);
  if (at === -1) return undefined;
  const next = parts[at + 1];
  // A cuid, not "new" or a tab name — a segment that is not an id would be
  // resolved by the server as a missing row and quietly drop the context.
  return next && next.length > 8 ? next : undefined;
};

export function useZenPageContext(): ZenPageContext {
  const pathname = usePathname() ?? '';
  const query = useSearchParams()?.toString() ?? '';

  return useMemo(() => {
    const ctx: ZenPageContext = { path: pathname, search: query ? `?${query}` : '' };
    const project = idAfter(pathname, 'projects');
    const retainer = idAfter(pathname, 'retainers');
    const company = idAfter(pathname, 'companies');
    const internal = idAfter(pathname, 'internal-projects');
    const asset = idAfter(pathname, 'assets');
    // A project inside a retainer is /retainers/{id}/projects/{projectId}.
    if (retainer && project) ctx.retainerProjectId = project;
    else if (project) ctx.projectId = project;
    if (retainer) ctx.retainerId = retainer;
    if (company) ctx.companyId = company;
    if (internal) ctx.internalProjectId = internal;
    if (asset) ctx.assetId = asset;
    return ctx;
  }, [pathname, query]);
}

/** The sidebar's names for its screens. */
const SCREENS: Record<string, string> = {
  '/my-work': 'My Work',
  '/calendar': 'Calendar',
  '/members': 'Team',
  '/all-work': 'All tasks',
  '/companies': 'Companies',
  '/outreach': 'Outreach list',
  '/pipeline': 'Pipeline',
  '/quotations': 'Proposals',
  '/live-work': 'Live work',
  '/brief': 'Monday brief',
  '/money': 'Money',
  '/forecast': 'Forecast',
  '/assets': 'Assets',
  '/allocations': 'Time split',
  '/settings': 'Settings',
  '/profile': 'Profile',
};

const MONEY_TABS: Record<string, string> = { billing: 'Retainer billing', costs: 'Costs', profit: 'Profit & Costs', invoices: 'Invoices' };

/**
 * Which screen this is, for the panel: a `key` that picks its suggested
 * questions, and the `label` it says out loud ("looking at Money → Retainer
 * billing with you") so the context is never a secret.
 */
export function zenScreen(ctx: ZenPageContext): { key: string; label: string | null } {
  if (ctx.retainerProjectId) return { key: 'project', label: 'this project' };
  if (ctx.projectId) return { key: 'project', label: 'this project' };
  if (ctx.retainerId) return { key: 'retainer', label: 'this retainer' };
  if (ctx.internalProjectId) return { key: 'internal', label: 'this internal work' };
  if (ctx.companyId) return { key: 'client', label: 'this client' };
  if (ctx.assetId) return { key: 'asset', label: 'this equipment' };

  const q = new URLSearchParams(ctx.search ?? '');
  const base = '/' + ((ctx.path ?? '').split('/').filter(Boolean)[0] ?? '');
  if (base === '/my-work' && q.get('task')) return { key: 'task', label: 'this task' };
  if (base === '/money') {
    const tab = q.get('tab')?.toLowerCase() ?? '';
    return MONEY_TABS[tab] ? { key: `/money:${tab}`, label: `Money → ${MONEY_TABS[tab]}` } : { key: '/money', label: 'Money' };
  }
  if (base === '/members' && q.get('tab') === 'approvals') return { key: '/members:approvals', label: 'Team → Approvals' };
  const name = SCREENS[base];
  return name ? { key: base, label: name } : { key: '', label: null };
}

/** What the panel shows above the box. */
export function describeContext(ctx: ZenPageContext): string | null {
  return zenScreen(ctx).label;
}
