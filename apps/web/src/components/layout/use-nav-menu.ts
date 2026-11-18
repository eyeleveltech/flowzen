'use client';

/**
 * Pin, unpin, hide and unhide a menu item — for the sidebar and the phone's
 * More sheet alike (Ease Plan 3, decisions 9–12).
 *
 * The screen changes first and the save follows (lib/optimistic.ts's rule);
 * if the save fails the menu goes back to what the server last had, with
 * "Couldn't save — changed back".
 *
 * Saves go one at a time, in order, and each sends both whole lists — so a
 * later save always carries every change before it. That is why only the
 * LATEST save's answer is applied: an earlier one finishing late would
 * otherwise put back a menu the person has already changed again, and an
 * earlier one failing needs no undo when a later one is still on its way with
 * the same change in it.
 */

import { useCallback } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/lib/api-v2';
import { changedBackMessage } from '@/lib/optimistic';
import { useAuthStore } from '@/stores';
import { withHiddenToggled, withPinToggled, type MenuPrefs } from '@/config/navigation';

let queue: Promise<void> = Promise.resolve();
let latest = 0;
/** What the server holds for this person, as far as this tab knows. */
let confirmed: { userId: string; prefs: MenuPrefs } | null = null;

const prefsOf = (user: { navPinned?: string[]; navHidden?: string[] }): MenuPrefs => ({
  pinned: user.navPinned ?? [],
  hidden: user.navHidden ?? [],
});

function change(next: (prefs: MenuPrefs) => MenuPrefs) {
  const { user, setMenu } = useAuthStore.getState();
  if (!user) return;
  const before = prefsOf(user);
  if (confirmed?.userId !== user.id) confirmed = { userId: user.id, prefs: before };

  const wanted = next(before);
  setMenu(wanted.pinned, wanted.hidden);

  const mine = ++latest;
  const userId = user.id;
  queue = queue.then(async () => {
    try {
      const kept = await api.profile.saveMenu(wanted);
      confirmed = { userId, prefs: { pinned: kept.pinned, hidden: kept.hidden } };
      // What the server kept — the same lists, less anything this person can no longer open.
      if (mine === latest) setMenu(kept.pinned, kept.hidden);
    } catch (e) {
      if (mine !== latest) return;
      if (confirmed?.userId === userId) setMenu(confirmed.prefs.pinned, confirmed.prefs.hidden);
      toast.error(changedBackMessage(e));
    }
  });
}

export function useNavMenu() {
  const togglePin = useCallback((href: string) => change((prefs) => withPinToggled(prefs, href)), []);
  const toggleHidden = useCallback((href: string) => change((prefs) => withHiddenToggled(prefs, href)), []);
  return { togglePin, toggleHidden };
}
