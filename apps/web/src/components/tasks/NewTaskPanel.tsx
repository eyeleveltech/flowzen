'use client';

/**
 * Quick-add a task from ⌘K, always against a project someone just searched
 * for (see lib/actions.ts — the "task" command only ever `applies: ['project']`).
 * The fields are the shared form's (TaskForm), the same as every other place a
 * task is written down; the project is already decided, so it is shown fixed.
 */

import { Drawer } from '@/components/ui/drawer';
import { TaskForm, useOpenSession } from '@/components/work/TaskForm';

interface NewTaskPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  projectId: string;
  projectName: string;
}

export function NewTaskPanel({ isOpen, onClose, onSuccess, projectId, projectName }: NewTaskPanelProps) {
  const session = useOpenSession(isOpen);

  return (
    <Drawer isOpen={isOpen} onClose={onClose} variant="slideover" title="New task" guardUnsaved>
      <TaskForm
        key={session}
        layout="panel"
        belongsTo={{ kind: 'fixed', label: projectName, where: { workType: 'PROJECT', projectId } }}
        submitLabel="Add task"
        onCancel={onClose}
        onCreated={() => {
          onSuccess?.();
          onClose();
        }}
      />
    </Drawer>
  );
}
