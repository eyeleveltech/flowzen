'use client';

/**
 * "Needs approval" — the one tick every task form shares.
 *
 * It only works when the task has a type and that type has at least one
 * approver in Settings → Approvals; a task waiting on a list of nobody would
 * wait for ever. Otherwise it is shown disabled with the reason, rather than
 * hidden: somebody looking for it should find out where it is switched on.
 *
 * Unticks itself when the type changes to one nobody approves, so a form never
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
  const pool = taskType ? (approvers?.[taskType] ?? []) : [];
  const available = Boolean(taskType) && pool.length > 0;

  // A new type nobody approves takes the tick away with it.
  useEffect(() => {
    if (!isPending && value && !available && !lockedReason) onChange(false);
  }, [isPending, value, available, lockedReason, onChange]);

  const hint = lockedReason
    ? lockedReason
    : !taskType
      ? 'Pick a type of work first — approval goes to that type’s approvers.'
      : isPending
        ? 'Checking who approves this type…'
        : available
          ? `Only Done once one of ${pool.map((p) => p.name).join(', ')} approves it.`
          : `No approvers set for ${taskTypeLabel(taskType) ?? taskType}. Set them in Settings → Approvals.`;

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
