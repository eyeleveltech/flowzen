'use client';

import { useEffect } from 'react';
import { useUIStore } from '@/stores';

/**
 * Sets the title/subtitle TopNav renders on the left of the sticky bar, and
 * the browser tab title alongside it — one call per page instead of each
 * screen drawing its own <h1> in the body (which scrolled away, unlike the
 * prototype's `.top h1`).
 */
export function usePageHeader(title: string, subtitle?: string | null) {
  const setPageHeader = useUIStore((s) => s.setPageHeader);
  useEffect(() => {
    setPageHeader(title, subtitle ?? null);
    document.title = title ? `${title} — Flowzen` : 'Flowzen';
  }, [title, subtitle, setPageHeader]);
}
