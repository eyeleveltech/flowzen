'use client';

/**
 * A titled section with a line saying what it is for — the unit every
 * Settings page is built from.
 *
 * The heading and its sentence sit above the card, not inside it: the card
 * holds the things you change, and the words about them read as the
 * section's title rather than as the first field. One shape on every tab, so
 * a page of sections reads as a list of headings with their controls beneath.
 *
 * `flush` drops the card's padding for a list of `SettingRow`s, which carry
 * their own and are divided edge to edge.
 */

import { cn } from '@/lib/utils';

export function SectionCard({
  title,
  description,
  aside,
  children,
  bodyClassName = 'space-y-4',
  flush = false,
}: {
  title: string;
  /** What this section decides. One sentence, under the heading. */
  description?: React.ReactNode;
  /** A control that belongs to the whole section — a link away, usually. */
  aside?: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
  /** No padding: the children are rows that pad themselves (see SettingRow). */
  flush?: boolean;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight text-primary">{title}</h2>
          {description && <p className="mt-1 max-w-2xl text-sm leading-relaxed text-secondary">{description}</p>}
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
      <div className="rounded-xl border border-line bg-white">
        <div className={cn(flush ? 'divide-y divide-border' : 'p-5 sm:p-6', bodyClassName && !flush ? bodyClassName : undefined)}>
          {children}
        </div>
      </div>
    </section>
  );
}

/**
 * One setting as a row: what it is on the left, the control on the right.
 * Used inside a `flush` SectionCard, where rows are divided edge to edge.
 */
export function SettingRow({
  icon: Icon,
  title,
  description,
  action,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** The switch or button, on the right. */
  action?: React.ReactNode;
  /** Anything that belongs under the row, full width. */
  children?: React.ReactNode;
}) {
  return (
    <div className="px-5 py-4 sm:px-6">
      <div className="flex items-center gap-4">
        {Icon && (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-subtle text-primary">
            <Icon className="h-4.5 w-4.5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-primary">{title}</p>
          {description && <p className="mt-0.5 text-xs leading-relaxed text-secondary">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}
