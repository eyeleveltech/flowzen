'use client';

/**
 * The new-task form everybody has: "Task for myself", or "New task" for
 * somebody who may hand work to others. My Work opens it, and the calendar
 * opens it on the day (and time) that was clicked.
 *
 * The fields are the shared form's (TaskForm). Nothing on these screens has
 * decided what the task belongs to, so it is asked — starting from the
 * person's last choice.
 */

import { useMayAssignOthers } from '@/components/work/AssigneeField';
import { Modal } from '@/components/ui/modal';
import { TaskForm, useOpenSession } from '@/components/work/TaskForm';

export function NewTaskModal({
  open,
  onClose,
  onCreated,
  initialDueDate,
  initialDueTime,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  /** A day to start from — the calendar opens this on the day that was clicked. */
  initialDueDate?: string;
  /** And a time, when it was a time slot. */
  initialDueTime?: string;
}) {
  /** Decides the dialog's own name: a head opening it is not writing a task for themselves. */
  const { may: mayAssignOthers } = useMayAssignOthers();
  const session = useOpenSession(open);

  return (
    <Modal open={open} onClose={onClose} title={mayAssignOthers ? 'New task' : 'Task for myself'}>
      <TaskForm
        key={session}
        belongsTo={{ kind: 'pick' }}
        initialDueDate={initialDueDate}
        initialDueTime={initialDueTime}
        submitLabel="Add task"
        onCancel={onClose}
        onCreated={onCreated}
      />
    </Modal>
  );
}
