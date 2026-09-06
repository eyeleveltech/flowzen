import { Router, type Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission, type AuthRequest, hasPermission } from '../middleware/auth.js';
import { calculateWorkingMinutes } from '../utils/workingHours.js';
import { loadPercentage } from '../utils/workload.js';
import { toCsv } from '../utils/csv.js';
import { sendCsv } from '../utils/csvResponse.js';

export const teamRouter = Router();

teamRouter.use(authenticate);

// ── Member picker (name + id only) ──────────────────────────────────────────
//
// Who works here isn't sensitive — only monthlyCost is (per §9, gated behind
// setup.admin everywhere else). /capacity needs work.team for workload data,
// but a BD user with only company.write still needs to pick a company's
// owner from *somewhere*, so this is gated on nothing but being logged in.

teamRouter.get('/members', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const members = await prisma.user.findMany({
      where: { organizationId: orgId, active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, designation: true, dept: true },
    });
    res.json({ success: true, members });
  } catch (error) {
    next(error);
  }
});

teamRouter.get('/capacity', requirePermission('work.team'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const { dept } = req.query;
    const canSeeSalaries = hasPermission(req.user!, 'setup.admin');

    const where: any = { organizationId: orgId, active: true };
    if (dept && typeof dept === 'string' && dept !== 'ALL') {
      where.dept = dept;
    }

    const members = await prisma.user.findMany({
      where,
      orderBy: [{ dept: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        // What they are called at work, which used to be smuggled inside
        // `name` — "Vikram (Developer)" — leaving this column empty on
        // thirteen of fourteen people and every screen unable to show one
        // without the other.
        designation: true,
        email: true,
        dept: true,
        preset: true,
        monthlyCost: true,
        permissions: true,
        // Through the join, so a task shared by three people counts on all
        // three desks. Counting it against the lead alone is how the two
        // helping look idle.
        taskAssignments: {
          where: { task: { deletedAt: null } },
          select: {
            task: {
              select: {
                id: true,
                status: true,
                dueDate: true,
                assignedAt: true,
                completedAt: true,
                waitingTotalMinutes: true,
              },
            },
          },
        },
      },
    });

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    const formatted = members.map((m) => {
      const mine = m.taskAssignments.map((a) => a.task);
      const openTasks = mine.filter((t) => t.status !== 'DONE' && t.status !== 'CANCELLED');
      const overdueTasks = mine.filter(
        (t) => t.status !== 'DONE' && t.status !== 'CANCELLED' && new Date(t.dueDate).toISOString().slice(0, 10) < todayStr,
      );
      const waitingTasks = mine.filter((t) => t.status === 'ON_HOLD');
      const completedTasks = mine.filter((t) => t.status === 'DONE');

      // Calculate average turnaround in working hours for completed tasks
      let totalWorkingMinutes = 0;
      for (const t of completedTasks) {
        const time = calculateWorkingMinutes(t.assignedAt, t.completedAt || now, t.waitingTotalMinutes);
        totalWorkingMinutes += time.totalMinutes;
      }
      /*
       * Null when there is nothing to average, not zero.
       *
       * Four of the fourteen people here have never finished a task, and this
       * rendered "0h 0m" for every one of them — which reads as the fastest
       * turnaround on the screen when it means there is no turnaround to
       * report. The same mistake as printing a masked figure as ₹0.
       */
      const avgMinutes = completedTasks.length > 0 ? Math.round(totalWorkingMinutes / completedTasks.length) : null;
      const avgTurnaround =
        avgMinutes === null ? null : `${Math.floor(avgMinutes / 60)}h ${avgMinutes % 60}m`;

      // Against this person's own trailing 8 week median, not a flat number
      // everyone is held to (brief §9). Uncapped — 100% isn't a ceiling here,
      // it's the point past which the load-and-delivery table turns red.
      const load = loadPercentage(mine, openTasks.length, now);

      return {
        id: m.id,
        name: m.name,
        designation: m.designation,
        email: m.email,
        dept: m.dept,
        preset: m.preset,
        monthlyCost: canSeeSalaries ? m.monthlyCost : undefined,
        permissions: canSeeSalaries ? m.permissions : undefined,
        openTasksCount: openTasks.length,
        overdueTasksCount: overdueTasks.length,
        waitingTasksCount: waitingTasks.length,
        completedTasksCount: completedTasks.length,
        avgTurnaround,
        loadPercentage: load,
      };
    });

    /*
     * The departments, from the whole team — never from `members`, which is
     * the list AFTER the department filter has been applied.
     *
     * Deriving them from the filtered rows is why the filter looked broken:
     * choosing Design narrowed `members` to three people, so the dropdown
     * rebuilt itself with one option in it and there was no way to go from
     * Design to Development without going back through All first. The same
     * fault as counting a tab from the rows the tab already filtered.
     */
    const deptRows = await prisma.user.groupBy({
      by: ['dept'],
      where: { organizationId: orgId, active: true },
      orderBy: { dept: 'asc' },
    });
    const allDepts = deptRows.map((d) => d.dept);

    if (req.query.format === 'csv') {
      const csv = toCsv(formatted, [
        { label: 'Name', value: (m) => m.name },
        { label: 'Designation', value: (m) => m.designation ?? '' },
        { label: 'Department', value: (m) => m.dept },
        { label: 'Open tasks', value: (m) => m.openTasksCount },
        { label: 'Overdue', value: (m) => m.overdueTasksCount },
        { label: 'Waiting', value: (m) => m.waitingTasksCount },
        { label: 'Completed', value: (m) => m.completedTasksCount },
        { label: 'Avg turnaround', value: (m) => m.avgTurnaround ?? '' },
        { label: 'Load %', value: (m) => m.loadPercentage },
      ]);
      sendCsv(res, `team-${new Date().toISOString().slice(0, 10)}`, csv);
      return;
    }

    res.json({
      success: true,
      departments: allDepts,
      members: formatted,
    });
  } catch (error) {
    next(error);
  }
});

// ── One person, and the work that is actually on them ───────────────────────
//
// The capacity list answers "who is overloaded". It cannot answer the next
// question anybody asks, which is "overloaded with WHAT" — it counts a
// person's tasks and never carries their titles, let alone the job each one
// belongs to. So a Head could see that Sneha is at 333% of a normal load and
// had nowhere to go from there.
//
// The work a task belongs to takes two different routes through the schema and
// exactly one of them is ever set: `projectId` for one-off work, `monthCardId`
// for a month of a retainer. Zero of the eighty-two tasks in this database
// carry both, and a task with neither is internal. Resolving both here rather
// than in the browser keeps the two shapes from leaking into the UI as a pair
// of optional fields nobody remembers to handle.

teamRouter.get('/:id', requirePermission('work.team'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const id = String(req.params.id);
    const canSeeSalaries = hasPermission(req.user!, 'setup.admin');

    const member = await prisma.user.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        name: true,
        designation: true,
        email: true,
        dept: true,
        preset: true,
        active: true,
        monthlyCost: true,
        // Through the join, so somebody helping on a task sees it here rather
        // than only the person who leads it.
        taskAssignments: {
          where: { task: { deletedAt: null } },
          orderBy: { task: { dueDate: 'asc' } },
          select: {
            task: {
              select: {
                id: true,
                title: true,
                status: true,
                priority: true,
                taskType: true,
                dueDate: true,
                assignedAt: true,
                completedAt: true,
                waitingOn: true,
                waitingTotalMinutes: true,
                assignedBy: { select: { id: true, name: true } },
                creator: { select: { id: true, name: true } },
                reviewer: { select: { id: true, name: true } },
                assignees: { select: { user: { select: { id: true, name: true } } } },
                project: {
                  select: { id: true, name: true, company: { select: { id: true, name: true } } },
                },
                monthCard: {
                  select: {
                    id: true,
                    month: true,
                    retainer: {
                      select: { id: true, company: { select: { id: true, name: true } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!member) {
      res.status(404).json({ success: false, error: 'That person is not on this team' });
      return;
    }

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const tasks = member.taskAssignments.map((a) => a.task);

    const open = tasks.filter((t) => t.status !== 'DONE' && t.status !== 'CANCELLED');
    const overdue = open.filter((t) => t.dueDate.toISOString().slice(0, 10) < todayStr);
    const waiting = tasks.filter((t) => t.status === 'ON_HOLD');
    const done = tasks.filter((t) => t.status === 'DONE');

    let totalMinutes = 0;
    for (const t of done) {
      totalMinutes += calculateWorkingMinutes(t.assignedAt, t.completedAt || now, t.waitingTotalMinutes).totalMinutes;
    }
    // Null, not zero — see the capacity route: no finished work is not a
    // turnaround of nothing.
    const avg = done.length > 0 ? Math.round(totalMinutes / done.length) : null;

    const monthName = (m: string) => {
      const [y, mo] = m.split('-').map(Number);
      return new Date(y, mo - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    };

    res.json({
      success: true,
      member: {
        id: member.id,
        name: member.name,
        designation: member.designation,
        email: member.email,
        dept: member.dept,
        preset: member.preset,
        active: member.active,
        monthlyCost: canSeeSalaries ? member.monthlyCost : null,
        openTasksCount: open.length,
        overdueTasksCount: overdue.length,
        waitingTasksCount: waiting.length,
        completedTasksCount: done.length,
        avgTurnaround: avg === null ? null : `${Math.floor(avg / 60)}h ${avg % 60}m`,
        loadPercentage: loadPercentage(tasks, open.length, now),
      },
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        taskType: t.taskType,
        dueDate: t.dueDate,
        waitingOn: t.waitingOn,
        // The person who asked for it, not the person who typed it in.
        // `creator` is the fallback for rows written before the two were
        // separate columns, which the backfill has already made equal.
        assignedBy: t.assignedBy ?? t.creator,
        reviewer: t.reviewer,
        // Who else is on it — the reason a task can appear on two people's
        // screens without either of them wondering why.
        withOthers: t.assignees.map((a) => a.user).filter((u) => u.id !== member.id),
        overdue: t.status !== 'DONE' && t.status !== 'CANCELLED' && t.dueDate.toISOString().slice(0, 10) < todayStr,
        // Where the work lives, resolved to one shape whichever column it came
        // down. `href` is the screen that task is worked on, so a name in this
        // drawer is a way in rather than a label.
        work: t.project
          ? {
              kind: 'PROJECT' as const,
              label: t.project.name,
              clientName: t.project.company?.name ?? null,
              href: `/projects/${t.project.id}`,
            }
          : t.monthCard
            ? {
                kind: 'RETAINER' as const,
                label: `${monthName(t.monthCard.month)} retainer`,
                clientName: t.monthCard.retainer?.company?.name ?? null,
                href: t.monthCard.retainer
                  ? `/retainers/${t.monthCard.retainer.id}?month=${t.monthCard.month}&tab=tasks`
                  : null,
              }
            : { kind: 'INTERNAL' as const, label: 'Internal', clientName: null, href: null },
      })),
    });
  } catch (error) {
    next(error);
  }
});
