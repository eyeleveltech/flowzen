import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { DEFAULT_WORK_CALENDAR, type WorkCalendar } from '../utils/workCalendar.js';
import { createFrom, nextDueFor, ordinal, repeatLabel, ruleFromDueDate, type RepeatRule } from '../services/taskRepeat.js';
import { runTaskRepeats } from './taskRepeat.cron.js';

/**
 * Repeating tasks: the date maths, and the job's rules.
 *
 * The calendar is the default one — Monday to Saturday — so Sunday is the day
 * off, plus whatever holidays a test adds. October 2026: Thu 1, Sun 4, Mon 5,
 * Thu 8, Thu 15.
 */

const cal = (holidays: string[] = []): WorkCalendar => ({ ...DEFAULT_WORK_CALENDAR, holidays });
const DAILY: RepeatRule = { frequency: 'DAILY', weekday: null, dayOfMonth: null };
const THURSDAYS: RepeatRule = { frequency: 'WEEKLY', weekday: 4, dayOfMonth: null };
const ON_THE_31ST: RepeatRule = { frequency: 'MONTHLY', weekday: null, dayOfMonth: 31 };

describe('the rule, from a due date', () => {
  it('keeps the weekday or the day of the month', () => {
    expect(ruleFromDueDate('WEEKLY', '2026-10-01')).toEqual(THURSDAYS);
    expect(ruleFromDueDate('MONTHLY', '2026-10-31')).toEqual(ON_THE_31ST);
    expect(ruleFromDueDate('DAILY', '2026-10-01')).toEqual(DAILY);
  });

  it('says itself in words', () => {
    expect(repeatLabel(THURSDAYS)).toBe('Every week on Thursday');
    expect(repeatLabel({ frequency: 'MONTHLY', weekday: null, dayOfMonth: 2 })).toBe('Every month on the 2nd');
    expect(repeatLabel(DAILY)).toBe('Every working day');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '31st',
    ]);
  });
});

describe('the next due date', () => {
  it('daily: skips Sunday and a holiday', () => {
    // Saturday's copy; the next working day is Monday.
    expect(nextDueFor(DAILY, cal(), '2026-10-03', '2026-10-04')).toBe('2026-10-05');
    // Monday is a holiday: Tuesday.
    expect(nextDueFor(DAILY, cal(['2026-10-05']), '2026-10-03', '2026-10-04')).toBe('2026-10-06');
  });

  it('weekly: a holiday moves one copy, and the next is back on the weekday', () => {
    const holiday = cal(['2026-10-08']);
    expect(nextDueFor(THURSDAYS, holiday, '2026-10-01', '2026-10-02')).toBe('2026-10-09');
    expect(nextDueFor(THURSDAYS, holiday, '2026-10-09', '2026-10-09')).toBe('2026-10-15');
  });

  it('weekly: never a date in the past', () => {
    // Nothing made for a month: the next Thursday from today, not the missed ones.
    expect(nextDueFor(THURSDAYS, cal(), '2026-09-03', '2026-10-02')).toBe('2026-10-08');
    // But a Thursday a holiday pushed to today is today's.
    expect(nextDueFor(THURSDAYS, cal(['2026-10-01']), '2026-09-24', '2026-10-02')).toBe('2026-10-02');
  });

  it('monthly on the 31st: the last day of a shorter month', () => {
    expect(nextDueFor(ON_THE_31ST, cal(), '2026-10-31', '2026-11-01')).toBe('2026-11-30');
    expect(nextDueFor(ON_THE_31ST, cal(), '2026-01-31', '2026-02-01')).toBe('2026-02-28');
    expect(nextDueFor(ON_THE_31ST, cal(), '2028-01-31', '2028-02-01')).toBe('2028-02-29');
  });

  it('is made on the day for a daily task, three days ahead otherwise', () => {
    expect(createFrom(DAILY, '2026-10-08')).toBe('2026-10-08');
    expect(createFrom(THURSDAYS, '2026-10-08')).toBe('2026-10-05');
  });
});

// ── The job ──────────────────────────────────────────────────────────────────

const ORG = 'org-1';
const ME = 'u-me';

/** Monday 5 October 2026, 11:30 in India. */
const MONDAY = new Date('2026-10-05T06:00:00Z');

const source = (over: Record<string, unknown> = {}) => ({
  id: 'task-last',
  title: 'Weekly ad account check',
  status: 'TODO',
  workType: 'INTERNAL',
  workId: null,
  monthCardId: null,
  monthCard: null,
  projectId: null,
  project: null,
  retainerProjectId: null,
  retainerProject: null,
  internalProjectId: null,
  internalProject: null,
  companyId: null,
  createdById: ME,
  assignedById: null,
  assignedBy: null,
  reviewerId: null,
  reviewer: null,
  taskType: 'DIGITAL_MARKETING',
  needsApproval: false,
  dueTime: '17:00',
  priority: 'HIGH',
  notes: 'Check spend and pause what is not working.',
  dueDate: new Date('2026-10-01T00:00:00Z'),
  assignees: [{ user: { id: ME, active: true } }],
  ...over,
});

let series: Record<string, unknown>;
let latest: ReturnType<typeof source> | null;
let lastDueDate: Date;

beforeEach(() => {
  series = { id: 'rep-1', organizationId: ORG, ...THURSDAYS };
  latest = source();
  lastDueDate = new Date('2026-10-01T00:00:00Z');
  (prisma.taskRepeat.findMany as any).mockImplementation(async () => [series]);
  // The calendar and the timezone both come off the organisation row.
  (prisma.organization.findUnique as any).mockResolvedValue({ timezone: 'Asia/Kolkata' });
  (prisma.task.findFirst as any).mockImplementation(async (args: any) =>
    // The "latest date, deleted included" lookup selects only the date.
    args.select?.dueDate && !args.include ? { dueDate: lastDueDate } : latest,
  );
  (prisma.task.create as any).mockImplementation(async ({ data }: any) => ({
    id: 'task-new',
    ...data,
    assignees: [],
  }));
  (prisma.activity.create as any).mockResolvedValue({});
  (prisma.taskRepeat.updateMany as any).mockResolvedValue({ count: 1 });
});

const made = () => (prisma.task.create as any).mock.calls.map((c: any[]) => c[0].data);
const stoppedWith = () => (prisma.taskRepeat.updateMany as any).mock.calls[0]?.[0].data.stoppedReason;

describe('the repeat job', () => {
  it('weekly: makes the next copy three days ahead, even while the last is open — from the latest copy', async () => {
    latest = source({ title: 'Weekly ad account check (renamed)' });
    const out = await runTaskRepeats(MONDAY);
    expect(out.created).toBe(1);
    expect(made()[0]).toMatchObject({
      title: 'Weekly ad account check (renamed)',
      dueDate: new Date('2026-10-08T00:00:00Z'),
      dueTime: '17:00',
      priority: 'HIGH',
      taskType: 'DIGITAL_MARKETING',
      notes: 'Check spend and pause what is not working.',
      status: 'TODO',
      repeatId: 'rep-1',
    });
    const log = (prisma.activity.create as any).mock.calls[0][0].data;
    expect(log).toMatchObject({ verb: 'task_repeated', actorId: null });
  });

  it('weekly: waits until three days before', async () => {
    const out = await runTaskRepeats(new Date('2026-10-04T06:00:00Z')); // Sunday
    expect(out.created).toBe(0);
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('daily: nothing while the last copy is open; the next working day once it is done', async () => {
    series = { id: 'rep-1', organizationId: ORG, ...DAILY };
    latest = source({ status: 'IN_PROGRESS', dueDate: new Date('2026-10-03T00:00:00Z') });
    lastDueDate = new Date('2026-10-03T00:00:00Z');
    expect((await runTaskRepeats(MONDAY)).created).toBe(0);

    latest = source({ status: 'DONE', dueDate: new Date('2026-10-03T00:00:00Z') });
    expect((await runTaskRepeats(MONDAY)).created).toBe(1);
    // Saturday's done; Sunday is off; Monday's copy.
    expect(made()[0].dueDate).toEqual(new Date('2026-10-05T00:00:00Z'));
  });

  it('does not bring back a deleted copy', async () => {
    // The 8th was made and deleted: the latest standing copy is the 1st, but
    // the series has reached the 8th, so the next is the 15th.
    lastDueDate = new Date('2026-10-08T00:00:00Z');
    const out = await runTaskRepeats(new Date('2026-10-12T06:00:00Z'));
    expect(out.created).toBe(1);
    expect(made()[0].dueDate).toEqual(new Date('2026-10-15T00:00:00Z'));
  });

  it('a retainer copy waits for its month card, then goes on it', async () => {
    latest = source({
      workType: 'MONTH_CARD',
      monthCardId: 'card-oct',
      monthCard: { retainerId: 'ret-1', retainer: { status: 'ACTIVE' } },
      retainerProjectId: 'rp-1',
      retainerProject: { status: 'ACTIVE' },
      dueDate: new Date('2026-10-29T00:00:00Z'),
    });
    lastDueDate = new Date('2026-10-29T00:00:00Z');
    (prisma.monthCard.findFirst as any).mockResolvedValue(null);
    // Thursday 5 November is due; three days ahead is the 2nd — but no November card yet.
    const wait = await runTaskRepeats(new Date('2026-11-02T06:00:00Z'));
    expect(wait).toMatchObject({ created: 0, waiting: 1 });
    expect((prisma.monthCard.findFirst as any).mock.calls[0][0].where).toEqual({ retainerId: 'ret-1', month: '2026-11' });

    (prisma.monthCard.findFirst as any).mockResolvedValue({ id: 'card-nov' });
    expect((await runTaskRepeats(new Date('2026-11-02T06:00:00Z'))).created).toBe(1);
    expect(made()[0]).toMatchObject({ monthCardId: 'card-nov', retainerProjectId: 'rp-1', workId: 'card-nov' });
  });

  it('stops when the retainer is stopped, and says so', async () => {
    latest = source({ monthCardId: 'card-oct', monthCard: { retainerId: 'ret-1', retainer: { status: 'STOPPED' } } });
    const out = await runTaskRepeats(MONDAY);
    expect(out.stopped).toBe(1);
    expect(stoppedWith()).toBe('Retainer stopped');
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('stops when the project is delivered, or the internal project is done', async () => {
    latest = source({ projectId: 'p-1', project: { status: 'DELIVERED', deletedAt: null } });
    await runTaskRepeats(MONDAY);
    expect(stoppedWith()).toBe('Project delivered');

    (prisma.taskRepeat.updateMany as any).mockClear();
    latest = source({ internalProjectId: 'ip-1', internalProject: { status: 'DONE' } });
    await runTaskRepeats(MONDAY);
    expect(stoppedWith()).toBe('Internal project done');
  });

  it('drops people who have left, and stops when nobody is left', async () => {
    latest = source({
      assignees: [{ user: { id: 'u-gone', active: false } }, { user: { id: ME, active: true } }],
    });
    await runTaskRepeats(MONDAY);
    expect(made()[0].assigneeId).toBe(ME);
    expect(made()[0].assignees.create).toEqual([{ userId: ME }]);

    (prisma.task.create as any).mockClear();
    latest = source({ assignees: [{ user: { id: 'u-gone', active: false } }] });
    await runTaskRepeats(MONDAY);
    expect(stoppedWith()).toBe('Nobody active to assign');
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('stops when every copy is gone', async () => {
    latest = null;
    await runTaskRepeats(MONDAY);
    expect(stoppedWith()).toBe('No task left to copy');
  });

  it('running twice makes nothing extra — the second insert is skipped quietly', async () => {
    (prisma.task.create as any).mockRejectedValue(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));
    const out = await runTaskRepeats(MONDAY);
    expect(out.created).toBe(0);
    expect(prisma.activity.create).not.toHaveBeenCalled();
  });
});
