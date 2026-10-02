import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { RolePreset } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate, hasPermission, requirePermission, type AuthRequest } from '../middleware/auth.js';
import { emitToOrganization } from '../sse.js';

/**
 * /api/departments — departments as real records (Departments Plan 1).
 *
 * `User.dept` was free text, checked against nothing: the same team sat under
 * "Video & Production" and "Video / Production", a renamed department left its
 * people on the old spelling, and every screen built its list from a different
 * place. Now a department is a row, everybody points at one by id, and a
 * rename happens once.
 *
 * Read by anybody signed in — every picker and filter needs the list. Changed
 * only with `setup.admin`. Never deleted: merged into another, or archived
 * once nobody active is left in it, so history keeps its name.
 *
 * `User.dept` is still written with the department's name on every change, so
 * anything that still reads the text sees the right word. It goes in Plan 4.
 */
export const departmentsRouter = Router();
departmentsRouter.use(authenticate);

/** Who may be a head: a person whose access is Department head or Management. */
export const HEAD_PRESETS: RolePreset[] = [RolePreset.HEAD, RolePreset.MANAGEMENT];

const nameSchema = z.string().trim().min(1, 'A department needs a name.').max(60, 'Keep the name under 60 characters.');

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** The org's active departments, in their order, with head and people. */
export async function listDepartments(orgId: string, opts: { includeArchived?: boolean; withPeople?: boolean } = {}) {
  const rows = await prisma.department.findMany({
    where: { organizationId: orgId, ...(opts.includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      headId: true,
      sortOrder: true,
      archivedAt: true,
      head: { select: { name: true } },
      members: {
        where: { active: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, designation: true, preset: true },
      },
    },
  });
  return rows.map((d) => ({
    id: d.id,
    name: d.name,
    headId: d.headId,
    headName: d.head?.name ?? null,
    sortOrder: d.sortOrder,
    archived: Boolean(d.archivedAt),
    peopleCount: d.members.length,
    ...(opts.withPeople ? { people: d.members } : {}),
  }));
}

/** Another department already called this, ignoring case — archived ones included. */
async function nameTaken(orgId: string, name: string, exceptId?: string) {
  return prisma.department.findFirst({
    where: { organizationId: orgId, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true, name: true, archivedAt: true },
  });
}

const takenMessage = (t: { name: string; archivedAt: Date | null }) =>
  t.archivedAt
    ? `There is already an archived department called "${t.name}". Restore it instead.`
    : `There is already a department called "${t.name}".`;

/** A department of this org, or null. */
const findDepartment = (orgId: string, id: string) =>
  prisma.department.findFirst({ where: { id, organizationId: orgId } });

/** Move people into a department, keeping their `dept` text in step. */
async function moveInto(tx: Tx, orgId: string, where: { id?: { in: string[] }; departmentId?: string }, to: { id: string; name: string }) {
  return tx.user.updateMany({
    where: { organizationId: orgId, ...where },
    data: { departmentId: to.id, dept: to.name },
  });
}

const log = (orgId: string, actorId: string, departmentId: string, verb: string, payload: Record<string, unknown>) =>
  prisma.activity.create({
    data: { organizationId: orgId, entityType: 'Department', entityId: departmentId, actorId, verb, payload: payload as never },
  });

const changed = (orgId: string) => emitToOrganization(orgId, 'member:changed', { departments: true });

/**
 * GET /api/departments — the active departments, in order.
 * `?includeArchived=1` (setup.admin) adds the archived ones; `?withPeople=1`
 * adds who is in each, and the people in none.
 */
departmentsRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const includeArchived = req.query.includeArchived === '1';
    if (includeArchived && !hasPermission(req.user!, 'setup.admin')) {
      res.status(403).json({ success: false, error: 'Only an admin can see archived departments.' });
      return;
    }
    const withPeople = req.query.withPeople === '1';
    const [departments, unplaced] = await Promise.all([
      listDepartments(orgId, { includeArchived, withPeople }),
      withPeople
        ? prisma.user.findMany({
            where: { organizationId: orgId, active: true, departmentId: null },
            orderBy: { name: 'asc' },
            select: { id: true, name: true, designation: true, preset: true },
          })
        : Promise.resolve(null),
    ]);
    res.json({ success: true, departments, ...(unplaced ? { unplaced } : {}) });
  } catch (e) {
    next(e);
  }
});

/** POST /api/departments — add one, at the end of the list. */
departmentsRouter.post('/', requirePermission('setup.admin'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = z.object({ name: nameSchema }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const orgId = req.user!.organizationId;
    const { name } = parsed.data;
    const taken = await nameTaken(orgId, name);
    if (taken) {
      res.status(409).json({ success: false, error: takenMessage(taken) });
      return;
    }
    const last = await prisma.department.findFirst({
      where: { organizationId: orgId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const created = await prisma.department.create({
      data: { organizationId: orgId, name, sortOrder: (last?.sortOrder ?? -1) + 1 },
    });
    await log(orgId, req.user!.userId, created.id, 'department_created', { name });
    changed(orgId);
    res.status(201).json({ success: true, department: { id: created.id, name: created.name } });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/departments/move-people — put people in a department. Declared
 * before the `/:id` routes so "move-people" is never read as an id.
 */
departmentsRouter.post('/move-people', requirePermission('setup.admin'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = z
      .object({ userIds: z.array(z.string().min(1)).min(1, 'Choose at least one person.').max(200), departmentId: z.string().min(1) })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const orgId = req.user!.organizationId;
    const { userIds, departmentId } = parsed.data;
    const to = await findDepartment(orgId, departmentId);
    if (!to || to.archivedAt) {
      res.status(400).json({ success: false, error: to ? `${to.name} is archived. Restore it first.` : 'No such department.' });
      return;
    }
    const people = await prisma.user.findMany({
      where: { organizationId: orgId, id: { in: userIds } },
      select: { id: true, departmentId: true },
    });
    if (people.length !== new Set(userIds).size) {
      res.status(400).json({ success: false, error: 'Somebody in that list is not in this organisation.' });
      return;
    }
    const moving = people.filter((p) => p.departmentId !== to.id).map((p) => p.id);
    if (moving.length) {
      await prisma.$transaction((tx) => moveInto(tx, orgId, { id: { in: moving } }, to));
      await log(orgId, req.user!.userId, to.id, 'department_people_moved', { name: to.name, userIds: moving });
      changed(orgId);
    }
    res.json({ success: true, moved: moving.length });
  } catch (e) {
    next(e);
  }
});

/** PATCH /api/departments/:id — rename, change the head, or move it in the order. */
departmentsRouter.patch('/:id', requirePermission('setup.admin'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = z
      .object({
        name: nameSchema.optional(),
        headId: z.string().min(1).nullable().optional(),
        sortOrder: z.number().int().min(0).max(10_000).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const orgId = req.user!.organizationId;
    const dept = await findDepartment(orgId, String(req.params.id));
    if (!dept) {
      res.status(404).json({ success: false, error: 'No such department.' });
      return;
    }
    const { name, headId, sortOrder } = parsed.data;

    if (name !== undefined && name !== dept.name) {
      const taken = await nameTaken(orgId, name, dept.id);
      if (taken) {
        res.status(409).json({ success: false, error: takenMessage(taken) });
        return;
      }
    }
    if (headId) {
      const head = await prisma.user.findFirst({
        where: { id: headId, organizationId: orgId },
        select: { name: true, active: true, preset: true },
      });
      if (!head || !head.active) {
        res.status(400).json({ success: false, error: 'A head has to be somebody active in this organisation.' });
        return;
      }
      if (!HEAD_PRESETS.includes(head.preset)) {
        res.status(400).json({
          success: false,
          error: `${head.name} does not have Department head access. Give it to them in Team → Access first.`,
        });
        return;
      }
    }

    const renamed = name !== undefined && name !== dept.name;
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.department.update({
        where: { id: dept.id },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(headId !== undefined ? { headId } : {}),
          ...(sortOrder !== undefined ? { sortOrder } : {}),
        },
      });
      // A rename shows everywhere: the text kept beside the id follows it.
      if (renamed) await tx.user.updateMany({ where: { organizationId: orgId, departmentId: dept.id }, data: { dept: name } });
      return row;
    });

    if (renamed) await log(orgId, req.user!.userId, dept.id, 'department_renamed', { from: dept.name, to: name });
    if (headId !== undefined && headId !== dept.headId) {
      await log(orgId, req.user!.userId, dept.id, 'department_head_changed', { name: updated.name, headFrom: dept.headId, headTo: headId });
    }
    if (sortOrder !== undefined && sortOrder !== dept.sortOrder) {
      await log(orgId, req.user!.userId, dept.id, 'department_reordered', { name: updated.name, from: dept.sortOrder, to: sortOrder });
    }
    changed(orgId);
    res.json({ success: true, department: { id: updated.id, name: updated.name, headId: updated.headId, sortOrder: updated.sortOrder } });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/departments/:id/merge { intoId } — everybody in this department
 * moves into another, in one go, and this one is archived.
 */
departmentsRouter.post('/:id/merge', requirePermission('setup.admin'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = z.object({ intoId: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'Choose the department to merge into.' });
      return;
    }
    const orgId = req.user!.organizationId;
    const [from, into] = await Promise.all([
      findDepartment(orgId, String(req.params.id)),
      findDepartment(orgId, parsed.data.intoId),
    ]);
    if (!from || !into) {
      res.status(404).json({ success: false, error: 'No such department.' });
      return;
    }
    if (from.id === into.id) {
      res.status(400).json({ success: false, error: 'A department cannot be merged into itself.' });
      return;
    }
    if (into.archivedAt) {
      res.status(400).json({ success: false, error: `${into.name} is archived. Restore it first, or merge into another.` });
      return;
    }
    // Everybody, active or not: an old account still belongs somewhere real.
    const moved = await prisma.$transaction(async (tx) => {
      const r = await moveInto(tx, orgId, { departmentId: from.id }, into);
      await tx.department.update({ where: { id: from.id }, data: { archivedAt: from.archivedAt ?? new Date(), headId: null } });
      return r.count;
    });
    await log(orgId, req.user!.userId, from.id, 'department_merged', { name: from.name, into: into.name, intoId: into.id, moved });
    changed(orgId);
    res.json({ success: true, moved });
  } catch (e) {
    next(e);
  }
});

/** POST /api/departments/:id/archive — only once nobody active is in it. */
departmentsRouter.post('/:id/archive', requirePermission('setup.admin'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const dept = await findDepartment(orgId, String(req.params.id));
    if (!dept) {
      res.status(404).json({ success: false, error: 'No such department.' });
      return;
    }
    const people = await prisma.user.count({ where: { organizationId: orgId, departmentId: dept.id, active: true } });
    if (people > 0) {
      res.status(409).json({
        success: false,
        error: `Move its ${people} ${people === 1 ? 'person' : 'people'} first, or merge it.`,
        code: 'HAS_PEOPLE',
      });
      return;
    }
    if (!dept.archivedAt) {
      await prisma.department.update({ where: { id: dept.id }, data: { archivedAt: new Date() } });
      await log(orgId, req.user!.userId, dept.id, 'department_archived', { name: dept.name });
      changed(orgId);
    }
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

/** POST /api/departments/:id/restore — back into the pickers. */
departmentsRouter.post('/:id/restore', requirePermission('setup.admin'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const dept = await findDepartment(orgId, String(req.params.id));
    if (!dept) {
      res.status(404).json({ success: false, error: 'No such department.' });
      return;
    }
    if (dept.archivedAt) {
      await prisma.department.update({ where: { id: dept.id }, data: { archivedAt: null } });
      await log(orgId, req.user!.userId, dept.id, 'department_restored', { name: dept.name });
      changed(orgId);
    }
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

/**
 * The department a person is being put in, checked: this organisation's, and
 * not archived. For the invite and edit routes.
 */
export async function departmentFor(orgId: string, departmentId: string) {
  const d = await prisma.department.findFirst({
    where: { id: departmentId, organizationId: orgId },
    select: { id: true, name: true, archivedAt: true },
  });
  if (!d) return { error: 'Choose one of this organisation’s departments.' } as const;
  if (d.archivedAt) return { error: `${d.name} is archived. Choose another department.` } as const;
  return { department: { id: d.id, name: d.name } } as const;
}
