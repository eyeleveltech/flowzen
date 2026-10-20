'use client';

/**
 * My Department → Calendar: one week, drawn as the Calendar page draws it,
 * with only this department's people on it — their meetings and shoots, their
 * task deadlines, the holidays, and their Google busy time. Busy time is
 * "Busy · name" for everybody but its owner: the Calendar's own rule, applied
 * by the server, which never sends anybody else's titles.
 *
 * Narrowed to one person with the picker. Reading, not editing: clicking
 * opens the item's card, and its own screen from there.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api, type CalendarItem, type DepartmentOverview } from '@/lib/api-v2';
import { Select } from '@/components/ui/select';
import { ErrorNote } from '@/components/ui/empty-state';
import { QuickView } from '@/components/calendar/QuickView';
import { addDays, CalendarWeekView } from '@/components/calendar/calendarDrawing';

export function CalendarTab({ overview, timezone }: { overview: DepartmentOverview; timezone: string }) {
  const router = useRouter();
  const departmentId = overview.department.id;
  const [person, setPerson] = useState('');
  const [anchor, setAnchor] = useState(overview.today);
  const [range, setRange] = useState<{ from: string; to: string; title: string } | null>(null);
  const [quick, setQuick] = useState<{ item: CalendarItem; rect: DOMRect } | null>(null);

  const { data, error, refetch } = useQuery({
    queryKey: ['department', departmentId, 'calendar', range?.from, person],
    enabled: Boolean(range),
    placeholderData: keepPreviousData,
    queryFn: () =>
      api.calendar.get({
        from: range!.from,
        to: range!.to,
        layers: ['team', 'events', 'google', 'holidays'],
        onlyDepartment: departmentId,
        ...(person ? { person } : {}),
      }),
  });

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setAnchor(overview.today)}
          className="rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-medium text-body hover:bg-subtle"
        >
          This week
        </button>
        <button
          type="button"
          aria-label="Previous week"
          onClick={() => range && setAnchor(addDays(range.from, -7))}
          className="rounded-lg p-1.5 text-secondary hover:bg-subtle hover:text-primary"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Next week"
          onClick={() => range && setAnchor(addDays(range.from, 7))}
          className="rounded-lg p-1.5 text-secondary hover:bg-subtle hover:text-primary"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold text-primary">{range?.title ?? ''}</span>
        <div className="ml-auto w-full sm:w-56">
          <Select
            ariaLabel="Whose calendar"
            value={person}
            onChange={setPerson}
            options={[{ value: '', label: `Everyone in ${overview.department.name}` }, ...overview.people.map((p) => ({ value: p.id, label: p.name }))]}
          />
        </div>
      </div>

      {error && <ErrorNote onDismiss={() => void refetch()}>{error instanceof Error ? error.message : 'Could not load the calendar'}</ErrorNote>}

      <div className="overflow-x-auto rounded-card border border-border bg-white p-2">
        <div className="min-w-[44rem]">
          <CalendarWeekView
            items={items}
            timezone={data?.timezone ?? timezone}
            workingDays={data?.workingDays ?? [1, 2, 3, 4, 5, 6]}
            anchor={anchor}
            onRange={(r) => setRange((prev) => (prev?.from === r.from ? prev : r))}
            onItemClick={(item, rect) => setQuick({ item, rect })}
          />
        </div>
      </div>

      {quick && (
        <QuickView
          item={quick.item}
          anchor={quick.rect}
          onClose={() => setQuick(null)}
          onOpen={() => {
            const target = quick.item.eventId ? `/calendar?event=${quick.item.eventId}` : quick.item.link;
            setQuick(null);
            if (target) router.push(target);
          }}
        />
      )}
    </div>
  );
}
