'use client';

/**
 * Adding a task against a company's live work — a Project or a Retainer's
 * month card, the two `workType`s a task can hang off besides internal work.
 * Opened from a Project or Retainer page, "Belongs to" is pre-selected to that
 * page's own work item, but shown and changeable rather than silently implicit
 * — every task sits inside a specific piece of work, and the person creating
 * it should see which one before saving. Opened from inside a retainer
 * project, it is shown as the fact it is.
 *
 * The fields are the shared form's (TaskForm); this says what the page knows.
 */

import { Modal } from '@/components/ui/modal';
import { TaskForm, useOpenSession, type WorkTarget } from '@/components/work/TaskForm';

type Props = {
  open: boolean;
  /**
   * The page's team. No longer read — the shared assignee field asks the
   * roster itself — and kept so the pages that pass it need no change.
   */
  team: { id: string; name: string; dept: string }[];
  companyId: string;
  defaultTarget: WorkTarget;
  /**
   * The named pieces of work inside the retainer this task is being added to.
   *
   * Only offered when the target is a month card, because that is the only
   * place they mean anything — a one-off project is its own piece of work.
   */
  retainerProjects?: { id: string; name: string; status: string }[];
  /**
   * Which of them the task already belongs to.
   *
   * Set when the modal is opened from inside a project, where the answer is
   * not a question — the screen is already that project.
   */
  defaultRetainerProjectId?: string;
  onClose: () => void;
  onCreated: () => void;
};

export function NewWorkTaskModal({
  open,
  companyId,
  defaultTarget,
  retainerProjects,
  defaultRetainerProjectId,
  onClose,
  onCreated,
}: Props) {
  const session = useOpenSession(open);

  return (
    <Modal open={open} onClose={onClose} title="New task">
      <TaskForm
        key={session}
        belongsTo={{ kind: 'company', companyId, defaultTarget, retainerProjects, defaultRetainerProjectId }}
        submitLabel="Add task"
        onCancel={onClose}
        onCreated={onCreated}
      />
    </Modal>
  );
}
