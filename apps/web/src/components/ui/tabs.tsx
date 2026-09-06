'use client';

/**
 * A row of tabs.
 *
 * ─── Why this looks the way it does ─────────────────────────────────────────
 *
 * There were two tab designs in the product. Six screens — Assets, Companies,
 * a client record, Live Work, Money, Quotations — draw an underline: the label
 * sits on a hairline that runs the width of the content, and the current one is
 * marked by a two-pixel accent rule under it. Two screens — a project and a
 * retainer month card — draw a segmented control instead: pills in a grey
 * trough, the current one a white chip.
 *
 * Neither was wrong. Having both was, because the two say different things
 * about the same gesture, and a person moving from a client to that client's
 * retainer met a different control doing the identical job. The underline is
 * the one that won on count and the one that carries a count in the label
 * without the trough getting crowded, so it is the one here.
 *
 * ─── Why the URL ────────────────────────────────────────────────────────────
 *
 * A tab held only in `useState` means a refresh drops you back on the first
 * one, the browser's back button leaves the page entirely, and "the costs on
 * this month card" cannot be sent to anybody. `replace` rather than `push`, so
 * flicking between tabs does not fill the back button with a history of clicks
 * nobody thought of as navigation.
 */

import { useCallback, useId, useRef } from 'react';
import { motion } from 'framer-motion';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';

export type TabDef<T extends string> = {
  key: T;
  label: string;
  icon?: LucideIcon;
  /** Shown after the label in brackets — a count, usually. Hidden when undefined. */
  count?: number;
  /** Left out entirely when false. Gating belongs to the caller. */
  visible?: boolean;
};

/**
 * The active tab, in the query string.
 *
 * Returns the key and a setter, so a caller that wants plain `useState`
 * instead can pass its own pair to `Tabs` and this hook stays out of it.
 *
 * Falls back to the first visible tab, so an unknown or stale `?tab=` in a
 * bookmark lands somewhere sensible instead of rendering nothing. Other query
 * parameters are carried through — the retainer card keeps `?month=`.
 */
export function useTabState<T extends string>(
  tabs: TabDef<T>[],
  param = 'tab',
): [T, (key: T) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const shown = tabs.filter((t) => t.visible !== false);
  const wanted = searchParams.get(param);
  const match = shown.find((t) => t.key.toLowerCase() === wanted?.toLowerCase());
  const active = (match?.key ?? shown[0]?.key) as T;

  const select = useCallback(
    (key: T) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set(param, key.toLowerCase());
      router.replace(`${pathname}?${next}`, { scroll: false });
    },
    [router, pathname, searchParams, param],
  );

  return [active, select];
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  className = '',
}: {
  tabs: TabDef<T>[];
  active: T;
  onChange: (key: T) => void;
  className?: string;
}) {
  const shown = tabs.filter((t) => t.visible !== false);
  const row = useRef<HTMLDivElement>(null);
  /*
   * One id per row, not one per app. Two tab rows on the same screen sharing a
   * `layoutId` would make the mark fly between them — the client record has a
   * row, and anything rendered beside it would steal the underline.
   */
  const id = useId();

  /*
   * `role="tab"` is a promise that the arrow keys move between them — a tab
   * strip is one stop on the Tab key, not one stop per tab. Without this the
   * role is a lie that a screen reader repeats.
   */
  const onKeyDown = (event: React.KeyboardEvent) => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const at = shown.findIndex((t) => t.key === active);
    const next = shown[(at + delta + shown.length) % shown.length];
    onChange(next.key);
    row.current?.querySelector<HTMLButtonElement>(`[data-tab="${next.key}"]`)?.focus();
  };

  return (
    <div
      ref={row}
      role="tablist"
      onKeyDown={onKeyDown}
      className={`flex max-w-full gap-0 overflow-x-auto border-b border-border ${className}`}
    >
      {shown.map((tab) => {
        const Icon = tab.icon;
        const selected = tab.key === active;
        return (
          <button
            key={tab.key}
            data-tab={tab.key}
            role="tab"
            type="button"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.key)}
            className={`relative -mb-px flex shrink-0 items-center gap-2 whitespace-nowrap rounded-t-sm px-4 py-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 ${
              selected ? 'font-[650] text-primary' : 'font-normal text-secondary hover:text-primary'
            }`}
          >
            {Icon && <Icon className="h-4 w-4" strokeWidth={1.75} />}
            <span>
              {tab.label}
              {tab.count !== undefined && ` (${tab.count})`}
            </span>
            {/*
              One mark that slides, not a border switched on and off.

              `layoutId` is what makes it travel: React unmounts this element
              from the tab you left and mounts it under the one you chose, and
              framer animates between the two positions because they share an
              id. The `border-b-2` it replaces could only blink.

              It honours "reduce motion" without asking — `MotionConfig
              reducedMotion="user"` is set once around the whole app, so
              somebody who has turned animation off gets the same mark, placed
              rather than slid.
            */}
            {selected && (
              <motion.span
                layoutId={`tab-underline-${id}`}
                aria-hidden="true"
                className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
