'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { ChevronLeft, ChevronRight, User } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { useAuthStore } from '@/stores';

interface CalendarTask {
  id: string; title: string; dueDate: string; priority: string; status: string;
  project: { id: string; name: string };
}

interface Member { id: string; name: string; }

const priorityDots: Record<string, string> = {
  LOW: 'bg-gray-300', MEDIUM: 'bg-blue-400', HIGH: 'bg-orange-500', URGENT: 'bg-red-500',
};

export default function CalendarPage() {
  const { user } = useAuthStore();
  const isStaff = user?.role === 'TEAM_MEMBER';
  
  const [date, setDate] = useState(new Date());
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState(isStaff ? (user?.id || '') : '');

  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  useEffect(() => {
    fetchTasks();
  }, [assigneeFilter]);

  useEffect(() => {
    if (!isStaff) {
      api.get<Member[]>('/team').then(setMembers).catch(() => {});
    }
  }, [isStaff]);

  function fetchTasks() {
    const params = new URLSearchParams();
    params.set('limit', '200');
    if (assigneeFilter) params.set('assigneeId', assigneeFilter);
    else if (isStaff && user?.id) params.set('assigneeId', user.id); // Fallback safeguard

    api.get<{ tasks: CalendarTask[] }>(`/tasks?${params}`)
      .then((d) => setTasks(d.tasks.filter((t) => t.dueDate)))
      .catch(() => {});
  }

  function prevMonth() { setDate(new Date(year, month - 1, 1)); }
  function nextMonth() { setDate(new Date(year, month + 1, 1)); }

  const days = Array.from({ length: 42 }, (_, i) => {
    const dayNum = i - firstDay + 1;
    if (dayNum < 1 || dayNum > daysInMonth) return null;
    return dayNum;
  });

  function getTasksForDay(day: number) {
    return tasks.filter((t) => {
      const d = new Date(t.dueDate!);
      return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
    });
  }

  const monthName = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[#111827] tracking-tight">Calendar</h1>
          <p className="text-sm text-[#6B7280] mt-1">Tasks and deadlines overview</p>
        </div>
        {!isStaff && (
          <div className="w-64">
            <Select
              value={assigneeFilter}
              onChange={(val) => setAssigneeFilter(val)}
              options={[
                { label: 'All Team Members', value: '' },
                ...members.map((m) => ({ label: m.name, value: m.id }))
              ]}
            />
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-[#E5E7EB] bg-white overflow-hidden">
        {/* Month Navigation */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6]">
          <button onClick={prevMonth} className="p-2 rounded-xl hover:bg-[#F3F4F6] transition-colors">
            <ChevronLeft className="h-4 w-4 text-[#6B7280]" />
          </button>
          <h2 className="text-sm font-semibold text-[#111827]">{monthName}</h2>
          <button onClick={nextMonth} className="p-2 rounded-xl hover:bg-[#F3F4F6] transition-colors">
            <ChevronRight className="h-4 w-4 text-[#6B7280]" />
          </button>
        </div>

        {/* Day Headers */}
        <div className="grid grid-cols-7 border-b border-[#F3F4F6]">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <div key={d} className="px-2 py-2.5 text-center text-xs font-medium text-[#9CA3AF] uppercase tracking-wider">
              {d}
            </div>
          ))}
        </div>

        {/* Days Grid */}
        <div className="grid grid-cols-7">
          {days.map((day, i) => {
            if (day === null) return <div key={i} className="min-h-[100px] border-b border-r border-[#F3F4F6] bg-[#FAFAFA]" />;

            const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
            const dayTasks = getTasksForDay(day);

            return (
              <div key={i} className="min-h-[100px] border-b border-r border-[#F3F4F6] p-2">
                <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${isToday ? 'bg-[#111827] text-white' : 'text-[#374151]'}`}>
                  {day}
                </span>
                <div className="mt-1 space-y-0.5">
                  {dayTasks.slice(0, 3).map((t) => (
                    <div key={t.id} className="flex items-center gap-1 rounded-md bg-[#F3F4F6] px-1.5 py-0.5">
                      <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${priorityDots[t.priority]}`} />
                      <span className="text-[10px] text-[#374151] truncate">{t.title}</span>
                    </div>
                  ))}
                  {dayTasks.length > 3 && (
                    <span className="text-[10px] text-[#9CA3AF] px-1.5">+{dayTasks.length - 3} more</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
