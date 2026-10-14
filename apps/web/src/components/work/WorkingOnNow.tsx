'use client';

/**
 * "Working on now" (Team plan 1).
 *
 * A person says which of their own open tasks they are on. One at a time —
 * choosing another replaces it — and only they can set it. A To do task moves
 * to In progress. It clears itself when the task is done, cancelled, sent for
 * approval or put on hold, or when they press Clear.
 *
 * It is what they SAID, not something watched: no time goes with it, here or
 * anywhere else.
 */

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api, type MyFocus } from '@/lib/api-v2';
import { qk, useMyFocus } from '@/hooks/queries';
import { useAuthStore } from '@/stores';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/** The small mark on the task somebody said they are working on. */
export function NowBadge({ className }: { className?: string }) {
  return (
    <Badge tone="info" className={className}>
      Now
    </Badge>
  );
}

/** A task can be somebody's "now" while it is To do or In progress. */
export const canBeNow = (status: string) => status === 'TODO' || status === 'IN_PROGRESS';

/** The caller's "now", and the two things they can do with it. */
export function useWorkingOnNow(enabled = true) {
  const queryClient = useQueryClient();
  const { focus } = useMyFocus(enabled);
  const [busy, setBusy] = useState(false);
  const put = (next: MyFocus | null) => queryClient.setQueryData(qk.myFocus, { success: true, focus: next });

  /** Returns what it became — the status may have moved to In progress — or null if refused. */
  const start = async (taskId: string): Promise<MyFocus | null> => {
    setBusy(true);
    try {
      const res = await api.tasks.focus(taskId);
      put(res.focus);
      toast.success('Marked as what you’re working on now');
      return res.focus;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not mark that as what you’re working on');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      await api.me.clearFocus();
      put(null);
      toast.success('Cleared');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not clear that');
    } finally {
      setBusy(false);
    }
  };

  return { focus, busy, start, clear };
}

type FocusTask = {
  id: string;
  status: string;
  assignee?: { id: string } | null;
  assignees?: { id: string }[];
};

/**
 * The line in the task drawer: "Working on this now", or the Now badge and
 * Clear. Only on the caller's own task, and only while it is To do or In
 * progress — nobody marks what somebody else is doing.
 */
export function WorkingOnNowControl({
  task,
  onStarted,
}: {
  task: FocusTask;
  /** After it is set — with the status it is now in, which may have moved to In progress. */
  onStarted: (status: string) => void;
}) {
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user?.id);
  const { focus, busy, start, clear } = useWorkingOnNow();

  // The server clears it when a task is finished, held or sent for approval,
  // wherever that happened — so ask again whenever the status in front of us moves.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: qk.myFocus });
  }, [queryClient, task.id, task.status]);

  const mine = Boolean(me) && (task.assignees?.length ? task.assignees.some((a) => a.id === me) : task.assignee?.id === me);
  if (!mine || !canBeNow(task.status)) return null;

  if (focus?.id === task.id) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-info/30 bg-info-tint/50 px-3 py-2">
        <NowBadge />
        <span className="text-sm text-primary">You’re working on this now.</span>
        <Button variant="ghost" size="sm" className="ml-auto" loading={busy} onClick={() => void clear()}>
          Clear
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-2">
      <Button
        variant="secondary"
        size="sm"
        loading={busy}
        onClick={async () => {
          const now = await start(task.id);
          if (now) onStarted(now.status);
        }}
      >
        Working on this now
      </Button>
      <p className="mt-1 text-micro text-secondary">
        {[
          task.status === 'TODO' ? 'Moves it to In progress.' : null,
          focus ? `Replaces “${focus.title}”.` : null,
        ]
          .filter(Boolean)
          .join(' ') || 'Shows on your team’s board as what you’re on.'}
      </p>
    </div>
  );
}
