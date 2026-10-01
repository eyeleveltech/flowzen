'use client';

/**
 * A task's due date and time, changed right on the row — in one place.
 *
 * Moving a date used to mean opening the task, pressing Edit, changing one
 * field and saving. Then the row took the date (a calendar) and, beside it,
 * the time (a separate dropdown): two controls for one deadline. Now the due
 * cell is one button, and it opens one panel: a month calendar, the list of
 * times with am/pm beside it, Today / Tomorrow, and Save. On a phone the same
 * panel comes up as a bottom sheet, stacked.
 *
 * Saves both in one call, shows the new value at once, and every task list
 * refreshes (lib/task-sync).
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { api, ApiError, formatDate } from '@/lib/api-v2';
import { cn } from '@/lib/utils';
import { dueTimeOptions, withDueTime } from '@/lib/due-time';
import { useIsMobile } from '@/hooks/use-breakpoint';
import { Drawer } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';

/** A calendar day as the API wants it, from local parts — never through UTC. */
const keyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromKey = (k: string) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export function InlineDueDate({
  taskId,
  title,
  value,
  time,
  className,
  disabled = false,
  format = formatDate,
}: {
  taskId: string;
  /** For the accessible name: "Due date for <title>". */
  title: string;
  /** The due date as the API sends it. */
  value: string;
  /** The optional due time, "17:30". */
  time?: string | null;
  /** How the date reads — the late / today colouring belongs to the screen. */
  className?: string;
  /** A finished task's date is history. */
  disabled?: boolean;
  format?: (iso: string) => string;
}) {
  const isMobile = useIsMobile();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  /** What was just saved, shown until the list hands over the fresh row. */
  const [saved, setSaved] = useState<{ date: string; time: string | null } | null>(null);
  useEffect(() => setSaved(null), [value, time]);

  const date = (saved?.date ?? value ?? '').slice(0, 10);
  const currentTime = saved ? (saved.time ?? '') : (time ?? '');
  const shown = withDueTime(format(date), currentTime);

  const save = async (nextDate: string, nextTime: string) => {
    if (nextDate === date && nextTime === currentTime) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      await api.tasks.update(taskId, {
        ...(nextDate !== date ? { dueDate: nextDate } : {}),
        ...(nextTime !== currentTime ? { dueTime: nextTime || null } : {}),
      });
      setSaved({ date: nextDate, time: nextTime || null });
      toast.success(`Due ${withDueTime(format(nextDate), nextTime)}`);
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not change the due date');
    } finally {
      setSaving(false);
    }
  };

  if (disabled) return <span className={className}>{shown}</span>;

  const panel = (
    <DueDateTimePanel
      date={date}
      time={currentTime}
      saving={saving}
      stacked={isMobile}
      onCancel={() => setOpen(false)}
      onSave={(d, t) => void save(d, t)}
    />
  );

  return (
    <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Due ${shown} for ${title}. Change it`}
        title="Change the due date and time"
        className={cn(
          'group inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 -mx-1.5 text-left outline-none transition-colors hover:bg-subtle focus-visible:ring-2 focus-visible:ring-primary/40',
          open && 'bg-subtle',
          className,
        )}
      >
        {shown}
        <CalendarDays
          className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-60"
          aria-hidden="true"
        />
      </button>

      {open &&
        (isMobile ? (
          <Drawer isOpen onClose={() => setOpen(false)} title="Due date and time" description={title}>
            {panel}
          </Drawer>
        ) : (
          <Popover anchor={trigger} onClose={() => setOpen(false)}>
            {panel}
          </Popover>
        ))}
    </span>
  );
}

/** A floating panel under the trigger — above it when there is no room below. */
function Popover({
  anchor,
  onClose,
  children,
}: {
  anchor: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const b = box.current?.getBoundingClientRect();
      if (!a || !b) return;
      const room = window.innerHeight - a.bottom;
      const top = room >= b.height + 12 ? a.bottom + 6 : Math.max(8, a.top - b.height - 6);
      const left = Math.min(Math.max(8, a.left), window.innerWidth - b.width - 8);
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        anchor.current?.focus();
      }
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-label="Due date and time"
      // Clicks inside must not reach the row behind, which would open the task.
      onClick={(e) => e.stopPropagation()}
      className="fixed z-9999 rounded-xl border border-border bg-white p-3 shadow-overlay"
      style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** The calendar and the times, side by side (stacked on a phone), and Save. */
function DueDateTimePanel({
  date,
  time,
  saving,
  stacked,
  onCancel,
  onSave,
}: {
  date: string;
  time: string;
  saving: boolean;
  stacked: boolean;
  onCancel: () => void;
  onSave: (date: string, time: string) => void;
}) {
  const [pickedDate, setPickedDate] = useState(date);
  const [pickedTime, setPickedTime] = useState(time);
  const [month, setMonth] = useState(() => {
    const d = fromKey(date || keyOf(new Date()));
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const todayKey = keyOf(new Date());
  const tomorrowKey = keyOf(new Date(Date.now() + 24 * 60 * 60 * 1000));

  // Six rows of seven: the month, padded with the days either side.
  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [month]);

  const pick = (k: string) => {
    setPickedDate(k);
    const d = fromKey(k);
    if (d.getMonth() !== month.getMonth() || d.getFullYear() !== month.getFullYear())
      setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  };

  // The time list opens on the chosen time, or 9:00 am — not at midnight.
  const timeList = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = timeList.current;
    const el = list?.querySelector(`[data-time="${time || '09:00'}"]`) as HTMLElement | null;
    if (list && el) list.scrollTop = el.offsetTop - list.clientHeight / 2 + el.clientHeight / 2;
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const options = dueTimeOptions(pickedTime);

  return (
    <div className="space-y-3">
      <div className={cn('flex gap-3', stacked ? 'flex-col' : 'items-start')}>
        {/* ── The calendar ── */}
        <div className="w-64 max-w-full shrink-0 self-center sm:self-auto">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
              className="rounded-md p-1 text-secondary outline-none hover:bg-subtle hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <p className="text-sm font-semibold text-primary">
              {month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
            </p>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
              className="rounded-md p-1 text-secondary outline-none hover:bg-subtle hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {WEEKDAYS.map((w) => (
              <span key={w} className="py-1 text-micro font-semibold text-secondary">
                {w}
              </span>
            ))}
            {days.map((d) => {
              const k = keyOf(d);
              const inMonth = d.getMonth() === month.getMonth();
              const selected = k === pickedDate;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => pick(k)}
                  aria-pressed={selected}
                  aria-label={d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  className={cn(
                    'h-8 rounded-md text-xs tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40',
                    selected
                      ? 'bg-primary font-semibold text-white'
                      : cn('hover:bg-subtle', inMonth ? 'text-body' : 'text-secondary/50'),
                    k === todayKey && !selected && 'font-semibold text-primary ring-1 ring-inset ring-primary/30',
                  )}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              onClick={() => pick(todayKey)}
              className="rounded-md border border-border px-2 py-1 text-xs text-body outline-none hover:bg-subtle focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => pick(tomorrowKey)}
              className="rounded-md border border-border px-2 py-1 text-xs text-body outline-none hover:bg-subtle focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Tomorrow
            </button>
          </div>
        </div>

        {/* ── The time ── */}
        <div className={cn('min-w-0', stacked ? 'w-full' : 'w-32 border-l border-border pl-3')}>
          <p className="eyebrow mb-1.5">Time</p>
          <div
            ref={timeList}
            role="listbox"
            aria-label="Due time"
            className={cn('relative overflow-y-auto', stacked ? 'max-h-40' : 'h-64')}
          >
            {options.map((o) => {
              const selected = o.value === pickedTime;
              return (
                <button
                  key={o.value || 'none'}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-time={o.value}
                  onClick={() => setPickedTime(o.value)}
                  className={cn(
                    'block w-full rounded-md px-2 py-1.5 text-left text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40',
                    selected ? 'bg-primary font-semibold text-white' : 'text-body hover:bg-subtle',
                    !o.value && !selected && 'text-secondary',
                  )}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
        <p className="min-w-0 truncate text-xs text-secondary">
          {pickedDate ? withDueTime(formatDate(pickedDate), pickedTime) : 'Pick a day'}
        </p>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" loading={saving} disabled={!pickedDate} onClick={() => onSave(pickedDate, pickedTime)}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
