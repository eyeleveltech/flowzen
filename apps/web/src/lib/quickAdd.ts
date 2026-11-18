/**
 * My Work's quick add (Ease Plan 1, decision 3): a title and Enter makes a
 * task for yourself, due today, filed where your last task was.
 *
 * Nothing is created with a guessed target. With no last choices — a first
 * task ever, or the last one's work is closed — `quickAddBody` gives null and
 * the full form opens with the title already typed.
 */
import type { LastTaskChoices } from '@/lib/api-v2';
import { taskTypeLabel } from '@/lib/task-type';

/** The request a quick add sends — the same `POST /tasks` the full form sends. */
export type QuickAddBody = {
  title: string;
  workType: 'INTERNAL' | 'MONTH_CARD' | 'PROJECT';
  monthCardId?: string;
  retainerProjectId?: string;
  projectId?: string;
  internalProjectId?: string;
  dueDate: string;
  priority: 'MEDIUM';
  taskType: string;
};

export function quickAddBody(title: string, choices: LastTaskChoices | null | undefined, today: string): QuickAddBody | null {
  const what = title.trim();
  const target = choices?.target;
  if (!what || !choices?.taskType || !target || !today) return null;
  // No assignee: the server's default is the caller, which is what "for myself" means.
  const base = { title: what, dueDate: today, priority: 'MEDIUM' as const, taskType: choices.taskType };
  if (target.scope === 'INTERNAL') {
    return {
      ...base,
      workType: 'INTERNAL',
      // "No project" is sent as no internal project at all, as the form does.
      ...(target.internalProjectId ? { internalProjectId: target.internalProjectId } : {}),
    };
  }
  return target.workType === 'RETAINER'
    ? {
        ...base,
        workType: 'MONTH_CARD',
        monthCardId: target.monthCardId,
        ...(target.retainerProjectId ? { retainerProjectId: target.retainerProjectId } : {}),
      }
    : { ...base, workType: 'PROJECT', projectId: target.projectId };
}

/** "Acme — Design": where it went, and the type of work — the toast after a quick add. */
export function quickAddSummary(choices: LastTaskChoices): string {
  const where = choices.target?.name ?? 'Internal';
  const type = taskTypeLabel(choices.taskType) ?? choices.taskType ?? '';
  return type ? `${where} — ${type}` : where;
}
