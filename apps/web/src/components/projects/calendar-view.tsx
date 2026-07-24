'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  format, addMonths, subMonths, startOfMonth, endOfMonth,
  startOfWeek, endOfWeek, addDays, isSameMonth, isSameDay, isToday
} from 'date-fns';
import { ChevronLeft, ChevronRight, PlayCircle, Flag, MapPin } from 'lucide-react';
import { motion } from 'framer-motion';

interface CalendarViewProps {
  projects: any[];
}

interface CalendarEvent {
  id: string;
  title: string;
  date: Date;
  type: 'PROJECT_START' | 'PROJECT_DUE' | 'MILESTONE';
  status?: string;
  projectId: string;
  completed?: boolean;
}

const statusColors: Record<string, string> = {
  PLANNING: 'bg-violet-100 text-violet-700 border-violet-200',
  IN_PROGRESS: 'bg-blue-100 text-blue-700 border-blue-200',
  REVIEW: 'bg-amber-100 text-amber-700 border-amber-200',
  COMPLETED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  ON_HOLD: 'bg-orange-100 text-orange-700 border-orange-200',
  CANCELLED: 'bg-red-100 text-red-700 border-red-200',
  TODO: 'bg-slate-100 text-slate-700 border-slate-200',
  BLOCKED: 'bg-red-100 text-red-700 border-red-200',
};

export function CalendarView({ projects }: CalendarViewProps) {
  const router = useRouter();
  const [currentDate, setCurrentDate] = useState(new Date());

  const events = useMemo(() => {
    const allEvents: CalendarEvent[] = [];
    projects.forEach(p => {
      if (p.startDate) {
        allEvents.push({
          id: `p-start-${p.id}`, title: p.name, date: new Date(p.startDate), type: 'PROJECT_START', projectId: p.id, status: p.status
        });
      }
      if (p.endDate) {
        allEvents.push({
          id: `p-end-${p.id}`, title: p.name, date: new Date(p.endDate), type: 'PROJECT_DUE', projectId: p.id, status: p.status
        });
      }
      if (p.milestones) {
        p.milestones.forEach((m: any) => {
          if (m.dueDate) {
            allEvents.push({
              id: `m-${m.id}`, title: m.name, date: new Date(m.dueDate), type: 'MILESTONE', projectId: p.id, completed: m.completed
            });
          }
        });
      }
    });
    return allEvents.sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [projects]);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);

  const days: Date[] = [];
  let day = startDate;
  while (day <= endDate) {
    days.push(day);
    day = addDays(day, 1);
  }

  const getEventsForDay = (date: Date) => events.filter(e => isSameDay(e.date, date));

  return (
    <div className="rounded-2xl border border-border bg-white overflow-hidden flex flex-col h-[800px]">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6] bg-white">
        <h2 className="text-lg font-bold text-primary">{format(currentDate, 'MMMM yyyy')}</h2>
        <div className="flex items-center gap-2">
          <button onClick={() => setCurrentDate(new Date())} className="px-3 py-1.5 text-xs font-medium text-[#374151] border border-border rounded-lg hover:bg-[#F9FAFB] transition-colors">
            Today
          </button>
          <div className="flex items-center rounded-lg border border-border p-0.5">
            <button onClick={() => setCurrentDate(subMonths(currentDate, 1))} className="p-1.5 hover:bg-[#F3F4F6] rounded-md transition-colors">
              <ChevronLeft className="h-4 w-4 text-secondary" />
            </button>
            <button onClick={() => setCurrentDate(addMonths(currentDate, 1))} className="p-1.5 hover:bg-[#F3F4F6] rounded-md transition-colors">
              <ChevronRight className="h-4 w-4 text-secondary" />
            </button>
          </div>
        </div>
      </div>

      {/* Desktop Day Headers */}
      <div className="hidden md:grid grid-cols-7 border-b border-[#F3F4F6] bg-surface">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
          <div key={day} className="px-2 py-3 text-center text-xs font-medium text-secondary uppercase">
            {day}
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Desktop Grid View */}
        <div className="hidden md:grid grid-cols-7 auto-rows-[minmax(120px,1fr)] h-full">
          {days.map((date, i) => {
            const dayEvents = getEventsForDay(date);
            const isCurrentMonth = isSameMonth(date, monthStart);
            const today = isToday(date);

            return (
              <div key={date.toISOString()} className={`min-h-30 border-b border-r border-[#F3F4F6] p-2 transition-colors ${!isCurrentMonth ? 'bg-surface/50 opacity-50' : 'bg-white hover:bg-[#F9FAFB]'}`}>
                <div className="flex justify-between items-center mb-1.5">
                  <span className={`text-xs font-medium h-6 w-6 flex items-center justify-center rounded-full ${today ? 'bg-primary text-white' : 'text-[#374151]'}`}>
                    {format(date, 'd')}
                  </span>
                  {dayEvents.length > 0 && (
                    <span className="text-[10px] text-muted font-medium">{dayEvents.length} items</span>
                  )}
                </div>
                
                <div className="space-y-1.5 overflow-y-auto max-h-[140px] pr-1 custom-scrollbar">
                  {dayEvents.map(event => {
                    const isProject = event.type === 'PROJECT_START' || event.type === 'PROJECT_DUE';
                    const Icon = event.type === 'PROJECT_START' ? PlayCircle : event.type === 'PROJECT_DUE' ? Flag : MapPin;
                    return (
                    <motion.div
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      key={event.id}
                      onClick={() => router.push(`/projects/${event.projectId}`)}
                      className={`px-2.5 py-1.5 text-xs rounded-lg border cursor-pointer hover:shadow-md transition-all truncate group
                        ${event.type === 'MILESTONE' ? (event.completed ? 'bg-emerald-50 text-emerald-700 border-emerald-100 opacity-70 line-through' : 'bg-emerald-100 text-emerald-800 border-emerald-200 shadow-sm') : ''}
                        ${isProject ? (statusColors[event.status || ''] || 'bg-gray-100 text-gray-700 border-gray-200 shadow-sm') : ''}
                      `}
                      title={event.title}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <Icon className={`h-3.5 w-3.5 shrink-0 ${event.type === 'PROJECT_START' ? 'text-blue-500' : event.type === 'PROJECT_DUE' ? 'text-red-500' : 'text-emerald-600'}`} />
                        <span className="truncate font-medium">{event.title}</span>
                      </div>
                    </motion.div>
                  )})}
                </div>
              </div>
            );
          })}
        </div>

        {/* Mobile Agenda View */}
        <div className="md:hidden flex flex-col p-4 gap-4">
          {days.filter(d => getEventsForDay(d).length > 0).length === 0 ? (
            <div className="text-center text-sm text-muted py-8">No scheduled events this month</div>
          ) : (
            days.filter(d => isSameMonth(d, monthStart) && getEventsForDay(d).length > 0).map(date => {
              const dayEvents = getEventsForDay(date);
              const today = isToday(date);
              return (
                <div key={date.toISOString()} className="flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <div className={`flex flex-col items-center justify-center h-12 w-12 rounded-xl shrink-0 ${today ? 'bg-primary text-white shadow-sm' : 'bg-surface border border-border text-primary'}`}>
                      <span className="text-[10px] font-bold uppercase tracking-wider opacity-80 leading-none mb-1">{format(date, 'EEE')}</span>
                      <span className="text-lg font-bold leading-none">{format(date, 'd')}</span>
                    </div>
                    <div className="h-px bg-border flex-1" />
                  </div>
                  <div className="flex flex-col gap-2 pl-[3.25rem]">
                    {dayEvents.map(event => {
                      const isProject = event.type === 'PROJECT_START' || event.type === 'PROJECT_DUE';
                      const Icon = event.type === 'PROJECT_START' ? PlayCircle : event.type === 'PROJECT_DUE' ? Flag : MapPin;
                      return (
                        <div
                          key={event.id}
                          onClick={() => router.push(`/projects/${event.projectId}`)}
                          className={`p-3 text-sm rounded-xl border cursor-pointer active:scale-[0.98] transition-all
                            ${event.type === 'MILESTONE' ? (event.completed ? 'bg-emerald-50 text-emerald-700 border-emerald-100 opacity-70 line-through' : 'bg-emerald-100 text-emerald-800 border-emerald-200 shadow-sm') : ''}
                            ${isProject ? (statusColors[event.status || ''] || 'bg-gray-100 text-gray-700 border-gray-200 shadow-sm') : ''}
                          `}
                        >
                          <div className="flex items-center gap-2">
                            <Icon className={`h-4 w-4 shrink-0 ${event.type === 'PROJECT_START' ? 'text-blue-500' : event.type === 'PROJECT_DUE' ? 'text-red-500' : 'text-emerald-600'}`} />
                            <span className="font-semibold">{event.title}</span>
                          </div>
                          <span className="text-[10px] uppercase tracking-wider font-bold opacity-60 ml-6 mt-1 block">
                            {event.type.replace('_', ' ')}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #E5E7EB;
          border-radius: 4px;
        }
        .custom-scrollbar:hover::-webkit-scrollbar-thumb {
          background: #D1D5DB;
        }
      `}</style>
    </div>
  );
}
