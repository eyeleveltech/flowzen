'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { getInitials, getAvatarColor, formatShortDate } from '@/lib/utils';
import { BarChart2, Calendar } from 'lucide-react';

const ROW_HEIGHT = 56;
const SIDEBAR_WIDTH = 260;
const MONTH_COLUMN_WIDTH = 140;

import { getStatusColor, getStatusLabel } from '@/lib/status';

interface ProjectGanttViewProps {
  projects: any[];
  loading?: boolean;
}

export function ProjectGanttView({ projects, loading = false }: ProjectGanttViewProps) {
  const { minDate, maxDate, months } = useMemo(() => {
    if (!projects.length) return { minDate: new Date(), maxDate: new Date(), months: [] };

    let earliest = new Date();
    projects.forEach((p) => {
      const d = new Date(p.startDate || p.createdAt || new Date());
      if (d < earliest) earliest = d;
    });

    // Start 1 month prior to the earliest project start/creation
    earliest = new Date(earliest.getFullYear(), earliest.getMonth() - 1, 1);
    // End 4 months after today
    const paddedLatest = new Date(new Date().getFullYear(), new Date().getMonth() + 4, 0);

    const ms: Date[] = [];
    let cur = new Date(earliest);
    while (cur <= paddedLatest) {
      ms.push(new Date(cur));
      cur.setMonth(cur.getMonth() + 1);
    }
    return { minDate: earliest, maxDate: paddedLatest, months: ms };
  }, [projects]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-white p-8 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex gap-4 animate-pulse">
            <div className="h-10 w-44 bg-gray-100 rounded-lg" />
            <div className="h-10 bg-blue-50 rounded-full border border-blue-100" style={{ width: `${120 + i * 30}px`, marginLeft: `${i * 15}px` }} />
          </div>
        ))}
      </div>
    );
  }

  if (!projects.length) {
    return (
      <div className="rounded-2xl border border-border bg-white p-16 text-center">
        <BarChart2 className="h-10 w-10 text-gray-200 mx-auto mb-3" />
        <p className="text-sm text-secondary">No projects to display in the Gantt view.</p>
      </div>
    );
  }

  const today = new Date();
  const totalDuration = maxDate.getTime() - minDate.getTime();
  const chartWidth = months.length * MONTH_COLUMN_WIDTH;
  const totalContainerWidth = SIDEBAR_WIDTH + chartWidth;

  const todayRatio = Math.min(1, Math.max(0, (today.getTime() - minDate.getTime()) / totalDuration));
  const todayLeftPx = todayRatio * chartWidth;

  const sortedProjects = [...projects].sort((a, b) => {
    return new Date(a.startDate || a.createdAt || 0).getTime() - new Date(b.startDate || b.createdAt || 0).getTime();
  });

  return (
    <div className="rounded-2xl border border-border bg-white overflow-hidden shadow-sm" style={{ height: 600 }}>
      <div className="h-full overflow-auto custom-scrollbar">
        <div style={{ width: totalContainerWidth, minWidth: '100%' }}>

          {/* Header Row */}
          <div className="flex sticky top-0 z-30 border-b border-border h-12 bg-white">
            {/* Sidebar header cell – sticky left */}
            <div
              className="sticky left-0 z-40 bg-white border-r border-border flex items-center px-4 shrink-0 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]"
              style={{ width: SIDEBAR_WIDTH }}
            >
              <span className="text-[10px] font-bold text-secondary uppercase tracking-wider">Project Name</span>
            </div>

            {/* Month cells */}
            <div className="flex" style={{ width: chartWidth }}>
              {months.map((m, i) => {
                const isNow = m.getMonth() === today.getMonth() && m.getFullYear() === today.getFullYear();
                return (
                  <div
                    key={i}
                    style={{ width: MONTH_COLUMN_WIDTH }}
                    className={`shrink-0 px-3 flex items-center border-r text-[11px] font-semibold uppercase tracking-wider ${isNow ? 'text-primary bg-primary/5 border-primary/20' : 'text-secondary border-border'}`}
                  >
                    {m.toLocaleString('default', { month: 'short' })}
                    <span className="ml-1 font-normal opacity-60">{m.getFullYear()}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Data Rows ── */}
          <div className="relative">
            {/* Vertical grid lines (behind everything) */}
            <div
              className="absolute pointer-events-none"
              style={{ left: SIDEBAR_WIDTH, top: 0, bottom: 0, width: chartWidth, display: 'flex' }}
            >
              {months.map((m, i) => {
                const isNow = m.getMonth() === today.getMonth() && m.getFullYear() === today.getFullYear();
                return (
                  <div
                    key={i}
                    style={{ width: MONTH_COLUMN_WIDTH }}
                    className={`shrink-0 border-r ${isNow ? 'bg-primary/5 border-primary/10' : 'border-gray-100'}`}
                  />
                );
              })}
            </div>

            {/* Today vertical line (only in the chart area, not over sidebar) */}
            <div
              className="absolute top-0 bottom-0 pointer-events-none z-10"
              style={{ left: SIDEBAR_WIDTH + todayLeftPx }}
            >
              <div className="absolute inset-y-0 w-0.5 bg-primary/60" />
              <div className="absolute top-2 left-1.5 text-[10px] font-bold text-primary bg-white border border-primary/20 px-1.5 py-0.5 rounded shadow-sm whitespace-nowrap">
                Today
              </div>
            </div>

            {/* Project rows */}
            {sortedProjects.map((project) => {
              const cfg = getStatusColor(project.status);
              const label = getStatusLabel(project.status);
              const dateStr = project.startDate || project.createdAt;
              const start = dateStr ? new Date(dateStr) : null;
              
              let end = project.endDate ? new Date(project.endDate) : null;
              if (!end) {
                if (['COMPLETED', 'CANCELLED'].includes(project.status)) {
                  end = new Date(project.updatedAt || today);
                } else {
                  end = new Date(today.getFullYear(), today.getMonth() + 1, today.getDate());
                }
              }

              const startRatio = start ? Math.max(0, (start.getTime() - minDate.getTime()) / totalDuration) : 0;
              const endRatio = Math.min(1, Math.max(startRatio, (end.getTime() - minDate.getTime()) / totalDuration));
              
              const barLeftPx = startRatio * chartWidth;
              const barWidthPx = Math.max(36, (endRatio - startRatio) * chartWidth);
              const progressPct = Math.min(100, Math.max(0, project.progress ?? 0));

              return (
                <div
                  key={project.id}
                  className="flex relative group border-b border-surface-sunken"
                  style={{ height: ROW_HEIGHT }}
                >
                  {/* Sidebar cell – sticky left */}
                  <Link
                    href={`/projects/${project.id}`}
                    className="sticky left-0 z-20 bg-white border-r border-subtle flex items-center px-4 shrink-0 hover:bg-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]"
                    style={{ width: SIDEBAR_WIDTH }}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${cfg.dot}`} />
                      <div className={`h-7 w-7 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ${getAvatarColor(project.name)}`}>
                        {getInitials(project.name)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-primary truncate group-hover:text-primary/80 transition-colors leading-tight">
                          {project.name}
                        </p>
                        <p className="text-[10px] text-secondary truncate">{label} • {progressPct}% done</p>
                      </div>
                    </div>
                  </Link>

                  {/* Chart cell for this row */}
                  <div className="relative flex-1 overflow-hidden flex items-center" style={{ width: chartWidth }}>
                    {start && (
                      <Link
                        href={`/projects/${project.id}`}
                        title={`${project.name} (${label})\n${start ? formatShortDate(start.toISOString()) : ''} - ${end ? formatShortDate(end.toISOString()) : ''}\nProgress: ${progressPct}%`}
                        style={{ left: barLeftPx, width: barWidthPx }}
                        className={`absolute h-8 z-10 rounded-xl border flex items-center px-3 gap-2 transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary overflow-hidden ${cfg.bg} ${cfg.border}`}
                      >
                        {/* Progress Fill Background */}
                        <div
                          className="absolute inset-y-0 left-0 bg-primary/10 transition-all"
                          style={{ width: `${progressPct}%` }}
                        />

                        <Calendar className={`h-3.5 w-3.5 shrink-0 z-10 ${cfg.text}`} />
                        <span className={`text-xs font-bold truncate z-10 ${cfg.text}`}>
                          {project.name}
                        </span>
                        {progressPct > 0 && (
                          <span className={`text-[10px] font-semibold opacity-75 ml-auto shrink-0 z-10 ${cfg.text}`}>
                            {progressPct}%
                          </span>
                        )}
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
