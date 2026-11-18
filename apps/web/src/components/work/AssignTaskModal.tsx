'use client';

/**
 * Quickly handing a specific person a task, from Team or My Department — the
 * assignee isn't a question, it's why this opened, so the shared form
 * (TaskForm) shows it as fixed and asks the rest, "Belongs to" included.
 */

import { Modal } from '@/components/ui/modal';
import { TaskForm } from '@/components/work/TaskForm';

export function AssignTaskModal({
  person,
  onClose,
  onCreated,
}: {
  person: { id: string; name: string };
  onClose: () => void;
  onCreated: () => void;
}) {
  return (
    <Modal open onClose={onClose} title={`Assign to ${person.name}`}>
      <TaskForm
        belongsTo={{ kind: 'pick' }}
        assignee={{ kind: 'fixed', person }}
        submitLabel="Assign task"
        onCancel={onClose}
        onCreated={onCreated}
      />
    </Modal>
  );
}
