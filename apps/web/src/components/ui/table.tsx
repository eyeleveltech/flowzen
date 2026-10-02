'use client';

/**
 * A table.
 *
 * Wide content scrolls inside its own container rather than pushing the page
 * sideways — a horizontally scrolling page hides the navigation, and on a laptop
 * nobody finds it again.
 */

import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto rounded-card border border-border bg-white', className)}>
      <table className="w-full min-w-xl text-left data-table">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="border-b border-border bg-surface/60 text-xs font-medium text-secondary">
      {children}
    </thead>
  );
}

export function TH({
  children,
  className,
  numeric,
}: {
  children?: React.ReactNode;
  className?: string;
  numeric?: boolean;
}) {
  return (
    <th className={cn('px-4 py-2.5 font-medium', numeric && 'text-right', className)}>{children}</th>
  );
}

export type SortDir = 'asc' | 'desc';

/**
 * A column header you can click to sort by.
 *
 * The first click sorts ascending, the next descending. The arrow says which
 * column the list is sorted by and which way; the faint double arrow on the
 * others says they can be. `aria-sort` tells a screen reader the same thing.
 */
export function SortableTH<K extends string>({
  label,
  column,
  sort,
  onSort,
  align = 'left',
}: {
  label: string;
  column: K;
  sort: { key: K; dir: SortDir };
  onSort: (column: K) => void;
  align?: 'left' | 'right';
}) {
  const active = sort.key === column;
  const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      // One line: a two-word heading ("Type of work") wrapping made the row
      // of headings uneven.
      className={cn('eyebrow whitespace-nowrap', align === 'right' ? 'text-right' : 'text-left')}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        title={`Sort by ${label.toLowerCase()}`}
        className={cn(
          'eyebrow inline-flex items-center gap-1 rounded-sm outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40',
          active && 'text-primary',
          align === 'right' && 'flex-row-reverse',
        )}
      >
        {label}
        <Icon className={cn('h-3 w-3 shrink-0', !active && 'opacity-40')} aria-hidden="true" />
      </button>
    </th>
  );
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-border">{children}</tbody>;
}

export function TR({
  children,
  className,
  onClick,
  ref,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  /**
   * So a caller can scroll one row into view — a notification that names a
   * record should land on that record, not on a list containing it. React 19
   * passes `ref` as an ordinary prop, so no `forwardRef` is needed.
   */
  ref?: React.Ref<HTMLTableRowElement>;
}) {
  return (
    <tr
      ref={ref}
      onClick={onClick}
      className={cn('transition-colors hover:bg-surface', onClick && 'cursor-pointer', className)}
    >
      {children}
    </tr>
  );
}

export function TD({
  children,
  className,
  numeric,
  onClick,
}: {
  children?: React.ReactNode;
  className?: string;
  /** Money and counts line up on the decimal, so columns can be compared by eye. */
  numeric?: boolean;
  onClick?: (e: React.MouseEvent<HTMLTableCellElement>) => void;
}) {
  return (
    <td
      onClick={onClick}
      className={cn('px-4 py-3 text-sm text-body', numeric && 'text-right tabular-nums', className)}
    >
      {children}
    </td>
  );
}
