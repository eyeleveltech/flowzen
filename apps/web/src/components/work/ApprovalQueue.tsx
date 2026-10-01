'use client';

/**
 * My Work, for an approver: what is waiting on them, at the top.
 *
 * There is no separate Approvals page. Approvers already open My Work, and the
 * WhatsApp link lands them there — so the work waiting for their sign-off is
 * the first thing on it, oldest first, with Approve and Request changes right
 * on the row. A decided row leaves at once; the list is what is still owed.
 *
 * Built for a phone first: the link mostly arrives on WhatsApp, so each row is
 * a stacked card, every control full width until there is room beside it.
 *
 * Below it, "Sent back": work another approver returned that is still with the
 * editor. One approval is enough, but a request for changes is not the last
 * word — the others see what was asked and add their own, so the editor fixes
 * everything in one go. Not counted in the badge: nothing is waiting on them.
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ApprovalItem, SentBackItem } from '@/lib/api-v2';
import { APPROVAL_QUEUE_KEY, useApprovalQueue, useSentBack, whenDecided } from '@/lib/approvals';
import { AddChanges, ApproveControls, ChangeList, OpenLink } from '@/components/work/Approval';
import { useConfig } from '@/hooks/queries';

export function ApprovalQueue({ onOpen }: { onOpen: (taskId: string) => void }) {
  const queryClient = useQueryClient();
  const { data: items = [] } = useApprovalQueue();
  const { data: sentBack = [] } = useSentBack();
  // Rows decided here, gone before the refetch lands.
  const [decided, setDecided] = useState<Set<string>>(new Set());
  const shown = items.filter((i) => !decided.has(i.id));

  if (shown.length === 0 && sentBack.length === 0) return null;

  const done = (id: string) => {
    setDecided((prev) => new Set(prev).add(id));
    void queryClient.invalidateQueries({ queryKey: APPROVAL_QUEUE_KEY });
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
  };
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: APPROVAL_QUEUE_KEY });
    void queryClient.invalidateQueries({ queryKey: ['task-reviews'] });
  };

  return (
    <div className="mb-6 space-y-4">
      {shown.length > 0 && (
        <Card padding="none" className="overflow-hidden border-review/30">
          <CardHeader className="bg-review-tint/50">
            <CardTitle>Waiting for your approval ({shown.length})</CardTitle>
          </CardHeader>
          <ul className="divide-y divide-border">
            {shown.map((item) => (
              <Row key={item.id} item={item} onDone={() => done(item.id)} onOpen={() => onOpen(item.id)} />
            ))}
          </ul>
        </Card>
      )}
      {sentBack.length > 0 && (
        <Card padding="none" className="overflow-hidden border-warning/30">
          <CardHeader className="bg-warning-tint/50">
            <CardTitle>Sent back — add your changes ({sentBack.length})</CardTitle>
          </CardHeader>
          <ul className="divide-y divide-border">
            {sentBack.map((item) => (
              <SentBackRow key={item.id} item={item} onAdded={refresh} onOpen={() => onOpen(item.id)} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** Returned by another approver, still with the editor: what was asked, and room for yours. */
function SentBackRow({ item, onAdded, onOpen }: { item: SentBackItem; onAdded: () => void; onOpen: () => void }) {
  const { data: config } = useConfig();
  const mine = item.review.decidedBy?.id === config?.me.userId;
  const place = [item.clientName, item.projectName].filter(Boolean).join(' · ');
  const editors = item.assignees.map((a) => a.name).join(', ');

  return (
    <li className="space-y-3 px-4 py-4 sm:px-5">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {item.taskTypeLabel && <Badge tone="review">{item.taskTypeLabel}</Badge>}
          <Badge tone="neutral">Round {item.review.round}</Badge>
          <Badge tone="warn">Changes requested</Badge>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="block text-left text-base font-semibold leading-snug text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {item.title}
        </button>
        {place && <p className="text-sm text-body">{place}</p>}
        <p className="text-xs text-secondary">
          Sent back by {mine ? 'you' : (item.review.decidedBy?.name ?? 'an approver')} · {whenDecided(item.review.decidedAt)}
          {editors ? ` · with ${editors}` : ''}
        </p>
      </div>
      {item.review.link && <OpenLink href={item.review.link} />}
      <ChangeList decidedBy={item.review.decidedBy} feedback={item.review.feedback} notes={item.review.notes} />
      <AddChanges taskId={item.id} onAdded={onAdded} />
    </li>
  );
}

function Row({ item, onDone, onOpen }: { item: ApprovalItem; onDone: () => void; onOpen: () => void }) {
  const editor = item.review.submittedBy.name;
  const place = [item.clientName, item.projectName].filter(Boolean).join(' · ');

  return (
    <li className="space-y-3 px-4 py-4 sm:px-5">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {item.taskTypeLabel && <Badge tone="review">{item.taskTypeLabel}</Badge>}
          <Badge tone="neutral">Round {item.review.round}</Badge>
          {/* Here because it escalated to them, not because they approve the type. */}
          {item.asEscalation && <Badge tone="bad">Escalated to you</Badge>}
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="block text-left text-base font-semibold leading-snug text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {item.title}
        </button>
        {place && <p className="text-sm text-body">{place}</p>}
        <p className="text-xs text-secondary">
          By {editor} ·{' '}
          {/* Amber once the approvers have been reminded, red once it has escalated. */}
          <span
            className={
              item.review.escalatedAt
                ? 'font-semibold text-danger'
                : item.review.remindedAt
                  ? 'font-semibold text-warning-ink'
                  : undefined
            }
          >
            waiting {item.waitingText}
          </span>
        </p>
      </div>

      {item.review.link && <OpenLink href={item.review.link} />}
      {item.review.note && (
        <p className="whitespace-pre-wrap rounded-lg bg-subtle/60 px-3 py-2 text-sm text-body">“{item.review.note}”</p>
      )}

      <ApproveControls taskId={item.id} onDecided={onDone} />
    </li>
  );
}
