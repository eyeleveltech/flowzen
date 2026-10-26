import { describe, it, expect } from 'vitest';
import { NO_FILTERS, dueWhen, elapsedRange, filterOptions, isFiltering, matchesFilters, type FilterableTask } from './myWorkFilters';

/** My Work's column filters. Today, throughout: Monday 26 October 2026; a working day is 9 hours. */
const ctx = { today: '2026-10-26', dayMinutes: 540 };
const task = (over: Partial<FilterableTask>): FilterableTask => ({
  title: 'Edit the reel',
  taskType: 'VIDEO',
  clientName: 'Acme',
  projectName: 'Diwali campaign',
  internalProjectName: null,
  dueDate: '2026-10-26',
  status: 'TODO',
  priority: 'MEDIUM',
  workingMinutes: 120,
  ...over,
});

describe('My Work column filters', () => {
  it('nothing chosen is no filter at all', () => {
    expect(isFiltering(NO_FILTERS)).toBe(false);
    expect(matchesFilters(task({}), NO_FILTERS, ctx)).toBe(true);
    expect(isFiltering({ ...NO_FILTERS, text: '  ' })).toBe(false);
  });

  it('search finds the title, the client or the project', () => {
    expect(matchesFilters(task({}), { ...NO_FILTERS, text: 'reel' }, ctx)).toBe(true);
    expect(matchesFilters(task({}), { ...NO_FILTERS, text: 'acme' }, ctx)).toBe(true);
    expect(matchesFilters(task({}), { ...NO_FILTERS, text: 'diwali' }, ctx)).toBe(true);
    expect(matchesFilters(task({}), { ...NO_FILTERS, text: 'logo' }, ctx)).toBe(false);
  });

  it('within a column any value passes; across columns all must', () => {
    const f = { ...NO_FILTERS, priority: ['HIGH', 'MEDIUM'], status: ['IN_PROGRESS'] };
    expect(matchesFilters(task({ priority: 'HIGH', status: 'IN_PROGRESS' }), f, ctx)).toBe(true);
    expect(matchesFilters(task({ priority: 'MEDIUM', status: 'TODO' }), f, ctx)).toBe(false);
    expect(matchesFilters(task({ priority: 'LOW', status: 'IN_PROGRESS' }), f, ctx)).toBe(false);
  });

  it('due: overdue, today, the next 7 days, later — and a finished task is never overdue', () => {
    expect(dueWhen(task({ dueDate: '2026-10-20' }), ctx.today)).toBe('OVERDUE');
    expect(dueWhen(task({ dueDate: '2026-10-20', status: 'DONE' }), ctx.today)).toBe('EARLIER');
    expect(dueWhen(task({ dueDate: '2026-10-26' }), ctx.today)).toBe('TODAY');
    expect(dueWhen(task({ dueDate: '2026-11-02' }), ctx.today)).toBe('WEEK');
    expect(dueWhen(task({ dueDate: '2026-11-03' }), ctx.today)).toBe('LATER');
  });

  it('elapsed in working days, a day being the studio\'s day', () => {
    expect(elapsedRange(task({ workingMinutes: 539 }), 540)).toBe('UNDER_DAY');
    expect(elapsedRange(task({ workingMinutes: 540 }), 540)).toBe('ONE_TO_THREE');
    expect(elapsedRange(task({ workingMinutes: 1620 }), 540)).toBe('ONE_TO_THREE');
    expect(elapsedRange(task({ workingMinutes: 1621 }), 540)).toBe('OVER_THREE');
  });

  it('offers only what is on the list, with counts, the studio\'s own work last', () => {
    const o = filterOptions(
      [task({}), task({ clientName: 'Internal', taskType: null }), task({ clientName: 'Bolt', priority: 'URGENT' })],
      ctx,
    );
    expect(o.client.map((c) => [c.label, c.count])).toEqual([
      ['Acme', 1],
      ['Bolt', 1],
      ['Internal', 1],
    ]);
    expect(o.priority.map((p) => p.value)).toEqual(['URGENT', 'MEDIUM']);
    expect(o.type.at(-1)).toMatchObject({ value: 'NONE', label: 'No type', count: 1 });
    expect(o.due).toEqual([{ value: 'TODAY', label: 'Today', count: 3 }]);
  });
});
