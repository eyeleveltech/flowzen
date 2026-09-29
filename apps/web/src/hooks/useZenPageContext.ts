'use client';

/**
 * Where the person is standing, in a form Zen can resolve.
 *
 * Ids and a route, and deliberately nothing else. The screen does NOT hand
 * over what it is showing: Zen looks everything up with its own tools, so what
 * it can see stays governed by those tools rather than by whatever the browser
 * happened to have in memory — which also means a page cannot pass it
 * something the asker was not allowed to read.
 *
 * What this buys is small and constant: "add a task here" resolves "here", and
 * "who owns this" resolves "this". Without it every question had to name the
 * client out loud, which is the thing that made the panel slower than the form
 * it was meant to replace.
 */

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';

export type ZenPageContext = {
  route?: string;
  projectId?: string;
  retainerId?: string;
  companyId?: string;
  internalProjectId?: string;
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

  return useMemo(() => {
    const ctx: ZenPageContext = { route: pathname };
    const project = idAfter(pathname, 'projects');
    const retainer = idAfter(pathname, 'retainers');
    const company = idAfter(pathname, 'companies');
    const internal = idAfter(pathname, 'internal-projects');
    if (project) ctx.projectId = project;
    if (retainer) ctx.retainerId = retainer;
    if (company) ctx.companyId = company;
    if (internal) ctx.internalProjectId = internal;
    return ctx;
  }, [pathname]);
}

/** What the panel shows above the box, so the context is never a secret. */
export function describeContext(ctx: ZenPageContext): string | null {
  if (ctx.projectId) return 'this project';
  if (ctx.retainerId) return 'this retainer';
  if (ctx.internalProjectId) return 'this internal work';
  if (ctx.companyId) return 'this client';
  return null;
}
