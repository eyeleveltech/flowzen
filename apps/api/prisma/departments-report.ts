/**
 * After the add_departments migration: which departments it created, who it
 * could not place, and which names look like one department spelled twice —
 * so management knows what to merge in Settings → Departments.
 *
 * Read-only. Run it against a copy of production before deploying, and again
 * on production after:
 *
 *   npx tsx prisma/departments-report.ts
 *
 * It also checks the database against services/departmentBackfill.ts — the
 * migration's SQL written out as code — and says so if the two disagree.
 */
import { PrismaClient } from '@prisma/client';
import { lookAlikes, planDepartments } from '../src/services/departmentBackfill.js';

const prisma = new PrismaClient();

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true, departments: true } });
  let problems = 0;

  for (const org of orgs) {
    const [departments, people] = await Promise.all([
      prisma.department.findMany({
        where: { organizationId: org.id },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          archivedAt: true,
          head: { select: { name: true } },
          members: { select: { id: true, name: true, active: true } },
        },
      }),
      prisma.user.findMany({
        where: { organizationId: org.id },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, dept: true, active: true, departmentId: true },
      }),
    ]);

    console.log(`\n${org.name}`);
    console.log(`  Departments (${departments.length}):`);
    for (const d of departments) {
      const active = d.members.filter((m) => m.active).length;
      console.log(
        `    ${d.name}${d.archivedAt ? ' (archived)' : ''} — ${active} active${d.members.length > active ? `, ${d.members.length - active} inactive` : ''}` +
          `${d.head ? ` · head ${d.head.name}` : ' · no head yet'}`,
      );
    }

    const unplaced = people.filter((p) => !p.departmentId);
    console.log(`  No department (${unplaced.length}):${unplaced.length ? '' : ' nobody'}`);
    for (const p of unplaced) console.log(`    ${p.name}${p.active ? '' : ' (inactive)'} — was "${p.dept}"`);

    const alike = lookAlikes(departments.filter((d) => !d.archivedAt).map((d) => d.name));
    if (alike.length) {
      console.log('  Probably the same department — merge in Settings → Departments:');
      for (const g of alike) console.log(`    ${g.join('  /  ')}`);
    }

    // The database against the mapping written as code.
    const plan = planDepartments(org.departments, people);
    const inDb = new Set(departments.map((d) => d.name.toLowerCase()));
    const missing = plan.departments.filter((d) => !inDb.has(d.name.toLowerCase()));
    const misplaced = people.filter((p) => {
      const want = plan.placed.get(p.id)?.toLowerCase();
      const got = departments.find((d) => d.id === p.departmentId)?.name.toLowerCase();
      return want !== undefined && got !== undefined && want !== got;
    });
    if (missing.length || misplaced.length) {
      problems += missing.length + misplaced.length;
      console.log('  ⚠ Differs from the backfill mapping:');
      for (const d of missing) console.log(`    no department called "${d.name}"`);
      for (const p of misplaced) console.log(`    ${p.name} is not in "${plan.placed.get(p.id)}"`);
    }
  }

  console.log(problems ? `\n${problems} difference(s) from the mapping — look before deploying.` : '\nMatches the backfill mapping.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
