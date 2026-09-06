/**
 * The PM module, driven over real HTTP against the real database.
 *
 * Reading a handler and believing it is how most of these bugs survived review in
 * the first place — the department field looked written, the review gate looked
 * closed, the visibility filter looked applied. So this mints a token per rung of
 * the ladder and asks the running API, then cleans up everything it made.
 *
 *   node test/pm-journey.mjs
 */

// FIRST, and it matters: `.env` holds the real JWT secret. Prisma loads it as a
// side effect of being constructed, so reading the secret before that silently
// falls back to the development default and every request is signed with the
// wrong key — which the API answers, confusingly, with a 404.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const API = process.env.API_URL?.replace(/\/api\/?$/, '') + '/api' || 'http://localhost:4000/api';
const SECRET = process.env.JWT_SECRET || 'flowzen-dev-jwt-secret';
const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const ok = String(actual) === String(expected);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  — expected ${expected}, got ${actual}`}`);
};
const section = (t) => console.log(`\n${t}\n${'─'.repeat(t.length)}`);

/**
 * A token for a real person.
 *
 * The `role` claim is deliberately absent: the API reads roles LIVE from the
 * database on every request and ignores what the token says (§3.10). An earlier
 * draft of this file minted a "MEMBER" token for an account that is actually a
 * super admin, and then reported the resulting 200s as bugs — the server was
 * right and the test was lying to it.
 */
const tokenFor = (user) =>
  jwt.sign(
    { userId: user.id, email: user.email, organizationId: user.organizationId, tokenVersion: user.tokenVersion ?? 0 },
    SECRET,
    { expiresIn: '1h' },
  );

const call = async (token, method, path, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
};

const made = { tasks: [], projects: [], departments: [] };

async function main() {
  // The org with the most people, not merely the first — `findFirst` picked the
  // one-user tenant and the journey needs two rungs of the ladder.
  const orgs = await prisma.organization.findMany({
    where: { modules: { some: { key: 'PM', enabled: true } } },
    select: { id: true, name: true, _count: { select: { users: true } } },
  });
  const org = orgs.sort((a, b) => b._count.users - a._count.users)[0];
  if (!org) throw new Error('no organisation with PM enabled');
  console.log(`  (against "${org.name}")`);

  const people = await prisma.user.findMany({
    where: { organizationId: org.id, status: 'ACTIVE' },
    select: { id: true, name: true, email: true, organizationId: true, tokenVersion: true, roles: { select: { role: true } } },
  });
  const withRole = (r) => people.find((u) => u.roles.some((x) => x.role === r));

  const adminUser = withRole('ADMIN') ?? withRole('SUPER_ADMIN');
  const managerUser = withRole('MANAGER');
  const memberUser = withRole('MEMBER');
  const other = await prisma.user.findFirst({ where: { organizationId: { not: org.id } } });
  const company = await prisma.company.findFirst({ where: { organizationId: org.id } });
  if (!adminUser || !managerUser || !memberUser || !company) {
    throw new Error('need a real admin, manager, member and a client in the org');
  }
  console.log(`  admin=${adminUser.name}  manager=${managerUser.name}  member=${memberUser.name}`);

  const admin = tokenFor(adminUser);
  const manager = tokenFor(managerUser);
  const member = tokenFor(memberUser);

  // ── 1 · The department field, which was written by nothing ─────────────────
  section('1 · A task remembers its department');

  const dept = await call(manager, 'POST', '/departments', { name: `Journey Dept ${Date.now()}` });
  check('a manager can create a department', dept.status, 201);
  made.departments.push(dept.body.data.id);

  const project = await call(manager, 'POST', '/projects', {
    companyId: company.id,
    name: `Journey Project ${Date.now()}`,
  });
  check('a manager can create a project', project.status, 201);
  const projectId = project.body.data.id;
  made.projects.push(projectId);

  const withDept = await call(manager, 'POST', '/projects/tasks', {
    title: 'Journey task with a department',
    projectId,
    departmentId: dept.body.data.id,
    taskType: 'DESIGN',
    dueDate: '2026-01-31T03:30:00.000Z',
  });
  check('the task is created', withDept.status, 201);
  made.tasks.push(withDept.body.data.id);
  // Zod stripped `departmentId` silently, so this arrived null every time.
  check('and it kept the department', withDept.body.data.departmentId, dept.body.data.id);
  check('the board filter now finds it',
    (await call(manager, 'GET', `/projects/tasks/all?departmentId=${dept.body.data.id}`)).body.data.length, 1);

  // ── 2 · The parent rule ────────────────────────────────────────────────────
  section('2 · A task belongs to exactly one parent');

  const orphan = await call(manager, 'POST', '/projects/tasks', { title: 'No parent', departmentId: dept.body.data.id });
  check('a department alone is refused, as it always was', orphan.status, 400);

  const both = await call(manager, 'PATCH', `/projects/tasks/${withDept.body.data.id}`, {
    dealId: (await prisma.deal.findFirst({ where: { organizationId: org.id } }))?.id ?? 'x',
  });
  // This used to be allowed: `.innerType().partial()` throws the refine away.
  check('attaching a deal to a project task is refused on UPDATE too', both.status, 400);

  const stranded = await call(manager, 'PATCH', `/projects/tasks/${withDept.body.data.id}`, { projectId: null });
  check('clearing the only parent is refused', stranded.status, 400);

  // ── 3 · Recurrence rolls forward exactly once ──────────────────────────────
  section('3 · Recurrence rolls forward once, and clamps the month');

  const recurring = await call(manager, 'POST', '/projects/tasks', {
    title: 'Journey monthly retainer',
    projectId,
    departmentId: dept.body.data.id,
    taskType: 'SEO',
    dueDate: '2026-01-31T03:30:00.000Z',
    recurrence: { frequency: 'MONTHLY', interval: 1 },
  });
  made.tasks.push(recurring.body.data.id);

  await call(manager, 'PATCH', `/projects/tasks/${recurring.body.data.id}`, { status: 'DONE' });
  let spawned = await prisma.task.findMany({ where: { spawnedFromId: recurring.body.data.id } });
  check('finishing it creates the next one', spawned.length, 1);
  made.tasks.push(...spawned.map((t) => t.id));

  // 31 January + 1 month used to be 3 March.
  const due = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(spawned[0].dueDate);
  check('and dates it 28 February, not 3 March', due, '2026-02-28');
  check('carrying the task type over', spawned[0].taskType, 'SEO');
  check('carrying the department over', spawned[0].departmentId, dept.body.data.id);

  // DONE → undo → DONE. This used to make a second identical task.
  await call(manager, 'PATCH', `/projects/tasks/${recurring.body.data.id}`, { status: 'IN_PROGRESS' });
  const again = await call(manager, 'PATCH', `/projects/tasks/${recurring.body.data.id}`, { status: 'DONE' });
  spawned = await prisma.task.findMany({ where: { spawnedFromId: recurring.body.data.id } });
  check('re-finishing it does NOT create a duplicate', spawned.length, 1);
  check('and the re-finish still succeeds', again.status, 200);

  // ── 4 · The review gate, on both doors ─────────────────────────────────────
  section('4 · The review gate cannot be walked around');

  const reviewed = await call(manager, 'POST', '/projects/tasks', {
    title: 'Journey work needing review',
    projectId,
    assigneeId: memberUser.id,
    reviewerId: managerUser.id,
  });
  made.tasks.push(reviewed.body.data.id);

  const skip = await call(member, 'PATCH', `/projects/tasks/${reviewed.body.data.id}`, { status: 'DONE' });
  // IN_PROGRESS → DONE skipped the gate entirely, because it only checked
  // transitions OUT of IN_REVIEW.
  check('the assignee cannot mark reviewed work done', skip.status, 403);

  const toReview = await call(member, 'PATCH', `/projects/tasks/${reviewed.body.data.id}`, { status: 'IN_REVIEW' });
  check('but they can send it for review', toReview.status, 200);

  const approve = await call(manager, 'PATCH', `/projects/tasks/${reviewed.body.data.id}`, { status: 'APPROVED' });
  check('and the reviewer can approve it', approve.status, 200);

  // ── 5 · Row-level visibility on the detail route ───────────────────────────
  section('5 · A Member sees their own world, by id as well as in a list');

  // A project they have NO connection to. It cannot be the one above: section 4
  // assigned them a task on that, and an assigned task is precisely how most
  // people are "on" a project — the filter says so deliberately.
  const stranger = await call(manager, 'POST', '/projects', {
    companyId: company.id,
    name: `Journey Untouched ${Date.now()}`,
  });
  made.projects.push(stranger.body.data.id);
  const strangerId = stranger.body.data.id;

  check('it is in the manager’s list', (await call(manager, 'GET', '/projects')).body.data.some((p) => p.id === strangerId), true);
  check('and absent from the member’s', (await call(member, 'GET', '/projects')).body.data.some((p) => p.id === strangerId), false);

  // The list filtered by membership; the detail did not, so an id was enough.
  check('and not readable by id either', (await call(member, 'GET', `/projects/${strangerId}`)).status, 404);

  await call(manager, 'POST', `/projects/${strangerId}/members`, { userId: memberUser.id });
  check('once they are put on it, they can read it',
    (await call(member, 'GET', `/projects/${strangerId}`)).status, 200);

  // ── 6 · Ids from the other organisation ────────────────────────────────────
  section('6 · Ids from another organisation are refused');

  if (other) {
    check('as a project member',
      (await call(manager, 'POST', `/projects/${projectId}/members`, { userId: other.id })).status, 422);
    check('as a task assignee',
      (await call(manager, 'POST', '/projects/tasks', { title: 'x', projectId, assigneeId: other.id })).status, 422);
    check('as a department head',
      (await call(manager, 'POST', '/departments', { name: `X ${Date.now()}`, headId: other.id })).status, 422);

    const theirCompany = await prisma.company.findFirst({ where: { organizationId: { not: org.id } } });
    if (theirCompany) {
      check('and a project cannot be re-pointed at their client',
        (await call(manager, 'PATCH', `/projects/${projectId}`, { companyId: theirCompany.id })).status, 404);
    }
  } else {
    console.log('  --    only one organisation present, skipped');
  }

  // ── 7 · completedAt, written by nothing ────────────────────────────────────
  section('7 · A finished project records when it finished');

  await call(manager, 'PATCH', `/projects/${projectId}`, { status: 'COMPLETED' });
  let row = await prisma.project.findUnique({ where: { id: projectId }, select: { completedAt: true } });
  check('completing it stamps completedAt', row.completedAt !== null, true);

  await call(manager, 'PATCH', `/projects/${projectId}`, { status: 'ACTIVE' });
  row = await prisma.project.findUnique({ where: { id: projectId }, select: { completedAt: true } });
  check('reopening it clears the stamp', row.completedAt, null);

  // ── 8 · Deleting a project ─────────────────────────────────────────────────
  section('8 · A project can be removed, but not one with work on it');

  check('a manager may not delete',
    (await call(manager, 'DELETE', `/projects/${projectId}`)).status, 403);

  const busy = await call(admin, 'DELETE', `/projects/${projectId}`);
  check('an admin is refused while tasks hang off it', busy.status, 409);
  check('and is told to cancel it instead', /Cancelled/.test(busy.body.error), true);

  // ── 9 · Reports agree with the projects page ───────────────────────────────
  section('9 · One health rule, one overdue rule');

  const summary = await call(manager, 'GET', '/reports/pm/summary');
  check('the summary loads', summary.status, 200);
  const s = summary.body.data.summary;
  check('on-time rate is a measurement or null, never an invented 95',
    s.onTimeDeliveryRate === null || s.onTimeSampleSize > 0, true);
  check('turnaround likewise, never an invented 2.5',
    s.avgTurnaroundDays === null || s.turnaroundSampleSize > 0, true);

  const list = await call(manager, 'GET', '/projects');
  const matrix = await call(manager, 'GET', '/reports/pm/projects');
  const fromList = new Map(list.body.data.map((p) => [p.id, p.health]));
  const disagreements = matrix.body.data.filter((p) => {
    const theirs = fromList.get(p.id);
    if (!theirs) return false;
    const mine = p.health === 'DELAYED' ? 'OFF_TRACK' : p.health;
    return ['ON_TRACK', 'AT_RISK', 'OFF_TRACK'].includes(mine) && mine !== theirs;
  });
  check('every project has the same health on both screens', disagreements.length, 0);
}

async function cleanup() {
  // Children first: spawned tasks reference their parent.
  await prisma.task.deleteMany({ where: { spawnedFromId: { in: made.tasks } } });
  await prisma.task.deleteMany({ where: { id: { in: made.tasks } } });
  await prisma.task.deleteMany({ where: { projectId: { in: made.projects } } });
  await prisma.activity.deleteMany({ where: { projectId: { in: made.projects } } });
  await prisma.projectMember.deleteMany({ where: { projectId: { in: made.projects } } });
  await prisma.project.deleteMany({ where: { id: { in: made.projects } } });
  await prisma.user.updateMany({ where: { departmentId: { in: made.departments } }, data: { departmentId: null } });
  await prisma.department.deleteMany({ where: { id: { in: made.departments } } });
}

main()
  .catch((e) => {
    fail++;
    console.error('\nJOURNEY THREW:', e.message);
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n${'═'.repeat(46)}\n  ${pass} passed, ${fail} failed\n${'═'.repeat(46)}`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  });
