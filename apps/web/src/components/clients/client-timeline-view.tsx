'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
        <CalendarDays className="h-10 w-10 text-gray-200 mx-auto mb-3" />
        <p className="text-sm text-secondary">No clients to display on the timeline.</p>
      </div>
    );
  }

  const totalDuration = maxDate.getTime() - minDate.getTime();
  const todayPct = ((new Date().getTime() - minDate.getTime()) / totalDuration) * 100;

  const sortedClients = [...clients].sort((a, b) => {
    const da = new Date(a.startDate || a.createdAt || 0).getTime();
    const db = new Date(b.startDate || b.createdAt || 0).getTime();
    return da - db;
  });

  return (
    <>
      {/* Mobile Vertical Timeline View (<640px) */}
      <div className="block sm:hidden rounded-2xl border border-border bg-white p-4 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <span className="text-xs font-semibold text-secondary uppercase tracking-wider">Client Milestones</span>
          <span className="text-xs text-secondary">{sortedClients.length} clients</span>
        </div>
        <div className="relative pl-6 space-y-5 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
          {sortedClients.map((client, idx) => {
            const dateStr = client.startDate || client.createdAt;
            const d = dateStr ? new Date(dateStr) : new Date();
            const cfg = getStatusColor(client.status);
            const displayName = getClientDisplayName(client);

            return (
              <motion.div
                key={client.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.03 }}
                className="relative"
              >
                {/* Timeline Dot */}
                <div className={`absolute -left-6 top-3 h-3.5 w-3.5 rounded-full border-2 border-white shadow-sm ${cfg.dot} ring-2 ring-white z-10`} />

                <Link
                  href={`/clients/${client.id}`}
                  className="block rounded-xl border border-border bg-surface hover:bg-white p-3.5 shadow-xs transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`h-8 w-8 rounded-full text-xs font-semibold flex items-center justify-center shrink-0 ${getAvatarColor(displayName)}`}>
                        {getInitials(displayName)}
                      </div>
                      <span className="text-sm font-semibold text-primary truncate">
                        {displayName}
                      </span>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md shrink-0 ${cfg.bg}`}>
                      {cfg.label}
                    </span>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between text-xs text-secondary pt-2 border-t border-surface-sunken">
                    <span>Start / Onboarding</span>
                    <span className="font-medium text-primary">{formatDate(d)}</span>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Desktop Horizontal Matrix View (>=640px) */}
      <div className="hidden sm:block rounded-2xl border border-border bg-white overflow-hidden" style={{ height: 600 }}>
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
                <Link
                  key={client.id}
                  href={`/clients/${client.id}`}
                  className="h-16 px-4 flex items-center border-b border-surface-sunken hover:bg-white transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`h-7 w-7 rounded-full text-[10px] font-semibold flex items-center justify-center shrink-0 ${getAvatarColor(getClientDisplayName(client))}`}>
                      {getInitials(getClientDisplayName(client))}
                    </div>
                    <span className="text-sm font-medium text-primary truncate group-hover:text-blue-600 transition-colors">
                      {getClientDisplayName(client)}
                    </span>
                  </div>
                </Link>
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
                  if (!dateStr) return <div key={client.id} className="h-16 border-b border-surface-sunken" />;
                  const d = new Date(dateStr);
                  const pct = ((d.getTime() - minDate.getTime()) / totalDuration) * 100;
                  const cfg = getStatusColor(client.status);

                  return (
                    <motion.div
                      key={client.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.03 }}
                      className="h-16 border-b border-surface-sunken flex items-center relative group"
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
                        <div className={`h-2.5 w-2.5 rounded-full border-2 border-white shadow-md ${cfg.dot} ring-2 ring-offset-1 ring-white`} />
                      </div>

                      {/* Floating label */}
                      <Link
                        href={`/clients/${client.id}`}
                        className={`absolute ml-4 z-20 flex items-center gap-2 px-3 py-1.5 rounded-lg border shadow-sm hover:shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${cfg.bg}`}
                        style={{ left: `${pct}%` }}
                      >
                        <div className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                        <span className="text-xs font-medium text-primary whitespace-nowrap">
                          {formatDate(d)}
                        </span>
                        <span className={`text-[10px] font-semibold`}>{cfg.label}</span>
                      </Link>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
