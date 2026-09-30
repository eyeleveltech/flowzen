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
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ApprovalItem } from '@/lib/api-v2';
import { APPROVAL_QUEUE_KEY, useApprovalQueue } from '@/lib/approvals';
import { ApproveControls, OpenLink } from '@/components/work/Approval';

export function ApprovalQueue({ onOpen }: { onOpen: (taskId: string) => void }) {
  const queryClient = useQueryClient();
  const { data: items = [] } = useApprovalQueue();
  // Rows decided here, gone before the refetch lands.
  const [decided, setDecided] = useState<Set<string>>(new Set());
  const shown = items.filter((i) => !decided.has(i.id));

  if (shown.length === 0) return null;

  const done = (id: string) => {
    setDecided((prev) => new Set(prev).add(id));
    void queryClient.invalidateQueries({ queryKey: APPROVAL_QUEUE_KEY });
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
  };

  return (
    <Card padding="none" className="mb-6 overflow-hidden border-review/30">
      <CardHeader className="bg-review-tint/50">
        <CardTitle>Waiting for your approval ({shown.length})</CardTitle>
      </CardHeader>
      <ul className="divide-y divide-border">
        {shown.map((item) => (
          <Row key={item.id} item={item} onDone={() => done(item.id)} onOpen={() => onOpen(item.id)} />
        ))}
      </ul>
    </Card>
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
