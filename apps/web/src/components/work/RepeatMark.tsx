'use client';

/**
 * The small repeat mark beside a task's title, wherever tasks are listed —
 * "Repeats every Thursday" on hover. Nothing for a task that does not repeat,
 * or whose repeat has stopped.
 */

import { Repeat } from 'lucide-react';
import { isRepeating, repeatTooltip, type TaskRepeatInfo } from '@/lib/repeat';

export function RepeatMark({ repeat }: { repeat: TaskRepeatInfo | null | undefined }) {
  if (!isRepeating(repeat)) return null;
  const label = repeatTooltip(repeat);
  return (
    <span title={label} aria-label={label} role="img" className="inline-flex shrink-0 align-middle text-secondary">
      <Repeat className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
    </span>
  );
}
