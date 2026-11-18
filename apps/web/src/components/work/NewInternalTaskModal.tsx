'use client';

/**
 * Adding work to a piece of the studio's own work.
 *
 * Opened from inside an internal project, so the one question every other task
 * form has to ask — what does this belong to — is already answered by the
 * screen it opened from, and the shared form (TaskForm) shows it as fixed.
 * What is left is who, when, and what.
 */

import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/modal';
import { TaskForm } from '@/components/work/TaskForm';

export function NewInternalTaskModal({
  open,
  project,
  onClose,
  onCreated,
}: {
  open: boolean;
  project: { id: string; name: string };
  onClose: () => void;
  onCreated: () => void;
}) {
  // A fresh form every time it opens: nothing is kept while it is closed.
  if (!open) return null;

  return (
    <Modal open onClose={onClose} title="New task" description={project.name} size="md">
      <TaskForm
        belongsTo={{
          kind: 'fixed',
          label: project.name,
          note: 'Internal — no client.',
          where: { workType: 'INTERNAL', internalProjectId: project.id },
        }}
        submitLabel="Add task"
        onCancel={onClose}
        onCreated={() => {
          toast.success('Task added');
          onCreated();
        }}
      />
    </Modal>
  );
}
