'use client';

import { useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getClientDisplayName, getInitials, getAvatarColor } from '@/lib/utils';
import { BarChart2 } from 'lucide-react';

const ROW_HEIGHT = 56;
const SIDEBAR_WIDTH = 192; // w-48

import { getStatusColor, getStatusLabel } from '@/lib/status';

export function ClientGanttView({ clients, loading }: { clients: any[]; loading: boolean }) {
  const router = useRouter();

  const { minDate, maxDate, months } = useMemo(() => {
    if (!clients.length) return { minDate: new Date(), maxDate: new Date(), months: [] };

    let earliest = new Date();
    clients.forEach((c) => {
      const d = new Date(c.startDate || c.createdAt || new Date());
      if (d < earliest) earliest = d;
    });

    earliest = new Date(earliest.getFullYear(), earliest.getMonth() - 1, 1);
    const paddedLatest = new Date(new Date().getFullYear(), new Date().getMonth() + 3, 0);

    const ms: Date[] = [];
    let cur = new Date(earliest);
    while (cur <= paddedLatest) {
      ms.push(new Date(cur));
      cur.setMonth(cur.getMonth() + 1);
    }
    return { minDate: earliest, maxDate: paddedLatest, months: ms };
  }, [clients]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-white p-8 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex gap-4 animate-pulse">
            <div className="h-10 w-36 bg-gray-100 rounded-lg" />
            <div className="h-10 bg-subtle rounded-full border border-border" style={{ width: `${120 + i * 30}px`, marginLeft: `${i * 15}px` }} />
          </div>
        ))}
      </div>
    );
  }

  if (!clients.length) {
    return (
      <div className="rounded-2xl border border-border bg-white p-16 text-center">
        <BarChart2 className="h-10 w-10 text-gray-200 mx-auto mb-3" />
        <p className="text-sm text-secondary">No clients to display in the Gantt view.</p>
      </div>
    );
  }

  const today = new Date();
  const totalDuration = maxDate.getTime() - minDate.getTime();
  const todayPct = Math.min(100, Math.max(0, ((today.getTime() - minDate.getTime()) / totalDuration) * 100));

  const sortedClients = [...clients].sort((a, b) => {
    return new Date(a.startDate || a.createdAt || 0).getTime() - new Date(b.startDate || b.createdAt || 0).getTime();
  });

  return (
    <div className="rounded-2xl border border-border bg-white overflow-hidden" style={{ height: 600 }}>
      {/* 
        Single scroll container. The sidebar column uses `sticky left-0` inside it
        so it scrolls vertically with the content but stays fixed horizontally.
      */}
      <div className="h-full overflow-auto custom-scrollbar">
        {/* Min-width ensures horizontal scroll when months overflow */}
        <div style={{ minWidth: `${SIDEBAR_WIDTH + months.length * 140}px` }}>

          {/* ── Sticky Header Row ── */}
          <div className="flex sticky top-0 z-30 bg-surface border-b border-border h-12">
            {/* Sidebar header cell – sticky left */}
            <div
              className="sticky left-0 z-40 bg-surface border-r border-border flex items-center px-4 shrink-0"
              style={{ width: SIDEBAR_WIDTH }}
            >
              <span className="text-[10px] font-semibold text-secondary uppercase tracking-widest">Client</span>
            </div>

            {/* Month cells */}
            {months.map((m, i) => {
              const isNow = m.getMonth() === today.getMonth() && m.getFullYear() === today.getFullYear();
              return (
                <div
                  key={i}
                  className={`flex-1 min-w-25 px-3 flex items-center border-r text-[11px] font-semibold uppercase tracking-wider ${isNow ? 'text-body bg-subtle border-border' : 'text-secondary border-border'}`}
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
                    className={`flex-1 min-w-25 border-r ${isNow ? 'bg-subtle/30 border-border' : 'border-gray-100'}`}
                  />
                );
              })}
            </div>

            {/* Today vertical line (only in the chart area, not over sidebar) */}
            <div
              className="absolute top-0 bottom-0 pointer-events-none z-10"
              style={{ left: `calc(${SIDEBAR_WIDTH}px + ${todayPct}% * (100% - ${SIDEBAR_WIDTH}px) / 100)` }}
            >
              <div className="absolute inset-y-0 w-0.5 bg-primary/60" />
              <div className="absolute top-2 left-2 text-[10px] font-bold text-body bg-white border border-border px-1.5 py-0.5 rounded shadow-sm whitespace-nowrap">
                Today
              </div>
            </div>

            {/* Client rows */}
            {sortedClients.map((client, idx) => {
              const cfg = getStatusColor(client.status);
              const label = getStatusLabel(client.status);
              const dateStr = client.startDate || client.createdAt;
              const start = dateStr ? new Date(dateStr) : null;
              const end = client.status === 'CHURNED' ? new Date(client.updatedAt || today) : today;

              const startPct = start ? Math.max(0, ((start.getTime() - minDate.getTime()) / totalDuration) * 100) : 0;
              const endPct = Math.min(100, ((end.getTime() - minDate.getTime()) / totalDuration) * 100);
              const widthPct = Math.max(0.5, endPct - startPct);

              return (
                <div
                  key={client.id}
                  className="flex relative group"
                  style={{ height: ROW_HEIGHT, borderBottom: '1px solid #F3F4F6' }}
                >
                  {/* Sidebar cell – sticky left, always aligned with its chart row */}
                  <Link
                    href={`/clients/${client.id}`}
                    className="sticky left-0 z-20 bg-white border-r border-subtle flex items-center px-4 shrink-0 hover:bg-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
                    style={{ width: SIDEBAR_WIDTH }}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`h-2 w-2 rounded-full shrink-0 ${cfg.dot}`} />
                      <div className={`h-7 w-7 rounded-full text-[10px] font-semibold flex items-center justify-center shrink-0 ${getAvatarColor(getClientDisplayName(client))}`}>
                        {getInitials(getClientDisplayName(client))}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-primary truncate group-hover:text-body transition-colors leading-tight">
                          {getClientDisplayName(client)}
                        </p>
                        <p className="text-[10px] text-secondary">{label}</p>
                      </div>
                    </div>
                  </Link>

                  {/* Chart cell for this row */}
                  <div className="flex-1 relative overflow-hidden flex items-center">
                    {start && (
                      <Link
                        href={`/clients/${client.id}`}
                        style={{ transformOrigin: 'left', left: `${startPct}%`, width: `${widthPct}%`, minWidth: '150px' }}
                        className={`absolute h-8 z-10 rounded-full border flex items-center px-3 gap-2 transition-all group-hover:brightness-95 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${cfg.bar}`}
                      >
                        <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${cfg.dot}`} />
                        <span className={`text-xs font-semibold truncate ${cfg.text}`}>
                          {getClientDisplayName(client)}
                        </span>
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
