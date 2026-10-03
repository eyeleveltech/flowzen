import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { hasPermission, type UserSession } from '../middleware/auth.js';

/**
 * Which people, and so which work, a person manages (Departments Plan 3).
 *
 * Every `work.team` check used to be organisation-wide: a Head saw, edited and
 * was alerted about everybody's work, while the Access screen promised them
 * "their people's work". Now a Head's reach is the departments they lead.
 *
 *   - Management sees everyone.
 *   - Anybody else with `work.team` sees the departments where they are the
 *     head, and the active people in them.
 *   - A `work.team` holder who leads NO department still sees everyone, until
 *     somebody gives them one. Turning this on must not leave a Head looking at
 *     an empty screen; Settings → Departments lists who is in that state.
 *   - Nobody else is limited by it: without `work.team` the routes refuse them
 *     anyway, so there is nothing to narrow.
 *
 * This is the one place the rule lives. A route asks `teamScope` (or the two
 * helpers below) and never works out departments for itself.
 */
export type TeamScope =
  | { all: true }
  | {
      all: false;
      /** The departments they lead, in the organisation's own order. */
      departments: { id: string; name: string; peopleCount: number }[];
      departmentIds: string[];
      /** The active people in those departments. */
      peopleIds: string[];
    };

type ScopeUser = Pick<UserSession, 'userId' | 'organizationId' | 'preset' | 'permissions' | 'active'>;

const ALL: TeamScope = { all: true };

/**
 * Whether this person's team view is limited to departments they lead.
 *
 * Exported so Settings → Departments can name the `work.team` holders who
 * lead nothing by the same test the routes use.
 */
export const isDepartmentScoped = (user: ScopeUser): boolean =>
  user.preset !== 'MANAGEMENT' && hasPermission(user as UserSession, 'work.team');

/**
 * Per request: `req.user` is built fresh for every request, so keying on it
 * means a route that asks three times reads the departments once, and nothing
 * outlives the request it was worked out for.
 */
const cache = new WeakMap<object, Promise<TeamScope>>();

export function teamScope(user: ScopeUser): Promise<TeamScope> {
  let hit = cache.get(user);
  if (!hit) {
    hit = compute(user);
    cache.set(user, hit);
    // A failed read must not be remembered for the rest of the request.
    hit.catch(() => cache.delete(user));
  }
  return hit;
}

async function compute(user: ScopeUser): Promise<TeamScope> {
  if (!isDepartmentScoped(user)) return ALL;

  const led = await prisma.department.findMany({
    where: { organizationId: user.organizationId, headId: user.userId, archivedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true },
  });
  if (led.length === 0) return ALL;

  const departmentIds = led.map((d) => d.id);
  const people = await prisma.user.findMany({
    where: { organizationId: user.organizationId, active: true, departmentId: { in: departmentIds } },
    select: { id: true, departmentId: true },
  });

  return {
    all: false,
    departments: led.map((d) => ({
      id: d.id,
      name: d.name,
      peopleCount: people.filter((p) => p.departmentId === d.id).length,
    })),
    departmentIds,
    peopleIds: people.map((p) => p.id),
  };
}

/**
 * Narrows a task query to the work a person manages.
 *
 * Tasks carry no department, so "my department's work" is a task that ANY of
 * its people is one of mine on, or one I created or asked for. The second half
 * is what keeps assigning across departments working: a Head can hand a task to
 * a designer, and it is then theirs to follow up. Their own tasks are always
 * theirs, whichever department they sit in.
 */
export async function taskInScope(user: ScopeUser, where: Prisma.TaskWhereInput): Promise<Prisma.TaskWhereInput> {
  const scope = await teamScope(user);
  if (scope.all) return where;
  return {
    AND: [
      where,
      {
        OR: [
          { assignees: { some: { userId: { in: [...scope.peopleIds, user.userId] } } } },
          { createdById: user.userId },
          { assignedById: user.userId },
        ],
      },
    ],
  };
}

/** Whether one task is in a person's scope. For detail routes, which answer 404 when it is not. */
export async function canSeeTask(user: ScopeUser, taskId: string): Promise<boolean> {
  const scope = await teamScope(user);
  if (scope.all) return true;
  const where = await taskInScope(user, { id: taskId, organizationId: user.organizationId });
  return (await prisma.task.count({ where })) > 0;
}

/**
 * Narrows a people query to the departments a person leads.
 *
 * By department rather than by the active list, so somebody who has left
 * still belongs to the department they left from. `includeSelf` adds the
 * caller, for the screens where seeing yourself is never the question.
 */
export async function peopleInScope(
  user: ScopeUser,
  where: Prisma.UserWhereInput,
  { includeSelf = false }: { includeSelf?: boolean } = {},
): Promise<Prisma.UserWhereInput> {
  const scope = await teamScope(user);
  if (scope.all) return where;
  const mine: Prisma.UserWhereInput = { departmentId: { in: scope.departmentIds } };
  return { AND: [where, includeSelf ? { OR: [mine, { id: user.userId }] } : mine] };
}

/** Whether one person is in scope, for a list already in hand. */
export async function canSeePerson(user: ScopeUser, personId: string): Promise<boolean> {
  const scope = await teamScope(user);
  if (scope.all || personId === user.userId) return true;
  return scope.peopleIds.includes(personId);
}
