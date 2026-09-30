'use client';

/**
 * "Needs approval" — the one tick every task form shares.
 *
 * No type of work needed. The same approvers cover all work, so a task ticked
 * with no type is filed as Other and goes to them. It is disabled only when
 * nobody is set to approve at all — a task waiting on a list of nobody would
 * wait for ever — and then says where that is set, rather than hiding.
 *
 * Unticks itself if the type changes to one nobody approves, so a form never
 * sends a tick the server would refuse.
 */

import { useEffect } from 'react';
import { FieldCheckbox } from '@/components/ui/field';
import { useApprovers } from '@/lib/approvals';
import { taskTypeLabel } from '@/lib/task-type';

export function NeedsApprovalField({
  taskType,
  value,
  onChange,
  disabled = false,
  lockedReason,
}: {
  taskType: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Why it cannot change right now, e.g. while the task is waiting on an approver. */
  lockedReason?: string;
}) {
  const { data: approvers, isPending } = useApprovers();
  // No type picked: it will be filed as Other, so Other's approvers are the ones.
  const pool = approvers?.[taskType || 'OTHER'] ?? [];
  const available = pool.length > 0;

  // A new type nobody approves takes the tick away with it.
  useEffect(() => {
    if (!isPending && value && !available && !lockedReason) onChange(false);
  }, [isPending, value, available, lockedReason, onChange]);

  const hint = lockedReason
    ? lockedReason
    : isPending
      ? 'Checking who approves…'
      : available
        ? `Only Done once one of ${pool.map((p) => p.name).join(', ')} approves it.`
        : taskType
          ? `Nobody approves ${taskTypeLabel(taskType) ?? taskType} work. Set the approvers in Settings → Approvals.`
          : 'Nobody is set to approve work yet. Set the approvers in Settings → Approvals.';

  return (
    <FieldCheckbox
      label="Needs approval"
      checked={value}
      onChange={onChange}
      disabled={disabled || Boolean(lockedReason) || (!available && !value)}
      hint={hint}
    />
  );
}
