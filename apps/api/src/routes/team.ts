import { Router, type Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission, type AuthRequest, hasPermission } from '../middleware/auth.js';
import { listDepartments } from './departments.js';
import { loadWorkCalendar, workingMinutesOn } from '../utils/workCalendar.js';
import { LAST_REVIEW } from '../services/taskApprovals.js';
import { composeApprovalsReport } from '../services/approvalsReport.js';
import { toCsv } from '../utils/csv.js';
import { sendCsv } from '../utils/csvResponse.js';
import { teamScope, peopleInScope } from '../services/teamScope.js';

export const teamRouter = Router();

teamRouter.use(authenticate);

// ── Whose people this is ────────────────────────────────────────────────────
//
// For the line a Head sees on Team and All work: "Showing Video (12 people)".
// `all` for everybody whose view is not limited — Management, and a Head who
// leads no department yet.

teamRouter.get('/scope', async (req: AuthRequest, res: Response, next) => {
  try {
    const scope = await teamScope(req.user!);
    res.json({ success: true, scope: scope.all ? { all: true } : { all: false, departments: scope.departments } });
  } catch (error) {
    next(error);
  }
});

// ── Member picker (name + id only) ──────────────────────────────────────────
//
// Who works here isn't sensitive — only monthlyCost is (per §9, gated behind
// setup.admin everywhere else). /capacity needs work.team for task counts,
// but a BD user with only company.write still needs to pick a company's
// owner from *somewhere*, so this is gated on nothing but being logged in.
//
// Not limited to a Head's departments: assigning across departments is
// normal, so the picker offers everybody. `?scoped=1` is for the screens that
// filter BY person over a Head's own people — the calendar's team layer.

teamRouter.get('/members', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const base = { organizationId: orgId, active: true };
    const members = await prisma.user.findMany({
      where: req.query.scoped === '1' ? await peopleInScope(req.user!, base) : base,
      orderBy: { name: 'asc' },
      select: { id: true, name: true, designation: true, dept: true, departmentId: true },
    });
    res.json({ success: true, members });
  } catch (error) {
    next(error);
  }
});

teamRouter.get('/capacity', requirePermission('work.team'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const { departmentId } = req.query;
    const canSeeSalaries = hasPermission(req.user!, 'setup.admin');

    // By id, never by text: "Video & Production" survives a URL, a comma and a rename.
    // NONE is the people nobody has placed yet.
    const where: any = { organizationId: orgId, active: true };
    if (typeof departmentId === 'string' && departmentId && departmentId !== 'ALL') {
      where.departmentId = departmentId === 'NONE' ? null : departmentId;
    }

    const members = await prisma.user.findMany({
      // A Head sees the people of the departments they lead.
      where: await peopleInScope(req.user!, where),
      // In the departments' own order, as every other screen lists them.
      orderBy: [{ department: { sortOrder: 'asc' } }, { department: { name: 'asc' } }, { name: 'asc' }],
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
        departmentId: true,
        department: { select: { name: true } },
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
    const calendar = await loadWorkCalendar(orgId);
    const todayStr = now.toISOString().slice(0, 10);

    const formatted = members.map((m) => {
      const mine = m.taskAssignments.map((a) => a.task);
      // Waiting on an approver is open work, but not this person's to do — it
      // is not their load, and not their overdue.
      const openTasks = mine.filter((t) => t.status !== 'DONE' && t.status !== 'CANCELLED' && t.status !== 'IN_REVIEW');
      const overdueTasks = openTasks.filter((t) => new Date(t.dueDate).toISOString().slice(0, 10) < todayStr);
      const waitingTasks = mine.filter((t) => t.status === 'ON_HOLD');
      const completedTasks = mine.filter((t) => t.status === 'DONE');

      // Calculate average turnaround in working hours for completed tasks
      let totalWorkingMinutes = 0;
      for (const t of completedTasks) {
        const time = workingMinutesOn(calendar, t.assignedAt, t.completedAt || now, t.waitingTotalMinutes);
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

      return {
        id: m.id,
        name: m.name,
        designation: m.designation,
        email: m.email,
        dept: m.department?.name ?? '',
        departmentId: m.departmentId,
        preset: m.preset,
        monthlyCost: canSeeSalaries ? m.monthlyCost : undefined,
        permissions: canSeeSalaries ? m.permissions : undefined,
        openTasksCount: openTasks.length,
        overdueTasksCount: overdueTasks.length,
        waitingTasksCount: waitingTasks.length,
        completedTasksCount: completedTasks.length,
        avgTurnaround,
      };
    });

    /*
     * The departments: the organisation's own records, in their order — the
     * same list every screen offers, whatever the filter above narrowed
     * `members` to. A Head is offered only the ones they lead.
     */
    const scope = await teamScope(req.user!);
    const departments = (await listDepartments(orgId)).filter((d) => scope.all || scope.departmentIds.includes(d.id));

    if (req.query.format === 'csv') {
      const csv = toCsv(formatted, [
        { label: 'Name', value: (m) => m.name },
        { label: 'Designation', value: (m) => m.designation ?? '' },
        { label: 'Department', value: (m) => m.dept || 'No department' },
        { label: 'Open tasks', value: (m) => m.openTasksCount },
        { label: 'Overdue', value: (m) => m.overdueTasksCount },
        { label: 'Waiting', value: (m) => m.waitingTasksCount },
        { label: 'Completed', value: (m) => m.completedTasksCount },
        { label: 'Avg turnaround', value: (m) => m.avgTurnaround ?? '' },
      ]);
      sendCsv(res, `team-${new Date().toISOString().slice(0, 10)}`, csv);
      return;
    }

    res.json({
      success: true,
      departments,
      members: formatted,
    });
  } catch (error) {
    next(error);
  }
});

// ── One person, and the work that is actually on them ───────────────────────
//
// The capacity list answers "who is carrying what". It could not answer the
// next question anybody asks, which is "carrying WHAT" — it counts a
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

// ── Approvals report ────────────────────────────────────────────────────────
//
// The Team screen's Approvals tab: where approvals get stuck. Heads and
// management — `work.team`, the screen's own gate. The last 7 days by default,
// or 30; the "waiting now" list is live whatever the period. Declared before
// `/:id` so the path is not read as somebody's id.

teamRouter.get('/approvals-report', requirePermission('work.team'), async (req: AuthRequest, res: Response, next) => {
  try {
    const raw = req.query.days;
    const days = raw === undefined ? 7 : Number(raw);
    if (days !== 7 && days !== 30) {
      res.status(400).json({ success: false, error: 'Choose the last 7 or the last 30 days.' });
      return;
    }
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    const report = await composeApprovalsReport(req.user!.organizationId, { from, to }, to);
    res.json({ success: true, ...report, period: { ...report.period, days } });
  } catch (error) {
    next(error);
  }
});

teamRouter.get('/:id', requirePermission('work.team'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const id = String(req.params.id);
    const canSeeSalaries = hasPermission(req.user!, 'setup.admin');

    const member = await prisma.user.findFirst({
      // Somebody outside a Head's departments is "not on this team" to them —
      // the same 404 as an id that does not exist.
      where: await peopleInScope(req.user!, { id, organizationId: orgId }, { includeSelf: true }),
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
                dueTime: true,
                // For the small repeat mark on the person's list.
                repeat: { select: { id: true, frequency: true, weekday: true, dayOfMonth: true, stoppedAt: true, stoppedReason: true } },
                assignedAt: true,
                completedAt: true,
                waitingOn: true,
                waitingTotalMinutes: true,
                needsApproval: true,
                reviews: LAST_REVIEW,
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
    const calendar = await loadWorkCalendar(orgId);
    const todayStr = now.toISOString().slice(0, 10);
    const tasks = member.taskAssignments.map((a) => a.task);

    // In review is open, but it is the approver's move, not this person's.
    const open = tasks.filter((t) => t.status !== 'DONE' && t.status !== 'CANCELLED' && t.status !== 'IN_REVIEW');
    const overdue = open.filter((t) => t.dueDate.toISOString().slice(0, 10) < todayStr);
    const waiting = tasks.filter((t) => t.status === 'ON_HOLD');
    const done = tasks.filter((t) => t.status === 'DONE');

    let totalMinutes = 0;
    for (const t of done) {
      totalMinutes += workingMinutesOn(calendar, t.assignedAt, t.completedAt || now, t.waitingTotalMinutes).totalMinutes;
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
      },
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        taskType: t.taskType,
        dueDate: t.dueDate,
        dueTime: t.dueTime,
        repeat: t.repeat,
        waitingOn: t.waitingOn,
        needsApproval: t.needsApproval,
        lastReview: t.reviews[0] ?? null,
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
