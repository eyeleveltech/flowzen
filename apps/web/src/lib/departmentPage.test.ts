import { describe, it, expect } from 'vitest';
import { teamTabRedirect } from './departmentPage';
import { groupTasks, type BoardTask } from '@/components/department/boardBits';

/** Department head page plan: Team → Board became My Department. */
describe('the old Board tab', () => {
  it('sends /members?tab=board to My Department', () => {
    expect(teamTabRedirect('board')).toBe('/my-department');
    expect(teamTabRedirect('BOARD')).toBe('/my-department');
  });

  it('leaves the tabs still on Team alone', () => {
    expect(teamTabRedirect('team')).toBeNull();
    expect(teamTabRedirect('approvals')).toBeNull();
    expect(teamTabRedirect(null)).toBeNull();
  });
});

describe("the person panel's task groups", () => {
  const t = (id: string, status: string, dueDate: string) => ({ id, status, dueDate: `${dueDate}T00:00:00.000Z` }) as unknown as BoardTask;

  it('puts waiting work in its own group, and the rest by due date', () => {
    const g = groupTasks(
      [
        t('late', 'TODO', '2026-10-22'),
        t('today', 'IN_PROGRESS', '2026-10-26'),
        t('week', 'TODO', '2026-10-30'),
        t('later', 'TODO', '2026-11-12'),
        t('hold', 'ON_HOLD', '2026-10-20'),
        t('done', 'DONE', '2026-10-22'),
      ],
      '2026-10-26',
      '2026-11-01',
    );
    expect(Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.map((x) => x.id)]))).toEqual({
      Overdue: ['late'],
      Today: ['today'],
      'This week': ['week'],
      Later: ['later'],
      Waiting: ['hold'],
    });
  });
});
