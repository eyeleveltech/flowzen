'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { ChevronLeft, ChevronRight, Check, SlidersHorizontal } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { Drawer } from '@/components/ui/drawer';
import { useIsMobile } from '@/hooks/use-breakpoint';
import { ActiveFilterChip } from '@/components/ui/active-filter-chip';
import { getClientDisplayName, getInitials } from '@/lib/utils';
import { useAuthStore } from '@/stores';
import { useTeams } from '@/hooks/useQueries';

interface CalendarTask {
  id: string;
  title: string;
  dueDate: string;
  priority: string;
  status: string;
  type: string;
  project?: { id: string; name: string; color?: string } | null;
  lead?: { id: string; companyName?: string | null; contactName?: string | null } | null;
  assignee?: { id: string; name: string } | null;
}

interface Member { id: string; name: string; }
interface Project { id: string; name: string; }
interface Client { id: string; name: string; }

import { getPriorityDot } from '@/lib/priority';
import { Icon } from '@/components/ui/icon';

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
  const { data: teams = [] } = useTeams();
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>(isStaff && user?.id ? [user.id] : []);
  const [projectIdFilter, setProjectIdFilter] = useState<string[]>([]);
  const [clientIdFilter, setClientIdFilter] = useState<string[]>([]);
  const [departmentFilter, setDepartmentFilter] = useState<string[]>([]);
  const [hideDone, setHideDone] = useState(true);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const isMobile = useIsMobile();

  const year = date.getFullYear();
  const month = date.getMonth();
  const today = new Date();

  useEffect(() => {
    fetchTasks();
  }, [assigneeFilter, projectIdFilter, clientIdFilter, departmentFilter, hideDone, date, view]);

  useEffect(() => {
    if (!isStaff) {
      api.get<Member[]>('/team').then(setMembers).catch(() => { });
    }
    api.get<{ projects: Project[] }>('/projects').then(res => setProjects(res.projects || [])).catch(() => { });
    api.get<{ clients: Client[] }>('/clients').then(res => setClients(res.clients || [])).catch(() => { });
  }, [isStaff]);

  function fetchTasks() {
    const params = new URLSearchParams();
    params.set('limit', '500');
    if (assigneeFilter.length) params.set('assigneeId', assigneeFilter.join(','));
    else if (isStaff && user?.id) params.set('assigneeId', user.id);

    if (projectIdFilter.length) params.set('projectId', projectIdFilter.join(','));
    if (clientIdFilter.length) params.set('clientId', clientIdFilter.join(','));
    if (departmentFilter.length) params.set('teamId', departmentFilter.join(','));

    api.get<{ tasks: CalendarTask[] }>(`/tasks?${params}`)
      .then((d) => {
        let filtered = d.tasks.filter((t) => t.dueDate);
        if (hideDone) {
          filtered = filtered.filter((t) => t.status !== 'COMPLETED');
        }
        setTasks(filtered);
      })
      .catch(() => { });
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
    const pColor = t.project?.color || '#3B82F6';
    const subtext = t.project?.name || t.lead?.companyName || t.lead?.contactName || 'Lead Task';

    if (compact) {
      return (
        <div key={t.id} className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 border" style={{ backgroundColor: `${pColor}15`, borderColor: `${pColor}30` }}>
          <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${getPriorityDot(t.priority)}`} />
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
          <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${getPriorityDot(t.priority)}`} />
        </div>
        <div className="flex items-center justify-between text-secondary">
          <span className="truncate max-w-[80%]">{subtext}</span>
        </div>
      </div>
    );
  }

  const isMyTasksOnly = assigneeFilter.length === 1 && assigneeFilter[0] === user?.id;
  const isAssigneeOther = assigneeFilter.length > 0 && !isMyTasksOnly;

  const activeCount = (isMyTasksOnly ? 1 : 0) +
    (projectIdFilter.length > 0 ? 1 : 0) +
    (clientIdFilter.length > 0 ? 1 : 0) +
    (departmentFilter.length > 0 ? 1 : 0) +
    (isAssigneeOther ? 1 : 0) +
    (!hideDone ? 1 : 0);

  return (
    <div className="h-full flex flex-col space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-primary tracking-tight">Calendar</h1>
          <p className="text-sm text-secondary mt-1">Tasks and deadlines overview</p>
        </div>
      </div>

      {/* Redesigned Clean Calendar Toolbar */}
      <div className="bg-white border border-border rounded-2xl p-4 shadow-sm flex flex-col gap-4 w-full mb-6">
        {/* Row 1: Active Filter Pills */}
        {isMobile ? (
          <div className="flex flex-col gap-2.5 w-full">
            <div className="flex items-center justify-between gap-2 w-full">
              <button
                type="button"
                onClick={() => setFilterSheetOpen(true)}
                className="flex items-center gap-1.5 h-9 rounded-xl border border-border bg-white hover:bg-gray-50 px-3 text-xs font-semibold text-secondary shrink-0 transition-colors"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span>Filters</span>
                {activeCount > 0 && (
                  <span className="ml-0.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {activeCount}
                  </span>
                )}
              </button>

              {/* Active Chips Row */}
              {activeCount > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 ml-auto">
                  {isMyTasksOnly && <ActiveFilterChip label="My Tasks" onRemove={() => setAssigneeFilter([])} />}
                  {projectIdFilter.length > 0 && <ActiveFilterChip label={`Projects: ${projectIdFilter.length}`} onRemove={() => setProjectIdFilter([])} />}
                  {clientIdFilter.length > 0 && <ActiveFilterChip label={`Clients: ${clientIdFilter.length}`} onRemove={() => setClientIdFilter([])} />}
                  {departmentFilter.length > 0 && <ActiveFilterChip label={`Departments: ${departmentFilter.length}`} onRemove={() => setDepartmentFilter([])} />}
                  {isAssigneeOther && <ActiveFilterChip label={`Assignees: ${assigneeFilter.length}`} onRemove={() => setAssigneeFilter([])} />}
                  {!hideDone && <ActiveFilterChip label="Show Done" onRemove={() => setHideDone(true)} />}
                </div>
              )}
            </div>

            {/* Mobile Filter Drawer */}
            <Drawer isOpen={filterSheetOpen} onClose={() => setFilterSheetOpen(false)} title="Filter Calendar">
              <div className="p-4 space-y-4">
                <div>
                  <button
                    type="button"
                    onClick={() => setAssigneeFilter(assigneeFilter.length === 1 && assigneeFilter[0] === user?.id ? [] : (user?.id ? [user.id] : []))}
                    className={assigneeFilter.length === 1 && assigneeFilter[0] === user?.id
                      ? "w-full border border-primary bg-primary/5 text-primary h-9 rounded-xl px-3 text-xs font-semibold"
                      : "w-full h-9 rounded-xl border border-border bg-white text-secondary px-3 text-xs font-semibold"
                    }
                  >
                    My Tasks
                  </button>
                </div>
                <div>
                  <label className="text-xs font-medium text-secondary mb-1.5 block">Projects</label>
                  <MultiSelect
                    value={projectIdFilter}
                    onChange={setProjectIdFilter}
                    placeholder="Projects"
                    triggerClassName="w-full h-9 rounded-xl border border-border bg-white px-3 text-xs"
                    options={projects.map(p => ({ label: p.name, value: p.id }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-secondary mb-1.5 block">Clients / Owners</label>
                  <MultiSelect
                    value={clientIdFilter}
                    onChange={setClientIdFilter}
                    placeholder="Clients/Owners"
                    triggerClassName="w-full h-9 rounded-xl border border-border bg-white px-3 text-xs"
                    options={clients.map(c => ({ label: getClientDisplayName(c), value: c.id }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-secondary mb-1.5 block">Departments</label>
                  <MultiSelect
                    value={departmentFilter}
                    onChange={setDepartmentFilter}
                    placeholder="Departments"
                    triggerClassName="w-full h-9 rounded-xl border border-border bg-white px-3 text-xs"
                    options={teams.map((t: any) => ({ label: t.name, value: t.id }))}
                  />
                </div>
                {!isStaff && (
                  <div>
                    <label className="text-xs font-medium text-secondary mb-1.5 block">Assignees</label>
                    <MultiSelect
                      value={assigneeFilter}
                      onChange={setAssigneeFilter}
                      placeholder="Assignees"
                      triggerClassName="w-full h-9 rounded-xl border border-border bg-white px-3 text-xs"
                      options={members.map(m => ({ label: m.name, value: m.id, image: getInitials(m.name) }))}
                    />
                  </div>
                )}
                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <span className="text-xs font-semibold text-secondary">Hide Done Tasks</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={hideDone}
                    onClick={() => setHideDone(!hideDone)}
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${hideDone ? 'bg-primary border-primary' : 'bg-gray-200 border-gray-300'}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${hideDone ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              </div>
            </Drawer>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 w-full">
            <button
              onClick={() => setAssigneeFilter(assigneeFilter.length === 1 && assigneeFilter[0] === user?.id ? [] : (user?.id ? [user.id] : []))}
              className={assigneeFilter.length === 1 && assigneeFilter[0] === user?.id
                ? "border-primary bg-primary/5 text-primary h-9 rounded-xl px-3 text-xs font-semibold"
                : "h-9 rounded-xl border border-border bg-white hover:bg-gray-50 hover:border-gray-300 text-secondary px-3 text-xs transition-all"
              }
            >
              My Tasks
            </button>

            <div className="shrink-0">
              <MultiSelect
                value={projectIdFilter}
                onChange={setProjectIdFilter}
                placeholder="Projects"
                triggerClassName={projectIdFilter.length > 0 ? "border-primary bg-primary/5 text-primary h-9 rounded-xl px-3 text-xs font-semibold" : "h-9 rounded-xl border border-border bg-white hover:bg-gray-50 hover:border-gray-300 text-secondary px-3 text-xs transition-all"}
                options={projects.map(p => ({ label: p.name, value: p.id }))}
              />
            </div>

            <div className="shrink-0">
              <MultiSelect
                value={clientIdFilter}
                onChange={setClientIdFilter}
                placeholder="Clients/Owners"
                triggerClassName={clientIdFilter.length > 0 ? "border-primary bg-primary/5 text-primary h-9 rounded-xl px-3 text-xs font-semibold" : "h-9 rounded-xl border border-border bg-white hover:bg-gray-50 hover:border-gray-300 text-secondary px-3 text-xs transition-all"}
                options={clients.map(c => ({ label: getClientDisplayName(c), value: c.id }))}
              />
            </div>

            <div className="shrink-0">
              <MultiSelect
                value={departmentFilter}
                onChange={setDepartmentFilter}
                placeholder="Departments"
                triggerClassName={departmentFilter.length > 0 ? "border-primary bg-primary/5 text-primary h-9 rounded-xl px-3 text-xs font-semibold" : "h-9 rounded-xl border border-border bg-white hover:bg-gray-50 hover:border-gray-300 text-secondary px-3 text-xs transition-all"}
                options={teams.map((t: any) => ({ label: t.name, value: t.id }))}
              />
            </div>

            {!isStaff && (
              <div className="shrink-0">
                <MultiSelect
                  value={assigneeFilter}
                  onChange={setAssigneeFilter}
                  placeholder="Assignees"
                  triggerClassName={assigneeFilter.length > 0 ? "border-primary bg-primary/5 text-primary h-9 rounded-xl px-3 text-xs font-semibold" : "h-9 rounded-xl border border-border bg-white hover:bg-gray-50 hover:border-gray-300 text-secondary px-3 text-xs transition-all"}
                  options={members.map(m => ({ label: m.name, value: m.id, image: getInitials(m.name) }))}
                />
              </div>
            )}

            {/* Hide Done Tasks Checkbox */}
            <button
              type="button"
              onClick={() => setHideDone(!hideDone)}
              className="flex items-center gap-2 text-xs font-semibold text-secondary ml-auto cursor-pointer select-none h-9 px-1.5 rounded-lg hover:text-primary transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-1"
            >
              <div className={`flex items-center justify-center h-4 w-4 rounded-sm border transition-colors ${hideDone ? 'bg-primary border-primary' : 'border-line bg-white'}`}>
                {hideDone && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
              </div>
              Hide Done Tasks
            </button>
          </div>
        )}

        {/* Separator line */}
        <div className="h-px bg-border/60 w-full" />

        {/* Row 2: Navigation & switcher */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 w-full">
          {/* Left Spacer to push Navigation to Center */}
          <div className="hidden sm:block flex-1" />

          {/* Center Side: Navigation triggers inside calendar view */}
          <div className="flex items-center justify-center gap-2 flex-1 sm:flex-none">
            <button onClick={prevPeriod} className="p-2 rounded-xl hover:bg-gray-50 border border-border bg-white transition-colors h-9 w-9 flex items-center justify-center shrink-0">
              <Icon as={ChevronLeft} size="md" className="text-secondary" />
            </button>
            <div className="text-sm font-semibold text-primary px-2 min-w-36 text-center select-none">
              {view === 'month'
                ? date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
                : `Week of ${startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
              }
            </div>
            <button onClick={nextPeriod} className="p-2 rounded-xl hover:bg-gray-50 border border-border bg-white transition-colors h-9 w-9 flex items-center justify-center shrink-0">
              <Icon as={ChevronRight} size="md" className="text-secondary" />
            </button>
          </div>

          {/* Right Side: Segmented switcher */}
          <div className="flex justify-center sm:justify-end flex-1">
            <div className="flex bg-subtle p-1 rounded-xl gap-0.5 border border-border/50 shrink-0 h-9 items-center">
              <button
                type="button"
                onClick={() => setView('month')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all shrink-0 ${view === 'month' ? 'bg-white text-primary shadow-sm' : 'text-secondary hover:text-primary'}`}
              >
                Month
              </button>
              <button
                type="button"
                onClick={() => setView('week')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all shrink-0 ${view === 'week' ? 'bg-white text-primary shadow-sm' : 'text-secondary hover:text-primary'}`}
              >
                Week
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-white overflow-hidden">
        <div className="overflow-x-auto md:overflow-x-visible">
          <div className="min-w-full md:min-w-175">

            {/* Desktop Grid Headers */}
            <div className="hidden md:grid grid-cols-7 border-b border-subtle">
              {(view === 'month' ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : weekDays).map((d, i) => (
                <div key={i} className="px-2 py-2.5 text-center text-xs font-medium text-secondary uppercase tracking-wide">
                  {view === 'month' ? d as string : (d as Date).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })}
                </div>
              ))}
            </div>

            {/* Desktop Grid Body */}
            {view === 'month' && (
              <div className="hidden md:grid grid-cols-7">
                {days.map((day, i) => {
                  if (day === null) return <div key={i} className="min-h-27.5 border-b border-r border-subtle bg-surface" />;

                  const dObj = new Date(year, month, day);
                  const isToday = today.toDateString() === dObj.toDateString();
                  const dayTasks = getTasksForDate(dObj);

                  return (
                    <div key={i} className="min-h-27.5 border-b border-r border-subtle p-2 hover:bg-surface transition-colors">
                      <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium mb-1.5 ${isToday ? 'bg-primary text-white' : 'text-body'}`}>
                        {day}
                      </span>
                      <div className="space-y-1">
                        {dayTasks.slice(0, 3).map((t) => renderTaskPill(t, true))}
                        {dayTasks.length > 3 && (
                          <span className="text-xs text-secondary px-1 font-medium block mt-1">+{dayTasks.length - 3} more</span>
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
                    <div key={i} className="min-h-100 border-b border-r border-subtle p-2 hover:bg-surface transition-colors flex flex-col gap-2">
                      <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium self-center mb-2 ${isToday ? 'bg-primary text-white' : 'text-body'}`}>
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
                  return <div className="text-center text-sm text-secondary py-8 bg-white rounded-xl border border-border">No tasks scheduled for this period.</div>;
                }

                return agendaDays.map((day, i) => (
                  <div key={i} className="flex flex-col gap-3 bg-white p-4 rounded-xl border border-border">
                    <h3 className="text-sm font-semibold text-primary border-b border-subtle pb-2">
                      {day.date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                    </h3>
                    <div className="flex flex-col gap-2">
                      {day.tasks.map(t => {
                        const pColor = t.project?.color || '#3B82F6';
                        const subtext = t.project?.name || t.lead?.companyName || t.lead?.contactName || 'Lead Task';
                        return (
                          <div
                            key={t.id}
                            className="flex flex-col gap-1.5 rounded-lg px-3 py-2.5 border text-xs"
                            style={{ backgroundColor: `${pColor}10`, borderColor: `${pColor}30` }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium truncate" style={{ color: pColor }}>{t.title}</span>
                              <div className={`h-2 w-2 rounded-full shrink-0 ${getPriorityDot(t.priority)}`} />
                            </div>
                            <span className="text-secondary truncate">{subtext}</span>
                          </div>
                        );
                      })}
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
