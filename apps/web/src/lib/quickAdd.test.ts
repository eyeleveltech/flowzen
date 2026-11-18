import { describe, it, expect } from 'vitest';
import { quickAddBody, quickAddSummary } from './quickAdd';
import type { LastTaskChoices } from './api-v2';

/** Quick add on My Work (Ease Plan 1, decision 3): what Enter sends. */

const ACME_DESIGN: LastTaskChoices = {
  taskType: 'DESIGN',
  target: {
    scope: 'CLIENT',
    companyId: 'c-acme',
    name: 'Acme',
    key: 'rp-reels',
    label: 'Retainer — Reels',
    workType: 'RETAINER',
    monthCardId: 'mc-nov',
    retainerProjectId: 'rp-reels',
    month: '2026-11',
  },
};

describe('quickAddBody', () => {
  it('makes the task for me, due today, Medium, filed where my last one was', () => {
    expect(quickAddBody('  Check banner sizes ', ACME_DESIGN, '2026-11-17')).toEqual({
      title: 'Check banner sizes',
      workType: 'MONTH_CARD',
      monthCardId: 'mc-nov',
      retainerProjectId: 'rp-reels',
      dueDate: '2026-11-17',
      priority: 'MEDIUM',
      taskType: 'DESIGN',
    });
  });

  it('sends no assignee — the server makes it the caller’s own', () => {
    expect(quickAddBody('x', ACME_DESIGN, '2026-11-17')).not.toHaveProperty('assigneeIds');
  });

  it('files a project task under its project', () => {
    const body = quickAddBody('Fix footer', {
      taskType: 'DEVELOPMENT',
      target: { scope: 'CLIENT', companyId: 'c', name: 'Acme', key: 'pr-1', label: 'Project — Site', workType: 'PROJECT', projectId: 'pr-1' },
    }, '2026-11-17');
    expect(body).toMatchObject({ workType: 'PROJECT', projectId: 'pr-1' });
    expect(body).not.toHaveProperty('monthCardId');
  });

  it('internal work: an internal project, or none for "No project"', () => {
    expect(quickAddBody('a', { taskType: 'OTHER', target: { scope: 'INTERNAL', internalProjectId: 'ip-1', name: 'Brand' } }, '2026-11-17')).toMatchObject({
      workType: 'INTERNAL',
      internalProjectId: 'ip-1',
    });
    const none = quickAddBody('a', { taskType: 'OTHER', target: { scope: 'INTERNAL', internalProjectId: null, name: 'Internal' } }, '2026-11-17');
    expect(none).toMatchObject({ workType: 'INTERNAL' });
    expect(none).not.toHaveProperty('internalProjectId');
  });

  it('never guesses: no last choices, a closed target or no type — the full form opens instead', () => {
    expect(quickAddBody('a', null, '2026-11-17')).toBeNull();
    expect(quickAddBody('a', { taskType: 'DESIGN', target: null }, '2026-11-17')).toBeNull();
    expect(quickAddBody('a', { taskType: null, target: ACME_DESIGN.target }, '2026-11-17')).toBeNull();
    expect(quickAddBody('   ', ACME_DESIGN, '2026-11-17')).toBeNull();
  });
});

describe('quickAddSummary', () => {
  it('reads "Acme — Design"', () => {
    expect(quickAddSummary(ACME_DESIGN)).toBe('Acme — Design');
  });
});
