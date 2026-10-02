'use client';

import { useEffect, useRef, useState } from 'react';
import { animate, useReducedMotion } from 'framer-motion';
import { ArrowDownRight, ArrowUpRight, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sparkline, type SparkPoint } from './Sparkline';
import { changePct } from './format';

/**
 * A number that counts up to itself, once — when it first appears. A later
 * refresh shows the new figure straight away; the parent remounts the tile to
 * count again on a change of week. Reduced motion: no counting at all.
 */
function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  const counted = useRef(false);

  useEffect(() => {
    if (reduce || counted.current) {
      setShown(value);
      return;
    }
    counted.current = true;
    const run = animate(0, value, { duration: 0.6, ease: 'easeOut', onUpdate: setShown });
    return () => run.stop();
  }, [value, reduce]);

  return <>{format(shown)}</>;
}

/**
 * One scoreboard figure: the number, how it moved against the week before,
 * eight weeks of it, and a line saying what it is compared with.
 *
 * The chip is coloured by what the move MEANS, not which way it went: more
 * cash is good, a longer approval time is not.
 */
export function TrendTile({
  label,
  value,
  previous,
  format,
  display,
  upIsGood = true,
  points,
  pointFormat,
  note,
  onOpen,
  openLabel,
}: {
  label: string;
  /** What the big number is, to count up to. Null shows a dash. */
  value: number | null;
  /** The same figure the week before; null when there is nothing to compare. */
  previous: number | null;
  format: (n: number) => string;
  /** Overrides the big number when it is not simply `format(value)`. */
  display?: React.ReactNode;
  upIsGood?: boolean;
  points: SparkPoint[];
  pointFormat: (n: number) => string;
  note: React.ReactNode;
  onOpen: () => void;
  openLabel: string;
}) {
  const moved = value !== null && previous !== null && value !== previous;
  const up = moved && value! > previous!;
  const good = up === upIsGood;
  const pct = moved ? changePct(value!, previous!) : null;

  const firstKnown = points.find((p) => p.value !== null)?.value;
  const lastKnown = [...points].reverse().find((p) => p.value !== null)?.value;
  const trendWords =
    firstKnown === undefined || lastKnown === undefined || firstKnown === null || lastKnown === null
      ? `${label}: no figures in the last eight weeks.`
      : `${label} over eight weeks: from ${pointFormat(firstKnown)} to ${pointFormat(lastKnown)}${
          lastKnown > firstKnown ? ', rising' : lastKnown < firstKnown ? ', falling' : ', level'
        }.`;

  return (
    <div className="group relative flex flex-col rounded-card border border-border bg-white p-4 transition-[border-color,box-shadow] hover:border-line hover:shadow-overlay">
      {/* The whole tile opens what is behind the number; the sparkline's weeks sit above it. */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={openLabel}
        className="absolute inset-0 rounded-card outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      />
      <div className="pointer-events-none flex items-start justify-between gap-2">
        <p className="eyebrow">{label}</p>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-secondary opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
      </div>
      <div className="pointer-events-none mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-2xl font-semibold tabular-nums tracking-tight text-primary">
          {display ?? (value === null ? '—' : <CountUp value={value} format={format} />)}
        </span>
        {moved ? (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-micro font-medium tabular-nums',
              good ? 'bg-success-tint text-success' : 'bg-danger-tint text-danger',
            )}
          >
            {up ? <ArrowUpRight className="h-3 w-3" aria-hidden="true" /> : <ArrowDownRight className="h-3 w-3" aria-hidden="true" />}
            <span className="sr-only">{up ? 'Up' : 'Down'}</span>
            {pct !== null ? `${pct}%` : up ? 'from none' : ''}
          </span>
        ) : previous !== null && value !== null ? (
          <span className="rounded-full bg-subtle px-1.5 py-0.5 text-micro text-secondary">no change</span>
        ) : null}
      </div>
      <Sparkline points={points} format={pointFormat} label={trendWords} className="relative z-[1] mt-3" />
      <p className="pointer-events-none mt-2 text-xs text-secondary">{note}</p>
    </div>
  );
}
