'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { getInitials, getAvatarColor } from '@/lib/utils';
import { BarChart2, Calendar } from 'lucide-react';
import { format } from 'date-fns';

const ROW_HEIGHT = 56;
const SIDEBAR_WIDTH = 220;

const statusConfig: Record<string, { bar: string; text: string; dot: string; label: string }> = {
  PLANNING:    { bar: 'bg-violet-50 border-violet-200 hover:bg-violet-100', text: 'text-violet-700', dot: 'bg-violet-500', label: 'Planning' },
  IN_PROGRESS: { bar: 'bg-blue-50 border-blue-200 hover:bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500', label: 'In Progress' },
  REVIEW:      { bar: 'bg-amber-50 border-amber-200 hover:bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500', label: 'Review' },
  ON_HOLD:     { bar: 'bg-orange-50 border-orange-200 hover:bg-orange-100', text: 'text-orange-700', dot: 'bg-orange-500', label: 'On Hold' },
  COMPLETED:   { bar: 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'Completed' },
  CANCELLED:   { bar: 'bg-red-50 border-red-200 hover:bg-red-100', text: 'text-red-700', dot: 'bg-red-500', label: 'Cancelled' },
};

interface ProjectGanttViewProps {
  projects: any[];
  loading?: boolean;
}

export function ProjectGanttView({ projects, loading = false }: ProjectGanttViewProps) {
  const router = useRouter();

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
            <div className="h-10 w-36 bg-gray-100 rounded-lg" />
            <div className="h-10 bg-blue-50 rounded-full border border-blue-100" style={{ width: `${120 + i * 30}px`, marginLeft: `${i * 15}px` }} />
          </div>
        ))}
      </div>
    );
  }

  if (!projects.length) {
    return (
      <div className="rounded-2xl border border-border bg-white p-16 text-center">
        <BarChart2 className="w-10 h-10 text-gray-200 mx-auto mb-3" />
        <p className="text-sm text-secondary">No projects to display in the Gantt view.</p>
      </div>
    );
  }

  const today = new Date();
  const totalDuration = maxDate.getTime() - minDate.getTime();
  const todayPct = Math.min(100, Math.max(0, ((today.getTime() - minDate.getTime()) / totalDuration) * 100));

  const sortedProjects = [...projects].sort((a, b) => {
    return new Date(a.startDate || a.createdAt || 0).getTime() - new Date(b.startDate || b.createdAt || 0).getTime();
  });

  return (
    <div className="rounded-2xl border border-border bg-white overflow-hidden shadow-sm" style={{ height: 600 }}>
      <div className="h-full overflow-auto custom-scrollbar">
        <div style={{ minWidth: `${SIDEBAR_WIDTH + months.length * 140}px` }}>

          <div className="flex sticky top-0 z-30 border-b border-border h-12 bg-white">
            {/* Sidebar header cell – sticky left */}
            <div
              className="sticky left-0 z-40 bg-white border-r border-border flex items-center px-4 shrink-0"
              style={{ width: SIDEBAR_WIDTH }}
            >
              <span className="text-[10px] font-bold text-secondary uppercase tracking-wider">Project Name</span>
            </div>

            {/* Month cells */}
            {months.map((m, i) => {
              const isNow = m.getMonth() === today.getMonth() && m.getFullYear() === today.getFullYear();
              return (
                <div
                  key={i}
                  className={`flex-1 min-w-[100px] px-3 flex items-center border-r text-[11px] font-semibold uppercase tracking-wider ${isNow ? 'text-primary bg-primary/5 border-primary/20' : 'text-secondary border-border'}`}
                >
                  {m.toLocaleString('default', { month: 'short' })}
                  <span className="ml-1 font-normal opacity-60">{m.getFullYear()}</span>
                </div>
              );
            })}
          </div>

          {/* ── Data Rows ── */}
          <div className="relative">
            {/* Vertical grid lines (behind everything) */}
            <div className="absolute" style={{ left: SIDEBAR_WIDTH, top: 0, bottom: 0, right: 0, display: 'flex', pointerEvents: 'none' }}>
              {months.map((m, i) => {
                const isNow = m.getMonth() === today.getMonth() && m.getFullYear() === today.getFullYear();
                return (
                  <div
                    key={i}
                    className={`flex-1 min-w-[100px] border-r ${isNow ? 'bg-primary/5 border-primary/10' : 'border-gray-100'}`}
                  />
                );
              })}
            </div>

            {/* Today vertical line (only in the chart area, not over sidebar) */}
            <div
              className="absolute top-0 bottom-0 pointer-events-none z-10"
              style={{ left: `calc(${SIDEBAR_WIDTH}px + ${todayPct}% * (100% - ${SIDEBAR_WIDTH}px) / 100)` }}
            >
              <div className="absolute inset-y-0 w-[2px] bg-primary/60" />
              <div className="absolute top-2 left-2 text-[10px] font-bold text-primary bg-white border border-primary/20 px-1.5 py-0.5 rounded shadow-sm whitespace-nowrap">
                Today
              </div>
            </div>

            {/* Project rows */}
            {sortedProjects.map((project, idx) => {
              const cfg = statusConfig[project.status] || statusConfig['IN_PROGRESS'];
              const dateStr = project.startDate || project.createdAt;
              const start = dateStr ? new Date(dateStr) : null;
              // If project completed/cancelled, end date is the actual updatedAt. Otherwise default to endDate or today + 1 month.
              let end = project.endDate ? new Date(project.endDate) : null;
              if (!end) {
                if (['COMPLETED', 'CANCELLED'].includes(project.status)) {
                  end = new Date(project.updatedAt || today);
                } else {
                  end = new Date(today.getFullYear(), today.getMonth() + 1, today.getDate());
                }
              }

              const startPct = start ? Math.max(0, ((start.getTime() - minDate.getTime()) / totalDuration) * 100) : 0;
              const endPct = Math.min(100, ((end.getTime() - minDate.getTime()) / totalDuration) * 100);
              const widthPct = Math.max(0.5, endPct - startPct);

              return (
                <div
                  key={project.id}
                  className="flex relative group"
                  style={{ height: ROW_HEIGHT, borderBottom: '1px solid #F3F4F6' }}
                >
                  {/* Sidebar cell – sticky left */}
                  <div
                    className="sticky left-0 z-20 bg-white border-r border-[#F3F4F6] flex items-center px-4 shrink-0 cursor-pointer hover:bg-surface transition-colors"
                    style={{ width: SIDEBAR_WIDTH }}
                    onClick={() => router.push(`/projects/${project.id}`)}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
                      <div className={`h-7 w-7 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ${getAvatarColor(project.name)}`}>
                        {getInitials(project.name)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-primary truncate group-hover:text-primary/80 transition-colors leading-tight">
                          {project.name}
                        </p>
                        <p className="text-[10px] text-secondary truncate">{cfg.label}</p>
                      </div>
                    </div>
                  </div>

                  {/* Chart cell for this row */}
                  <div className="flex-1 relative overflow-hidden flex items-center">
                    {start && (
                      <motion.div
                        initial={{ opacity: 0, scaleX: 0.5 }}
                        animate={{ opacity: 1, scaleX: 1 }}
                        transition={{ delay: idx * 0.035, ease: 'easeOut' }}
                        style={{ originX: 'left', left: `${startPct}%`, width: `${widthPct}%`, minWidth: '160px' }}
                        className={`absolute h-8 z-10 rounded-xl border flex items-center px-3 gap-2 cursor-pointer transition-all group-hover:brightness-95 hover:shadow-md ${cfg.bar}`}
                        onClick={() => router.push(`/projects/${project.id}`)}
                      >
                        <Calendar className={`w-3.5 h-3.5 shrink-0 ${cfg.text}`} />
                        <span className={`text-xs font-bold truncate ${cfg.text}`}>
                          {project.name}
                        </span>
                      </motion.div>
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
