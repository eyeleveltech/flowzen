'use client';

/**
 * My Department → Time split: how each person's month divides across clients
 * and work, as percentages — never money, not even for an admin looking at it
 * (the server leaves the figures out for this tab). Confirmed or not, and Edit
 * and Confirm per person, or Confirm all.
 *
 * Through the Time split routes as they are: they refuse anybody outside the
 * departments a Head leads, and any change to a closed month.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api, ApiError } from '@/lib/api-v2';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/empty-state';
import { EditAllocationsModal } from '@/components/work/EditAllocationsModal';
import { cn } from '@/lib/utils';

export const allocationsKey = (departmentId: string, month: string) => ['department', departmentId, 'allocations', month] as const;

/** The department's split for a month — one read, shared by this tab and the person panel. */
export function useDepartmentAllocations(departmentId: string, month: string) {
  return useQuery({
    queryKey: allocationsKey(departmentId, month),
    queryFn: () => api.allocations.list(month, departmentId),
  });
}

export function TimeSplitTab({ departmentId, departmentName, month }: { departmentId: string; departmentName: string; month: string }) {
  const queryClient = useQueryClient();
  const { data, isPending, error, refetch } = useDepartmentAllocations(departmentId, month);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const members = data?.members ?? [];
  const toConfirm = members.filter((m) => m.allocations.length > 0 && !m.isConfirmed);
  const monthName = new Date(`${month}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: allocationsKey(departmentId, month) }),
      // "Not confirmed after the 25th" in Needs attention.
      queryClient.invalidateQueries({ queryKey: ['department', departmentId, 'overview'] }),
    ]);

  const confirm = async (userIds: string[], key: string) => {
    setBusy(key);
    try {
      const res = await api.allocations.confirm(month, userIds);
      toast.success(res.confirmedCount === 1 ? 'Confirmed' : `Confirmed ${res.confirmedCount} allocations`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not confirm the split');
    } finally {
      setBusy(null);
    }
  };

  if (error) return <ErrorNote onDismiss={() => void refetch()}>{error instanceof Error ? error.message : 'Could not load the time split'}</ErrorNote>;
  if (isPending || !data) return <p className="text-sm text-secondary">Loading…</p>;

  const editingMember = members.find((m) => m.id === editing) ?? null;

  return (
    <>
      <Card padding="none" className="overflow-hidden">
        <CardHeader className="flex-wrap gap-y-2">
          <div>
            <CardTitle>Time split · {monthName}</CardTitle>
            <p className="text-micro text-secondary">How each person&apos;s month divides across the work, in percentages.</p>
          </div>
          {toConfirm.length > 0 && (
            <Button
              size="sm"
              variant="primary"
              loading={busy === 'all'}
              onClick={() => void confirm(toConfirm.map((m) => m.id), 'all')}
            >
              Confirm all ({toConfirm.length})
            </Button>
          )}
        </CardHeader>
        {members.length === 0 ? (
          <p className="px-5 py-6 text-sm text-secondary">Nobody is in {departmentName} yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {members.map((m) => (
              <li key={m.id} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-start">
                <div className="min-w-0 md:w-48 md:shrink-0">
                  <p className="truncate text-sm font-semibold text-primary">{m.name}</p>
                  <p className={cn('text-xs tabular-nums', m.totalPercent === 100 ? 'text-secondary' : 'text-warning-ink')}>
                    {m.totalPercent}% split
                    {m.totalPercent !== 100 && m.allocations.length > 0 ? ' — usually 100%' : ''}
                  </p>
                </div>
                <div className="min-w-0 flex-1">
                  {m.allocations.length === 0 ? (
                    <p className="text-sm text-secondary">No split entered for {monthName}.</p>
                  ) : (
                    <ul className="space-y-1">
                      {m.allocations.map((a) => (
                        <li key={a.id} className="flex justify-between gap-3 text-sm">
                          <span className="min-w-0 truncate text-body">{a.jobTitle}</span>
                          <span className="shrink-0 tabular-nums font-medium text-primary">{a.percent}%</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
                  {m.allocations.length > 0 && <Badge tone={m.isConfirmed ? 'good' : 'warn'}>{m.isConfirmed ? 'Confirmed' : 'Not confirmed'}</Badge>}
                  <Button size="sm" variant="ghost" onClick={() => setEditing(m.id)}>
                    Edit
                  </Button>
                  {m.allocations.length > 0 && !m.isConfirmed && (
                    <Button size="sm" variant="secondary" loading={busy === m.id} onClick={() => void confirm([m.id], m.id)}>
                      Confirm
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editingMember && (
        <EditAllocationsModal
          member={editingMember}
          month={month}
          jobsFrom="targets"
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh();
            toast.success('Split saved');
          }}
        />
      )}
    </>
  );
}
