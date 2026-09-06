'use client';

/**
 * A table.
 *
 * Wide content scrolls inside its own container rather than pushing the page
 * sideways — a horizontally scrolling page hides the navigation, and on a laptop
 * nobody finds it again.
 */

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
