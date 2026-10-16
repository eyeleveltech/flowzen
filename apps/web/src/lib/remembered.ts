'use client';

/**
 * A small choice remembered per browser — "Group by" on All work and My Work.
 *
 * Kept in localStorage, and only ever a convenience: private mode, blocked
 * storage or a value from an older version all read as the default, and a
 * write that fails is still remembered for the rest of the visit. Read through
 * `useSyncExternalStore`, so the server render and the first paint use the
 * default and the remembered choice follows without a mismatch.
 */

import { useCallback, useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
/** What this visit set, in case storage refused it. */
const memory = new Map<string, string>();

function read(key: string): string | null {
  if (memory.has(key)) return memory.get(key)!;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function useRemembered<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
): [T, (next: T) => void] {
  const subscribe = useCallback(
    (onChange: () => void) => {
      listeners.add(onChange);
      // Another tab changed it.
      const onStorage = (e: StorageEvent) => {
        if (e.key !== key) return;
        memory.delete(key);
        onChange();
      };
      window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(onChange);
        window.removeEventListener('storage', onStorage);
      };
    },
    [key],
  );

  const value = useSyncExternalStore(
    subscribe,
    () => {
      const v = read(key);
      return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
    },
    () => fallback,
  );

  const set = useCallback(
    (next: T) => {
      memory.set(key, next);
      try {
        localStorage.setItem(key, next);
      } catch {
        // Storage blocked: remembered for this visit only.
      }
      listeners.forEach((l) => l());
    },
    [key],
  );

  return [value, set];
}
