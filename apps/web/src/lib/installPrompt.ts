/**
 * "Install app": putting Flowzen on a phone or computer like an app.
 *
 * Chrome, Edge and Samsung Internet offer it once per page load, through the
 * `beforeinstallprompt` event — often before Profile, which has the button, is
 * even open. So it is caught as the app starts (providers.tsx) and kept here
 * until somebody taps Install. Safari (iPhone, iPad, Mac) and Firefox never
 * fire it: there the card gives the steps instead.
 */

import { useSyncExternalStore } from 'react';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let offered: InstallPromptEvent | null = null;
let installedHere = false;
let listening = false;
const watchers = new Set<() => void>();
const tell = () => watchers.forEach((w) => w());

/** Once, as the app starts — before any page, since the browser offers it only once. */
export function catchInstallPrompt(): void {
  if (typeof window === 'undefined' || listening) return;
  listening = true;
  window.addEventListener('beforeinstallprompt', (e) => {
    // Profile's button offers it instead of the browser's own pop-up bar.
    e.preventDefault();
    offered = e as InstallPromptEvent;
    tell();
  });
  window.addEventListener('appinstalled', () => {
    offered = null;
    installedHere = true;
    tell();
  });
}

const watch = (w: () => void) => {
  watchers.add(w);
  return () => {
    watchers.delete(w);
  };
};

/** Whether this browser offers Install right now, and the tap that does it. */
export function useInstallPrompt() {
  const canInstall = useSyncExternalStore(watch, () => offered !== null, () => false);
  const justInstalled = useSyncExternalStore(watch, () => installedHere, () => false);

  const install = async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    const e = offered;
    if (!e) return 'unavailable';
    // One prompt per offer: the browser offers again on a later visit if it was turned down.
    offered = null;
    tell();
    await e.prompt();
    return (await e.userChoice).outcome;
  };

  return { canInstall, justInstalled, install };
}
