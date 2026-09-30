/* eslint-disable */
/**
 * One-off: the VOSO / ESSA to-do list (meeting of 28 Sep 2026) into Flowzen.
 *
 *   ESSA   (a prospect)  → a new Sample work, 12 tasks from the ESSA sheet
 *   VOSO   website       → the existing VOSO one-time project, 6 tasks
 *   VOSO   promotion     → the VOSO retainer's October month, 4 tasks
 *
 * Run it inside the API container, from /var/www/flowzen on the server:
 *
 *   Look (changes nothing):
 *     docker exec -i flowzen-api node - < seed-voso-essa.cjs
 *
 *   Create (only after the look is right):
 *     docker exec -i -e APPLY=yes flowzen-api node - < seed-voso-essa.cjs
 *
 * Safe to run twice: a task already there (same title, same place) is
 * skipped, and the sample work is reused if it exists. It creates nothing
 * else — no companies, no people, no projects other than the one sample.
 *
 * If anything is unclear (two VOSO projects, a person not found, the October
 * month not rolled yet) it says so and, with APPLY=yes, stops before writing.
 * Overrides, when the look asks for one:
 *   VOSO_COMPANY_ID, ESSA_COMPANY_ID, VOSO_PROJECT_ID, RETAINER_ID,
 *   RETAINER_PROJECT_ID (which project inside the retainer; default: its default one),
 *   MONTH (default 2026-10), CREATED_BY_EMAIL (default harish.s@eyelevelstudio.in),
 *   SAMPLE_NAME (default "ESSA sample work")
 */

const path = require('path');
const req = require('module').createRequire(path.join(process.cwd(), 'package.json'));
const { PrismaClient, Prisma } = req('@prisma/client');
const db = new PrismaClient();

const APPLY = process.env.APPLY === 'yes';
const MONTH = process.env.MONTH || '2026-10';
const CREATED_BY_EMAIL = process.env.CREATED_BY_EMAIL || 'harish.s@eyelevelstudio.in';
const SAMPLE_NAME = process.env.SAMPLE_NAME || 'ESSA sample work';

// ── The tasks ────────────────────────────────────────────────────────────────
// who: first name as it is in Flowzen. due: YYYY-MM-DD. type: Type of work.

const ESSA = [
  { title: "Rename 'Mascara' to 'Heroica'", who: 'Janani', due: '2026-10-07', priority: 'MEDIUM', type: 'DESIGN',
    notes: 'Replace the Mascara title/logo with Heroica across the catalogue wherever it appears. Confirm the correct Heroica logo/text before finalising.',
    dep: 'Client to confirm Heroica logo/text' },
  { title: '3 product videos', who: 'Dharshini', due: '2026-10-06', priority: 'HIGH', type: 'VIDEO',
    notes: 'Create videos for the 3-product set discussed: Fair Lady, one women’s innerwear product and one men’s innerwear product.',
    dep: 'Exact 3 products / SKUs confirmed' },
  { title: 'Update sports bra / normal bra section titles', who: 'Janani', due: '2026-10-08', priority: 'LOW', type: 'DESIGN',
    notes: 'Apply the agreed section title changes and any approved background/colour adjustments. Check page-by-page against client copy.',
    dep: 'Approved titles from client' },
  { title: "Men's trunks — FG series numbers", who: 'Akmal', due: '2026-10-03', priority: 'LOW', type: 'VIDEO',
    notes: "Once the client sends the FG series list (e.g. FG-3005, FG-3035 etc.), update the relevant men's trunks / mixed trunks references and use the correct product series for video planning.",
    dep: 'Client sends confirmed FG list' },
  { title: 'ESSA social media — sample videos', who: 'Dharshini', due: '2026-10-06', priority: 'MEDIUM', type: 'DIGITAL_MARKETING',
    notes: 'Prepare the initial ESSA sample video for kids wear (1 video and 1 picture for boys and girls).',
    dep: 'Confirm exact products and dates' },
  { title: 'Start ESSA social media management', who: 'Dharshini', due: '2026-10-07', priority: 'MEDIUM', type: 'DIGITAL_MARKETING',
    notes: 'Begin organic social posts and reels using the approved ESSA products first.',
    dep: 'Product photos/videos; client approval' },
  { title: 'First ESSA content batch', who: 'Dharshini', due: '2026-10-13', priority: 'MEDIUM', type: 'DIGITAL_MARKETING',
    notes: "Produce product visibility videos with strong lighting, plus UGC-style content across ladies and men's categories.",
    dep: 'Products / reference assets available' },
  { title: 'Client approval before each video', who: 'Dharshini', due: '2026-10-06', priority: 'HIGH', type: 'VIDEO', status: 'IN_PROGRESS',
    notes: 'Share each video concept and receive client approval before shooting or generating the final output. Ongoing — for every video.',
    dep: 'Client reply' },
  { title: 'Fair Lady video', who: 'Dharshini', due: '2026-10-06', priority: 'HIGH', type: 'VIDEO',
    notes: 'Create a dedicated Fair Lady video with a different treatment from previous AI videos, keeping product visibility and lighting as the priority.',
    dep: 'Fair Lady product / reference confirmed' },
  { title: 'FG mixed trunks video', who: 'Dharshini', due: '2026-10-13', priority: 'MEDIUM', type: 'VIDEO',
    notes: 'Develop a 20–30 second stylish product-visibility video featuring the approved FG trunk series / mixed trunks.',
    dep: 'Confirmed FG product list + concept approval' },
  { title: 'Fortnightly check-in call', who: 'Dharshini', due: '2026-10-01', priority: 'HIGH', type: 'MANAGEMENT',
    notes: 'Use the recurring 20–30 minute fortnightly call to close ESSA approvals, product selections and pending video inputs. Shared with VOSO.',
    dep: 'Calendar' },
  { title: 'Send meeting summary', who: 'Dharshini', due: '2026-10-01', priority: 'HIGH', type: 'MANAGEMENT',
    notes: 'Include ESSA product/video decisions, Heroica catalogue changes and client dependencies in the written meeting recap. Shared with VOSO.',
    dep: null },
];

const VOSO_WEBSITE = [
  { title: 'Phase 3 product images', who: 'Harish', due: '2026-10-07', priority: 'MEDIUM', type: 'DESIGN',
    notes: 'Generate AI images for the 4 new products in all colours (front, back, close-up, texture, ~2-3 per colour), matched to the look of the existing 11 products. Use the physical pieces as the base so the style stays consistent.',
    dep: 'Client sends 1 physical piece per product (front/back photos)' },
  { title: 'Upload Phase 3 colours + images to store', who: 'Harish', due: '2026-10-07', priority: 'MEDIUM', type: 'DEVELOPMENT',
    notes: 'Add the new colour variants and images to the 4 new products on the site.',
    dep: 'Phase 3 images; colours, pricing and stock confirmed in writing' },
  { title: 'Inventory for Phase 3 products', who: 'Harish', due: '2026-10-07', priority: 'MEDIUM', type: 'DEVELOPMENT',
    notes: 'Update colour, size and stock for the new products with the ESA team, as done for Phase 2.',
    dep: 'Client stock sheet' },
  { title: 'Chase the 4 physical product pieces', who: 'Harish', due: '2026-10-07', priority: 'MEDIUM', type: 'DEVELOPMENT',
    notes: 'Ask Ganesh to courier one piece per new product (or arrange a Chennai drop). Front and back photos are the fallback if courier is slow. This unblocks Janani and Harish.',
    dep: 'Ganesh / Vyoma' },
  { title: 'Confirm cost basis for Phase 2 and 3', who: 'Akmal', due: '2026-10-01', priority: 'MEDIUM', type: 'MANAGEMENT',
    notes: 'Phase 2 and 3 were outside original scope, so charges apply. Already sent in the 28 Sep proposal (Phase 2 Rs 50K + Phase 3 Rs 65K + GST). Follow up for written approval; label invoices clearly.',
    dep: 'Vyoma approval' },
  { title: 'Website support retainer discussion', who: 'Akmal', due: '2026-10-01', priority: 'MEDIUM', type: 'MANAGEMENT',
    notes: 'Client will discuss a retainer for post-launch changes and product additions. Prepare a simple retainer offer (changes are chargeable otherwise).',
    dep: 'Fortnightly call' },
];

const VOSO_RETAINER = [
  { title: 'Creator barter list', who: 'Dharshini', due: '2026-10-06', priority: 'MEDIUM', type: 'DIGITAL_MARKETING',
    notes: "Shortlist gym/fitness creators for the free tee + shorts UGC barter (client approved). Collect each creator's size and address, hand the list to the client to courier directly.",
    dep: 'Client couriers kits' },
  { title: 'UGC brief for creators', who: 'Dharshini', due: '2026-10-06', priority: 'MEDIUM', type: 'DIGITAL_MARKETING',
    notes: "One-page brief: what to shoot, tags, do/don't, delivery date. Creators post user-generated content in return for the kit.",
    dep: 'Creator list' },
  { title: 'Community workout session plan', who: 'Dharshini', due: '2026-10-10', priority: 'MEDIUM', type: 'DIGITAL_MARKETING',
    notes: 'Plan one sponsored session with a jogging/walking/cycling club (about 10 people, product offered, filmed and posted). Draft plan and cost, get client OK before approaching any club.',
    dep: 'Client OK on kit cost' },
  { title: 'Paid ads proposal (awareness first)', who: 'Dharshini', due: '2026-10-08', priority: 'MEDIUM', type: 'DIGITAL_MARKETING',
    notes: 'Send a clear one-page ad plan: Rs 30-50K/mo, 3 cities, 2 months awareness to build retargeting audience, no sales focus. Their decision was unclear; close the question.',
    dep: 'Client decision' },
];

// ── What this database has ───────────────────────────────────────────────────

const models = Prisma.dmmf.datamodel.models;
const enums = Prisma.dmmf.datamodel.enums;
const fieldsOf = (model) => new Set((models.find((m) => m.name === model)?.fields ?? []).map((f) => f.name));
const enumValues = (name) => (enums.find((e) => e.name === name)?.values ?? []).map((v) => v.name);
const TASK = fieldsOf('Task');
const PROJECT = fieldsOf('Project');
const has = (set, f) => set.has(f);
const live = (set) => (has(set, 'deletedAt') ? { deletedAt: null } : {});

const problems = [];
const say = (...a) => console.log(...a);
const line = () => say('─'.repeat(78));

async function main() {
  line();
  say(APPLY ? 'CREATING — APPLY=yes' : 'LOOK ONLY — nothing will be changed');
  line();

  // Schema this server has.
  const migrations = await db.$queryRawUnsafe(
    'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 3',
  ).catch(() => []);
  say('Latest migrations:', migrations.map((m) => m.migration_name).join(', ') || '(could not read)');
  const need = [
    ['Project.isSample (Sample work)', has(PROJECT, 'isSample')],
    ['Task.assignees (people on a task)', has(TASK, 'assignees')],
    ['Task.priority', has(TASK, 'priority')],
    ['Task.notes', has(TASK, 'notes')],
  ];
  for (const [label, ok] of need) say(`  ${ok ? 'yes' : 'NO '}  ${label}`);
  if (!has(PROJECT, 'isSample')) problems.push('This server has no Sample work yet (Project.isSample). Deploy first.');
  const taskTypes = has(TASK, 'taskType') ? enumValues('TaskType') : [];
  const statuses = enumValues('TaskStatus');
  say('  Task types here:', taskTypes.join(', ') || '(none)');
  say('  Task statuses here:', statuses.join(', '));

  // The organisation.
  const orgs = await db.organization.findMany({ select: { id: true, name: true } });
  if (orgs.length !== 1) problems.push(`Expected one organisation, found ${orgs.length}: ${orgs.map((o) => o.name).join(', ')}`);
  const org = orgs[0];
  say('\nOrganisation:', org ? `${org.name} (${org.id})` : '—');
  if (!org) return finish();
  const orgId = org.id;

  // People.
  const users = await db.user.findMany({
    where: { organizationId: orgId, active: true },
    select: { id: true, name: true, email: true },
  });
  const person = (first) => {
    const hits = users.filter((u) => u.name.toLowerCase().split(/\s+/)[0] === first.toLowerCase());
    if (hits.length === 1) return hits[0];
    problems.push(
      hits.length === 0
        ? `No active person called "${first}".`
        : `More than one "${first}": ${hits.map((u) => `${u.name} <${u.email}>`).join(', ')}`,
    );
    return null;
  };
  const people = Object.fromEntries(['Harish', 'Akmal', 'Janani', 'Dharshini'].map((n) => [n, person(n)]));
  const creator = users.find((u) => u.email.toLowerCase() === CREATED_BY_EMAIL.toLowerCase()) || people.Harish;
  say('\nPeople:');
  for (const [n, u] of Object.entries(people)) say(`  ${n.padEnd(10)} ${u ? `${u.name} <${u.email}>` : 'NOT FOUND'}`);
  say(`  Created by: ${creator ? `${creator.name} <${creator.email}>` : 'NOT FOUND'}`);
  if (!creator) problems.push(`Nobody to record as creating the tasks (${CREATED_BY_EMAIL}).`);

  // Companies.
  const companies = await db.company.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true, status: true },
  });
  const company = (label, re, override) => {
    if (override) return companies.find((c) => c.id === override) || (problems.push(`${label}: no company ${override}`), null);
    const hits = companies.filter((c) => re.test(c.name));
    if (hits.length === 1) return hits[0];
    problems.push(
      hits.length === 0
        ? `${label}: no company matching ${re}. Create it in Flowzen first.`
        : `${label}: several companies match — set ${label}_COMPANY_ID to one of: ${hits.map((c) => `${c.name} (${c.status}) ${c.id}`).join(' · ')}`,
    );
    return null;
  };
  const voso = company('VOSO', /voso/i, process.env.VOSO_COMPANY_ID);
  const essa = company('ESSA', /\besa\b|\bessa\b/i, process.env.ESSA_COMPANY_ID);
  say('\nCompanies:');
  say(`  VOSO  ${voso ? `${voso.name} · ${voso.status} · ${voso.id}` : 'NOT FOUND'}`);
  say(`  ESSA  ${essa ? `${essa.name} · ${essa.status} · ${essa.id}` : 'NOT FOUND'}`);

  // VOSO's project.
  let project = null;
  if (voso) {
    const projects = await db.project.findMany({
      where: { companyId: voso.id, ...live(PROJECT), ...(has(PROJECT, 'isSample') ? { isSample: false } : {}) },
      select: { id: true, name: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    say('\nVOSO projects:');
    for (const p of projects) say(`  ${p.name} · ${p.status} · ${p.id}`);
    if (process.env.VOSO_PROJECT_ID) project = projects.find((p) => p.id === process.env.VOSO_PROJECT_ID) || null;
    else {
      const liveOnes = projects.filter((p) => p.status === 'LIVE');
      if (liveOnes.length === 1) project = liveOnes[0];
      else
        problems.push(
          liveOnes.length === 0
            ? 'VOSO has no live project.'
            : 'VOSO has several live projects — set VOSO_PROJECT_ID to the website one.',
        );
    }
    say(`  → website tasks go to: ${project ? project.name : 'NOT CHOSEN'}`);
  }

  // VOSO's retainer, its month, and the project inside it the tasks are filed
  // under — a retainer task must sit in one of the retainer's projects.
  let monthCard = null;
  let retainerProject = null;
  if (voso) {
    const retainers = await db.retainer.findMany({
      where: { companyId: voso.id, ...(process.env.RETAINER_ID ? { id: process.env.RETAINER_ID } : {}) },
      select: {
        id: true,
        status: true,
        monthCards: { select: { id: true, month: true, status: true }, orderBy: { month: 'desc' }, take: 4 },
      },
    });
    say('\nVOSO retainers:');
    for (const r of retainers)
      say(`  ${r.status} · ${r.id} · months: ${r.monthCards.map((m) => `${m.month} ${m.status}`).join(', ') || 'none'}`);
    const active = retainers.filter((r) => r.status === 'ACTIVE');
    if (active.length !== 1) {
      problems.push(active.length === 0 ? 'VOSO has no active retainer.' : 'VOSO has several active retainers — set RETAINER_ID.');
    } else {
      if (has(TASK, 'retainerProjectId')) {
        const rps = await db.retainerProject.findMany({
          where: { retainerId: active[0].id },
          select: { id: true, name: true, isDefault: true },
        });
        say('  Projects inside it:');
        for (const rp of rps) say(`    ${rp.name}${rp.isDefault ? ' (default)' : ''} · ${rp.id}`);
        retainerProject = process.env.RETAINER_PROJECT_ID
          ? rps.find((rp) => rp.id === process.env.RETAINER_PROJECT_ID) || null
          : rps.find((rp) => rp.isDefault) || null;
        if (!retainerProject) problems.push('Could not choose a project inside the VOSO retainer — set RETAINER_PROJECT_ID.');
      }
      monthCard = active[0].monthCards.find((m) => m.month === MONTH) || null;
      if (!monthCard)
        problems.push(
          `The VOSO retainer has no ${MONTH} month yet — it is made on the 1st. Run again after that, or set MONTH to an open month.`,
        );
      else if (monthCard.status !== 'OPEN') problems.push(`The VOSO ${MONTH} month is closed.`);
    }
    say(
      `  → promotion tasks go to: ${monthCard ? `the ${monthCard.month} month (${monthCard.status})` : 'NOT CHOSEN'}${
        retainerProject ? `, under "${retainerProject.name}"` : ''
      }`,
    );
  }

  // ESSA's sample work.
  let sample = null;
  if (essa && has(PROJECT, 'isSample')) {
    sample = await db.project.findFirst({
      where: { companyId: essa.id, isSample: true, name: SAMPLE_NAME, ...live(PROJECT) },
      select: { id: true, name: true },
    });
    say(`\nESSA sample work: ${sample ? `"${sample.name}" exists — reusing it (${sample.id})` : `"${SAMPLE_NAME}" will be created (₹0, not billed)`}`);
  }

  // What would be written, and what is already there.
  const already = async (where, title) =>
    Boolean(await db.task.findFirst({ where: { ...where, title, ...live(TASK) }, select: { id: true } }));
  const plan = [];
  const add = async (group, list, where) => {
    for (const t of list) {
      const skip = where ? await already(where, t.title) : false;
      plan.push({ group, t, skip });
    }
  };
  await add('ESSA sample work', ESSA, sample ? { projectId: sample.id } : null);
  await add('VOSO website project', VOSO_WEBSITE, project ? { projectId: project.id } : null);
  await add(`VOSO retainer ${MONTH}`, VOSO_RETAINER, monthCard ? { monthCardId: monthCard.id } : null);

  let group = '';
  for (const p of plan) {
    if (p.group !== group) {
      group = p.group;
      say(`\n${group}:`);
    }
    const who = people[p.t.who];
    say(
      `  ${p.skip ? 'SKIP (already there) ' : ''}${p.t.due}  ${p.t.priority.padEnd(6)} ${(who ? who.name : p.t.who + '?').padEnd(12)} ${p.t.title}${p.t.status === 'IN_PROGRESS' ? '  [In progress]' : ''}`,
    );
  }
  const toCreate = plan.filter((p) => !p.skip);
  say(`\n${toCreate.length} task(s) to create, ${plan.length - toCreate.length} already there.`);

  if (problems.length) {
    say('\nPROBLEMS — fix these first:');
    for (const p of problems) say(`  • ${p}`);
  }
  if (!APPLY) return finish('\nLook only — nothing was changed. When this is right, run again with APPLY=yes.');
  if (problems.length) return finish('\nNot creating anything while there are problems.');

  // ── Write ──────────────────────────────────────────────────────────────────
  const now = new Date();
  const created = await db.$transaction(
    async (tx) => {
      let sampleId = sample?.id;
      if (!sampleId) {
        const made = await tx.project.create({
          data: {
            organizationId: orgId,
            companyId: essa.id,
            name: SAMPLE_NAME,
            quotedValue: 0,
            isSample: true,
            ...(has(PROJECT, 'gstPercent') ? { gstPercent: null } : {}),
            startDate: new Date(now.toISOString().slice(0, 10)),
            endDate: new Date('2026-10-13'),
            ownerId: creator.id,
            status: 'LIVE',
            ...(has(PROJECT, 'priority') ? { priority: 'MEDIUM' } : {}),
            ...(has(PROJECT, 'description')
              ? { description: 'Sample content for ESSA from the 28 Sep meeting — catalogue, videos and social. Not billed.' }
              : {}),
          },
        });
        sampleId = made.id;
        await tx.activity.create({
          data: {
            organizationId: orgId,
            entityType: 'Project',
            entityId: made.id,
            actorId: creator.id,
            verb: 'project_created',
            payload: { name: made.name, quotedValue: 0 },
          },
        });
      }

      let n = 0;
      for (const p of toCreate) {
        const who = people[p.t.who];
        const target =
          p.group === 'ESSA sample work'
            ? { workType: 'PROJECT', projectId: sampleId }
            : p.group === 'VOSO website project'
              ? { workType: 'PROJECT', projectId: project.id }
              : {
                  workType: 'MONTH_CARD',
                  monthCardId: monthCard.id,
                  ...(retainerProject ? { retainerProjectId: retainerProject.id } : {}),
                };
        // A re-check inside the transaction, for the sample that was just made.
        if (await tx.task.findFirst({ where: { ...target, title: p.t.title, ...live(TASK) }, select: { id: true } })) continue;
        const notes = [p.t.notes, p.t.dep ? `Depends on: ${p.t.dep}` : null].filter(Boolean).join('\n\n');
        const task = await tx.task.create({
          data: {
            organizationId: orgId,
            title: p.t.title,
            ...target,
            ...(has(TASK, 'assigneeId') ? { assigneeId: who.id } : {}),
            createdById: creator.id,
            dueDate: new Date(p.t.due),
            assignedAt: now,
            status: p.t.status && statuses.includes(p.t.status) ? p.t.status : 'TODO',
            ...(has(TASK, 'priority') ? { priority: p.t.priority } : {}),
            ...(has(TASK, 'notes') ? { notes } : {}),
            ...(taskTypes.includes(p.t.type) ? { taskType: p.t.type } : {}),
            ...(has(TASK, 'assignees') ? { assignees: { create: [{ userId: who.id }] } } : {}),
          },
        });
        await tx.activity.create({
          data: {
            organizationId: orgId,
            entityType: 'Task',
            entityId: task.id,
            actorId: creator.id,
            verb: 'task_created',
            payload: { title: task.title, workType: task.workType, assigneeIds: [who.id] },
          },
        });
        n++;
      }
      return n;
    },
    { timeout: 60000 },
  );
  finish(`\nCreated ${created} task(s)${sample ? '' : ` and the sample work "${SAMPLE_NAME}"`}.`);
}

function finish(msg) {
  if (msg) say(msg);
  line();
}

main()
  .catch((e) => {
    console.error('\nFAILED — nothing was written (it runs in one transaction).\n', e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
