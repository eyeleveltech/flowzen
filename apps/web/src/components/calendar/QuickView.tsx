'use client';

/**
 * The small card an item opens beside itself, as Google Calendar does: what it
 * is, when, where, whose — and the one or two things you would do next.
 *
 * Meetings and shoots carry Edit and Delete here for the people allowed to
 * change them; everything else opens on its own screen. The full event — its
 * people, gear and history — is one click further, in the drawer.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CalendarDays, Clock, MapPin, Pencil, Trash2, UserRound, X } from 'lucide-react';
import type { CalendarItem } from '@/lib/api-v2';
import { dueTimeLabel } from '@/lib/due-time';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const LAYER_NAME: Record<string, string> = {
  mine: 'My tasks',
  team: 'Team tasks',
  events: 'Meetings & shoots',
  google: 'Google Calendar',
  money: 'Money',
  sales: 'Sales',
  work: 'Work',
  equipment: 'Equipment',
  holidays: 'Holidays',
};

const longDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/** "Friday, 9 October · 10:00 am – 11:00 am", or the days for something longer. */
function whenOf(it: CalendarItem): string {
  const day = longDay(it.date);
  if (it.allDay) {
    if (it.endDate) {
      // All-day ends are exclusive: the last day is the one before.
      const last = new Date(`${it.endDate}T00:00:00Z`);
      last.setUTCDate(last.getUTCDate() - 1);
      const lastDay = last.toISOString().slice(0, 10);
      if (lastDay !== it.date) return `${day} – ${longDay(lastDay)}`;
    }
    return day;
  }
  const start = dueTimeLabel(it.time);
  if (it.endTime && it.endDate && it.endDate !== it.date) return `${day} ${start} – ${longDay(it.endDate)} ${dueTimeLabel(it.endTime)}`;
  return it.endTime ? `${day} · ${start} – ${dueTimeLabel(it.endTime)}` : `${day} · ${start}`;
}

export function QuickView({
  item,
  anchor,
  onClose,
  onOpen,
  onEdit,
  onDelete,
}: {
  item: CalendarItem;
  /** Where the clicked item is on screen. */
  anchor: DOMRect;
  onClose: () => void;
  /** Open it properly: the event's drawer, or the item's own screen. */
  onOpen: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Beside the item, on whichever side has room, kept on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (vw < 640) {
      setPos({ left: 16, top: Math.max(16, vh - h - 96) });
      return;
    }
    const left = anchor.right + 8 + w <= vw - 16 ? anchor.right + 8 : Math.max(16, anchor.left - w - 8);
    const top = Math.min(Math.max(16, anchor.top), vh - h - 16);
    setPos({ left, top });
  }, [anchor]);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    // On the next tick, so the click that opened it does not close it.
    const t = setTimeout(() => document.addEventListener('mousedown', away));
    document.addEventListener('keydown', esc);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  const isEvent = Boolean(item.eventId);
  const isBusy = item.layer === 'google';

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={item.title}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
      className="gc fixed z-40 w-[min(26rem,calc(100vw-2rem))] rounded-card bg-white p-2 shadow-overlay ring-1 ring-black/5"
    >
      <div className="flex justify-end gap-0.5">
        {onEdit && (
          <button type="button" aria-label="Edit" title="Edit" onClick={onEdit} className="gc-icon-btn h-9 w-9">
            <Pencil className="h-4 w-4" strokeWidth={1.75} />
          </button>
        )}
        {onDelete && (
          <button type="button" aria-label="Delete" title="Delete" onClick={onDelete} className="gc-icon-btn h-9 w-9">
            <Trash2 className="h-4 w-4" strokeWidth={1.75} />
          </button>
        )}
        <button type="button" aria-label="Close" title="Close" onClick={onClose} className="gc-icon-btn h-9 w-9">
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>

      <div className="space-y-3 px-3 pb-3">
        <div className="flex gap-4">
          <span className={cn('gc-swatch mt-1.5 shrink-0', `gc-c-${item.overdue ? 'overdue' : item.layer}`)} aria-hidden="true" />
          <div className="min-w-0">
            <p className={cn('text-xl text-primary', item.done && 'line-through opacity-70')}>{item.title}</p>
            <p className="mt-0.5 text-sm text-secondary">
              {item.kind === 'task' ? `Due ${whenOf(item)}` : whenOf(item)}
              {item.overdue && <span className="text-danger"> · overdue</span>}
            </p>
          </div>
        </div>

        {item.location && (
          <Line icon={MapPin}>{item.location}</Line>
        )}
        {item.bookedBy && <Line icon={UserRound}>Booked by {item.bookedBy}</Line>}
        {isBusy && <Line icon={Clock}>Busy in Google Calendar</Line>}
        <Line icon={CalendarDays}>{LAYER_NAME[item.layer] ?? item.layer}</Line>

        {item.link && (
          <div className="flex justify-end pt-1">
            <Button size="sm" variant="primary" onClick={onOpen}>
              {isEvent ? 'Open details' : item.kind === 'task' ? 'Open task' : 'Open'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Line({ icon: Icon, children }: { icon: typeof MapPin; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-4 text-sm text-body">
      <Icon className="h-4 w-4 shrink-0 text-secondary" strokeWidth={1.75} aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
