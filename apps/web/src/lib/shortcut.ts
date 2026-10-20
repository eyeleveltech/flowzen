'use client';

import { useSyncExternalStore } from 'react';

/**
 * A keyboard shortcut, written the way this computer writes it: ⌘K on a Mac,
 * Ctrl+K on Windows and Linux (QA19 fixes plan, small wins). The hint said ⌘K
 * everywhere, which a Windows user reads as a key they do not have. The
 * handlers already take either key; only the words were wrong.
 */
export const isApplePlatform = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent || '';
  return /mac|iphone|ipad|ipod/i.test(platform);
};

/** "⌘K" or "Ctrl+K", for a screen that is only ever drawn in the browser. */
export const shortcut = (key: string, apple = isApplePlatform()): string => (apple ? `⌘${key}` : `Ctrl+${key}`);

/** The platform never changes under a page, so there is nothing to subscribe to. */
const noSubscription = () => () => {};

/**
 * The same, for something the server also renders: Ctrl+ on the server, so
 * the first render matches, then the Mac's own once the page is hydrated.
 */
export function useShortcut(key: string): string {
  const apple = useSyncExternalStore(noSubscription, isApplePlatform, () => false);
  return shortcut(key, apple);
}
