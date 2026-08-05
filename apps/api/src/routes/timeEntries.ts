import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { emitToOrganization } from '../sse.js';

/**
 * Logged hours.
 *
 * Built to answer "did we make money on this client", not "who worked the fewest hours". The P&L
 * compared payments received against vendor expenses and carried NO labour cost, so a retainer
 * that consumed eighty hours of the team's month scored identically to one that consumed eight.
 * These entries are what put delivery effort on the cost side of that calculation.
 *
 * Two rules shape everything below:
 *
 *  1. A person owns their own time. Anyone can log, edit and delete their OWN entries; only an
 *     admin can touch someone else's or read the whole org's. Nobody has to ask permission to
 *     correct their own Tuesday.
 *
 *  2. Money is admin-only. `costRate` is what the agency pays for an hour of someone's time —
 *     effectively their salary, divided. It is stripped from every response to a non-admin,
 *     including their own entries, because a team member's timesheet should not double as a
 *     payroll disclosure to anyone who can read the network tab.
 */

export const timeEntryRouter = Router();

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN'];
const isAdmin = (req: AuthRequest) => ADMIN_ROLES.includes(req.user!.role);

const timeEntrySchema = z.object({
  taskId: z.string().optional(),
  projectId: z.string().optional(),
  // Whose time this is. Absent means the caller's own; only an admin may set it to someone else.
  userId: z.string().optional(),
  date: z.string().refine((d) => !isNaN(Date.parse(d)), 'Invalid date'),
  // A day has 24 hours, so anything above it is a typo (usually minutes typed into an hours box).
  // Rejecting it here keeps a single fat-fingered "800" from swamping a whole project's costing.
  hours: z.number().positive('Hours must be greater than zero').max(24, 'A single entry cannot exceed 24 hours'),
  note: z.string().max(500).optional(),
});

/** Strip the money from an entry unless the caller is an admin. See rule 2 above. */
function shape(entry: any, admin: boolean) {
  if (admin) return { ...entry, cost: cost(entry) };
  const { costRate, ...rest } = entry;
  return rest;
}

/** What this entry cost the agency. An uncosted person contributes hours but no money. */
function cost(entry: { hours: any; costRate: any }): number {
  return Number(entry.hours || 0) * Number(entry.costRate || 0);
}

const entryInclude = {
  user: { select: { id: true, name: true, avatar: true } },
  task: { select: { id: true, title: true } },
  project: { select: { id: true, name: true } },
  client: { select: { id: true, name: true, company: true } },
};

/**
 * Resolve what a new entry is attached to, and prove it all belongs to the caller's org.
 *
 * A task already knows its project and client, so those are derived rather than trusted from the
 * request — otherwise a caller could file time against task A while attributing the cost to
 * project B, and the roll-up would disagree with the task list forever.
 */
async function resolveTarget(orgId: string, body: { taskId?: string; projectId?: string }) {
  if (body.taskId) {
    const task = await prisma.task.findFirst({
      where: { id: body.taskId, OR: [{ project: { client: { organizationId: orgId } } }, { client: { organizationId: orgId } }, { lead: { organizationId: orgId } }] },
      select: { id: true, projectId: true, clientId: true, project: { select: { clientId: true } } },
    });
    if (!task) return { error: 'Task not found' as const };
    return { taskId: task.id, projectId: task.projectId, clientId: task.clientId ?? task.project?.clientId ?? null };
  }
  if (body.projectId) {
    const project = await prisma.project.findFirst({
      where: { id: body.projectId, client: { organizationId: orgId } },
      select: { id: true, clientId: true },
    });
    if (!project) return { error: 'Project not found' as const };
    return { taskId: null, projectId: project.id, clientId: project.clientId };
  }
  // Time with nothing attached is time nobody can cost, so it is refused rather than stored.
  return { error: 'A time entry must be attached to a task or a project' as const };
}

// GET /api/time-entries — the caller's own entries, or the whole org for an admin.
timeEntryRouter.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const admin = isAdmin(req);
    const { from, to, userId, projectId, taskId, clientId } = req.query as Record<string, string>;

    const where: any = { organizationId: orgId };
    // A non-admin sees only their own time, whatever they ask for.
    where.userId = admin ? (userId || undefined) : req.user!.userId;
    if (projectId) where.projectId = projectId;
    if (taskId) where.taskId = taskId;
    if (clientId) where.clientId = clientId;
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }

    const take = Math.min(Number(req.query.limit) || 200, 500);
    const entries = await prisma.timeEntry.findMany({
      where,
      include: entryInclude,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take,
    });

    const totalHours = entries.reduce((s, e) => s + Number(e.hours), 0);
    res.json({
      entries: entries.map((e) => shape(e, admin)),
      totalHours,
      ...(admin ? { totalCost: entries.reduce((s, e) => s + cost(e), 0) } : {}),
    });
  } catch (error) { next(error); }
});

/**
 * GET /api/time-entries/summary — hours and cost rolled up, for the profitability view.
 * Admin-only, because the whole point of it is the money.
 */
timeEntryRouter.get('/summary', async (req: AuthRequest, res: Response, next) => {
  try {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Not authorized to view cost summaries' }); return; }
    const orgId = req.user!.organizationId;
    const { from, to } = req.query as Record<string, string>;
    const groupBy = (req.query.groupBy as string) || 'project';
    if (!['project', 'client', 'user'].includes(groupBy)) {
      res.status(400).json({ error: 'groupBy must be one of: project, client, user' });
      return;
    }

    const where: any = { organizationId: orgId };
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }

    const entries = await prisma.timeEntry.findMany({ where, include: entryInclude });

    const buckets = new Map<string, { id: string; label: string; hours: number; cost: number; entries: number }>();
    for (const e of entries) {
      const key = groupBy === 'project' ? (e.projectId || 'none')
        : groupBy === 'client' ? (e.clientId || 'none')
          : e.userId;
      const label = groupBy === 'project' ? (e.project?.name || 'No project')
        : groupBy === 'client' ? (e.client?.company || e.client?.name || 'No client')
          : (e.user?.name || 'Unknown');
      const b = buckets.get(key) || { id: key, label, hours: 0, cost: 0, entries: 0 };
      b.hours += Number(e.hours);
      b.cost += cost(e);
      b.entries += 1;
      buckets.set(key, b);
    }

    const rows = Array.from(buckets.values()).sort((a, b) => b.cost - a.cost);
    res.json({
      groupBy,
      rows,
      totalHours: rows.reduce((s, r) => s + r.hours, 0),
      totalCost: rows.reduce((s, r) => s + r.cost, 0),
    });
  } catch (error) { next(error); }
});

// POST /api/time-entries
timeEntryRouter.post('/', validate(timeEntrySchema), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const admin = isAdmin(req);
    const body = req.body as z.infer<typeof timeEntrySchema>;

    // Logging time for someone else is an admin action — otherwise anyone could inflate a
    // colleague's hours, and the cost roll-up would be attributing money to the wrong person.
    const targetUserId = body.userId && body.userId !== req.user!.userId ? body.userId : req.user!.userId;
    if (targetUserId !== req.user!.userId && !admin) {
      res.status(403).json({ error: 'You can only log time against yourself' });
      return;
    }

    const targetUser = await prisma.user.findFirst({
      where: { id: targetUserId, organizationId: orgId },
      select: { id: true, hourlyCostRate: true },
    });
    if (!targetUser) { res.status(400).json({ error: 'User not found in your organization' }); return; }

    const target = await resolveTarget(orgId, body);
    if ('error' in target) { res.status(400).json({ error: target.error }); return; }

    const entry = await prisma.timeEntry.create({
      data: {
        organizationId: orgId,
        userId: targetUserId,
        taskId: target.taskId,
        projectId: target.projectId,
        clientId: target.clientId,
        date: new Date(body.date),
        hours: body.hours,
        note: body.note || null,
        // Snapshotted, not joined — a later pay rise must not rewrite the cost of past work.
        costRate: targetUser.hourlyCostRate ?? null,
      },
      include: entryInclude,
    });

    emitToOrganization(req.app.get('io'), orgId, 'time:updated', { taskId: target.taskId, projectId: target.projectId });
    res.status(201).json(shape(entry, admin));
  } catch (error) { next(error); }
});

// PATCH /api/time-entries/:id — correct an entry. Own entries always; anyone's if admin.
timeEntryRouter.patch('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const admin = isAdmin(req);
    const existing = await prisma.timeEntry.findFirst({
      where: { id: req.params.id as string, organizationId: orgId },
      select: { id: true, userId: true },
    });
    if (!existing) { res.status(404).json({ error: 'Time entry not found' }); return; }
    if (existing.userId !== req.user!.userId && !admin) {
      res.status(403).json({ error: 'You can only edit your own time entries' });
      return;
    }

    const patch = timeEntrySchema.partial().safeParse(req.body);
    if (!patch.success) {
      res.status(400).json({ error: 'Validation failed', details: patch.error.issues });
      return;
    }
    const data: any = {};
    if (patch.data.hours !== undefined) data.hours = patch.data.hours;
    if (patch.data.date !== undefined) data.date = new Date(patch.data.date);
    if (patch.data.note !== undefined) data.note = patch.data.note || null;
    // Re-pointing an entry at a different task also moves its project and client, so it goes
    // through the same resolution as a create rather than trusting the ids sent.
    if (patch.data.taskId !== undefined || patch.data.projectId !== undefined) {
      const target = await resolveTarget(orgId, patch.data);
      if ('error' in target) { res.status(400).json({ error: target.error }); return; }
      Object.assign(data, target);
    }
    // costRate is deliberately NOT editable: it is a historical snapshot, not a setting.

    const updated = await prisma.timeEntry.update({ where: { id: existing.id }, data, include: entryInclude });
    emitToOrganization(req.app.get('io'), orgId, 'time:updated', { taskId: updated.taskId, projectId: updated.projectId });
    res.json(shape(updated, admin));
  } catch (error) { next(error); }
});

// DELETE /api/time-entries/:id
timeEntryRouter.delete('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const existing = await prisma.timeEntry.findFirst({
      where: { id: req.params.id as string, organizationId: orgId },
      select: { id: true, userId: true, taskId: true, projectId: true },
    });
    if (!existing) { res.status(404).json({ error: 'Time entry not found' }); return; }
    if (existing.userId !== req.user!.userId && !isAdmin(req)) {
      res.status(403).json({ error: 'You can only delete your own time entries' });
      return;
    }
    await prisma.timeEntry.delete({ where: { id: existing.id } });
    emitToOrganization(req.app.get('io'), orgId, 'time:updated', { taskId: existing.taskId, projectId: existing.projectId });
    res.json({ success: true });
  } catch (error) { next(error); }
});
