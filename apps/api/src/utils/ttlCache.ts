/**
 * A small in-memory cache with an expiry (Perf Plan 2).
 *
 * For answers that are expensive to work out and fine to be a little old —
 * the task-type medians, the Monday brief, the bell's audience, All tasks'
 * filter lists. Per API process: a restart or a second instance simply starts
 * cold, which is the safe direction.
 *
 * It holds the PROMISE, not the value, so ten people opening the brief in the
 * same second share one compute instead of starting ten. A failed load is
 * dropped at once, so an error is never served from the cache.
 */

type Entry<V> = { at: number; value: Promise<V> };

export type TtlCache<V> = {
  /** The cached answer for `key`, or `load()`'s — kept for the cache's lifetime. */
  get(key: string, load: () => Promise<V>, now?: number): Promise<V>;
  /** Forget one key. */
  forget(key: string): void;
  /** Forget every key that starts with `prefix` — an organisation's, say. */
  forgetPrefix(prefix: string): void;
  /** Forget everything. */
  clear(): void;
  readonly size: number;
};

const everyCache: TtlCache<unknown>[] = [];

/** For tests: start every cache empty, so one test's answers never reach the next. */
export function forgetAllCaches(): void {
  for (const c of everyCache) c.clear();
}

export function ttlCache<V>(ttlMs: number, maxEntries = 1000): TtlCache<V> {
  const entries = new Map<string, Entry<V>>();

  const cache: TtlCache<V> = {
    get(key, load, now = Date.now()) {
      const hit = entries.get(key);
      if (hit && now - hit.at < ttlMs) return hit.value;
      entries.delete(key);
      const value = load();
      entries.set(key, { at: now, value });
      // Oldest first out: a Map keeps insertion order.
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value as string);
      value.catch(() => {
        if (entries.get(key)?.value === value) entries.delete(key);
      });
      return value;
    },
    forget(key) {
      entries.delete(key);
    },
    forgetPrefix(prefix) {
      for (const key of [...entries.keys()]) if (key.startsWith(prefix)) entries.delete(key);
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
  everyCache.push(cache as TtlCache<unknown>);
  return cache;
}
