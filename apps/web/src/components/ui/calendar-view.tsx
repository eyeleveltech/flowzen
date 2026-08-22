'use client';

import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';

export interface CalendarEvent {
  id: string;
  title: string;
  date: string | null; // ISO string e.g. "2026-08-18T00:00:00.000Z"
  status?: string;
  priority?: string;
  subtitle?: string;
  onClick?: () => void;
}

interface CalendarViewProps {
  events: CalendarEvent[];
  onEventClick?: (event: CalendarEvent) => void;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CalendarView({ events, onEventClick }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDayOfMonth = new Date(year, month, 1);
  const startingDayOfWeek = firstDayOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const prevMonthDays = new Date(year, month, 0).getDate();

  const prevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const todayDate = today.getDate();

  // Map events to date key YYYY-MM-DD
  const eventsByDate: Record<string, CalendarEvent[]> = {};

  events.forEach((ev) => {
    if (!ev.date) return;
    let key = '';
    if (typeof ev.date === 'string' && ev.date.includes('T')) {
      key = ev.date.split('T')[0];
    } else if (typeof ev.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ev.date)) {
      key = ev.date;
    } else {
      const d = new Date(ev.date);
      if (isNaN(d.getTime())) return;
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    if (!eventsByDate[key]) eventsByDate[key] = [];
    eventsByDate[key].push(ev);
  });

  // Generate calendar grid cells (35 or 42 cells: 5 or 6 rows * 7 cols)
  const cells = [];
  
  // Previous month padding cells
  for (let i = startingDayOfWeek - 1; i >= 0; i--) {
    const dayNum = prevMonthDays - i;
    cells.push({ day: dayNum, currentMonth: false, key: `prev-${dayNum}` });
  }

  // Current month cells
  for (let d = 1; d <= daysInMonth; d++) {
    const keyStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({
      day: d,
      currentMonth: true,
      key: keyStr,
      dateKey: keyStr,
      isToday: isCurrentMonth && d === todayDate,
    });
  }

  // Next month padding cells to complete 35 or 42 grid cells
  const remainder = cells.length % 7;
  const padToWeek = remainder === 0 ? 0 : 7 - remainder;
  const totalCount = cells.length + padToWeek;
  const targetTotal = totalCount <= 35 ? 35 : 42;
  const padNext = targetTotal - cells.length;

  for (let n = 1; n <= padNext; n++) {
    cells.push({ day: n, currentMonth: false, key: `next-${n}` });
  }

  return (
    <div className="rounded-xl border border-border bg-white overflow-hidden">
      {/* Calendar Header / Toolbar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-surface">
        <div className="flex items-center gap-2">
          <CalendarIcon className="h-5 w-5 text-indigo-600" />
          <h2 className="text-base font-bold text-primary">
            {MONTH_NAMES[month]} {year}
          </h2>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setCurrentDate(new Date())}
            className="px-3 py-1.5 text-xs font-semibold text-primary bg-white border border-border rounded-lg hover:bg-subtle transition-colors mr-2"
          >
            Today
          </button>
          <button
            onClick={prevMonth}
            className="p-1.5 text-secondary hover:text-primary hover:bg-subtle rounded-lg border border-border transition-colors"
            title="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={nextMonth}
            className="p-1.5 text-secondary hover:text-primary hover:bg-subtle rounded-lg border border-border transition-colors"
            title="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Weekday Labels Header */}
      <div className="grid grid-cols-7 border-b border-border bg-surface/50 text-center text-xs font-semibold text-secondary py-2.5">
        {WEEKDAYS.map((wd) => (
          <div key={wd}>{wd}</div>
        ))}
      </div>

      {/* Grid Days */}
      <div className="grid grid-cols-7 auto-rows-fr divide-x divide-y divide-border bg-border">
        {cells.map((cell) => {
          const dayEvents = cell.dateKey ? eventsByDate[cell.dateKey] ?? [] : [];

          return (
            <div
              key={cell.key}
              className={`min-h-28 p-2 bg-white flex flex-col justify-start transition-colors ${
                !cell.currentMonth ? 'bg-surface/30 opacity-50' : ''
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    cell.isToday
                      ? 'bg-indigo-600 text-white font-bold'
                      : cell.currentMonth
                      ? 'text-primary'
                      : 'text-secondary'
                  }`}
                >
                  {cell.day}
                </span>
                {dayEvents.length > 0 && (
                  <span className="text-[10px] font-bold text-secondary">
                    {dayEvents.length}
                  </span>
                )}
              </div>

              {/* Event Cards in Day Cell */}
              <div className="space-y-1 overflow-y-auto max-h-24">
                {dayEvents.map((ev) => (
                  <div
                    key={ev.id}
                    onClick={() => (ev.onClick ? ev.onClick() : onEventClick?.(ev))}
                    className="cursor-pointer rounded-lg bg-blue-50 border border-blue-200 px-2 py-1 text-xs text-blue-900 font-medium hover:bg-blue-100 transition-colors truncate"
                    title={`${ev.title} ${ev.subtitle ? `(${ev.subtitle})` : ''}`}
                  >
                    <p className="truncate font-semibold text-[11px] leading-tight">{ev.title}</p>
                    {ev.subtitle && (
                      <p className="truncate text-[10px] text-blue-700">{ev.subtitle}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
