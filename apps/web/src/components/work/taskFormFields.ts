/**
 * The sums behind the one new-task form (Ease Plan 1): where a new form starts
 * from the person's last choices, where a "Belongs to" answer files the task,
 * and the body POST /tasks is sent. Kept pure, so the rules can be tested
 * without a screen — see TaskForm.tsx for the form itself.
 */

import type { LastTaskChoices } from '@/lib/api-v2';
import { TASK_TYPE_OPTIONS } from '@/lib/task-type';

/** "No project" in the internal picker — a choice, sent as no internal project at all. */
export const NO_PROJECT = 'none';

/**
 * One thing a task can be filed against, as GET /tasks/targets lists it.
 *
 * A retainer option is a piece of work INSIDE the retainer, not the retainer's
 * month. `key` is what the dropdown stores, and it is the retainer project or
 * the one-time project, both unique.
 */
export type TaskTargetJob = {
  key: string;
  label: string;
  workType: 'RETAINER' | 'PROJECT';
  monthCardId?: string;
  retainerProjectId?: string;
  projectId?: string;
  /** Which month a retainer option bills into, for the line under the field. */
  month?: string;
};

/** Everything the studio-wide picker offers: GET /tasks/targets. */
export type OfferedTargets = {
  companies: { id: string; name: string; jobs: TaskTargetJob[] }[];
  internalProjects: { id: string; name: string }[];
};

/**
 * The studio-wide "Belongs to" answer (My Work, Calendar, Team). An empty
 * string is "not chosen yet", which the form does not accept — "No project" is
 * a decision, not a field somebody skipped.
 */
export type BelongsToPick = {
  scope: 'INTERNAL' | 'CLIENT';
  internalProjectId: string;
  companyId: string;
  targetKey: string;
};

/** A new form with nothing remembered: internal, project not chosen yet. */
export const EMPTY_PICK: BelongsToPick = { scope: 'INTERNAL', internalProjectId: '', companyId: '', targetKey: '' };

/** Where a task is filed, in POST /tasks's own words. */
export type TaskWhere = {
  workType: 'INTERNAL' | 'MONTH_CARD' | 'PROJECT';
  monthCardId?: string;
  retainerProjectId?: string;
  internalProjectId?: string;
  projectId?: string;
};

/**
 * What a new form starts on, from the person's last hand-made task.
 *
 * The type of work, wherever the form is. "Belongs to" only when `offered` is
 * given — a screen that already fixed it passes nothing, and the screen wins —
 * and only when that exact choice is still in the list: a closed job, or an
 * internal project that is no longer active, starts the field empty rather
 * than on something the form cannot show.
 */
export function startFromLastChoices(
  choices: LastTaskChoices | null | undefined,
  offered?: OfferedTargets,
): { taskType: string | null; belongsTo: BelongsToPick | null } {
  if (!choices) return { taskType: null, belongsTo: null };
  const type = choices.taskType;
  const taskType = type && TASK_TYPE_OPTIONS.some((o) => o.value === type) ? type : null;

  const remembered = choices.target;
  let belongsTo: BelongsToPick | null = null;
  if (remembered && offered) {
    if (remembered.scope === 'INTERNAL') {
      // No project is always on offer; a named one only while it is active.
      const id = remembered.internalProjectId;
      if (id === null) belongsTo = { ...EMPTY_PICK, internalProjectId: NO_PROJECT };
      else if (offered.internalProjects.some((p) => p.id === id)) belongsTo = { ...EMPTY_PICK, internalProjectId: id };
    } else {
      const company = offered.companies.find((c) => c.id === remembered.companyId);
      if (company?.jobs.some((j) => j.key === remembered.key)) {
        belongsTo = { scope: 'CLIENT', internalProjectId: '', companyId: company.id, targetKey: remembered.key };
      }
    }
  }
  return { taskType, belongsTo };
}

/** Where the studio-wide picker's answer files the task, or null while it is incomplete. */
export function pickWhere(pick: BelongsToPick, offered: OfferedTargets | undefined): TaskWhere | null {
  if (pick.scope === 'INTERNAL') {
    if (!pick.internalProjectId) return null;
    // "No project" is sent as no internal project at all.
    return {
      workType: 'INTERNAL',
      internalProjectId: pick.internalProjectId === NO_PROJECT ? undefined : pick.internalProjectId,
    };
  }
  const job = offered?.companies.find((c) => c.id === pick.companyId)?.jobs.find((j) => j.key === pick.targetKey);
  if (!job) return null;
  return {
    workType: job.workType === 'RETAINER' ? 'MONTH_CARD' : 'PROJECT',
    monthCardId: job.monthCardId,
    // What the work is for, alongside the month that bills it. Absent for a
    // one-time project, which is its own answer to both questions.
    retainerProjectId: job.retainerProjectId,
    projectId: job.projectId,
  };
}

/** One piece of a client's work on the project and retainer pages' form. */
export type WorkOption = {
  key: string;
  label: string;
  kind: 'PROJECT' | 'MONTH_CARD';
  projectId?: string;
  monthCardId?: string;
  /** A month card's "2026-09". */
  month?: string;
};

/** A page's own work item, as that form's option key. */
export const workOptionKey = (t: { kind: 'PROJECT'; projectId: string } | { kind: 'MONTH_CARD'; monthCardId: string }) =>
  t.kind === 'PROJECT' ? `p:${t.projectId}` : `m:${t.monthCardId}`;

/**
 * GET /tasks/targets/company/:id as that form's options: every month card of a
 * running retainer (the page can be showing any month, and the pre-selection
 * needs that exact card to be a real option), then the live projects.
 */
export function companyWorkOptions(res: {
  monthCards: { id: string; month: string }[];
  projects: { id: string; name: string }[];
}): WorkOption[] {
  return [
    ...res.monthCards.map((m) => ({
      key: `m:${m.id}`,
      label: `Retainer — ${m.month}`,
      kind: 'MONTH_CARD' as const,
      monthCardId: m.id,
      month: m.month,
    })),
    ...res.projects.map((p) => ({ key: `p:${p.id}`, label: `Project — ${p.name}`, kind: 'PROJECT' as const, projectId: p.id })),
  ];
}

/**
 * Where one of those options files the task. The retainer project rides
 * alongside the month card, never instead of it: the month says when this is
 * billed and costed, the project says what it is for.
 */
export function workWhere(option: WorkOption, retainerProjectId: string): TaskWhere {
  return option.kind === 'PROJECT'
    ? { workType: 'PROJECT', projectId: option.projectId }
    : { workType: 'MONTH_CARD', monthCardId: option.monthCardId, retainerProjectId: retainerProjectId || undefined };
}

/** The form's own fields, as typed. */
export type TaskFormValues = {
  title: string;
  dueDate: string;
  /** "17:30", or '' for any time that day. */
  dueTime: string;
  repeat: string;
  priority: string;
  taskType: string;
  description: string;
  assignedById: string;
  /** Empty means "me", which is what the server already defaults to. */
  assigneeIds: string[];
  /** Set when the screen already said who (Team): sent as the one assignee. */
  fixedAssigneeId?: string;
};

/** The POST /tasks body: the same one each of the five forms sent before they shared this one. */
export function createTaskBody(v: TaskFormValues, where: TaskWhere): Record<string, unknown> {
  return {
    title: v.title.trim(),
    ...where,
    dueDate: v.dueDate,
    dueTime: v.dueTime || undefined,
    repeat: v.repeat || undefined,
    priority: v.priority,
    ...(v.fixedAssigneeId
      ? { assigneeId: v.fixedAssigneeId, assigneeIds: [v.fixedAssigneeId] }
      : { assigneeIds: v.assigneeIds.length > 0 ? v.assigneeIds : undefined }),
    // Nobody, until somebody says otherwise — see tasks.ts on why this field
    // means nothing when it is filled in by default.
    assignedById: v.assignedById || undefined,
    taskType: v.taskType || undefined,
    notes: v.description.trim() || undefined,
  };
}
