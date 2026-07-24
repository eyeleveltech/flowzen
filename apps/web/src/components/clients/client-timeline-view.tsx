'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { getClientDisplayName, getInitials, getAvatarColor, formatDate } from '@/lib/utils';
import { CalendarDays } from 'lucide-react';

import { getStatusColor } from '@/lib/status';

export function ClientTimelineView({ clients, loading }: { clients: any[]; loading: boolean }) {
  const router = useRouter();

  const { minDate, maxDate, months } = useMemo(() => {
    if (!clients.length) return { minDate: new Date(), maxDate: new Date(), months: [] };

    let earliest = new Date();
    let latest = new Date();

    clients.forEach((c) => {
      const dateStr = c.startDate || c.createdAt;
      if (!dateStr) return;
      const d = new Date(dateStr);
      if (d < earliest) earliest = d;
      if (d > latest) latest = d;
    });

    earliest = new Date(earliest.getFullYear(), earliest.getMonth() - 1, 1);
    latest = new Date(latest.getFullYear(), latest.getMonth() + 2, 0);

    const ms: Date[] = [];
    let current = new Date(earliest);
    while (current <= latest) {
      ms.push(new Date(current));
      current.setMonth(current.getMonth() + 1);
    }

    return { minDate: earliest, maxDate: latest, months: ms };
  }, [clients]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-white p-8 space-y-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 animate-pulse">
            <div className="h-4 w-20 bg-gray-100 rounded" />
            <div className="h-3 w-3 rounded-full bg-gray-200 shrink-0" />
            <div className="h-9 rounded-lg bg-gray-100" style={{ width: `${100 + i * 40}px` }} />
          </div>
        ))}
      </div>
    );
  }

  if (!clients.length) {
    return (
      <div className="rounded-2xl border border-border bg-white p-16 text-center">
        <CalendarDays className="w-10 h-10 text-gray-200 mx-auto mb-3" />
        <p className="text-sm text-secondary">No clients to display on the timeline.</p>
      </div>
    );
  }

  const totalDuration = maxDate.getTime() - minDate.getTime();
  const todayPct = ((new Date().getTime() - minDate.getTime()) / totalDuration) * 100;

  return (
    <div className="rounded-2xl border border-border bg-white overflow-hidden" style={{ height: 600 }}>
      <div className="flex h-full">
        {/* Frozen left label column */}
        <div className="w-44 shrink-0 border-r border-border flex flex-col bg-surface z-20">
          {/* Header spacer */}
          <div className="h-11 border-b border-border shrink-0 flex items-center px-4">
            <span className="text-[10px] font-semibold text-secondary uppercase tracking-widest">Client</span>
          </div>
          {/* Rows */}
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {clients.map((client) => (
              <div
                key={client.id}
                className="h-16 px-4 flex items-center border-b border-[#F3F4F6] hover:bg-white cursor-pointer transition-colors group"
                onClick={() => router.push(`/clients/${client.id}`)}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={`h-7 w-7 rounded-full text-[10px] font-semibold flex items-center justify-center shrink-0 ${getAvatarColor(getClientDisplayName(client))}`}>
                    {getInitials(getClientDisplayName(client))}
                  </div>
                  <span className="text-sm font-medium text-primary truncate group-hover:text-blue-600 transition-colors">
                    {getClientDisplayName(client)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Scrollable chart area */}
        <div className="flex-1 overflow-auto custom-scrollbar relative">
          <div style={{ minWidth: `${months.length * 140}px` }} className="w-full min-h-full">
            {/* Month headers */}
            <div className="flex sticky top-0 z-30 bg-surface border-b border-border h-11">
              {months.map((m, i) => {
                const isCurrentMonth = m.getMonth() === new Date().getMonth() && m.getFullYear() === new Date().getFullYear();
                return (
                  <div
                    key={i}
                    className={`flex-1 min-w-25 px-3 flex items-center border-r border-border text-[11px] font-semibold uppercase tracking-wider ${isCurrentMonth ? 'text-blue-600 bg-blue-50/60' : 'text-secondary'}`}
                  >
                    {m.toLocaleString('default', { month: 'short' })}
                    <span className="ml-1 opacity-60 font-normal">{m.getFullYear()}</span>
                  </div>
                );
              })}
            </div>

            {/* Grid + rows */}
            <div className="relative">
              {/* Vertical grid lines */}
              <div className="absolute inset-0 flex pointer-events-none">
                {months.map((m, i) => {
                  const isCurrentMonth = m.getMonth() === new Date().getMonth() && m.getFullYear() === new Date().getFullYear();
                  return (
                    <div
                      key={i}
                      className={`flex-1 min-w-25 border-r ${isCurrentMonth ? 'bg-blue-50/30 border-blue-100' : 'border-gray-100'}`}
                    />
                  );
                })}
              </div>

              {/* Today indicator */}
              {todayPct >= 0 && todayPct <= 100 && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-blue-500/70 z-10 pointer-events-none"
                  style={{ left: `${todayPct}%` }}
                >
                  <div className="absolute top-2 -left-4.5 text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-md shadow-sm whitespace-nowrap z-10">
                    Today
                  </div>
                </div>
              )}

              {/* Client rows */}
              {clients.map((client, idx) => {
                const dateStr = client.startDate || client.createdAt;
                if (!dateStr) return <div key={client.id} className="h-16 border-b border-[#F3F4F6]" />;
                const d = new Date(dateStr);
                const pct = ((d.getTime() - minDate.getTime()) / totalDuration) * 100;
                const cfg = getStatusColor(client.status);

                return (
                  <motion.div
                    key={client.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className="h-16 border-b border-[#F3F4F6] flex items-center relative group"
                  >
                    {/* Horizontal connector line */}
                    <div
                      className="absolute top-1/2 h-px bg-gray-200"
                      style={{ left: 0, width: `${pct}%` }}
                    />

                    {/* Milestone point */}
                    <div
                      className="absolute -translate-y-1/2 top-1/2 z-10"
                      style={{ left: `${pct}%` }}
                    >
                      <div className={`w-2.5 h-2.5 rounded-full border-2 border-white shadow-md ${cfg.dot} ring-2 ring-offset-1 ring-white`} />
                    </div>

                    {/* Floating label */}
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: idx * 0.03 + 0.1 }}
                      className={`absolute ml-4 z-20 flex items-center gap-2 px-3 py-1.5 rounded-lg border shadow-sm cursor-pointer hover:shadow-md transition-all ${cfg.bg}`}
                      style={{ left: `${pct}%` }}
                      onClick={() => router.push(`/clients/${client.id}`)}
                    >
                      <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                      <span className="text-xs font-medium text-primary whitespace-nowrap">
                        {formatDate(d)}
                      </span>
                      <span className={`text-[10px] font-semibold`}>{cfg.label}</span>
                    </motion.div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
