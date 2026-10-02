'use client';

/**
 * What is happening when — tasks, money, follow-ups, project dates, gear due
 * back, meetings and shoots, Google busy time and holidays on one calendar.
 *
 * Laid out the way Google Calendar is, because that is the calendar everybody
 * already reads without thinking: Create, a little month and the calendars to
 * show down the side; Today, the arrows and the view across the top; the
 * date circled for today, items as solid colour, and a card beside anything
 * clicked.
 *
 * Every item comes from GET /calendar, which reads each layer with the
 * permission of the screen it comes from, so this page needs none of its own
 * and shows nobody anything their own screens would not.
 *
 * Tasks and meetings move; nothing else does. A task's drop is the same PATCH
 * the task drawer sends, and a refusal puts it back with the server's reason.
 * A meeting or shoot keeps its length, and a drop that runs into something
 * (gear booked, a person busy) asks Keep or Undo before anything is saved.
 * Invoices, proformas, renewals, project dates and gear are facts about the
 * business, not plans, so they stay put.
 *
 * Times are the organisation's: the server sends calendar days and "17:30"
 * wall times, and FullCalendar is run in UTC so it draws them exactly as sent
 * rather than shifting them into whatever zone this browser is in.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin, { type DateClickArg } from '@fullcalendar/interaction';
import type {
  DatesSetArg,
  DayCellContentArg,
  DayHeaderContentArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventInput,
  EventMountArg,
  SlotLabelContentArg,
} from '@fullcalendar/core';
import toast from 'react-hot-toast';
import { CalendarPlus, Check, CheckSquare, ChevronDown, ChevronLeft, ChevronRight, Menu, Plus, TriangleAlert, Users } from 'lucide-react';
import {
  api,
  ApiError,
  type CalendarClash,
  type CalendarEventDetail,
  type CalendarEventInput,
  type CalendarItem,
  type CalendarLayer,
} from '@/lib/api-v2';
import { usePageHeader } from '@/hooks/usePageHeader';
import { useConfig, useDepartments, useTeamMembers } from '@/hooks/queries';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Drawer } from '@/components/ui/drawer';
import { NotFoundPanel } from '@/components/ui/not-found-panel';
import { PageSkeleton } from '@/components/ui/skeleton-loaders';
import { NewTaskModal } from '@/components/work/NewTaskModal';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { EventModal, type EventModalStart } from '@/components/calendar/EventModal';
import { EventDrawer } from '@/components/calendar/EventDrawer';
import { MiniMonth } from '@/components/calendar/MiniMonth';
import { QuickView } from '@/components/calendar/QuickView';
import { useConfirmStore } from '@/stores/confirm';
import { useAuthStore } from '@/stores';
import { personOptions } from '@/lib/people';
import { cn } from '@/lib/utils';

type View = 'month' | 'week' | 'agenda';

const FC_VIEW: Record<View, string> = { month: 'dayGridMonth', week: 'timeGridWeek', agenda: 'agenda' };
/** Google's order and words; "agenda" is still the key a browser remembers. */
const VIEWS: { key: View; label: string; shortcut: string }[] = [
  { key: 'week', label: 'Week', shortcut: 'W' },
  { key: 'month', label: 'Month', shortcut: 'M' },
  { key: 'agenda', label: 'Schedule', shortcut: 'A' },
];

/** Google's two groups: yours, and everything else you can see. */
const LAYERS: { key: CalendarLayer; label: string; group: 'mine' | 'other' }[] = [
  { key: 'mine', label: 'My tasks', group: 'mine' },
  { key: 'events', label: 'Meetings & shoots', group: 'mine' },
  { key: 'google', label: 'Google busy', group: 'mine' },
  { key: 'team', label: 'Team tasks', group: 'other' },
  { key: 'money', label: 'Money', group: 'other' },
  { key: 'sales', label: 'Sales', group: 'other' },
  { key: 'work', label: 'Work', group: 'other' },
  { key: 'equipment', label: 'Equipment', group: 'other' },
  { key: 'holidays', label: 'Holidays', group: 'other' },
];
const ALL_LAYERS = LAYERS.map((l) => l.key);

/* ── Remembered per browser ─────────────────────────────────────────────── */

/*
 * A new key: the first calendar opened with every layer on, and those saved
 * choices would otherwise outlive the new default below.
 */
const STORE = 'flowzen.calendar.v2';
/**
 * `known` is the layers that existed when the choice was saved, so a layer
 * added since follows the default instead of an old choice nobody made about
 * it. `people` is whose schedule is shown — see the Search for people field.
 */
type Prefs = { view?: View; layers?: CalendarLayer[]; known?: CalendarLayer[]; people?: string };
/**
 * Your own calendar first, as Google opens: your tasks, your meetings, your
 * Google busy time, and the studio's holidays. Everybody else's is a choice —
 * tick it under Other calendars, or search for people.
 */
const DEFAULT_LAYERS: CalendarLayer[] = ['mine', 'events', 'google', 'holidays'];
/**
 * The people search: empty is just you (the field then reads "Search for
 * people", as Google's does), "all" is everyone, anything else one person.
 */
const JUST_ME = '';
const EVERYONE = 'all';

function readPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}') as Prefs;
  } catch {
    return {};
  }
}
function writePrefs(next: Prefs) {
  try {
    localStorage.setItem(STORE, JSON.stringify({ ...readPrefs(), ...next }));
  } catch {
    // Private mode or storage blocked: the calendar works, it just forgets.
  }
}

/** True once running in the browser — the remembered view lives there. */
const useInBrowser = () =>
  useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

/* ── Dates ──────────────────────────────────────────────────────────────── */

/** FullCalendar runs in UTC here, so its dates ARE the wall-clock values. */
const dayOfUtc = (d: Date) => d.toISOString().slice(0, 10);
const timeOfUtc = (d: Date) => d.toISOString().slice(11, 16);
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return dayOfUtc(d);
};
const WEEKDAY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Now, as the organisation's wall clock — what "today" and the now-line mean. */
function orgNow(timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:00`;
}

/** "GMT+05:30" — Google puts the zone in the corner above the hours. */
function zoneLabel(timezone: string): string {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'shortOffset' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value;
    return (name ?? '').replace(/GMT([+-])(\d)(?=:|$)/, 'GMT$10$2');
  } catch {
    return '';
  }
}

/** Is a key press meant for the calendar, not a field or a dialog? */
const typingSomewhere = () => {
  const el = document.activeElement as HTMLElement | null;
  if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return true;
  return Boolean(document.querySelector('[role="dialog"]'));
};

export default function CalendarPage() {
  usePageHeader('Calendar');
  // The view and layers are read from this browser, so nothing is drawn on
  // the server — a phone would otherwise flash Month before Schedule.
  return useInBrowser() ? <CalendarScreen /> : <PageSkeleton />;
}

function CalendarScreen() {
  const router = useRouter();
  const calendarRef = useRef<FullCalendar>(null);
  const { data: config } = useConfig();
  const team = useTeamMembers();
  // The one department list, in Settings' order — the team layer filters by id.
  const { departments } = useDepartments();
  const confirm = useConfirmStore((st) => st.confirm);
  const me = useAuthStore((st) => st.user);

  const [view, setView] = useState<View>(() => {
    const stored = readPrefs().view;
    if (stored && FC_VIEW[stored]) return stored;
    // Phones and small tablets read a list better than a grid.
    return window.innerWidth < 1024 ? 'agenda' : 'week';
  });
  const [selected, setSelected] = useState<CalendarLayer[]>(() => {
    const { layers: stored, known = ALL_LAYERS } = readPrefs();
    if (!Array.isArray(stored)) return DEFAULT_LAYERS;
    const added = ALL_LAYERS.filter((l) => !known.includes(l) && DEFAULT_LAYERS.includes(l));
    return [...stored.filter((l) => ALL_LAYERS.includes(l)), ...added];
  });
  const [range, setRange] = useState<{ from: string; to: string; title: string; anchor: string } | null>(null);
  // Whose meetings and busy time: yours until you search for somebody else.
  const [person, setPersonState] = useState<string>(() => {
    const saved = readPrefs().people;
    // "me" was how "just you" was saved for a short while.
    return !saved || saved === 'me' ? JUST_ME : saved;
  });
  const setPerson = (next: string) => {
    setPersonState(next);
    writePrefs({ people: next });
  };
  /** A real person picked — the server filters to them. "Just me" and "Everyone" are not. */
  const pickedPerson = person !== JUST_ME && person !== EVERYONE ? person : '';
  const [dept, setDept] = useState('');
  /** An empty day or slot was clicked: Task or Event? */
  const [chooser, setChooser] = useState<EventModalStart | null>(null);
  const [taskAt, setTaskAt] = useState<EventModalStart | null>(null);
  const [eventAt, setEventAt] = useState<EventModalStart | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalendarEventDetail | null>(null);
  const [quick, setQuick] = useState<{ item: CalendarItem; rect: DOMRect } | null>(null);
  const [sideOpen, setSideOpen] = useState(false);
  /** A meeting dropped somewhere that clashes, waiting on Keep or Undo. */
  const [pendingMove, setPendingMove] = useState<{
    arg: EventDropArg;
    eventId: string;
    body: Pick<CalendarEventInput, 'startsAt' | 'endsAt' | 'allDay'>;
    clashes: CalendarClash[];
  } | null>(null);
  const queryClient = useQueryClient();

  // The open event lives in the address, so the bell and emails can link to it.
  const searchParams = useSearchParams();
  const openEventId = searchParams.get('event');
  const openEvent = (id: string) => router.replace(`/calendar?event=${id}`, { scroll: false });
  const closeEvent = () => router.replace('/calendar', { scroll: false });
  const refreshEvents = (id?: string) => {
    void queryClient.invalidateQueries({ queryKey: ['calendar'] });
    if (id) void queryClient.invalidateQueries({ queryKey: ['calendar-event', id] });
  };

  /*
   * Searching for people shows their calendar — their meetings, their busy
   * time AND their tasks — not only what happens to be ticked. Without this,
   * "Everyone" changed nothing unless Team tasks was ticked as well. The
   * server drops the team's tasks for anybody whose role cannot see them.
   */
  const layersAsked: CalendarLayer[] = person !== JUST_ME && !selected.includes('team') ? [...selected, 'team'] : selected;
  const teamOn = layersAsked.includes('team');
  const eventsOn = selected.includes('events');
  const busyOn = selected.includes('google');
  // One person's schedule: their events and busy time for anybody, their tasks for a Head.
  const personOn = teamOn || eventsOn || busyOn;
  const { data, error, isPending, isFetching, refetch } = useQuery({
    queryKey: ['calendar', range?.from, range?.to, [...layersAsked].sort().join(','), personOn ? pickedPerson : '', teamOn ? dept : ''],
    queryFn: () =>
      api.calendar.get({
        from: range!.from,
        to: range!.to,
        layers: layersAsked,
        person: personOn ? pickedPerson || undefined : undefined,
        departmentId: teamOn ? dept || undefined : undefined,
      }),
    enabled: Boolean(range),
    // Moving a week keeps the old items up until the new ones land, rather
    // than flashing an empty grid.
    placeholderData: keepPreviousData,
  });

  const timezone = data?.timezone ?? config?.organization.timezone ?? 'Asia/Kolkata';
  const available = data?.available ?? ['mine', 'equipment', 'holidays'];
  /*
   * "Just my calendar": the meetings you are on and your own busy time, not
   * the whole team's. Team tasks, money and the rest are other calendars,
   * shown when ticked.
   */
  const items = useMemo(() => {
    const all = data?.items ?? [];
    if (person !== JUST_ME) return all;
    return all.filter((it) => !((it.layer === 'events' || it.layer === 'google') && !it.isMine));
  }, [data, person]);
  const workingDays = data?.workingDays ?? [1, 2, 3, 4, 5, 6];
  const today = orgNow(timezone).slice(0, 10);

  const events: EventInput[] = useMemo(
    () =>
      items.map((it) => ({
        id: it.id,
        title: it.title,
        start: it.time ? `${it.date}T${it.time}:00` : it.date,
        // Meetings, shoots and busy time have an end; everything else is a moment.
        ...(it.endDate ? { end: it.endTime ? `${it.endDate}T${it.endTime}:00` : it.endDate } : {}),
        allDay: it.allDay,
        editable: it.draggable,
        durationEditable: false,
        classNames: [
          'gc-ev',
          `gc-c-${it.overdue ? 'overdue' : it.layer}`,
          it.done ? 'gc-done' : '',
          it.layer === 'google' ? 'gc-busy' : '',
          // A meeting I am not on: outlined, as Google draws one not yet mine.
          it.layer === 'events' && !it.isMine ? 'gc-outline' : '',
          it.draggable ? 'gc-drag' : '',
        ].filter(Boolean),
        extendedProps: { item: it },
      })),
    [items],
  );

  /*
   * Days off, shaded — weekdays nobody works and the holidays in Settings —
   * as a class on the whole day: the month's cell and the week's column.
   */
  const holidaysOn = selected.includes('holidays');
  const dayCellClassNames = useCallback(
    (arg: { date: Date }) => {
      if (!holidaysOn) return [];
      const day = dayOfUtc(arg.date);
      const off = !workingDays.includes(arg.date.getUTCDay()) || items.some((i) => i.kind === 'holiday' && i.date === day);
      return off ? ['gc-off-day'] : [];
    },
    [holidaysOn, workingDays, items],
  );

  /* ── Moving around ── */

  const api_ = () => calendarRef.current?.getApi();

  /*
   * FullCalendar measures itself on window resizes only, so collapsing the
   * app's sidebar left the grid at its old width with a gap beside it. Watch
   * the grid's own box instead and redraw — once a frame, while the sidebar
   * slides.
   */
  const surfaceRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => calendarRef.current?.getApi().updateSize());
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, []);
  const changeView = (next: View) => {
    setView(next);
    writePrefs({ view: next });
    api_()?.changeView(FC_VIEW[next]);
  };
  const toggleLayer = (layer: CalendarLayer) => {
    const next = selected.includes(layer) ? selected.filter((l) => l !== layer) : [...selected, layer];
    setSelected(next);
    writePrefs({ layers: next, known: ALL_LAYERS });
  };
  const goTo = (day: string) => {
    api_()?.gotoDate(day);
    setSideOpen(false);
  };

  // Google's keys: T today, J/N next, K/P back, W M A for the views, C create.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typingSomewhere()) return;
      const k = e.key.toLowerCase();
      if (k === 't') api_()?.today();
      else if (k === 'j' || k === 'n') api_()?.next();
      else if (k === 'k' || k === 'p') api_()?.prev();
      else if (k === 'w') changeView('week');
      else if (k === 'm') changeView('month');
      else if (k === 'a') changeView('agenda');
      else if (k === 'c') setEventAt({ date: orgNow(timezone).slice(0, 10) });
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timezone]);

  /* ── Calendar callbacks ── */

  const onDatesSet = (arg: DatesSetArg) => {
    setRange({
      from: dayOfUtc(arg.start),
      // FullCalendar's end is the day after the last one shown.
      to: addDays(dayOfUtc(arg.end), -1),
      title: arg.view.title,
      anchor: dayOfUtc(arg.view.currentStart),
    });
  };

  /** Anything clicked opens its card beside it. */
  const onEventClick = (arg: EventClickArg) => {
    const item = arg.event.extendedProps.item as CalendarItem | undefined;
    if (!item) return;
    arg.jsEvent.preventDefault();
    setQuick({ item, rect: arg.el.getBoundingClientRect() });
  };

  const openItem = (item: CalendarItem) => {
    setQuick(null);
    if (item.eventId) openEvent(item.eventId);
    else if (item.link) router.push(item.link);
  };

  const editItem = async (item: CalendarItem) => {
    setQuick(null);
    try {
      const detail = await queryClient.fetchQuery({
        queryKey: ['calendar-event', item.eventId],
        queryFn: () => api.calendar.event(item.eventId!),
      });
      setEditingEvent(detail.event);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not open it');
    }
  };

  const deleteItem = async (item: CalendarItem) => {
    setQuick(null);
    const ok = await confirm({
      title: `Cancel ${item.title}?`,
      message: 'Everybody on it is emailed that it is cancelled, and any gear it reserved is let go.',
      confirmText: 'Cancel it',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.calendar.deleteEvent(item.eventId!);
      toast.success('Cancelled');
      refreshEvents(item.eventId);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not cancel it');
    }
  };

  /** The browser's own hover text: the whole title, when, where — and who booked it. */
  const onEventMount = (arg: EventMountArg) => {
    const item = arg.event.extendedProps.item as CalendarItem | undefined;
    if (!item) return;
    arg.el.title = item.eventId
      ? [item.title, item.time ? `${item.time}–${item.endTime}` : 'All day', item.location, `Booked by ${item.bookedBy}`]
          .filter(Boolean)
          .join(' · ')
      : item.title;
  };

  const saveMove = async (eventId: string, body: Pick<CalendarEventInput, 'startsAt' | 'endsAt' | 'allDay'>, revert: () => void) => {
    try {
      await api.calendar.updateEvent(eventId, body);
      toast.success('Moved');
      refreshEvents(eventId);
    } catch (e) {
      revert();
      toast.error(e instanceof ApiError ? e.message : 'Could not move it');
    }
  };

  /**
   * A meeting or shoot dropped somewhere new. Same length; Month moves the
   * day, Week the day and time. What it runs into is checked first — nothing
   * is saved (or emailed) until Keep, and Undo puts it back as it was.
   */
  const moveEvent = async (arg: EventDropArg, item: CalendarItem) => {
    const start = arg.event.start!;
    const end = arg.event.end;
    const body = arg.event.allDay
      ? { allDay: true, startsAt: dayOfUtc(start), endsAt: end ? addDays(dayOfUtc(end), -1) : dayOfUtc(start) }
      : {
          allDay: false,
          startsAt: `${dayOfUtc(start)}T${timeOfUtc(start)}`,
          endsAt: `${dayOfUtc(end ?? new Date(start.getTime() + 3_600_000))}T${timeOfUtc(end ?? new Date(start.getTime() + 3_600_000))}`,
        };
    try {
      const detail = await queryClient.fetchQuery({
        queryKey: ['calendar-event', item.eventId],
        queryFn: () => api.calendar.event(item.eventId!),
      });
      const { clashes } = await api.calendar.clashes({
        ...body,
        assetIds: detail.event.gear.map((g) => g.assetId),
        attendeeIds: detail.event.attendees.map((a) => a.id),
        excludeEventId: item.eventId,
      });
      if (clashes.length) setPendingMove({ arg, eventId: item.eventId!, body, clashes });
      else await saveMove(item.eventId!, body, arg.revert);
    } catch (e) {
      arg.revert();
      toast.error(e instanceof ApiError ? e.message : 'Could not move it');
    }
  };

  const onEventDrop = async (arg: EventDropArg) => {
    const item = arg.event.extendedProps.item as CalendarItem;
    const start = arg.event.start;
    if (item.eventId && start) {
      await moveEvent(arg, item);
      return;
    }
    if (!item.taskId || !start) {
      arg.revert();
      return;
    }
    const dueDate = dayOfUtc(start);
    /*
     * Month view moves the day and keeps the time. Week view moves both — and
     * a drop on the all-day row takes the time off.
     */
    const dueTime = arg.view.type === 'timeGridWeek' ? (arg.event.allDay ? null : timeOfUtc(start)) : (item.dueTime ?? null);
    try {
      await api.tasks.update(item.taskId, { dueDate, dueTime });
      toast.success('Task moved');
    } catch (e) {
      arg.revert();
      toast.error(e instanceof ApiError ? e.message : 'Could not move that task');
    }
  };

  // An empty day or slot: ask whether it is a task or an event.
  const onDateClick = (arg: DateClickArg) => {
    setChooser(arg.allDay ? { date: dayOfUtc(arg.date) } : { date: dayOfUtc(arg.date), time: timeOfUtc(arg.date) });
  };

  /* ── Google's drawing ── */

  /** The week's day heading — "MON" over a big 5, today's circled; the month's just "MON". */
  const dayHeader = (arg: DayHeaderContentArg) => {
    // Schedule's day rows say the whole date ("Thursday 1 October").
    if (arg.view.type === 'agenda') return arg.text;
    const wd = WEEKDAY[arg.date.getUTCDay()];
    if (arg.view.type !== 'timeGridWeek') return <span className="gc-dh-wd">{wd}</span>;
    return (
      <div className={cn('gc-dh', arg.isToday && 'gc-dh-today')}>
        <span className="gc-dh-wd">{wd}</span>
        <span className="gc-dh-num">{arg.date.getUTCDate()}</span>
      </div>
    );
  };

  /** A month cell's number, small and centred; "1 Oct" on the first. */
  const dayCell = (arg: DayCellContentArg) => {
    if (arg.view.type !== 'dayGridMonth') return undefined;
    const d = arg.date.getUTCDate();
    return (
      <span className={cn('gc-daynum', arg.isToday && 'gc-daynum-today')}>
        {d === 1 ? `${d} ${MONTH[arg.date.getUTCMonth()]}` : d}
      </span>
    );
  };

  /** "10 AM" at the top of each hour; nothing at midnight, as Google leaves it. */
  const slotLabel = (arg: SlotLabelContentArg) => {
    const h = arg.date.getUTCHours();
    return h === 0 ? '' : `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`;
  };

  const eventContent = (arg: EventContentArg) => {
    const item = arg.event.extendedProps.item as CalendarItem | undefined;
    const timed = !arg.event.allDay;
    if (arg.view.type === 'timeGridWeek' && timed) {
      return (
        <div className="gc-ev-body">
          <div className="gc-ev-title">{arg.event.title}</div>
          <div className="gc-ev-time">
            {arg.timeText}
            {item?.location ? `, ${item.location}` : ''}
          </div>
        </div>
      );
    }
    if (arg.view.type === 'dayGridMonth' && timed) {
      return (
        <div className="gc-ev-dotrow">
          <span className="gc-ev-dot" aria-hidden="true" />
          <span className="gc-ev-time">{arg.timeText}</span>
          <span className="gc-ev-title">{arg.event.title}</span>
        </div>
      );
    }
    return <div className="gc-ev-title">{arg.event.title}</div>;
  };

  if (error && !data) {
    return (
      <div className="page-shell">
        <NotFoundPanel
          thing="calendar"
          error={error}
          back={{ href: '/my-work', label: 'Go to My Work' }}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const shownLayers = LAYERS.filter((l) => available.includes(l.key));

  const sidebar = (
    <div className="flex flex-col gap-6">
      <CreateButton
        onEvent={() => {
          setSideOpen(false);
          setEventAt({ date: today });
        }}
        onTask={() => {
          setSideOpen(false);
          setTaskAt({ date: today });
        }}
      />
      <MiniMonth
        anchor={range?.anchor ?? today}
        today={today}
        from={view === 'week' ? range?.from : undefined}
        to={view === 'week' ? range?.to : undefined}
        onPick={goTo}
      />

      {/* Google's "Search for people": one person's schedule, to find them a free slot. */}
      {(eventsOn || busyOn || (teamOn && available.includes('team'))) && (
        <Select
          value={person}
          onChange={setPerson}
          placeholder="Search for people"
          ariaLabel="Search for people"
          leadingIcon={<Users className="h-4 w-4 text-secondary" strokeWidth={1.75} />}
          options={[
            // A way back to just you, once somebody else is showing.
            ...(person !== JUST_ME ? [{ value: JUST_ME, label: 'Just me' }] : []),
            { value: EVERYONE, label: 'Everyone' },
            // Everybody but you — your own calendar is already the default.
            ...personOptions(team.filter((m) => m.id !== me?.id)),
          ]}
          className="w-full"
        />
      )}

      <CalendarGroup
        title="My calendars"
        layers={shownLayers.filter((l) => l.group === 'mine')}
        selected={selected}
        onToggle={toggleLayer}
      />
      <CalendarGroup
        title="Other calendars"
        layers={shownLayers.filter((l) => l.group === 'other')}
        selected={selected}
        onToggle={toggleLayer}
      >
        {teamOn && available.includes('team') && (
          <Select
            value={dept}
            onChange={setDept}
            placeholder="Every department"
            ariaLabel="Team tasks from which department"
            options={[{ value: '', label: 'Every department' }, ...departments.map((d) => ({ value: d.id, label: d.name }))]}
            className="mt-1 w-full"
          />
        )}
      </CalendarGroup>
    </div>
  );

  return (
    // The whole width there is — a calendar is not a page of text, so it does
    // not take the reading measure the other screens use.
    <div className="gc flex h-[calc(100dvh-11.5rem)] min-h-120 w-full gap-6 md:h-[calc(100dvh-8rem)]">
      {/* The side panel, as Google has it, once there is room for it beside a
          useful grid — a drawer below that. */}
      <aside className="hidden w-60 shrink-0 overflow-y-auto pb-4 xl:block">{sidebar}</aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {/* Today, the arrows, where you are, and how you are looking. */}
        <div className="mb-3 flex items-center gap-1.5 sm:gap-2">
          <div className="xl:hidden">
            <button type="button" aria-label="Calendars" onClick={() => setSideOpen(true)} className="gc-icon-btn h-10 w-10">
              <Menu className="h-5 w-5" strokeWidth={1.75} />
            </button>
          </div>
          <button type="button" onClick={() => api_()?.today()} title="Today (T)" className="gc-pill">
            Today
          </button>
          <button type="button" aria-label="Previous" title="Previous (K)" onClick={() => api_()?.prev()} className="gc-icon-btn h-9 w-9">
            <ChevronLeft className="h-5 w-5" strokeWidth={1.75} />
          </button>
          <button type="button" aria-label="Next" title="Next (J)" onClick={() => api_()?.next()} className="gc-icon-btn h-9 w-9">
            <ChevronRight className="h-5 w-5" strokeWidth={1.75} />
          </button>
          <h2 className="ml-1 min-w-0 truncate text-xl font-normal text-primary">{range?.title}</h2>
          {isFetching && <span className="gc-spinner" aria-label="Loading" />}
          {!isPending && items.length === 0 && view !== 'agenda' && (
            <span className="hidden text-xs text-secondary md:inline">Nothing on these dates.</span>
          )}
          <div className="ml-auto">
            <ViewMenu view={view} onChange={changeView} />
          </div>
        </div>

        {/* Only ever shown to the person whose own Google connection stopped working. */}
        {data?.googleNeedsReconnect && (
          <p role="status" className="mb-3 rounded-card border border-warning/30 bg-warning-tint px-3 py-2 text-xs text-warning-ink">
            Your Google Calendar isn&apos;t syncing — Google stopped accepting Flowzen&apos;s access.{' '}
            <Link href="/profile" className="font-semibold underline underline-offset-2">
              Reconnect in Profile
            </Link>
          </p>
        )}

        <div ref={surfaceRef} className="gc-surface min-h-0 flex-1">
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
            initialView={FC_VIEW[view]}
            initialDate={range?.anchor}
            headerToolbar={false}
            views={{
              agenda: {
                type: 'list',
                duration: { days: 30 },
                listDayFormat: { weekday: 'long', day: 'numeric', month: 'long' },
                listDaySideFormat: false,
              },
              // Month shows when an item starts, not the whole range — there is no room.
              dayGridMonth: { eventDisplay: 'auto', dayHeaderFormat: { weekday: 'short' }, displayEventEnd: false },
              timeGridWeek: { eventDisplay: 'block' },
            }}
            height="100%"
            scrollTime="07:30:00"
            timeZone="UTC"
            now={() => orgNow(timezone)}
            firstDay={1}
            nowIndicator
            dayMaxEvents
            // The week's corner carries the zone, as Google's does; a list says "All day".
            allDayContent={(arg) => (arg.view.type === 'timeGridWeek' ? zoneLabel(timezone) : 'All day')}
            slotLabelContent={slotLabel}
            dayHeaderContent={dayHeader}
            dayCellContent={dayCell}
            eventContent={eventContent}
            eventTimeFormat={{ hour: 'numeric', minute: '2-digit', omitZeroMinute: true, meridiem: 'short' }}
            displayEventEnd
            events={events}
            dayCellClassNames={dayCellClassNames}
            eventDurationEditable={false}
            noEventsContent="Nothing on these dates."
            datesSet={onDatesSet}
            eventClick={onEventClick}
            eventDidMount={onEventMount}
            eventDrop={onEventDrop}
            dateClick={onDateClick}
          />
        </div>
      </section>

      {/* A phone: the side panel slides in, and Create floats, as in Google's app. */}
      <Drawer isOpen={sideOpen} onClose={() => setSideOpen(false)} variant="slideover" title="Calendar">
        <div className="gc h-full overflow-y-auto px-5 py-5">{sidebar}</div>
      </Drawer>
      <button
        type="button"
        aria-label="Create"
        onClick={() => setChooser({ date: today })}
        className="gc-fab fixed bottom-24 right-4 z-30 grid h-14 w-14 place-items-center rounded-2xl bg-white xl:hidden"
      >
        <Plus className="h-7 w-7" strokeWidth={2} />
      </button>

      {quick && (
        <QuickView
          item={quick.item}
          anchor={quick.rect}
          onClose={() => setQuick(null)}
          onOpen={() => openItem(quick.item)}
          onEdit={quick.item.eventId && quick.item.draggable ? () => void editItem(quick.item) : undefined}
          onDelete={quick.item.eventId && quick.item.draggable ? () => void deleteItem(quick.item) : undefined}
        />
      )}

      {/* Task, or event? */}
      <Modal open={Boolean(chooser)} onClose={() => setChooser(null)} title="Add to the calendar">
        <ModalBody>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                setTaskAt(chooser);
                setChooser(null);
              }}
              className="flex flex-col items-start gap-1 rounded-card border border-border p-4 text-left transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
            >
              <CheckSquare className="h-5 w-5 text-primary" strokeWidth={1.75} aria-hidden="true" />
              <span className="text-sm font-semibold text-primary">Task</span>
              <span className="text-xs text-secondary">Something to get done, due that day.</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setEventAt(chooser);
                setChooser(null);
              }}
              className="flex flex-col items-start gap-1 rounded-card border border-border p-4 text-left transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
            >
              <CalendarPlus className="h-5 w-5 text-primary" strokeWidth={1.75} aria-hidden="true" />
              <span className="text-sm font-semibold text-primary">Event</span>
              <span className="text-xs text-secondary">A meeting or a shoot, with people and gear.</span>
            </button>
          </div>
        </ModalBody>
      </Modal>

      <NewTaskModal
        open={Boolean(taskAt)}
        initialDueDate={taskAt?.date}
        initialDueTime={taskAt?.time}
        onClose={() => setTaskAt(null)}
        onCreated={() => setTaskAt(null)}
      />

      <EventModal
        open={Boolean(eventAt) || Boolean(editingEvent)}
        start={eventAt}
        event={editingEvent}
        onClose={() => {
          setEventAt(null);
          setEditingEvent(null);
        }}
        onSaved={(id) => {
          setEventAt(null);
          setEditingEvent(null);
          refreshEvents(id);
        }}
      />

      <EventDrawer
        eventId={openEventId}
        onClose={closeEvent}
        onEdit={(ev) => setEditingEvent(ev)}
        onChanged={() => refreshEvents(openEventId ?? undefined)}
      />

      {/* A drop that runs into something: keep it there anyway, or put it back. */}
      <Modal
        open={Boolean(pendingMove)}
        onClose={() => {
          pendingMove?.arg.revert();
          setPendingMove(null);
        }}
        title="This runs into something"
      >
        <ModalBody>
          <ul className="space-y-1.5 text-sm text-warning-ink">
            {pendingMove?.clashes.map((c, i) => (
              <li key={i} className="flex gap-2">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                <span>{c.kind === 'person' ? c.message : `${c.subject} — ${c.message}`}</span>
              </li>
            ))}
          </ul>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="ghost"
            onClick={() => {
              pendingMove?.arg.revert();
              setPendingMove(null);
            }}
          >
            Undo
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              const move = pendingMove;
              setPendingMove(null);
              if (move) void saveMove(move.eventId, move.body, move.arg.revert);
            }}
          >
            Keep
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

/* ── The side panel's pieces ────────────────────────────────────────────── */

/** Outside click and Escape close a little menu. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open, close]);
  return ref;
}

/** Google's Create: a raised pill with a menu — Event or Task. */
function CreateButton({ onEvent, onTask }: { onEvent: () => void; onTask: () => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="gc-create inline-flex h-10 items-center gap-2 rounded-full bg-white pl-3 pr-4 text-sm font-medium text-primary"
      >
        <Plus className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
        Create
        <ChevronDown className="h-3.5 w-3.5 text-secondary" strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full z-20 mt-1 w-48 rounded-card bg-white py-2 shadow-overlay ring-1 ring-black/5">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              onEvent();
            }}
            className="gc-menu-item"
          >
            Event
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              onTask();
            }}
            className="gc-menu-item"
          >
            Task
          </button>
        </div>
      )}
    </div>
  );
}

/** "My calendars" / "Other calendars": a heading that folds, and a coloured checkbox each. */
function CalendarGroup({
  title,
  layers,
  selected,
  onToggle,
  children,
}: {
  title: string;
  layers: { key: CalendarLayer; label: string }[];
  selected: CalendarLayer[];
  onToggle: (layer: CalendarLayer) => void;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  if (layers.length === 0) return null;
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm font-medium text-primary hover:bg-subtle"
      >
        {title}
        <ChevronDown className={cn('h-4 w-4 text-secondary transition-transform', !open && '-rotate-90')} strokeWidth={1.75} />
      </button>
      {open && (
        <div className="mt-0.5">
          {layers.map((l) => (
            <label key={l.key} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm text-body hover:bg-subtle">
              <input type="checkbox" className="peer sr-only" checked={selected.includes(l.key)} onChange={() => onToggle(l.key)} />
              <span className={cn('gc-check', `gc-c-${l.key}`)} aria-hidden="true">
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
              </span>
              {l.label}
            </label>
          ))}
          {children}
        </div>
      )}
    </div>
  );
}

/** Google's view switch: an outlined pill that opens a menu, with the keys beside. */
function ViewMenu({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  const current = VIEWS.find((v) => v.key === view)!;
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="gc-pill gap-2">
        {current.label}
        <ChevronDown className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-44 rounded-card bg-white py-2 shadow-overlay ring-1 ring-black/5">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              role="menuitemradio"
              aria-checked={view === v.key}
              onClick={() => {
                close();
                onChange(v.key);
              }}
              className={cn('gc-menu-item justify-between', view === v.key && 'gc-menu-item-on')}
            >
              {v.label}
              <span className="text-xs text-secondary">{v.shortcut}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
