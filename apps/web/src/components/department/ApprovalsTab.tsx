'use client';

/**
 * My Department → Approvals: the team's work waiting for an approver — how
 * long, which round, the link to look at — and what was sent back to them
 * lately, with the feedback.
 *
 * When the head approves that type (or is its escalation contact and the round
 * has escalated), Approve and Request changes are right on the row. They call
 * the same routes every approval screen does, which check the same rules again
 * — nobody approves their own work.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ExternalLink } from 'lucide-react';
import { api, ApiError, formatDate } from '@/lib/api-v2';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/empty-state';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { classifyLink } from '@/lib/safeLink';
import { APPROVAL_QUEUE_KEY } from '@/lib/approvals';

export function ApprovalsTab({ departmentId, onOpenTask }: { departmentId: string; onOpenTask: (id: string) => void }) {
  const queryClient = useQueryClient();
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['department', departmentId, 'approvals'],
    queryFn: () => api.departments.approvals(departmentId),
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [changesFor, setChangesFor] = useState<{ taskId: string; title: string } | null>(null);
  const [feedback, setFeedback] = useState('');

  const after = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['department', departmentId] }),
      queryClient.invalidateQueries({ queryKey: APPROVAL_QUEUE_KEY }),
    ]);
  };

  const approve = async (taskId: string) => {
    setBusy(taskId);
    try {
      await api.tasks.approve(taskId);
      toast.success('Approved');
      await after();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not approve it');
    } finally {
      setBusy(null);
    }
  };

  const sendBack = async () => {
    if (!changesFor || !feedback.trim()) return;
    setBusy(changesFor.taskId);
    try {
      await api.tasks.requestChanges(changesFor.taskId, feedback.trim());
      toast.success('Sent back with your changes');
      setChangesFor(null);
      setFeedback('');
      await after();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not send it back');
    } finally {
      setBusy(null);
    }
  };

  if (error) return <ErrorNote onDismiss={() => void refetch()}>{error instanceof Error ? error.message : 'Could not load approvals'}</ErrorNote>;
  if (isPending || !data) return <p className="text-sm text-secondary">Loading…</p>;

  const who = (people: { name: string }[]) => people.map((p) => p.name).join(', ');

  return (
    <div className="space-y-6">
      <Card padding="none" className="overflow-hidden">
        <CardHeader>
          <CardTitle>In review</CardTitle>
          <span className="text-micro text-secondary">The team&apos;s work waiting for an approver, longest first</span>
        </CardHeader>
        {data.inReview.length === 0 ? (
          <p className="px-5 py-6 text-sm text-secondary">Nothing of the team&apos;s is waiting for approval.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.inReview.map((r) => {
              // Only a real web address is a link; anything else is left as text.
              const kind = classifyLink(r.link);
              const link = kind.kind === 'none' ? null : kind.href;
              return (
                <li key={r.taskId} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => onOpenTask(r.taskId)}
                      className="block max-w-full truncate text-left text-sm font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {r.title}
                    </button>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-secondary">
                      <span>{who(r.assignees)}</span>
                      <span>· Round {r.round}</span>
                      <span>· waiting {r.waitingText}</span>
                      {r.escalated && <Badge tone="warn">Escalated</Badge>}
                      {link && (
                        <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-body hover:text-primary hover:underline">
                          Open the work <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      )}
                    </p>
                  </div>
                  {r.canDecide ? (
                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" variant="ghost" disabled={busy === r.taskId} onClick={() => setChangesFor({ taskId: r.taskId, title: r.title })}>
                        Request changes
                      </Button>
                      <Button size="sm" variant="primary" loading={busy === r.taskId} onClick={() => void approve(r.taskId)}>
                        Approve
                      </Button>
                    </div>
                  ) : r.notYours ? (
                    <p className="shrink-0 text-micro text-secondary sm:max-w-56 sm:text-right">{r.notYours}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card padding="none" className="overflow-hidden">
        <CardHeader>
          <CardTitle>Changes requested</CardTitle>
          <span className="text-micro text-secondary">Sent back to the team in the last two weeks, still being worked on</span>
        </CardHeader>
        {data.changesRequested.length === 0 ? (
          <p className="px-5 py-6 text-sm text-secondary">Nothing was sent back lately.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.changesRequested.map((c) => (
              <li key={c.taskId} className="px-5 py-3.5">
                <button
                  type="button"
                  onClick={() => onOpenTask(c.taskId)}
                  className="block max-w-full truncate text-left text-sm font-medium text-primary underline-offset-2 hover:underline"
                >
                  {c.title}
                </button>
                <p className="mt-0.5 text-micro text-secondary">
                  {who(c.assignees)} · round {c.round} sent back by {c.decidedBy?.name ?? 'an approver'} {formatDate(c.decidedAt)}
                </p>
                {c.feedback && <p className="mt-1.5 rounded-lg bg-subtle px-3 py-2 text-xs text-body">“{c.feedback}”</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={Boolean(changesFor)}
        onClose={() => setChangesFor(null)}
        title="Request changes"
        description={changesFor ? `${changesFor.title} — say what needs changing; the editor works from this.` : undefined}
      >
        <ModalBody>
          <textarea
            aria-label="What needs changing"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={5}
            maxLength={2000}
            placeholder="e.g. The logo is too small on the first slide; use the new colour on the CTA."
            className="w-full rounded-xl border border-border px-3 py-2 text-sm text-primary outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25"
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setChangesFor(null)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!feedback.trim()} loading={Boolean(changesFor && busy === changesFor.taskId)} onClick={() => void sendBack()}>
            Send back
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
