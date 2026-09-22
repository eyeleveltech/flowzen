'use client';

/**
 * The ⌘K shortcut, without the palette behind it.
 *
 * ─── Why this exists ────────────────────────────────────────────────────────
 *
 * `CommandPalette` is ~600 lines and pulls in framer-motion, the search client
 * and two edit dialogs. It was rendered by the dashboard layout on every page,
 * so every single screen paid to download and hydrate it — and almost nobody
 * presses ⌘K on any given page load.
 *
 * This component is what stays: a keydown listener and nothing else. The real
 * palette is fetched the first time somebody actually opens it.
 *
 * ─── Two details that matter ────────────────────────────────────────────────
 *
 * 1. The shortcut has to live OUT here. It used to be registered inside the
 *    palette, which is fine when the palette is always mounted and useless when
 *    it is not: the component that listens for the key that loads it cannot be
 *    the component being loaded.
 *
 * 2. Once opened, it STAYS mounted (`loaded`), rather than unmounting on close.
 *    The palette closes with an AnimatePresence exit transition, and a component
 *    that has been removed from the tree cannot animate its own exit — it would
 *    just vanish. So: nothing before the first ⌘K, normal behaviour after.
 */

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useUIStore } from '@/stores';

const CommandPalette = dynamic(
  () => import('@/components/layout/command-palette').then((m) => m.CommandPalette),
  // No SSR: it is keyboard-summoned, so it has nothing to contribute to the
  // first paint even when it is loaded.
  { ssr: false },
);

export function CommandPaletteMount() {
  const { commandPaletteOpen, setCommandPaletteOpen } = useUIStore();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [commandPaletteOpen, setCommandPaletteOpen]);

  // Opening by any route — the shortcut above, or the search box in the top nav
  // calling setCommandPaletteOpen — is what pulls the chunk down.
  useEffect(() => {
    if (commandPaletteOpen) setLoaded(true);
  }, [commandPaletteOpen]);

  if (!loaded) return null;
  return <CommandPalette />;
}
