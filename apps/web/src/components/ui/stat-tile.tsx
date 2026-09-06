import { cn } from '@/lib/utils';

/**
 * The number at the top of a screen.
 *
 * ─── Why this exists ────────────────────────────────────────────────────────
 *
 * Forty-two of these were written out by hand across thirteen screens, and
 * three of them had already been half-extracted into three separate local
 * components called `Kpi`, `Figure` and `Kpi` again — one per file, each a copy
 * of the last, each slightly adrift. The label was `mb-2` on some screens and
 * `mb-1.5` on others; the value carried `mb-1.5` here and the note carried
 * `mt-1.5` there for the same six pixels; one page turned a figure amber on
 * the condition its neighbour turned red on.
 *
 * None of that is visible in a screenshot of one page. It is visible walking
 * between two, which is the only way anybody actually uses this app.
 *
 * ─── The shape ──────────────────────────────────────────────────────────────
 *
 *   LABEL          micro, uppercase, tracked out — what the number is
 *   1,24,000       xl, bold, tabular — the number
 *   note           micro, quiet — what the number MEANS, in words
 *
 * The note is not decoration. A figure without one makes the reader guess
 * whether 3 is good, and every screen that dropped it grew a caption somewhere
 * else instead.
 */

export type StatTone = 'default' | 'success' | 'warning' | 'danger';

const TONE: Record<StatTone, string> = {
  default: 'text-primary',
  success: 'text-success',
  // The ink, never the shape colour — the brand gold measures 3.05:1 as text.
  warning: 'text-warning-ink',
  danger: 'text-danger',
};

export interface StatTileProps {
  label: string;
  value: React.ReactNode;
  /** What the number means. Skip it only when the label already says. */
  note?: React.ReactNode;
  tone?: StatTone;
  /**
   * The one tile on a screen that carries the answer — profit on a project,
   * what the month made. Inverted so it reads first. At most one per group;
   * two dark tiles beside each other emphasise nothing.
   */
  dark?: boolean;
  /**
   * What the tile sits in.
   *
   *   card   its own bordered box. The default, and what a row of these is.
   *   inset  no border, because a `gap-px bg-border` grid is already drawing
   *          the lines and a second one doubles them.
   *   none   no box at all, for a tile already inside a `Card`.
   */
  frame?: 'card' | 'inset' | 'none';
  className?: string;
}

export function StatTile({
  label,
  value,
  note,
  tone = 'default',
  dark = false,
  frame = 'card',
  className,
}: StatTileProps) {
  const quiet = dark ? 'text-white/60' : 'text-secondary';

  return (
    <div
      className={cn(
        frame === 'card' && 'rounded-xl border p-5',
        frame === 'card' && (dark ? 'border-primary bg-primary' : 'border-border bg-white'),
        frame === 'inset' && cn('px-5 py-4', dark ? 'bg-primary' : 'bg-white'),
        className,
      )}
    >
      <p className={cn('text-micro font-bold uppercase tracking-[0.13em]', quiet)}>{label}</p>
      <p
        className={cn(
          'mt-2 text-xl font-bold tracking-[-0.6px] tabular-nums leading-[1.2]',
          dark ? 'text-white' : TONE[tone],
        )}
      >
        {value}
      </p>
      {note && <p className={cn('mt-1.5 text-micro', quiet)}>{note}</p>}
    </div>
  );
}

/**
 * The row these normally sit in. Four across on a wide screen, two on a
 * tablet, stacked on a phone — the arrangement every screen was already
 * writing out, so it may as well be named.
 */
export function StatRow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4', className)}>
      {children}
    </div>
  );
}
