'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { getClientDisplayName, getInitials } from '@/lib/utils';
import { useAuthStore } from '@/stores';

interface CalendarTask {
  id: string;
  title: string;
  dueDate: string;
  priority: string;
  status: string;
  type: string;
  project: { id: string; name: string; color?: string };
  assignee?: { id: string; name: string };
}

interface Member { id: string; name: string; }
interface Project { id: string; name: string; }
interface Client { id: string; name: string; }

const priorityDots: Record<string, string> = {
  LOW: 'bg-gray-300', MEDIUM: 'bg-blue-400', HIGH: 'bg-orange-500', URGENT: 'bg-red-500',
};

export default function CalendarPage() {
  const { user } = useAuthStore();
  const isStaff = user?.role === 'TEAM_MEMBER';
  
  const [view, setView] = useState<'month' | 'week'>('month');
  const [date, setDate] = useState(new Date());
  
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  
  // Filters
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>(isStaff && user?.id ? [user.id] : []);
  const [projectIdFilter, setProjectIdFilter] = useState<string[]>([]);
  const [clientIdFilter, setClientIdFilter] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [hideDone, setHideDone] = useState(true);

  const year = date.getFullYear();
  const month = date.getMonth();
  const today = new Date();

  useEffect(() => {
    fetchTasks();
  }, [assigneeFilter, projectIdFilter, clientIdFilter, typeFilter, hideDone, date, view]);

  useEffect(() => {
    if (!isStaff) {
      api.get<Member[]>('/team').then(setMembers).catch(() => {});
    }
    api.get<{projects: Project[]}>('/projects').then(res => setProjects(res.projects || [])).catch(() => {});
    api.get<{clients: Client[]}>('/clients').then(res => setClients(res.clients || [])).catch(() => {});
  }, [isStaff]);

  function fetchTasks() {
    const params = new URLSearchParams();
    params.set('limit', '500');
    if (assigneeFilter.length) params.set('assigneeId', assigneeFilter.join(','));
    else if (isStaff && user?.id) params.set('assigneeId', user.id);

    if (projectIdFilter.length) params.set('projectId', projectIdFilter.join(','));
    if (clientIdFilter.length) params.set('clientId', clientIdFilter.join(','));
    if (typeFilter.length) params.set('type', typeFilter.join(','));

    api.get<{ tasks: CalendarTask[] }>(`/tasks?${params}`)
      .then((d) => {
        let filtered = d.tasks.filter((t) => t.dueDate);
        if (hideDone) {
          filtered = filtered.filter((t) => t.status !== 'COMPLETED');
        }
        setTasks(filtered);
      })
      .catch(() => {});
  }

  function prevPeriod() {
    if (view === 'month') setDate(new Date(year, month - 1, 1));
    else setDate(new Date(year, month, date.getDate() - 7));
  }
  function nextPeriod() {
    if (view === 'month') setDate(new Date(year, month + 1, 1));
    else setDate(new Date(year, month, date.getDate() + 7));
  }

  // Month Math
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days = Array.from({ length: 42 }, (_, i) => {
    const dayNum = i - firstDay + 1;
    if (dayNum < 1 || dayNum > daysInMonth) return null;
    return dayNum;
  });

  // Week Math
  const startOfWeek = new Date(date);
  startOfWeek.setDate(date.getDate() - date.getDay());
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    return d;
  });

  function getTasksForDate(d: Date) {
    return tasks.filter((t) => {
      const tDate = new Date(t.dueDate);
      return tDate.getFullYear() === d.getFullYear() && tDate.getMonth() === d.getMonth() && tDate.getDate() === d.getDate();
    });
  }

  function renderTaskPill(t: CalendarTask, compact: boolean = false) {
    const pColor = t.project.color || '#3B82F6';
    
    if (compact) {
      return (
        <div key={t.id} className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 border" style={{ backgroundColor: `${pColor}15`, borderColor: `${pColor}30` }}>
          <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${priorityDots[t.priority] || 'bg-gray-300'}`} />
          <span className="text-[10px] truncate font-medium" style={{ color: pColor }}>{t.title}</span>
        </div>
      );
    }
    
    return (
      <div 
        key={t.id} 
        className="flex flex-col gap-1 rounded-md px-2 py-1.5 border text-[10px] leading-tight"
        style={{ backgroundColor: `${pColor}15`, borderColor: `${pColor}30` }}
      >
        <div className="flex items-center justify-between gap-1">
          <span className="font-semibold truncate" style={{ color: pColor }}>{t.title}</span>
          <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${priorityDots[t.priority] || 'bg-gray-300'}`} />
        </div>
        <div className="flex items-center justify-between text-secondary">
           <span className="truncate max-w-[80%]">{t.project.name}</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-primary tracking-tight">Calendar</h1>
            <p className="text-sm text-secondary mt-1">Tasks and deadlines overview</p>
          </div>
          <div className="flex items-center gap-2 p-1 bg-[#F3F4F6] rounded-xl border border-border">
            <button 
              onClick={() => setView('month')} 
              className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-all ${view === 'month' ? 'bg-white text-primary shadow-sm' : 'text-secondary hover:text-primary'}`}
            >Month</button>
            <button 
              onClick={() => setView('week')} 
              className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-all ${view === 'week' ? 'bg-white text-primary shadow-sm' : 'text-secondary hover:text-primary'}`}
            >Week</button>
          </div>
        </div>
        
        {/* Filters Header */}
        <div className="flex flex-wrap items-center gap-3 p-4 bg-white border border-border rounded-2xl">
          <button
            onClick={() => setAssigneeFilter(assigneeFilter.length === 1 && assigneeFilter[0] === user?.id ? [] : (user?.id ? [user.id] : []))}
            className={`px-4 py-2 text-xs font-medium rounded-xl transition-all ${assigneeFilter.length === 1 && assigneeFilter[0] === user?.id ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-surface border border-border text-[#374151] hover:bg-[#F3F4F6]'}`}
          >
            My Tasks
          </button>

          <div className="w-44">
            <MultiSelect
              value={projectIdFilter}
              onChange={setProjectIdFilter}
              placeholder="All Projects"
              options={projects.map(p => ({ label: p.name, value: p.id }))}
            />
          </div>
          <div className="w-44">
            <MultiSelect
              value={clientIdFilter}
              onChange={setClientIdFilter}
              placeholder="All Clients"
              options={clients.map(c => ({ label: getClientDisplayName(c), value: c.id }))}
            />
          </div>
          <div className="w-44">
            <MultiSelect
              value={typeFilter}
              onChange={setTypeFilter}
              placeholder="All Types"
              options={[
                { label: 'Design', value: 'DESIGN' },
                { label: 'Content', value: 'CONTENT' },
                { label: 'Video', value: 'VIDEO' },
                { label: 'Digital Marketing', value: 'DIGITAL_MARKETING' },
                { label: 'Social Media', value: 'SOCIAL_MEDIA' },
                { label: 'Development', value: 'DEVELOPMENT' },
                { label: 'Strategy', value: 'STRATEGY' },
                { label: 'Business', value: 'BUSINESS' },
                { label: 'Other', value: 'OTHER' },
              ]}
            />
          </div>
          {!isStaff && (
            <div className="w-44">
              <MultiSelect
                value={assigneeFilter}
                onChange={setAssigneeFilter}
                placeholder="All Assignees"
                options={members.map(m => ({ label: m.name, value: m.id, image: getInitials(m.name) }))}
              />
            </div>
          )}
          <button
            type="button"
            onClick={() => setHideDone(!hideDone)}
            className="flex items-center gap-2 text-xs font-medium text-[#374151] ml-auto cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-primary/10 rounded-md"
          >
            <div className={`flex items-center justify-center w-4 h-4 rounded-[4px] border transition-colors ${hideDone ? 'bg-primary border-primary' : 'border-[#D1D5DB] bg-white'}`}>
              {hideDone && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
            </div>
            Hide Done Tasks
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-white overflow-hidden">
        <div className="overflow-x-auto md:overflow-x-visible">
          <div className="min-w-full md:min-w-[700px]">
            {/* Navigation */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6]">
              <button onClick={prevPeriod} className="p-2 rounded-xl hover:bg-[#F3F4F6] transition-colors">
                <ChevronLeft className="h-4 w-4 text-secondary" />
              </button>
              <h2 className="text-sm font-semibold text-primary">
                {view === 'month' 
                  ? date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
                  : `Week of ${startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                }
              </h2>
              <button onClick={nextPeriod} className="p-2 rounded-xl hover:bg-[#F3F4F6] transition-colors">
                <ChevronRight className="h-4 w-4 text-secondary" />
              </button>
            </div>

            {/* Desktop Grid Headers */}
            <div className="hidden md:grid grid-cols-7 border-b border-[#F3F4F6]">
              {(view === 'month' ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : weekDays).map((d, i) => (
                <div key={i} className="px-2 py-2.5 text-center text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
                  {view === 'month' ? d as string : (d as Date).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })}
                </div>
              ))}
            </div>

            {/* Desktop Grid Body */}
            {view === 'month' && (
              <div className="hidden md:grid grid-cols-7">
                {days.map((day, i) => {
                  if (day === null) return <div key={i} className="min-h-[110px] border-b border-r border-[#F3F4F6] bg-surface" />;

                  const dObj = new Date(year, month, day);
                  const isToday = today.toDateString() === dObj.toDateString();
                  const dayTasks = getTasksForDate(dObj);

                  return (
                    <div key={i} className="min-h-[110px] border-b border-r border-[#F3F4F6] p-2 hover:bg-[#F9FAFB] transition-colors">
                      <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium mb-1.5 ${isToday ? 'bg-primary text-white' : 'text-[#374151]'}`}>
                        {day}
                      </span>
                      <div className="space-y-1">
                        {dayTasks.slice(0, 3).map((t) => renderTaskPill(t, true))}
                        {dayTasks.length > 3 && (
                          <span className="text-[10px] text-[#9CA3AF] px-1 font-medium block mt-1">+{dayTasks.length - 3} more</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {view === 'week' && (
              <div className="hidden md:grid grid-cols-7">
                {weekDays.map((dObj, i) => {
                  const isToday = today.toDateString() === dObj.toDateString();
                  const dayTasks = getTasksForDate(dObj);

                  return (
                    <div key={i} className="min-h-100 border-b border-r border-[#F3F4F6] p-2 hover:bg-[#F9FAFB] transition-colors flex flex-col gap-2">
                      <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium self-center mb-2 ${isToday ? 'bg-primary text-white' : 'text-[#374151]'}`}>
                        {dObj.getDate()}
                      </span>
                      {dayTasks.map((t) => renderTaskPill(t, false))}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Mobile View (Agenda) */}
            <div className="md:hidden flex flex-col p-4 gap-6 bg-surface min-h-100">
              {(() => {
                const daysToRender = view === 'month' 
                  ? days.filter(d => d !== null).map(d => new Date(year, month, d as number))
                  : weekDays;
                
                const agendaDays = daysToRender.map(dObj => ({
                  date: dObj,
                  tasks: getTasksForDate(dObj)
                })).filter(day => day.tasks.length > 0);

                if (agendaDays.length === 0) {
                  return <div className="text-center text-sm text-[#9CA3AF] py-8 bg-white rounded-xl border border-border">No tasks scheduled for this period.</div>;
                }

                return agendaDays.map((day, i) => (
                  <div key={i} className="flex flex-col gap-3 bg-white p-4 rounded-xl border border-border">
                    <h3 className="text-sm font-semibold text-primary border-b border-[#F3F4F6] pb-2">
                      {day.date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                    </h3>
                    <div className="flex flex-col gap-2">
                      {day.tasks.map(t => (
                        <div 
                          key={t.id} 
                          className="flex flex-col gap-1.5 rounded-lg px-3 py-2.5 border text-xs"
                          style={{ backgroundColor: `${t.project.color || '#3B82F6'}10`, borderColor: `${t.project.color || '#3B82F6'}30` }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium truncate" style={{ color: t.project.color || '#3B82F6' }}>{t.title}</span>
                            <div className={`h-2 w-2 rounded-full shrink-0 ${priorityDots[t.priority] || 'bg-gray-300'}`} />
                          </div>
                          <span className="text-secondary truncate">{t.project.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ));
              })()}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
