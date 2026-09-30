'use client';

import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * Open a page's create form when the URL asks for it with `?create=true`.
 *
 * Quick Create in the top bar is a list of links — New task goes to
 * `/my-work?create=true`, New lead to `/outreach?create=true` — and each page
 * opened its form when it saw the flag. But each looked ONCE, on mount, by
 * reading `window.location`. Arriving from another page mounts it, so that
 * worked; clicking New task while already on My Work only changes the query
 * string, nothing mounts, nothing looked, and the form never opened.
 *
 * Read through `useSearchParams`, so it answers every time the flag appears,
 * then taken back out of the URL — a refresh or the back button must not
 * reopen the form, and the next click has to be a change to notice.
 */
export function useCreateFlag(open: () => void, cleanUrl: string) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const asked = searchParams.get('create') === 'true';

  // The latest `open`, without making every render of the page a new effect.
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (!asked) return;
    openRef.current();
    router.replace(cleanUrl);
  }, [asked, cleanUrl, router]);
}
