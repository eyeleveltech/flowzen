'use client';

/**
 * Zen, mounted once for the whole dashboard.
 *
 * It used to live inside the top nav as a sheet over a dark backdrop, so the
 * page behind it could not be used and every navigation was a reason to close
 * it. Mounted here, in the layout, it outlives page changes with the
 * conversation intact, and the layout gives it room:
 *
 *   - from 1024px, docked on the right (the page shrinks by its width) or
 *     expanded over the whole content area, with the sidebar left alone;
 *   - below that, a full-screen sheet.
 *
 * Ctrl/Cmd + J opens and closes it. Open or closed and docked or expanded are
 * remembered per browser (see `useUIStore`).
 *
 * Management only, as the server is: everybody else gets nothing at all —
 * not even the code, which is fetched the first time it is needed, the way
 * the command palette is.
 */

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useAuthStore, useUIStore } from '@/stores';
import { useConfig } from '@/hooks/queries';
import { useIsMobile } from '@/hooks/use-breakpoint';

const ManagementAssistant = dynamic(
  () => import('@/components/work/ManagementAssistant').then((m) => m.ManagementAssistant),
  { ssr: false },
);

/** How wide the docked panel is, and so how much room the page gives it. Here, so the layout need not load the panel to read it. */
export const ZEN_DOCK_WIDTH = 480;

/**
 * Whether the window is 1024px or wider — null until it has been measured, so
 * nothing draws as a phone sheet for a frame on a laptop.
 */
function useWide(): boolean | null {
  const [wide, setWide] = useState<boolean | null>(null);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const update = () => setWide(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return wide;
}

const useMayAskZen = () => useAuthStore((s) => s.user?.preset === 'MANAGEMENT');

/** How much room the page leaves on its right for Zen: its width while docked and open, else none. */
export function useZenDockWidth(): number {
  const mayAsk = useMayAskZen();
  const wide = useWide();
  const { zenOpen, zenExpanded } = useUIStore();
  return mayAsk && wide && zenOpen && !zenExpanded ? ZEN_DOCK_WIDTH : 0;
}

export function ZenDock() {
  const mayAsk = useMayAskZen();
  const wide = useWide();
  const isMobile = useIsMobile();
  const { data: config } = useConfig();
  const { zenOpen, zenExpanded, zenFocusToken, setZenOpen, toggleZen, setZenExpanded, restoreZen, sidebarCollapsed } =
    useUIStore();

  // What this browser remembered — after the first render, never during it.
  useEffect(() => restoreZen(), [restoreZen]);

  useEffect(() => {
    if (!mayAsk) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        toggleZen();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mayAsk, toggleZen]);

  // Nothing is fetched until it has been asked for once.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (zenOpen) setLoaded(true);
  }, [zenOpen]);

  if (!mayAsk || wide === null || !loaded) return null;

  return (
    <ManagementAssistant
      open={zenOpen}
      onClose={() => setZenOpen(false)}
      configured={Boolean(config?.organization.aiConfigured)}
      mode={!wide ? 'sheet' : zenExpanded ? 'expanded' : 'docked'}
      onExpand={setZenExpanded}
      // The content area starts where the sidebar ends; no sidebar on a phone.
      contentLeft={isMobile ? 0 : sidebarCollapsed ? 72 : 260}
      focusToken={zenFocusToken}
    />
  );
}
