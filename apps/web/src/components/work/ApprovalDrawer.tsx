'use client';

/**
 * The task a WhatsApp approval link opens: /my-work?task=…
 *
 * The approver is almost never on the task, so it is not in their own list and
 * the regular task drawer has nothing to open. This one is drawn from the
 * task's review history alone — enough to know what it is and whose, the
 * round waiting, and Approve / Request changes. If somebody got there first,
 * it says who and when instead.
 */

import { useQuery } from '@tanstack/react-query';
import { api, ApiError, formatDate } from '@/lib/api-v2';
import { Drawer } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ApprovalSection } from '@/components/work/Approval';

export function ApprovalDrawer({
  taskId,
  onClose,
  onChanged,
}: {
  taskId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { data, error } = useQuery({
    queryKey: ['task-reviews', taskId],
    queryFn: () => api.tasks.reviews(taskId!),
    enabled: Boolean(taskId),
    retry: false,
  });

  if (!taskId) return null;
  const task = data?.task;
  const place = task ? [task.clientName, task.projectName].filter(Boolean).join(' · ') : undefined;

  return (
    <Drawer isOpen onClose={onClose} variant="slideover" title={task?.title ?? 'Task'} description={place}>
      {/* On a phone the sheet already pads its content; the desktop panel does
          not, so the padding comes in at the same 768px the layout switches. */}
      <div className="flex h-full flex-col">
        <div className="flex-1 space-y-5 overflow-y-auto md:px-6 md:py-5">
          {error ? (
            <p className="rounded-xl border border-border bg-subtle/40 px-4 py-3 text-sm text-secondary">
              {error instanceof ApiError && error.status === 404
                ? 'That task no longer exists.'
                : error instanceof ApiError
                  ? error.message
                  : 'Could not open that task.'}
            </p>
          ) : (
            task && (
              <>
                <Card padding="none" className="overflow-hidden">
                  <dl className="divide-y divide-border text-sm">
                    {task.taskTypeLabel && <Row label="Type of work" value={task.taskTypeLabel} />}
                    <Row label="By" value={task.assignees.map((a) => a.name).join(', ') || '—'} />
                    <Row label="Due" value={formatDate(task.dueDate)} />
                  </dl>
                </Card>
                <ApprovalSection taskId={taskId} onChanged={onChanged} />
              </>
            )
          )}
        </div>
        <div className="mt-5 flex shrink-0 justify-end border-t border-border bg-surface pt-4 md:mt-0 md:px-6 md:py-4">
          <Button variant="ghost" onClick={onClose} className="w-full sm:w-auto">
            Close
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <dt className="shrink-0 text-secondary">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-primary">{value}</dd>
    </div>
  );
}
