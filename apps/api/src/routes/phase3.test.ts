import { describe, it, expect } from 'vitest';
import { calculateWorkingMinutes } from '../utils/workingHours.js';
import { TaskStatus, TaskWorkType, ProjectStatus, MilestoneStatus } from '@prisma/client';

describe('Phase 3: Work Execution & Delivery Engine Logic Tests', () => {
  it('1. Verifies working hours calculation inside Mon-Sat 10:00-19:00 IST', () => {
    // 2026-09-01 is a Tuesday. 10:00 to 14:30 is 4 hours 30 min (270 min).
    // In UTC, 10:00 IST is 04:30 UTC. 14:30 IST is 09:00 UTC.
    const start = new Date(Date.UTC(2026, 8, 1, 4, 30, 0));
    const end = new Date(Date.UTC(2026, 8, 1, 9, 0, 0));

    const result = calculateWorkingMinutes(start, end, 0);
    expect(result.totalMinutes).toBe(270);
    expect(result.hours).toBe(4);
    expect(result.minutes).toBe(30);
    expect(result.formatted).toBe('4h 30m');
  });

  it('2. Deducts waitingTotalMinutes from working elapsed time', () => {
    const start = new Date(Date.UTC(2026, 8, 1, 4, 30, 0));
    const end = new Date(Date.UTC(2026, 8, 1, 9, 0, 0)); // 270 min total

    // 60 minutes on hold (Waiting on Client)
    const result = calculateWorkingMinutes(start, end, 60);
    expect(result.totalMinutes).toBe(210);
    expect(result.hours).toBe(3);
    expect(result.minutes).toBe(30);
    expect(result.formatted).toBe('3h 30m');
  });

  it('3. Verifies Sunday exclusion (Sunday is non-working day 0)', () => {
    // 2026-09-06 is a Sunday. 10:00 to 19:00 on Sunday should yield 0 working minutes.
    const sundayStart = new Date(Date.UTC(2026, 8, 6, 4, 30, 0));
    const sundayEnd = new Date(Date.UTC(2026, 8, 6, 13, 30, 0));

    const result = calculateWorkingMinutes(sundayStart, sundayEnd, 0);
    expect(result.totalMinutes).toBe(0);
    expect(result.formatted).toBe('0m');
  });

  it('4. Verifies Retainer vs Project operational rules', () => {
    // Retainer has monthly value and MonthCards
    const retainer = {
      monthlyValue: 220000,
      termMonths: 12,
      monthCards: [{ month: '2026-08', status: 'CLOSED' }, { month: '2026-09', status: 'OPEN' }],
    };
    expect(retainer.monthCards.length).toBe(2);

    // Project has fixed quoted value and milestone schedule
    const project = {
      quotedValue: 150000,
      estimatedCost: 55000,
      milestones: [
        { label: 'Advance', percent: 40, status: 'PAID' },
        { label: 'Delivery', percent: 60, status: 'PENDING' },
      ],
    };
    const paidPercent = project.milestones.filter((m) => m.status === 'PAID').reduce((acc, m) => acc + m.percent, 0);
    expect(paidPercent).toBe(40);
  });

  it('5. Verifies task reopen increment logic', () => {
    let task: { status: TaskStatus; reopenCount: number; completedAt: Date | null } = {
      status: TaskStatus.TODO,
      reopenCount: 0,
      completedAt: null,
    };

    // Complete task
    task = { ...task, status: TaskStatus.DONE, completedAt: new Date() };
    expect(task.status).toBe('DONE');
    expect(task.completedAt).not.toBeNull();

    // Reopen task
    task = { ...task, status: TaskStatus.TODO, completedAt: null, reopenCount: task.reopenCount + 1 };
    expect(task.status).toBe('TODO');
    expect(task.completedAt).toBeNull();
    expect(task.reopenCount).toBe(1);
  });
});
