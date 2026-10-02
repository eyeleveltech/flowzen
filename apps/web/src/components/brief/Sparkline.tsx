'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { shortDay } from './format';

export type SparkPoint = { weekStart: string; value: number | null };

const W = 100;
const H = 32;
/** Room above the highest point and below the line, so neither touches the edge. */
const PAD_TOP = 4;
const PAD_BOTTOM = 3;

/**
 * Eight weeks of one figure, drawn by hand — no chart library, the same way
 * the Usage tab draws its bars.
 *
 * A line with a soft area under it in the primary green, the latest week
 * marked with a dot. Each week is a hover and tap target wider than its point,
 * and says itself in words: "Week of 15 Sep: ₹1.8L". A week with no value (no
 * approvals decided) is a gap in the line, not a zero.
 */
export function Sparkline({
  points,
  format,
  label,
  className,
}: {
  points: SparkPoint[];
  format: (n: number) => string;
  /** The trend in words, for a screen reader. */
  label: string;
  className?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const values = points.map((p) => p.value);
  const known = values.filter((v): v is number => v !== null);
  const max = Math.max(...known, 0);
  const min = Math.min(...known, 0);
  const span = max - min || 1;

  const x = (i: number) => (points.length <= 1 ? W / 2 : (i / (points.length - 1)) * W);
  const y = (v: number) => H - PAD_BOTTOM - ((v - min) / span) * (H - PAD_TOP - PAD_BOTTOM);

  // Runs of consecutive known values; a null breaks the line.
  const runs: { i: number; v: number }[][] = [];
  values.forEach((v, i) => {
    if (v === null) return;
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1].i === i - 1) last.push({ i, v });
    else runs.push([{ i, v }]);
  });
  const line = runs.map((run) => run.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(2)} ${y(p.v).toFixed(2)}`).join(' ')).join(' ');
  const area = runs
    .filter((run) => run.length > 1)
    .map(
      (run) =>
        `M${x(run[0].i).toFixed(2)} ${H} ` +
        run.map((p) => `L${x(p.i).toFixed(2)} ${y(p.v).toFixed(2)}`).join(' ') +
        ` L${x(run[run.length - 1].i).toFixed(2)} ${H} Z`,
    )
    .join(' ');

  const lastIndex = values.length - 1;
  const lastValue = values[lastIndex];
  const said = (p: SparkPoint) => `Week of ${shortDay(p.weekStart)}: ${p.value === null ? 'none' : format(p.value)}`;
  const shown = active ?? null;

  return (
    <div className={cn('relative h-8 w-full', className)}>
      <span className="sr-only">{label}</span>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true" data-testid="sparkline">
        {area && <path d={area} fill="var(--color-primary)" fillOpacity={0.07} />}
        {line && (
          <path d={line} fill="none" stroke="var(--color-primary)" strokeOpacity={0.75} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        )}
      </svg>

      {/* The latest week: a dot with a dotted ring — this is the number above. */}
      {lastValue !== null && lastValue !== undefined && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dotted border-primary bg-white"
          style={{ left: `${(x(lastIndex) / W) * 100}%`, top: `${(y(lastValue) / H) * 100}%` }}
        />
      )}
      {shown !== null && values[shown] !== null && shown !== lastIndex && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
          style={{ left: `${(x(shown) / W) * 100}%`, top: `${(y(values[shown]!) / H) * 100}%` }}
        />
      )}

      {/* One target per week, the full height and wider than its point. */}
      <div className="absolute inset-0 flex">
        {points.map((p, i) => (
          <button
            key={p.weekStart}
            type="button"
            aria-label={said(p)}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            onClick={(e) => {
              // A tap shows the week; it must not also open the tile's drawer.
              e.stopPropagation();
              setActive((a) => (a === i ? null : i));
            }}
            className="h-full flex-1 cursor-default rounded-sm outline-none focus-visible:bg-primary/5"
          />
        ))}
      </div>

      {shown !== null && (
        <span
          role="tooltip"
          className={cn(
            'pointer-events-none absolute bottom-full z-10 mb-1.5 whitespace-nowrap rounded-md border border-border bg-white px-2 py-1 text-micro text-body shadow-overlay',
            shown < 2 ? 'left-0' : shown > points.length - 3 ? 'right-0' : '-translate-x-1/2',
          )}
          style={shown >= 2 && shown <= points.length - 3 ? { left: `${(x(shown) / W) * 100}%` } : undefined}
        >
          {said(points[shown])}
        </span>
      )}
    </div>
  );
}
