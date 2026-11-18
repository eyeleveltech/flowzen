import { describe, it, expect } from 'vitest';
import type { RememberedTarget } from '@/lib/api-v2';
import {
  EMPTY_PICK,
  NO_PROJECT,
  companyWorkOptions,
  createTaskBody,
  pickWhere,
  startFromLastChoices,
  workWhere,
  type OfferedTargets,
  type TaskFormValues,
} from './taskFormFields';

/**
 * The one new-task form (Ease Plan 1): it starts from the person's last
 * choices only where the screen has not answered "belongs to" itself, and only
 * with what it actually offers — and each of the five places that open it
 * still sends the body it sent before.
 */

const offered: OfferedTargets = {
  companies: [
    {
      id: 'acme',
      name: 'Acme',
      jobs: [
        { key: 'rp1', label: 'Retainer — Diwali', workType: 'RETAINER', monthCardId: 'mc11', retainerProjectId: 'rp1', month: '2026-11' },
        { key: 'pr1', label: 'Project — Website', workType: 'PROJECT', projectId: 'pr1' },
      ],
    },
  ],
  internalProjects: [{ id: 'ip1', name: 'Brand refresh' }],
};

const acmeDiwali: Extract<RememberedTarget, { scope: 'CLIENT' }> = {
  scope: 'CLIENT',
  companyId: 'acme',
  name: 'Acme',
  key: 'rp1',
  label: 'Retainer — Diwali',
  workType: 'RETAINER',
  monthCardId: 'mc11',
  retainerProjectId: 'rp1',
  month: '2026-11',
};

describe('startFromLastChoices', () => {
  it('starts empty for somebody who has never written a task', () => {
    expect(startFromLastChoices(null, offered)).toEqual({ taskType: null, belongsTo: null });
    expect(startFromLastChoices(undefined, offered)).toEqual({ taskType: null, belongsTo: null });
  });

  it('starts on the last type of work and client job', () => {
    expect(startFromLastChoices({ taskType: 'DESIGN', target: acmeDiwali }, offered)).toEqual({
      taskType: 'DESIGN',
      belongsTo: { scope: 'CLIENT', internalProjectId: '', companyId: 'acme', targetKey: 'rp1' },
    });
  });

  it('keeps the type but leaves "belongs to" empty once that work is closed', () => {
    expect(startFromLastChoices({ taskType: 'DESIGN', target: null }, offered)).toEqual({ taskType: 'DESIGN', belongsTo: null });
  });

  it('only uses a remembered job this form offers', () => {
    const gone = { ...acmeDiwali, key: 'rp-old' };
    expect(startFromLastChoices({ taskType: 'VIDEO', target: gone }, offered).belongsTo).toBeNull();
    const otherCompany = { ...acmeDiwali, companyId: 'globex' };
    expect(startFromLastChoices({ taskType: 'VIDEO', target: otherCompany }, offered).belongsTo).toBeNull();
  });

  it('remembers "No project" and an internal project that is still active', () => {
    expect(
      startFromLastChoices({ taskType: 'OTHER', target: { scope: 'INTERNAL', internalProjectId: null, name: 'Internal' } }, offered)
        .belongsTo,
    ).toEqual({ ...EMPTY_PICK, internalProjectId: NO_PROJECT });
    expect(
      startFromLastChoices({ taskType: 'OTHER', target: { scope: 'INTERNAL', internalProjectId: 'ip1', name: 'Brand refresh' } }, offered)
        .belongsTo,
    ).toEqual({ ...EMPTY_PICK, internalProjectId: 'ip1' });
    expect(
      startFromLastChoices({ taskType: 'OTHER', target: { scope: 'INTERNAL', internalProjectId: 'ip-closed', name: 'Old' } }, offered)
        .belongsTo,
    ).toBeNull();
  });

  it('the screen wins: with nothing offered, only the type comes back', () => {
    expect(startFromLastChoices({ taskType: 'DESIGN', target: acmeDiwali })).toEqual({ taskType: 'DESIGN', belongsTo: null });
  });

  it('ignores a type of work the form does not offer', () => {
    expect(startFromLastChoices({ taskType: 'GARDENING', target: null }, offered).taskType).toBeNull();
    expect(startFromLastChoices({ taskType: null, target: null }, offered).taskType).toBeNull();
  });
});

/** The body as it goes over the wire — `undefined` keys are not sent. */
const sent = (body: Record<string, unknown>) => JSON.parse(JSON.stringify(body));

const typed: TaskFormValues = {
  title: '  Check banner sizes ',
  dueDate: '2026-11-17',
  dueTime: '',
  repeat: '',
  priority: 'MEDIUM',
  taskType: 'DESIGN',
  description: '',
  assignedById: '',
  assigneeIds: [],
};

describe('createTaskBody — the same body each entry point sent before', () => {
  it('My Work / Calendar: a client job, with time, repeat, people and notes', () => {
    const where = pickWhere({ scope: 'CLIENT', internalProjectId: '', companyId: 'acme', targetKey: 'rp1' }, offered)!;
    const body = createTaskBody(
      { ...typed, dueTime: '17:30', repeat: 'WEEKLY', assigneeIds: ['u1', 'u2'], assignedById: 'u3', description: ' Sizes ' },
      where,
    );
    expect(sent(body)).toEqual({
      title: 'Check banner sizes',
      workType: 'MONTH_CARD',
      monthCardId: 'mc11',
      retainerProjectId: 'rp1',
      dueDate: '2026-11-17',
      dueTime: '17:30',
      repeat: 'WEEKLY',
      priority: 'MEDIUM',
      assigneeIds: ['u1', 'u2'],
      assignedById: 'u3',
      taskType: 'DESIGN',
      notes: 'Sizes',
    });
  });

  it('My Work: internal with No project sends no internal project, and nobody picked means me', () => {
    const where = pickWhere({ ...EMPTY_PICK, internalProjectId: NO_PROJECT }, offered)!;
    expect(sent(createTaskBody(typed, where))).toEqual({
      title: 'Check banner sizes',
      workType: 'INTERNAL',
      dueDate: '2026-11-17',
      priority: 'MEDIUM',
      taskType: 'DESIGN',
    });
    expect(pickWhere(EMPTY_PICK, offered)).toBeNull();
  });

  it('Team: the person as assigneeId and the only assignee', () => {
    const where = pickWhere({ scope: 'CLIENT', internalProjectId: '', companyId: 'acme', targetKey: 'pr1' }, offered)!;
    expect(sent(createTaskBody({ ...typed, fixedAssigneeId: 'p9' }, where))).toEqual({
      title: 'Check banner sizes',
      workType: 'PROJECT',
      projectId: 'pr1',
      dueDate: '2026-11-17',
      priority: 'MEDIUM',
      assigneeId: 'p9',
      assigneeIds: ['p9'],
      taskType: 'DESIGN',
    });
  });

  it('project and retainer pages: a month card with its piece of work, or a project', () => {
    const [month, project] = companyWorkOptions({ monthCards: [{ id: 'mc9', month: '2026-09' }], projects: [{ id: 'pr1', name: 'Website' }] });
    expect(month).toMatchObject({ key: 'm:mc9', label: 'Retainer — 2026-09' });
    expect(project).toMatchObject({ key: 'p:pr1', label: 'Project — Website' });
    expect(sent(createTaskBody(typed, workWhere(month, 'rp1')))).toMatchObject({ workType: 'MONTH_CARD', monthCardId: 'mc9', retainerProjectId: 'rp1' });
    expect(sent(createTaskBody(typed, workWhere(month, '')))).not.toHaveProperty('retainerProjectId');
    expect(sent(createTaskBody(typed, workWhere(project, 'rp1')))).toEqual({
      title: 'Check banner sizes',
      workType: 'PROJECT',
      projectId: 'pr1',
      dueDate: '2026-11-17',
      priority: 'MEDIUM',
      taskType: 'DESIGN',
    });
  });
});
